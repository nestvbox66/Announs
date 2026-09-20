/**
 * FlightPathRecorder — registro en memoria del recorrido del vuelo activo.
 *
 * Durante el bucle de telemetría (≈1 Hz) NO se guarda cada muestra de forma
 * ciega: se aplica un downsampling por delta contra el último punto guardado y
 * solo se agrega un punto nuevo si la variación es significativa:
 *   - rumbo (heading) > 2°
 *   - altitud > 500 ft
 *   - velocidad ground > 20 kt
 *   - (seguridad) pasaron >= 60 s sin registrar → se fuerza un punto para no
 *     perder continuidad temporal en tramos estables (p. ej. crucero).
 *
 * Cada punto es un array 3D+telemetría: [longitud, latitud, altitud, velocidad]
 * más los segundos transcurridos desde el primer punto (5.º elemento, para
 * graficar el eje temporal sin compresión por downsampling).
 * Al empaquetar se genera un GeoJSON Feature con geometría LineString.
 *
 * La persistencia y el vaciado del buffer los orquesta el llamador
 * (VueloActualView) a través de FlightPathService: el buffer se limpia recién
 * tras un guardado exitoso.
 */

/** [longitud, latitud, altitud(ft), velocidad(kt), segundosTranscurridos?] */
export type FlightPathPoint = [number, number, number, number, number?];

export interface FlightPathSample {
  latitude: number;
  longitude: number;
  altitude: number;
  groundspeed: number;
  heading: number;
  /** Señal física tierra/aire (SimConnect `simOnGround`). */
  simOnGround?: boolean | null;
}

export interface FlightPathFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: FlightPathPoint[];
  };
  properties: {
    flight_id: string | null;
    flight_phase: string | null;
    scenario_key: string | null;
    point_count: number;
    started_at: string | null;
    ended_at: string | null;
  };
}

export interface FlightPathRecorderStartOptions {
  phase?: string | null;
  scenarioKey?: string | null;
}

import { haversineNm } from "./flightHistoryFormat";

export class FlightPathRecorder {
  /** Umbral de variación de rumbo (grados). */
  static readonly HEADING_DELTA_DEG = 2;
  /** Umbral de variación de altitud (pies). */
  static readonly ALTITUDE_DELTA_FT = 500;
  /** Umbral de variación de velocidad ground (nudos). */
  static readonly GROUNDSPEED_DELTA_KT = 20;
  /** Intervalo máximo sin registrar antes de forzar un punto (ms). */
  static readonly MAX_GAP_MS = 60_000;

  /** Fases narrativas con el avión en el aire (claves normalizadas del Scheduler). */
  private static readonly AIR_PHASES = new Set(["TAKEOFF", "CLIMB", "CRUISE", "DESCENT"]);
  /** Fases narrativas con el avión en tierra. */
  private static readonly GROUND_PHASES = new Set([
    "GATE",
    "BOARDING",
    "PRE_FLIGHT",
    "TAXI",
    "TAXI_TO_GATE",
    "AT_GATE",
  ]);
  /** Fases cuya entrada marca el toque (respaldo si no hay `simOnGround`). */
  private static readonly TOUCHDOWN_PHASES = new Set(["LANDING", "TAXI_TO_GATE", "AT_GATE"]);

  private points: FlightPathPoint[] = [];
  private last: FlightPathSample | null = null;
  private lastRecordedAtMs: number | null = null;
  private startMs: number | null = null;
  // Hitos del ciclo tierra→aire→tierra (ms epoch). El despegue es la primera
  // transición tierra→aire y el toque la primera aire→tierra posterior.
  private takeoffMs: number | null = null;
  private touchdownMs: number | null = null;
  private prevOnGround: boolean | null = null;
  private prevPhase: string | null = null;
  private startedAtIso: string | null = null;
  private endedAtIso: string | null = null;
  private flightPhase: string | null = null;
  private scenarioKey: string | null = null;
  private recording = false;

  /** Arranca un vuelo nuevo: limpia el buffer y habilita el registro. */
  start(options: FlightPathRecorderStartOptions = {}): void {
    this.reset();
    this.recording = true;
    this.flightPhase = options.phase ?? null;
    this.scenarioKey = options.scenarioKey ?? null;
  }

