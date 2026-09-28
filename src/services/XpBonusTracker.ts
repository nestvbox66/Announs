/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * XpBonusTracker — acumula evidencia de telemetría por fase para los bonos de
 * XP de disciplina operativa (tabla `flight_xp_breakdown`).
 *
 * Se alimenta muestra a muestra desde el bucle de telemetría
 * (VueloActualView.onTelemetry, ~10Hz) junto con la fase normalizada del
 * Scheduler.
 *
 * TOLERANCIA (grace period): ningún bonus se pierde por una única muestra
 * errónea. Todas las reglas exigen una fracción de TIEMPO cumplido sobre
 * tiempo evaluado (dt real entre muestras, clamp 5s), no un 100% estricto:
 *
 * - Luces taxi/strobe/landing (15/15/25 XP): luz ON en ≥80% del tiempo en su
 *   fase (TAXI / TAKEOFF / LANDING). Margen para encendidos/apagados.
 * - Velocidad (40 XP): <255 kt en ≥80% del tiempo bajo 10.000 ft (margen de
 *   5 kt sobre 250 kt + tolerancia a ráfagas/transitorios).
 * - Perfil vertical (25 + 25 XP): VS ≤3.000 fpm en ≥90% del tiempo en CLIMB y
 *   VS ≥-2.000 fpm en ≥90% del tiempo en DESCENT/APPROACH.
 * - Vuelo nocturno (20 XP): E:TIME OF DAY == 3 en >30% del tiempo con dato
 *   de hora válido. Además acumula horas diurnas/nocturnas para el resumen
 *   del piloto (`getDayNightHours`, `snapshot.dayNight`).
 * - Baliza (20 XP): LIGHT BEACON encendida durante todo el vuelo, con
 *   60 s de gracia tras el inicio (preparativos) y ventana hasta volver a
 *   AT_GATE (al llegar a puerta se congela la evaluación).
 *
 * Sin tiempo evaluado, el bonus correspondiente queda en 0 (fail-closed).
 *
 * Sinergia IA (`ai_companion_synergy_xp`): 3 XP por cada evento de voz del
 * conjunto disparado. Se cuenta en el punto único de reproducción
 * (`AnnouncementQueue` → `announcement:enqueued`, cubre vía narrativa,
 * phase-rules, fallbacks y disparos manuales) además de `step:executed`;
 * las variantes de demora (`preflight_capt_delay_*`) normalizan al casillero
 * canónico. Es por evento (no por muestra) y no exige `recording`.
 */

import { FlightPhase } from "../engine/FlightEngine";
import { fileLogger } from "./FileLogger";
import {
  NIGHT_FLIGHT_BONUS_XP,
  countAiSynergyBonus,
  normalizeSynergyEventKey,
} from "./FlightCompletionBonuses";

export interface XpLightSample {
  taxiLightsOn?: boolean | null;
  landingLightsOn?: boolean | null;
  strobeLightsOn?: boolean | null;
  altitude: number;
  indicatedAirspeed?: number | null;
  groundspeed: number;
  verticalSpeed: number;
  /** E:TIME OF DAY nativo del sim (enum; 3 = noche). Ausente → no computa día/noche. */
  timeOfDay?: number | null;
  /** LIGHT BEACON (baliza) encendida. Ausente/null cuenta como OFF en su ventana. */
  beaconLightsOn?: boolean | null;
}

export interface XpPhaseFraction {
  samples: number;
  on: number;
  fraction: number | null;
  /** Segundos evaluados en la fase/regla (dt real entre muestras). */
  evaluatedSec: number;
  /** Segundos en cumplimiento dentro de lo evaluado. */
  compliedSec: number;
  earned: boolean;
}

export interface SpeedViolationDetail {
  /** Velocidad registrada (kt, IAS preferida, fallback GS). */
  speedKt: number;
  /** Altitud MSL de la muestra (ft). */
  altitudeFt: number;
  /** Fase normalizada del Scheduler al momento de la muestra. */
  phase: string | null;
  /** Timestamp ISO de la primera violación (auditoría). */
  at: string;
}

