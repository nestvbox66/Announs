/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Servicio de Packages de Seguridad de tipo Safety Video (`taxi_crew_safety_brief`
 * en modo `PACK`).
 *
 * Responsabilidades:
 *  - Consultar el catálogo `packages` filtrando por
 *    `package_type = 'safety_video'` y `status = 'approved'`, con match contra
 *    el `airline_icao` del vuelo actual (los genéricos —`airline_icao` nulo o
 *    vacío— siempre aplican).
 *  - Mantener el package seleccionado para el vuelo en curso.
 *  - Pre-descargar en segundo plano el `package_url` (Supabase Storage) a un
 *    caché local en memoria (blob + object URL) para reproducción instantánea.
 *  - Bus de reproducción: la cola de anuncios solicita la reproducción en el
 *    IFE (`requestPlayAndWait`) y el propio monitor (`IfeScreen`) la muestra y
 *    la resuelve al terminar el video (o por timeout de seguridad, para no
 *    bloquear nunca la narrativa).
 */

import { supabase } from "../lib/supabase";
import type { PackageRecord } from "./PackagesService";
import { fileLogger } from "./FileLogger";
import { SAFETY_VIDEO_PACKAGE_STORAGE_KEY } from "./eventConfigConstants";

/** Clave del evento que puede usar video de seguridad de la comunidad. */
export const SAFETY_VIDEO_EVENT_KEY = "taxi_crew_safety_brief";

/** TTL del caché local de video (7 días, igual que la música ambiental). */
export const SAFETY_VIDEO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PACKAGE_SELECT =
  "id, package_name, package_desc, package_type, package_url, cover_image_url, duration_seconds, status, airline_icao, package_enabled, user_id, created_at";

/** Valores de `airline_icao` que se consideran "genéricos" (valen para todo). */
const GENERIC_AIRLINE_TOKENS = new Set(["", "N/A", "-", "NA", "NULL", "GENERIC", "ALL"]);

/** ¿El package es genérico (sin aerolínea asignada)? */
export function isGenericSafetyPackage(pkg: Pick<PackageRecord, "airline_icao">): boolean {
  const icao = (pkg.airline_icao ?? "").toString().toUpperCase().trim();
  return GENERIC_AIRLINE_TOKENS.has(icao);
}

/** Normaliza un ICAO de aerolínea (mayúsculas, sin espacios). */
export function normalizeAirlineIcao(value: string | null | undefined): string {
  return (value ?? "").toString().toUpperCase().trim();
}

function toPackageRecord(row: any): PackageRecord {
  return {
    id: String(row.id),
    package_name: row.package_name ?? "",
    package_desc: row.package_desc ?? null,
    package_type: row.package_type,
    package_url: row.package_url ?? null,
    cover_image_url: row.cover_image_url ?? null,
    duration_seconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    status: row.status ?? "pending",
    airline_icao: row.airline_icao ?? null,
    package_enabled: row.package_enabled ?? true,
    user_id: row.user_id ?? null,
    created_at: row.created_at ?? "",
  };
}

export interface SafetyVideoPlayRequest {
  eventKey: string;
  packageId: string;
  packageName: string;
  /** URL local cacheada (object URL) si la pre-descarga terminó; si no, null. */
  objectUrl: string | null;
  /** URL remota de Supabase Storage (fallback con streaming). */
  remoteUrl: string;
  durationSeconds: number | null;
}

interface CachedVideo {
  packageId: string;
  blob: Blob;
  objectUrl: string;
  remoteUrl: string;
  timestamp: number;
}

type PlayListener = (request: SafetyVideoPlayRequest) => void;

class SafetyVideoPackService {
  private activePackage: PackageRecord | null = null;
  private cache = new Map<string, CachedVideo>();
  private playListeners = new Set<PlayListener>();
  private pendingWaits = new Map<string, Set<(outcome: "completed" | "timeout") => void>>();

  // ── Selección ────────────────────────────────────────────────────

  /** Package seleccionado para el vuelo en curso (o default del usuario). */
  getActivePackage(): PackageRecord | null {
    return this.activePackage;
  }

  setActivePackage(pkg: PackageRecord | null): void {
    this.activePackage = pkg;
  }

  /** URL local cacheada del package activo, si ya se pre-descargó. */
  getActiveObjectUrl(): string | null {
    if (!this.activePackage) return null;
    const cached = this.cache.get(this.activePackage.id);
    if (cached && Date.now() - cached.timestamp < SAFETY_VIDEO_CACHE_TTL_MS) {
      return cached.objectUrl;
    }
    return null;
  }