  /** Detiene el registro sin borrar el buffer (el llamador decide vaciarlo). */
  stop(): void {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getPointCount(): number {
    return this.points.length;
  }

  getPhase(): string | null {
    return this.flightPhase;
  }

  getScenarioKey(): string | null {
    return this.scenarioKey;
  }

  /** Epoch ms del despegue (primera transición tierra→aire) o null. */
  getTakeoffMs(): number | null {
    return this.takeoffMs;
  }

  /** Epoch ms del toque (primera aire→tierra tras el despegue) o null. */
  getTouchdownMs(): number | null {
    return this.touchdownMs;
  }

  /**
   * Tiempo de vuelo efectivo en minutos (despegue→toque), redondeado.
   * Null si el ciclo no se completó en el buffer actual.
   */
  getAirMinutes(): number | null {
    if (this.takeoffMs === null || this.touchdownMs === null) return null;
    if (this.touchdownMs < this.takeoffMs) return null;
    return Math.round((this.touchdownMs - this.takeoffMs) / 60000);
  }

  /**
   * Distancia total recorrida en millas náuticas: suma de Haversine entre
   * coordenadas sucesivas del historial en memoria.
   */
  getDistanceNm(): number {
    let total = 0;
    for (let i = 1; i < this.points.length; i++) {
      const prev = this.points[i - 1];
      const cur = this.points[i];
      total += haversineNm(prev[1], prev[0], cur[1], cur[0]) ?? 0;
    }
    return Math.round(total * 10) / 10;
  }

  setPhase(phase: string | null | undefined): void {
    if (phase) this.flightPhase = phase;
  }

  /**
   * Evalúa la muestra contra el último punto guardado y la agrega solo si es
   * significativa (o si se cumple el tiempo máximo sin registrar).
   * Devuelve true si se guardó un punto.
   */
  record(
    sample: FlightPathSample,
    phase?: string | null,
    nowMs: number = Date.now()
  ): boolean {
    if (!this.recording) return false;

    const latitude = Number(sample.latitude);
    const longitude = Number(sample.longitude);
    // Sin fix de posición (0,0) no hay nada que graficar.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    if (latitude === 0 && longitude === 0) return false;

    if (phase) this.flightPhase = phase;

    const normalized: FlightPathSample = {
      latitude,
      longitude,
      altitude: Number(sample.altitude) || 0,
      groundspeed: Number(sample.groundspeed) || 0,
      heading: Number(sample.heading) || 0,
      simOnGround: typeof sample.simOnGround === "boolean" ? sample.simOnGround : null,
    };

    this.noteFlightEvents(normalized, phase, nowMs);

    if (this.points.length > 0 && !this.isSignificant(normalized, nowMs)) {
      return false;
    }

    this.push(normalized, nowMs);
    return true;
  }

  /**
   * Detecta despegue y toque a partir de la señal física `simOnGround`
   * (tierra→aire y aire→tierra). Si la telemetría no trae esa señal, usa como
   * respaldo las transiciones de fase narrativa (fases de rodaje vs. fases de
   * vuelo). Solo registra el primer ciclo (ida, sin touch-and-go).
   */
  private noteFlightEvents(sample: FlightPathSample, phase: string | null | undefined, nowMs: number): void {
    const onGround = sample.simOnGround;
    if (typeof onGround === "boolean") {
      if (this.prevOnGround === true && onGround === false && this.takeoffMs === null) {
        this.takeoffMs = nowMs;
      }
      if (
        this.prevOnGround === false &&
        onGround === true &&
        this.takeoffMs !== null &&
        this.touchdownMs === null
      ) {
        this.touchdownMs = nowMs;
      }
      this.prevOnGround = onGround;
    } else if (typeof phase === "string" && phase && phase !== this.prevPhase) {
      const prev = this.prevPhase;
      if (
        this.takeoffMs === null &&
        FlightPathRecorder.AIR_PHASES.has(phase) &&
        (prev === null || FlightPathRecorder.GROUND_PHASES.has(prev))
      ) {
        this.takeoffMs = nowMs;
      }
      if (
        this.takeoffMs !== null &&
        this.touchdownMs === null &&
        FlightPathRecorder.TOUCHDOWN_PHASES.has(phase) &&
        (prev === null || !FlightPathRecorder.GROUND_PHASES.has(prev))
      ) {
        this.touchdownMs = nowMs;
      }
    }
    if (typeof phase === "string" && phase) this.prevPhase = phase;
  }

  private isSignificant(sample: FlightPathSample, nowMs: number): boolean {
    const prev = this.last;
    if (!prev) return true;

    if (
      FlightPathRecorder.headingDeltaDeg(sample.heading, prev.heading) >
      FlightPathRecorder.HEADING_DELTA_DEG
    ) {
      return true;
    }
    if (Math.abs(sample.altitude - prev.altitude) > FlightPathRecorder.ALTITUDE_DELTA_FT) {
      return true;
    }
    if (Math.abs(sample.groundspeed - prev.groundspeed) > FlightPathRecorder.GROUNDSPEED_DELTA_KT) {
      return true;
    }
    // Seguridad: mantener continuidad temporal en tramos estables.
    return (
      this.lastRecordedAtMs !== null &&
      nowMs - this.lastRecordedAtMs >= FlightPathRecorder.MAX_GAP_MS
    );
  }

  private push(sample: FlightPathSample, nowMs: number): void {
    if (this.startMs === null) this.startMs = nowMs;
    const elapsedSec = Math.max(0, Math.round((nowMs - this.startMs) / 1000));
    this.points.push([
      round(sample.longitude, 6),
      round(sample.latitude, 6),
      Math.round(sample.altitude),
      round(sample.groundspeed, 1),
      elapsedSec,
    ]);
    this.last = sample;
    this.lastRecordedAtMs = nowMs;
    const iso = new Date(nowMs).toISOString();
    if (!this.startedAtIso) this.startedAtIso = iso;
    this.endedAtIso = iso;
  }

  /** Empaqueta el recorrido como GeoJSON Feature (LineString). */
  toGeoJSON(flightId: string | null): FlightPathFeature {
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: this.points.map((point) => [...point] as FlightPathPoint),
      },
      properties: {
        flight_id: flightId,
        flight_phase: this.flightPhase,
        scenario_key: this.scenarioKey,
        point_count: this.points.length,
        started_at: this.startedAtIso,
        ended_at: this.endedAtIso,
      },
    };
  }

  /** Limpia todo el estado en memoria (liberación de recursos). */
  reset(): void {
    this.points = [];
    this.last = null;
    this.lastRecordedAtMs = null;
    this.startMs = null;
    this.takeoffMs = null;
    this.touchdownMs = null;
    this.prevOnGround = null;
    this.prevPhase = null;
    this.startedAtIso = null;
    this.endedAtIso = null;
    this.flightPhase = null;
    this.scenarioKey = null;
    this.recording = false;
  }

  /** Diferencia angular mínima entre dos rumbos (0..180). */
  static headingDeltaDeg(a: number, b: number): number {
    const diff = Math.abs((((a - b) % 360) + 360) % 360);
    return diff > 180 ? 360 - diff : diff;
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