export interface XpTimeFraction {
  /** Segundos evaluados. */
  evaluatedSec: number;
  /** Segundos en cumplimiento. */
  compliedSec: number;
  /** Fracción cumplido/evaluado (null sin tiempo evaluado). */
  fraction: number | null;
  earned: boolean;
}

export interface XpBonusSnapshot {
  recording: boolean;
  phase: string | null;
  taxi: XpPhaseFraction;
  landing: XpPhaseFraction;
  takeoff: XpPhaseFraction;
  speed: {
    samplesBelow10k: number;
    violations: number;
    evaluatedSec: number;
    compliedSec: number;
    fraction: number | null;
    earned: boolean;
    /** Velocidad máxima vista bajo 10k ft (kt). Clave para auditar excesos. */
    maxKt: number | null;
    /** Detalle de la PRIMERA violación (auditoría). */
    firstViolation: SpeedViolationDetail | null;
  };
  climb: {
    samples: number;
    evaluatedSec: number;
    compliedSec: number;
    fraction: number | null;
    /** ¿Hubo algún exceso puntual? (informativo; el bonus usa la fracción). */
    exceeded: boolean;
    maxVs: number | null;
  };
  descent: {
    samples: number;
    evaluatedSec: number;
    compliedSec: number;
    fraction: number | null;
    /** ¿Hubo algún exceso puntual? (informativo; el bonus usa la fracción). */
    exceeded: boolean;
    minVs: number | null;
  };
  /** Día/noche por E:TIME OF DAY (3 = noche). Listo para persistir. */
  dayNight: {
    /** Horas con dato diurno (timeOfDay !== 3). */
    dayHours: number;
    /** Horas con dato nocturno (timeOfDay === 3). */
    nightHours: number;
    /** Segundos con dato de hora válido (base del porcentaje). */
    evaluatedSec: number;
    /** Fracción nocturna (null sin tiempo con dato). */
    nightFraction: number | null;
    /** Último valor crudo visto (auditoría del enum). */
    lastTimeOfDay: number | null;
    earned: boolean;
    bonus: number;
  };
  /** Eventos de voz de sinergia disparados (únicos) y bonus proyectado. */
  synergy: { events: string[]; bonus: number };
  /** Baliza: ON todo el vuelo (gracia 60 s, ventana hasta AT_GATE). */
  beacon: {
    samples: number;
    evaluatedSec: number;
    compliedSec: number;
    fraction: number | null;
    /** Segundos de gracia restantes (60 s desde el inicio). */
    graceRemainingSec: number;
    /** Evaluación congelada al volver a AT_GATE. */
    frozen: boolean;
    earned: boolean;
  };
  projected: XpBonusResults;
}

export interface XpBonusResults {
  base_time_xp: number;
  disc_taxi_lights_xp: number;
  disc_landing_lights_xp: number;
  disc_strobe_lights_xp: number;
  disc_beacon_lights_xp: number;
  disc_speed_limit_xp: number;
  disc_vertical_profile_xp: number;
}

export interface DayNightHours {
  dayHours: number;
  nightHours: number;
}

const TAXI_PHASES = new Set<string>([FlightPhase.TAXI, "TAXI"]);
const LANDING_PHASES = new Set<string>([FlightPhase.LANDING, "LANDING"]);
const TAKEOFF_PHASES = new Set<string>([FlightPhase.TAKEOFF, "TAKEOFF"]);
const CLIMB_PHASES = new Set<string>([FlightPhase.CLIMB, "CLIMB"]);
const DESCENT_PHASES = new Set<string>([
  FlightPhase.DESCENT,
  FlightPhase.APPROACH,
  "DESCENT",
]);

function fractionMs(compliedMs: number, evaluatedMs: number): number | null {
  if (evaluatedMs <= 0) return null;
  return compliedMs / evaluatedMs;
}

