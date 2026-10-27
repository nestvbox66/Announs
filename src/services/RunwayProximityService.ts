/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RunwayProximityService — calcula `onAnyRunway` para X-Plane por paridad
 * con MSFS (vía geometría de pistas, no rumbo/alineación).
 *
 * - Geometría: comando Tauri `get_runways(icao)` (apt.dat local con prioridad
 *   scenery_packs.ini) + caché localStorage estilo `airports_cache` (TTL 7d,
 *   invalidada por ruta+mtime de la fuente).
 * - Evaluación por muestra: punto-en-rectángulo sobre SALIDA y DESTINO
 *   (transition_to_takeoff y transition_to_taxi_in lo consumen); la
 *   planificada se chequea primero como early-out, pero un mismatch dispara
 *   igual y se loguea (semántica "cualquier pista", como MSFS).
 * - Sin geometría: fallback degradado `simOnGround && gs >= 30kt` (visible y
 *   logueado, nunca silencioso). Ver FALLBACK_GROUNDSPEED_KT.
 */

import type { TelemetrySnapshot } from "../types/telemetry";
import {
  checkNearRamp,
  checkOnAnyRunway,
  FALLBACK_GROUNDSPEED_KT,
  PARKING_RADIUS_M,
  type RampStart,
  type RunwayGeometry,
} from "./RunwayGeometry";
import { fileLogger } from "./FileLogger";

const CACHE_KEY = "runways_cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, como airports_cache
const XPLANE_ROOT_KEY = "announs_xplane_root";

interface CachedAirportRunways {
  runways: RunwayGeometry[];
  ramps: RampStart[];
  sourceFile: string;
  sourceMtime: number;
  cachedAt: number;
}

interface CacheEnvelope {
  data: Record<string, CachedAirportRunways>;
  timestamp: number;
}

export type RunwayValueSource = "geometry" | "fallback" | "absent";

export interface RunwayEvaluation {
  value: boolean | null;
  source: RunwayValueSource;
  matchedDesignator: string | null;
  planMismatch: boolean;
  /** ICAO del aeropuerto cuya geometría coincidió (o null). */
  airportIcao: string | null;
}

interface RustRunwayEnd {
  designator: string;
  lat: number;
  lon: number;
  displaced_threshold_m: number;
}

interface RustRunway {
  width_m: number;
  surface: number;
  ends: RustRunwayEnd[];
}

interface RustRamp {
  lat: number;
  lon: number;
  kind: string;
  name: string;
}

interface RustRunwayResponse {
  icao: string;
  runways: RustRunway[];
  ramps: RustRamp[];
  source_file: string;
  source_mtime: number;
  found: boolean;
}

export interface ParkingEvaluation {
  value: boolean | null;
  source: RunwayValueSource;
  /** Nombre del stand coincidente (o null). */
  standName: string | null;
  /** ICAO del aeropuerto (o null). */
  airportIcao: string | null;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Override manual de la raíz de X-Plane (req. B). null = descubrimiento. */
export function getXPlaneRootOverride(): string | null {
  try {
    const v = localStorage.getItem(XPLANE_ROOT_KEY);
    return v !== null && v.trim() !== "" ? v : null;
  } catch {
    return null;
  }
}

export function setXPlaneRootOverride(path: string | null): void {
  try {
    if (path === null || path.trim() === "") {
      localStorage.removeItem(XPLANE_ROOT_KEY);
    } else {
      localStorage.setItem(XPLANE_ROOT_KEY, path);
    }
  } catch {
    // almacenamiento no disponible: se sigue con descubrimiento.
  }
}

function readCache(): Record<string, CachedAirportRunways> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env || typeof env !== "object") return {};
    if (Date.now() - (env.timestamp ?? 0) >= CACHE_TTL_MS) return {};
    return env.data ?? {};
  } catch {
    return {};
  }
}

function writeCache(data: Record<string, CachedAirportRunways>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() } satisfies CacheEnvelope));
  } catch {
    // caché best-effort: se sigue sin persistir.
  }
}

function toGeometry(r: RustRunway): RunwayGeometry | null {
  if (!Array.isArray(r.ends) || r.ends.length !== 2) return null;
  const [a, b] = r.ends;
  if (
    typeof a?.lat !== "number" || typeof a?.lon !== "number" ||
    typeof b?.lat !== "number" || typeof b?.lon !== "number" ||
    typeof r.width_m !== "number"
  ) {
    return null;
  }
  return {
    widthM: r.width_m,
    surface: typeof r.surface === "number" ? r.surface : undefined,
    ends: [
      { designator: String(a.designator ?? ""), lat: a.lat, lon: a.lon, displacedThresholdM: Number(a.displaced_threshold_m ?? 0) || 0 },
      { designator: String(b.designator ?? ""), lat: b.lat, lon: b.lon, displacedThresholdM: Number(b.displaced_threshold_m ?? 0) || 0 },
    ],
  };
}