  /** ¿Hay video cacheado en memoria para este package? */
  isCached(packageId: string): boolean {
    const cached = this.cache.get(packageId);
    return !!cached && Date.now() - cached.timestamp < SAFETY_VIDEO_CACHE_TTL_MS;
  }

  /** Id del package por defecto guardado por el usuario (Settings/pre-vuelo). */
  getStoredPackageId(): string | null {
    try {
      return localStorage.getItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Resuelve el package activo para una aerolínea: el preferido (por id) si
   * sigue disponible, si no el primero del catálogo, si no null. Se usa al
   * iniciar el vuelo cuando el dropdown no dejó registro en memoria (pestaña
   * sin abrir, catálogo aún cargando o PACK configurado desde Settings).
   */
  async resolveActivePackage(
    airlineIcao: string | null | undefined,
    preferredId?: string | null
  ): Promise<PackageRecord | null> {
    const { data, error } = await this.listSafetyVideosForAirline(airlineIcao);
    if (error) {
      console.warn("[SafetyVideo] No se pudo resolver el package activo:", error);
      fileLogger.warn("[SafetyVideo] resolveActivePackage falló", {
        airlineIcao: airlineIcao ?? null,
        error,
      });
      return null;
    }
    if (data.length === 0) {
      console.warn("[SafetyVideo] Sin videos para la aerolínea:", airlineIcao ?? "(todas)");
      fileLogger.warn("[SafetyVideo] Sin videos para la aerolínea", {
        airlineIcao: airlineIcao ?? null,
      });
      return null;
    }
    if (preferredId) {
      const found = data.find((pkg) => pkg.id === preferredId) ?? null;
      if (found) return found;
    }
    return data[0];
  }

  // ── Catálogo ─────────────────────────────────────────────────────

  /**
   * Lista los videos de seguridad disponibles para una aerolínea:
   * `package_type = 'safety_video'`, `status = 'approved'`, habilitados, y con
   * match de `airline_icao` (o genéricos). Los específicos de la aerolínea van
   * primero; dentro de cada grupo, los más recientes primero.
   *
   * Con `airlineIcao` vacío se devuelven todos (pantalla de preferencias sin
   * vuelo asociado).
   */
  async listSafetyVideosForAirline(
    airlineIcao: string | null | undefined
  ): Promise<{ data: PackageRecord[]; error: string | null }> {
    const wanted = normalizeAirlineIcao(airlineIcao);
    try {
      const { data, error } = await supabase
        .from("packages")
        .select(PACKAGE_SELECT)
        .eq("package_type", "safety_video")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) return { data: [], error: error.message };

      const records = ((data ?? []) as any[])
        .map(toPackageRecord)
        // Los deshabilitados por su dueño no se ofrecen para reproducir.
        .filter((pkg) => pkg.package_enabled !== false)
        .filter((pkg) => !!pkg.package_url)
        .filter((pkg) => {
          if (!wanted) return true;
          if (isGenericSafetyPackage(pkg)) return true;
          return normalizeAirlineIcao(pkg.airline_icao) === wanted;
        });

      records.sort((a, b) => {
        const aSpecific = !isGenericSafetyPackage(a) ? 0 : 1;
        const bSpecific = !isGenericSafetyPackage(b) ? 0 : 1;
        if (aSpecific !== bSpecific) return aSpecific - bSpecific;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });

      return { data: records, error: null };
    } catch (err) {
      return { data: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Caché local (pre-descarga en segundo plano) ──────────────────

  /**
   * Descarga silenciosa del `package_url` a un blob local + object URL.
   * Idempotente: si ya está cacheado y vigente, reutiliza el caché. Nunca
   * lanza (los errores se devuelven en `error` para loguearlos sin romper el
   * inicio del vuelo).
   */
  async precacheSafetyVideo(
    pkg: PackageRecord
  ): Promise<{ objectUrl: string | null; fromCache: boolean; error: string | null }> {
    const cached = this.cache.get(pkg.id);
    if (cached && Date.now() - cached.timestamp < SAFETY_VIDEO_CACHE_TTL_MS) {
      return { objectUrl: cached.objectUrl, fromCache: true, error: null };
    }
    if (!pkg.package_url) {
      return { objectUrl: null, fromCache: false, error: "Package sin package_url" };
    }
    try {
      console.log("[SafetyVideo] ⏬ Pre-descargando en segundo plano:", {
        id: pkg.id,
        name: pkg.package_name,
      });
      const response = await fetch(pkg.package_url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al descargar ${pkg.package_url}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const previous = this.cache.get(pkg.id);
      if (previous) {
        try {
          URL.revokeObjectURL(previous.objectUrl);
        } catch {
          // ignorar: la URL anterior ya era inválida
        }
      }
      this.cache.set(pkg.id, {
        packageId: pkg.id,
        blob,
        objectUrl,
        remoteUrl: pkg.package_url,
        timestamp: Date.now(),
      });
      console.log("[SafetyVideo] ✅ Video cacheado localmente:", {
        id: pkg.id,
        bytes: blob.size,
      });
      fileLogger.log("[SafetyVideo] Video cacheado", { id: pkg.id, bytes: blob.size });
      return { objectUrl, fromCache: false, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[SafetyVideo] ⚠️ Pre-descarga fallida (se usará streaming):", message);
      fileLogger.warn("[SafetyVideo] Pre-descarga fallida", { id: pkg.id, error: message });
      return { objectUrl: null, fromCache: false, error: message };
    }
  }

  /** Libera los object URL cacheados (p. ej. al cerrar el vuelo). */
  clearCache(): void {
    for (const cached of this.cache.values()) {
      try {
        URL.revokeObjectURL(cached.objectUrl);
      } catch {
        // ignorar
      }
    }
    this.cache.clear();
  }

  // ── Bus de reproducción (cola → IFE) ─────────────────────────────

  /** La UI del IFE se suscribe para mostrar el video cuando se dispare. */
  onPlayRequest(listener: PlayListener): () => void {
    this.playListeners.add(listener);
    return () => {
      this.playListeners.delete(listener);
    };
  }

  /**
   * Solicita la reproducción en el IFE y espera a que termine. Se resuelve con
   * `"completed"` cuando la UI notifica el fin (o cierre/error del video) y con
   * `"timeout"` si vence el margen de seguridad (la narrativa nunca queda
   * bloqueada aunque el IFE no esté montado).
   */
  requestPlayAndWait(
    request: SafetyVideoPlayRequest,
    timeoutMs?: number
  ): Promise<"completed" | "timeout"> {
    const durationMs =
      request.durationSeconds != null && Number.isFinite(request.durationSeconds)
        ? request.durationSeconds * 1000
        : 120000;
    const marginMs = timeoutMs ?? Math.min(Math.max(durationMs + 20000, 30000), 600000);

    console.log("[SafetyVideo] ▶️ Solicitando reproducción en IFE:", {
      eventKey: request.eventKey,
      packageId: request.packageId,
      cached: request.objectUrl != null,
    });
    fileLogger.log("[SafetyVideo] Reproducción solicitada", {
      eventKey: request.eventKey,
      packageId: request.packageId,
      cached: request.objectUrl != null,
    });

    for (const listener of Array.from(this.playListeners)) {
      try {
        listener(request);
      } catch (err) {
        console.warn("[SafetyVideo] Play listener falló:", err);
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: "completed" | "timeout") => {
        if (settled) return;
        settled = true;
        const waiters = this.pendingWaits.get(request.eventKey);
        if (waiters) {
          waiters.delete(finish);
          if (waiters.size === 0) this.pendingWaits.delete(request.eventKey);
        }
        resolve(outcome);
      };
      let waiters = this.pendingWaits.get(request.eventKey);
      if (!waiters) {
        waiters = new Set();
        this.pendingWaits.set(request.eventKey, waiters);
      }
      waiters.add(finish);
      setTimeout(() => {
        console.warn("[SafetyVideo] ⏱️ Timeout de reproducción, avanzando:", request.eventKey);
        fileLogger.warn("[SafetyVideo] Timeout de reproducción", { eventKey: request.eventKey });
        finish("timeout");
      }, marginMs);
    });
  }

  /** La UI del IFE llama aquí al terminar (fin, error o cierre del video). */
  notifyPlaybackFinished(eventKey: string): void {
    const waiters = this.pendingWaits.get(eventKey);
    if (!waiters || waiters.size === 0) return;
    console.log("[SafetyVideo] ✅ Reproducción finalizada:", eventKey);
    fileLogger.log("[SafetyVideo] Reproducción finalizada", { eventKey });
    for (const finish of Array.from(waiters)) {
      try {
        finish("completed");
      } catch {
        // ignorar
      }
    }
  }
}

/** Instancia única compartida entre configuración, vuelo, cola e IFE. */
export const safetyVideoPackService = new SafetyVideoPackService();