/** Segundos → "H:MM:SS" (o "M:SS" si < 1h) para el monitor en vivo. */
export function formatXpSeconds(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(rest).padStart(2, "0")}`;
}

export class XpBonusTracker {
  static readonly TAXI_LIGHT_MIN_FRACTION = 0.8;
  static readonly LANDING_LIGHT_MIN_FRACTION = 0.8;
  static readonly STROBE_MIN_FRACTION = 0.8;
  /** Cumplimiento efectivo exigido (tolerancia a ráfagas/transitorios). */
  static readonly SPEED_MIN_FRACTION = 0.8;
  static readonly VERTICAL_MIN_FRACTION = 0.9;
  /** Fracción de tiempo nocturno exigida para el bonus. */
  static readonly NIGHT_MIN_FRACTION = 0.3;
  static readonly SPEED_LIMIT_KT = 255;
  static readonly SPEED_ALT_FT = 10000;
  static readonly CLIMB_VS_MAX_FPM = 3000;
  static readonly DESCENT_VS_MAX_FPM = 2000;
  /** E:TIME OF DAY nativo: 3 = noche. */
  static readonly TIME_OF_DAY_NIGHT = 3;
  /** Gracia inicial del beacon tras el inicio (preparativos, no evaluada). */
  static readonly BEACON_GRACE_MS = 60000;
  /** Baliza: ON en (casi) todo el vuelo (épsilon de muestreo, no tolerancia). */
  static readonly BEACON_MIN_FRACTION = 0.999;
  /** dt máximo atribuible a una muestra, en ms (cubre pausas del hilo). */
  static readonly MAX_DT_MS = 5000;
  static readonly XP_TAXI_LIGHTS = 15;
  static readonly XP_LANDING_LIGHTS = 25;
  static readonly XP_STROBE = 15;
  static readonly XP_BEACON = 20;
  static readonly XP_SPEED_LIMIT = 40;
  static readonly XP_VERTICAL_CLIMB = 25;
  static readonly XP_VERTICAL_DESCENT = 25;
  static readonly XP_NIGHT_FLIGHT = NIGHT_FLIGHT_BONUS_XP;

  private recording = false;
  private phase: string | null = null;
  private getAirMinutes: (() => number | null) | null = null;
  private lastSampleAtMs: number | null = null;
  /** Instante de inicio de grabación (gracia del beacon). */
  private startedAtMs: number | null = null;

  private taxiSamples = 0;
  private taxiOn = 0;
  private taxiEvaluatedMs = 0;
  private taxiCompliedMs = 0;
  private landingSamples = 0;
  private landingOn = 0;
  private landingEvaluatedMs = 0;
  private landingCompliedMs = 0;
  private takeoffSamples = 0;
  private strobeOn = 0;
  private takeoffEvaluatedMs = 0;
  private takeoffCompliedMs = 0;

  private below10kSamples = 0;
  private speedViolations = 0;
  private speedEvaluatedMs = 0;
  private speedCompliedMs = 0;
  private maxSpeedBelow10k: number | null = null;
  private firstViolation: SpeedViolationDetail | null = null;

  private climbSamples = 0;
  private climbExceeded = false;
  private climbMaxVs: number | null = null;
  private climbEvaluatedMs = 0;
  private climbCompliedMs = 0;
  private descentSamples = 0;
  private descentExceeded = false;
  private descentMinVs: number | null = null;
  private descentEvaluatedMs = 0;
  private descentCompliedMs = 0;

  private dayMs = 0;
  private nightMs = 0;
  private lastTimeOfDay: number | null = null;

  private beaconSamples = 0;
  private beaconEvaluatedMs = 0;
  private beaconCompliedMs = 0;
  /** Congelado al volver a AT_GATE (fin de la ventana evaluada). */
  private beaconFrozen = false;

  /** Eventos de voz de sinergia disparados (únicos, en memoria). */
  private synergyEvents = new Set<string>();

  start(): void {
    this.reset();
    this.recording = true;
    this.startedAtMs = Date.now();
  }

  stop(): void {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getPhase(): string | null {
    return this.phase;
  }

  /** Proveedor de minutos de vuelo para proyectar `base_time_xp` en el monitor. */
  setAirMinutesProvider(provider: (() => number | null) | null): void {
    this.getAirMinutes = provider;
  }

  /** dt real atribuible a esta muestra, en ms enteros (0 en la primera; clamp anti-pausas). */
  private takeDtMs(nowMs: number): number {
    let dtMs = 0;
    if (this.lastSampleAtMs !== null) {
      dtMs = Math.round(nowMs - this.lastSampleAtMs);
      if (!Number.isFinite(dtMs) || dtMs < 0) dtMs = 0;
      if (dtMs > XpBonusTracker.MAX_DT_MS) dtMs = XpBonusTracker.MAX_DT_MS;
    }
    this.lastSampleAtMs = nowMs;
    return dtMs;
  }

  sample(input: XpLightSample, phase?: string | null): void {
    if (!this.recording) return;
    if (phase !== undefined && phase !== null && phase !== "") {
      this.phase = phase;
    }
    // Un único timestamp por muestra (determinista y testeable).
    const nowMs = Date.now();
    const dtMs = this.takeDtMs(nowMs);
    const current = this.phase;
    const altitude = Number(input.altitude) || 0;
    const ias = Number(input.indicatedAirspeed);
    const speed = Number.isFinite(ias) && ias > 0 ? ias : Number(input.groundspeed) || 0;
    const vs = Number(input.verticalSpeed) || 0;

    if (current !== null && TAXI_PHASES.has(current)) {
      this.taxiSamples++;
      this.taxiEvaluatedMs += dtMs;
      if (input.taxiLightsOn === true) {
        this.taxiOn++;
        this.taxiCompliedMs += dtMs;
      }
    }
    if (current !== null && LANDING_PHASES.has(current)) {
      this.landingSamples++;
      this.landingEvaluatedMs += dtMs;
      if (input.landingLightsOn === true) {
        this.landingOn++;
        this.landingCompliedMs += dtMs;
      }
    }
    if (current !== null && TAKEOFF_PHASES.has(current)) {
      this.takeoffSamples++;
      this.takeoffEvaluatedMs += dtMs;
      if (input.strobeLightsOn === true) {
        this.strobeOn++;
        this.takeoffCompliedMs += dtMs;
      }
    }
    if (current !== null && CLIMB_PHASES.has(current)) {
      this.climbSamples++;
      this.climbEvaluatedMs += dtMs;
      this.climbMaxVs = this.climbMaxVs === null ? vs : Math.max(this.climbMaxVs, vs);
      if (vs > XpBonusTracker.CLIMB_VS_MAX_FPM) {
        this.climbExceeded = true;
      } else {
        this.climbCompliedMs += dtMs;
      }
    }
    if (current !== null && DESCENT_PHASES.has(current)) {
      this.descentSamples++;
      this.descentEvaluatedMs += dtMs;
      this.descentMinVs = this.descentMinVs === null ? vs : Math.min(this.descentMinVs, vs);
      if (vs < -XpBonusTracker.DESCENT_VS_MAX_FPM) {
        this.descentExceeded = true;
      } else {
        this.descentCompliedMs += dtMs;
      }
    }
    if (altitude < XpBonusTracker.SPEED_ALT_FT) {
      this.below10kSamples++;
      this.speedEvaluatedMs += dtMs;
      this.maxSpeedBelow10k =
        this.maxSpeedBelow10k === null ? speed : Math.max(this.maxSpeedBelow10k, speed);
      if (speed >= XpBonusTracker.SPEED_LIMIT_KT) {
        this.speedViolations++;
        // Auditoría: registrar SOLO la primera violación con contexto completo
        // (no inundar el log a 10Hz). Permite verificar si el exceso fue real
        // (p. ej. ascenso a 280 kt) o ruido de telemetría.
        if (!this.firstViolation) {
          this.firstViolation = {
            speedKt: Math.round(speed * 10) / 10,
            altitudeFt: Math.round(altitude),
            phase: current,
            at: new Date().toISOString(),
          };
          console.warn("[XpBonusTracker] primera violación de velocidad <10k ft:", this.firstViolation);
          fileLogger.warn("[XpBonusTracker] primera violación de velocidad <10k ft", this.firstViolation);
        }
      } else {
        this.speedCompliedMs += dtMs;
      }
    }
    // Día/noche nativo: solo computa con dato válido (ausente → no suma).
    const tod = Number(input.timeOfDay);
    if (Number.isFinite(tod)) {
      this.lastTimeOfDay = tod;
      if (tod === XpBonusTracker.TIME_OF_DAY_NIGHT) {
        this.nightMs += dtMs;
      } else {
        this.dayMs += dtMs;
      }
    }
    // Baliza: ventana desde fin de gracia (60 s tras el inicio) hasta volver
    // a AT_GATE. Fuera de ventana no suma (ni evaluado ni cumplido).
    if (current !== null && (current === FlightPhase.AT_GATE || current === "AT_GATE")) {
      if (!this.beaconFrozen) {
        this.beaconFrozen = true;
        console.log("[XpBonusTracker] baliza: ventana cerrada al volver a AT_GATE");
      }
    }
    if (!this.beaconFrozen && this.startedAtMs !== null) {
      if (nowMs - this.startedAtMs >= XpBonusTracker.BEACON_GRACE_MS) {
        this.beaconSamples++;
        this.beaconEvaluatedMs += dtMs;
        if (input.beaconLightsOn === true) {
          this.beaconCompliedMs += dtMs;
        }
      }
    }
  }

  private static earnedFraction(compliedMs: number, evaluatedMs: number, minFraction: number): boolean {
    if (evaluatedMs <= 0) return false;
    return compliedMs / evaluatedMs >= minFraction;
  }

  /** Bono baliza (20 XP si ON en todo el vuelo: gracia 60 s, hasta AT_GATE). */
  getBeaconBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.beaconCompliedMs, this.beaconEvaluatedMs, XpBonusTracker.BEACON_MIN_FRACTION
    )
      ? XpBonusTracker.XP_BEACON
      : 0;
  }

  /** Segundos de gracia restantes (0 si ya terminó o no hay inicio). */
  getBeaconGraceRemainingSec(nowMs: number = Date.now()): number {
    if (this.startedAtMs === null) return 0;
    return Math.max(0, (XpBonusTracker.BEACON_GRACE_MS - (nowMs - this.startedAtMs)) / 1000);
  }

  /** Resultados finales (fail-closed: sin tiempo evaluado → 0). */
  getResults(airMinutes?: number | null): XpBonusResults {
    const minutes = airMinutes ?? this.getAirMinutes?.() ?? null;
    return {
      base_time_xp: minutes !== null && minutes > 0 ? Math.round(minutes) * 10 : 0,
      disc_taxi_lights_xp: this.getTaxiBonus(),
      disc_landing_lights_xp: this.getLandingBonus(),
      disc_strobe_lights_xp: this.getStrobeBonus(),
      disc_beacon_lights_xp: this.getBeaconBonus(),
      disc_speed_limit_xp: this.getSpeedBonus(),
      disc_vertical_profile_xp: this.getClimbBonus() + this.getDescentBonus(),
    };
  }

  /** Bono taxi lights (15 XP si luz ON en ≥80% del tiempo en TAXI). */
  getTaxiBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.taxiCompliedMs, this.taxiEvaluatedMs, XpBonusTracker.TAXI_LIGHT_MIN_FRACTION
    )
      ? XpBonusTracker.XP_TAXI_LIGHTS
      : 0;
  }

  /** Bono landing lights (25 XP si luz ON en ≥80% del tiempo en LANDING). */
  getLandingBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.landingCompliedMs, this.landingEvaluatedMs, XpBonusTracker.LANDING_LIGHT_MIN_FRACTION
    )
      ? XpBonusTracker.XP_LANDING_LIGHTS
      : 0;
  }

  /** Bono strobe (15 XP si luz ON en ≥80% del tiempo en TAKEOFF). */
  getStrobeBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.takeoffCompliedMs, this.takeoffEvaluatedMs, XpBonusTracker.STROBE_MIN_FRACTION
    )
      ? XpBonusTracker.XP_STROBE
      : 0;
  }

  /** Bono límite de velocidad (40 XP si <255 kt en ≥80% del tiempo bajo 10k ft). */
  getSpeedBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.speedCompliedMs, this.speedEvaluatedMs, XpBonusTracker.SPEED_MIN_FRACTION
    )
      ? XpBonusTracker.XP_SPEED_LIMIT
      : 0;
  }

  /** Bono perfil vertical en ascenso (25 XP si VS en límites en ≥90% del tiempo en CLIMB). */
  getClimbBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.climbCompliedMs, this.climbEvaluatedMs, XpBonusTracker.VERTICAL_MIN_FRACTION
    )
      ? XpBonusTracker.XP_VERTICAL_CLIMB
      : 0;
  }

  /** Bono perfil vertical en descenso (25 XP si VS en límites en ≥90% del tiempo en DESCENT). */
  getDescentBonus(): number {
    return XpBonusTracker.earnedFraction(
      this.descentCompliedMs, this.descentEvaluatedMs, XpBonusTracker.VERTICAL_MIN_FRACTION
    )
      ? XpBonusTracker.XP_VERTICAL_DESCENT
      : 0;
  }

  /** Fracción de tiempo nocturno (null sin tiempo con dato de hora). */
  getNightFraction(): number | null {
    const total = this.dayMs + this.nightMs;
    if (total <= 0) return null;
    return this.nightMs / total;
  }

  /** Bono nocturno (20 XP si >30% del tiempo con dato fue de noche). */
  getNightBonus(): number {
    const frac = this.getNightFraction();
    return frac !== null && frac > XpBonusTracker.NIGHT_MIN_FRACTION
      ? XpBonusTracker.XP_NIGHT_FLIGHT
      : 0;
  }

  /** Horas acumuladas diurnas/nocturnas (listas para persistir en el resumen). */
  getDayNightHours(): DayNightHours {
    return {
      dayHours: this.dayMs / 3600000,
      nightHours: this.nightMs / 3600000,
    };
  }

  /**
   * Registra un disparo de audio para la sinergia IA (3 XP por casillero del
   * conjunto). Acepta claves directas y alias (variantes de demora). Solo
   * cuentan los efectivamente encolados/ejecutados: los omitidos nunca llegan
   * aquí. No exige `recording` (eventos, no telemetría).
   */
  noteVoiceEvent(eventKey: string | null | undefined): void {
    const canonical = normalizeSynergyEventKey(eventKey);
    if (!canonical) return;
    if (!this.synergyEvents.has(canonical)) {
      this.synergyEvents.add(canonical);
      console.log("[XpBonusTracker] sinergia IA +3 XP:", canonical, `(${this.synergyEvents.size} eventos)`);
    }
  }

  /** Claves de sinergia registradas (para preservar ante reinicios). */
  getSynergyEventKeys(): string[] {
    return Array.from(this.synergyEvents);
  }

  /** Bono sinergia IA: 3 XP por cada evento del conjunto reproducido. */
  getAiSynergyBonus(): number {
    return countAiSynergyBonus(this.synergyEvents);
  }

  /** Foto para el monitor (incluye `base_time_xp` proyectada). */
  getSnapshot(): XpBonusSnapshot {
    return {
      recording: this.recording,
      phase: this.phase,
      taxi: {
        samples: this.taxiSamples,
        on: this.taxiOn,
        fraction: fractionMs(this.taxiCompliedMs, this.taxiEvaluatedMs),
        evaluatedSec: this.taxiEvaluatedMs / 1000,
        compliedSec: this.taxiCompliedMs / 1000,
        earned: XpBonusTracker.earnedFraction(
          this.taxiCompliedMs, this.taxiEvaluatedMs, XpBonusTracker.TAXI_LIGHT_MIN_FRACTION
        ),
      },
      landing: {
        samples: this.landingSamples,
        on: this.landingOn,
        fraction: fractionMs(this.landingCompliedMs, this.landingEvaluatedMs),
        evaluatedSec: this.landingEvaluatedMs / 1000,
        compliedSec: this.landingCompliedMs / 1000,
        earned: XpBonusTracker.earnedFraction(
          this.landingCompliedMs, this.landingEvaluatedMs, XpBonusTracker.LANDING_LIGHT_MIN_FRACTION
        ),
      },
      takeoff: {
        samples: this.takeoffSamples,
        on: this.strobeOn,
        fraction: fractionMs(this.takeoffCompliedMs, this.takeoffEvaluatedMs),
        evaluatedSec: this.takeoffEvaluatedMs / 1000,
        compliedSec: this.takeoffCompliedMs / 1000,
        earned: XpBonusTracker.earnedFraction(
          this.takeoffCompliedMs, this.takeoffEvaluatedMs, XpBonusTracker.STROBE_MIN_FRACTION
        ),
      },
      speed: {
        samplesBelow10k: this.below10kSamples,
        violations: this.speedViolations,
        evaluatedSec: this.speedEvaluatedMs / 1000,
        compliedSec: this.speedCompliedMs / 1000,
        fraction: fractionMs(this.speedCompliedMs, this.speedEvaluatedMs),
        earned: this.speedEvaluatedMs > 0
          && this.speedCompliedMs / this.speedEvaluatedMs >= XpBonusTracker.SPEED_MIN_FRACTION,
        maxKt: this.maxSpeedBelow10k === null ? null : Math.round(this.maxSpeedBelow10k * 10) / 10,
        firstViolation: this.firstViolation,
      },
      climb: {
        samples: this.climbSamples,
        evaluatedSec: this.climbEvaluatedMs / 1000,
        compliedSec: this.climbCompliedMs / 1000,
        fraction: fractionMs(this.climbCompliedMs, this.climbEvaluatedMs),
        exceeded: this.climbExceeded,
        maxVs: this.climbMaxVs,
      },
      descent: {
        samples: this.descentSamples,
        evaluatedSec: this.descentEvaluatedMs / 1000,
        compliedSec: this.descentCompliedMs / 1000,
        fraction: fractionMs(this.descentCompliedMs, this.descentEvaluatedMs),
        exceeded: this.descentExceeded,
        minVs: this.descentMinVs,
      },
      dayNight: {
        dayHours: this.dayMs / 3600000,
        nightHours: this.nightMs / 3600000,
        evaluatedSec: (this.dayMs + this.nightMs) / 1000,
        nightFraction: this.getNightFraction(),
        lastTimeOfDay: this.lastTimeOfDay,
        earned: this.getNightBonus() > 0,
        bonus: this.getNightBonus(),
      },
      synergy: {
        events: this.getSynergyEventKeys(),
        bonus: this.getAiSynergyBonus(),
      },
      beacon: {
        samples: this.beaconSamples,
        evaluatedSec: this.beaconEvaluatedMs / 1000,
        compliedSec: this.beaconCompliedMs / 1000,
        fraction: fractionMs(this.beaconCompliedMs, this.beaconEvaluatedMs),
        graceRemainingSec: this.getBeaconGraceRemainingSec(),
        frozen: this.beaconFrozen,
        earned: XpBonusTracker.earnedFraction(
          this.beaconCompliedMs, this.beaconEvaluatedMs, XpBonusTracker.BEACON_MIN_FRACTION
        ),
      },
      projected: this.getResults(),
    };
  }

  reset(): void {
    this.recording = false;
    this.phase = null;
    this.lastSampleAtMs = null;
    this.startedAtMs = null;
    this.taxiSamples = 0;
    this.taxiOn = 0;
    this.taxiEvaluatedMs = 0;
    this.taxiCompliedMs = 0;
    this.landingSamples = 0;
    this.landingOn = 0;
    this.landingEvaluatedMs = 0;
    this.landingCompliedMs = 0;
    this.takeoffSamples = 0;
    this.strobeOn = 0;
    this.takeoffEvaluatedMs = 0;
    this.takeoffCompliedMs = 0;
    this.below10kSamples = 0;
    this.speedViolations = 0;
    this.speedEvaluatedMs = 0;
    this.speedCompliedMs = 0;
    this.maxSpeedBelow10k = null;
    this.firstViolation = null;
    this.climbSamples = 0;
    this.climbExceeded = false;
    this.climbMaxVs = null;
    this.climbEvaluatedMs = 0;
    this.climbCompliedMs = 0;
    this.descentSamples = 0;
    this.descentExceeded = false;
    this.descentMinVs = null;
    this.descentEvaluatedMs = 0;
    this.descentCompliedMs = 0;
    this.dayMs = 0;
    this.nightMs = 0;
    this.lastTimeOfDay = null;
    this.beaconSamples = 0;
    this.beaconEvaluatedMs = 0;
    this.beaconCompliedMs = 0;
    this.beaconFrozen = false;
    this.synergyEvents.clear();
  }
}