function toRamp(r: RustRamp): RampStart | null {
  if (typeof r?.lat !== "number" || typeof r?.lon !== "number") return null;
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
  return {
    lat: r.lat,
    lon: r.lon,
    kind: typeof r.kind === "string" && r.kind !== "" ? r.kind : "unknown",
    name: typeof r.name === "string" ? r.name : "",
  };
}

export class RunwayProximityService {
  private departIcao: string | null = null;
  private arriveIcao: string | null = null;
  private planRwy: string | null = null;
  private geo = new Map<string, RunwayGeometry[]>();
  private ramps = new Map<string, RampStart[]>();
  private geoSource = new Map<string, { sourceFile: string; sourceMtime: number }>();
  private loading = new Map<string, Promise<void>>();
  private lastSource: RunwayValueSource | null = null;
  private lastParkingSource: RunwayValueSource | null = null;
  private mismatchLogged = new Set<string>();
  private readonly invokeFn: InvokeFn | null;
  // TEMPORAL DEBUG: hook de progreso para diagnosticar el freeze al iniciar
  // vuelo (sospecha: lectura de apt.dat en disco). Lo setea la UI y debe
  // removerse en la versión final junto con los emits de este archivo.
  public onProgress: ((message: string) => void) | null = null;

  // TEMPORAL DEBUG: remover en la versión final junto con el campo onProgress.
  private emitProgress(message: string): void {
    try {
      this.onProgress?.(message);
    } catch {
      // Nunca romper la carga por el gancho de debug.
    }
  }
  constructor(invokeFn?: InvokeFn | null) {
    this.invokeFn = invokeFn ?? null;
  }

  /** Configura el vuelo y precarga la geometría de salida+destino (no bloquea). */
  configureFlight(opts: {
    departIcao?: string | null;
    arriveIcao?: string | null;
    planRwy?: string | null;
  }): void {
    const norm = (v: string | null | undefined): string | null => {
      const t = (v ?? "").toString().trim().toUpperCase();
      return t === "" ? null : t;
    };
    this.departIcao = norm(opts.departIcao);
    this.arriveIcao = norm(opts.arriveIcao);
    this.planRwy = norm(opts.planRwy);
    this.mismatchLogged.clear();
    const codes = [this.departIcao, this.arriveIcao].filter((c): c is string => c !== null);
    if (codes.length > 0) void this.ensureMany(codes);
  }

  /** Geometría cargada para el ICAO (vacío = aún no / sin datos). */
  getRunways(icao: string): RunwayGeometry[] {
    return this.geo.get(icao.toUpperCase()) ?? [];
  }

  /** Rampas cargadas para el ICAO (vacío = aún no / sin datos). */
  getRamps(icao: string): RampStart[] {
    return this.ramps.get(icao.toUpperCase()) ?? [];
  }

  /** Estado para el DebugMonitor (fuente del valor, coincidencia, archivos). */
  getStatus(): {
    source: RunwayValueSource;
    parkingSource: RunwayValueSource;
    departIcao: string | null;
    arriveIcao: string | null;
    planRwy: string | null;
    departCount: number;
    arriveCount: number;
    departRamps: number;
    arriveRamps: number;
    departSource: string | null;
    arriveSource: string | null;
  } {
    const d = this.departIcao ? this.geoSource.get(this.departIcao) ?? null : null;
    const a = this.arriveIcao ? this.geoSource.get(this.arriveIcao) ?? null : null;
    return {
      source: this.lastSource ?? "absent",
      parkingSource: this.lastParkingSource ?? "absent",
      departIcao: this.departIcao,
      arriveIcao: this.arriveIcao,
      planRwy: this.planRwy,
      departCount: this.departIcao ? this.getRunways(this.departIcao).length : 0,
      arriveCount: this.arriveIcao ? this.getRunways(this.arriveIcao).length : 0,
      departRamps: this.departIcao ? this.getRamps(this.departIcao).length : 0,
      arriveRamps: this.arriveIcao ? this.getRamps(this.arriveIcao).length : 0,
      departSource: d ? `${d.sourceFile} (mtime ${d.sourceMtime})` : null,
      arriveSource: a ? `${a.sourceFile} (mtime ${a.sourceMtime})` : null,
    };
  }

  private async ensureMany(icaos: string[]): Promise<void> {
    const codes = Array.from(new Set(icaos.map((c) => c.toUpperCase()).filter((c) => c !== "")));
    const missing = codes.filter((c) => !this.geo.has(c));
    if (missing.length === 0) return;
    const key = [...missing].sort().join(",");
    const ongoing = this.loading.get(key);
    if (ongoing) {
      await ongoing;
      return;
    }
    const job = this.loadMany(missing).finally(() => {
      this.loading.delete(key);
    });
    this.loading.set(key, job);
    await job;
  }

  private async loadMany(codes: string[]): Promise<void> {
    // TEMPORAL DEBUG: remover en la versión final.
    const t0 = Date.now();
    for (const code of codes) this.emitProgress(`RunwayProximity: preparando geometría ${code}…`);
    // 1. Comando Rust batcheado (con override manual si existe): un solo
    // escaneo de apt.dat resuelve salida+destino (índice en memoria/disco).
    if (this.invokeFn) {
      try {
        // TEMPORAL DEBUG: remover en la versión final.
        this.emitProgress(`RunwayProximity: leyendo apt.dat para ${codes.join("+")} (get_runways_batch)…`);
        const res = (await this.invokeFn("get_runways_batch", {
          icaos: codes,
          xplaneRoot: getXPlaneRootOverride(),
        })) as RustRunwayResponse[];
        // TEMPORAL DEBUG: remover en la versión final.
        this.emitProgress(`RunwayProximity: respuesta recibida, procesando geometría…`);
        const items = Array.isArray(res) ? res : [];
        const batchCache = readCache();
        let touched = false;
        for (const item of items) {
          if (!item || item.found !== true) continue;
          const code = String(item.icao ?? "").toUpperCase();
          if (code === "") continue;
          const geoms = (Array.isArray(item.runways) ? item.runways : [])
            .map(toGeometry)
            .filter((g): g is RunwayGeometry => g !== null);
          const rampList = (Array.isArray(item.ramps) ? item.ramps : [])
            .map(toRamp)
            .filter((r): r is RampStart => r !== null);
          if (geoms.length > 0 || rampList.length > 0) {
            this.geo.set(code, geoms);
            this.ramps.set(code, rampList);
            this.geoSource.set(code, { sourceFile: item.source_file ?? "", sourceMtime: item.source_mtime ?? 0 });
            batchCache[code] = {
              runways: geoms,
              ramps: rampList,
              sourceFile: item.source_file ?? "",
              sourceMtime: item.source_mtime ?? 0,
              cachedAt: Date.now(),
            };
            touched = true;
            // TEMPORAL DEBUG: remover en la versión final.
            this.emitProgress(`RunwayProximity: geometría de ${code} lista (${Date.now() - t0}ms)`);
            fileLogger.log("[RunwayProximity] Geometría cargada", {
              icao: code,
              runways: geoms.length,
              ramps: rampList.length,
              source: item.source_file ?? "",
            });
          }
        }
        if (touched) writeCache(batchCache);
      } catch (err) {
        // TEMPORAL DEBUG: remover en la versión final.
        this.emitProgress(`RunwayProximity: get_runways_batch falló, probando caché…`);
        fileLogger.warn("[RunwayProximity] get_runways_batch falló, probando caché", {
          icaos: codes,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // 2. Caché local (TTL 7d; la mtime guardada permite detectar cambios).
    const localCache = readCache();
    for (const code of codes) {
      if (this.geo.has(code)) continue;
      const cached = localCache[code];
      if (cached && Array.isArray(cached.runways) && (cached.runways.length > 0 || (Array.isArray(cached.ramps) && cached.ramps.length > 0))) {
        this.geo.set(code, cached.runways);
        this.ramps.set(code, Array.isArray(cached.ramps) ? cached.ramps : []);
        this.geoSource.set(code, { sourceFile: cached.sourceFile, sourceMtime: cached.sourceMtime });
        // TEMPORAL DEBUG: remover en la versión final.
        this.emitProgress(`RunwayProximity: geometría de ${code} desde caché (${Date.now() - t0}ms)`);
        fileLogger.log("[RunwayProximity] Geometría desde caché", { icao: code, runways: cached.runways.length });
        continue;
      }
      // 3. Sin datos: el evaluador usará fallback degradado.
      // TEMPORAL DEBUG: remover en la versión final.
      this.emitProgress(`RunwayProximity: sin geometría para ${code} (fallback degradado)`);
      fileLogger.warn("[RunwayProximity] Sin geometría para ICAO (fallback degradado)", { icao: code });
    }
  }

  /**
   * Evalúa un snapshot. Devuelve null si no hay nada que adjuntar (sin
   * lat/lon o sin datos para decidir); si no, el valor + su fuente.
   * Puro respecto a la muestra (no muta el snapshot).
   */
  evaluateSnap(snap: TelemetrySnapshot): RunwayEvaluation | null {
    const lat = Number((snap as unknown as Record<string, unknown>).latitude);
    const lon = Number((snap as unknown as Record<string, unknown>).longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return this.track(null, "absent", null, false, null);
    }
    // Geometría: salida + destino (el ancla de salida y la de arribo).
    for (const icao of [this.departIcao, this.arriveIcao]) {
      if (!icao) continue;
      const runways = this.geo.get(icao);
      if (!runways || runways.length === 0) continue;
      const r = checkOnAnyRunway(lat, lon, runways, { planRwy: icao === this.departIcao ? this.planRwy : null });
      if (r.onRunway) {
        if (r.planMismatch && r.matchedDesignator) {
          const key = `${icao}:${r.matchedDesignator}`;
          if (!this.mismatchLogged.has(key)) {
            this.mismatchLogged.add(key);
            fileLogger.warn("[RunwayProximity] Pista distinta de la planificada (se dispara igual)", {
              icao,
              plan: this.planRwy,
              matched: r.matchedDesignator,
            });
          }
        }
        return this.track(true, "geometry", r.matchedDesignator, r.planMismatch, icao);
      }
    }
    const anyGeometry =
      (this.departIcao !== null && (this.geo.get(this.departIcao)?.length ?? 0) > 0) ||
      (this.arriveIcao !== null && (this.geo.get(this.arriveIcao)?.length ?? 0) > 0);
    if (anyGeometry) {
      return this.track(false, "geometry", null, false, null);
    }
    // Fallback degradado (req. A): en tierra y rápido. Tardío pero no mudo.
    // Umbral 30 kt: rodaje normal 10-20 kt, salidas rápidas ≤25 kt; rotación
    // GA ≥55 kt, reactores ≥120 kt. Falso positivo posible rodando >30 kt en
    // calle (raro/agresivo): queda logueado y visible como 'fallback'.
    const gs = Number((snap as unknown as Record<string, unknown>).groundspeed);
    const onGround = (snap as unknown as Record<string, unknown>).simOnGround === true;
    if (onGround && Number.isFinite(gs)) {
      return this.track(gs >= FALLBACK_GROUNDSPEED_KT, "fallback", null, false, null);
    }
    return this.track(null, "absent", null, false, null);
  }

  private track(
    value: boolean | null,
    source: RunwayValueSource,
    matched: string | null,
    mismatch: boolean,
    airport: string | null
  ): RunwayEvaluation | null {
    if (source !== this.lastSource) {
      fileLogger.log("[RunwayProximity] Fuente del valor", {
        from: this.lastSource,
        to: source,
        value,
        matched,
        airport,
      });
      this.lastSource = source;
    }
    if (value === null && source === "absent") return null;
    return { value, source, matchedDesignator: matched, planMismatch: mismatch, airportIcao: airport };
  }

  /**
   * Paridad `atcOnParkingSpot`: cerca de un ramp-start (fila 1300) + detenido
   * + freno puesto. Misma semántica MSFS en salida (arranca en puerta) y
   * arribo (transition_to_at_gate). Sin rampas no hay fallback deliberado:
   * "detenido+freno en cualquier lado = parking" dispararía en cada punto de
   * espera — peor que ausente. Puro respecto a la muestra.
   */
  evaluateParking(snap: TelemetrySnapshot): ParkingEvaluation | null {
    const rec = snap as unknown as Record<string, unknown>;
    const lat = Number(rec.latitude);
    const lon = Number(rec.longitude);
    const gs = Number(rec.groundspeed);
    const brake = rec.parkingBrake === true;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return this.trackParking(null, "absent", null, null);
    }
    let anyRamps = false;
    for (const icao of [this.departIcao, this.arriveIcao]) {
      if (!icao) continue;
      const ramps = this.ramps.get(icao);
      if (!ramps || ramps.length === 0) continue;
      anyRamps = true;
      const near = checkNearRamp(lat, lon, ramps, PARKING_RADIUS_M);
      if (near.near && near.stand) {
        // Umbral de quietud igual al de la regla (GROUND_VELOCITY < 0.5).
        if (Number.isFinite(gs) && gs < 0.5 && brake) {
          const label = near.stand.name !== "" ? near.stand.name : near.stand.kind;
          return this.trackParking(true, "geometry", label, icao);
        }
        return this.trackParking(false, "geometry", null, null);
      }
    }
    if (anyRamps) {
      return this.trackParking(false, "geometry", null, null);
    }
    return this.trackParking(null, "absent", null, null);
  }

  private trackParking(
    value: boolean | null,
    source: RunwayValueSource,
    stand: string | null,
    airport: string | null
  ): ParkingEvaluation | null {
    if (source !== this.lastParkingSource) {
      fileLogger.log("[RunwayProximity] Fuente de parking", {
        from: this.lastParkingSource,
        to: source,
        value,
        stand,
        airport,
      });
      this.lastParkingSource = source;
    }
    if (value === null) return null;
    return { value, source, standName: stand, airportIcao: airport };
  }
}
