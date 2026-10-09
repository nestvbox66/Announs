/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PassengerEngine — motor de tick de pasajeros (Fase 1 — MVP).
 *
 * Motor PURO: sin dependencias de telemetría, UI, Supabase ni Tauri.
 * Se alimenta muestra a muestra desde el bucle de telemetría
 * (VueloActualView.onTelemetry, ~10Hz MSFS / 1Hz mock) con `tick(dt, fase)`,
 * igual que `XpBonusTracker.sample()`. El `dt` real entre llamadas hace
 * irrelevante la frecuencia exacta del provider.
 *
 * Decisiones de diseño (ver reporte Fase 1 + respuestas Q1-Q10):
 * - Q1: los efectos se aplican al COMPLETAR la reproducción
 *   (`announcement:completed`). Este método es el punto único de entrada
 *   para eso: cada llamada resetea además el temporizador de silencio.
 * - Q2: los pasajeros del motor son una MUESTRA de 10; el manifiesto
 *   completo de UI no se toca.
 * - Q3: `mitigate` implementado desde día uno (ventana + ActiveNegativeEvent).
 * - Q5: todas las tasas/umbrales son placeholders calibrables (constantes).
 * - Q8: silencio = 15 min sin NINGÚN anuncio → -5 entretenimiento, recursivo.
 */

import { FlightPhase } from "../engine/FlightEngine";
import archetypesData from "./archetypes.json";
import type {
  ActiveNegativeEvent,
  ArchetypeDefinition,
  AttributeKey,
  AttributeState,
  FlightPassengerSummary,
  Passenger,
  PassengerEffect,
  PassengerEngineState,
} from "./types";
import { ATTRIBUTE_KEYS } from "./types";

// ── Constantes calibrables (placeholders, Q5) ───────────────────────────

export const TRACKED_PASSENGER_COUNT = 10;

/** Tasa base de deterioro por minuto de vuelo (PDF §4). */
export const BASE_DECAY_PER_MIN: AttributeState = {
  saciedad: 0.15,
  confortFisiologico: 0.25,
  calma: 0.02,
  entretenimiento: 0.2,
};

/** Rangos default al abordar (PDF §2). */
export const DEFAULT_BOARDING_RANGES: Record<AttributeKey, [number, number]> = {
  saciedad: [80, 100],
  confortFisiologico: [85, 100],
  calma: [40, 100],
  entretenimiento: [60, 100],
};

/**
 * Multiplicador global de deterioro por fase (PDF §4: climb/descent más
 * rápido, cruise estable más lento). En tierra, desgaste mínimo.
 */
const PHASE_DECAY_MULTIPLIER: Record<FlightPhase, number> = {
  [FlightPhase.GATE]: 0.3,
  [FlightPhase.BOARDING]: 0.5,
  [FlightPhase.PRE_FLIGHT]: 1.0,
  [FlightPhase.TAXI]: 1.1,
  [FlightPhase.TAKEOFF]: 1.3,
  [FlightPhase.CLIMB]: 1.3,
  [FlightPhase.CRUISE]: 0.8,
  [FlightPhase.DESCENT]: 1.2,
  [FlightPhase.APPROACH]: 1.2,
  [FlightPhase.LANDING]: 1.3,
  [FlightPhase.TAXI_IN]: 1.0,
  [FlightPhase.AT_GATE]: 0.5,
  [FlightPhase.FLIGHT_COMPLETED]: 0,
};

/**
 * Extra para calma y confort en fases de mayor incomodidad
 * (cinturones puestos / turbulencia más probable, PDF §4).
 */
const UNCOMFORTABLE_PHASES = new Set<FlightPhase>([
  FlightPhase.TAKEOFF,
  FlightPhase.CLIMB,
  FlightPhase.DESCENT,
  FlightPhase.APPROACH,
  FlightPhase.LANDING,
]);
const UNCOMFORTABLE_EXTRA_MULTIPLIER = 1.5;

/** Piso de aburrimiento: por tiempo solo, nadie cae bajo este valor (PDF §4). */
export const ENTERTAINMENT_DECAY_FLOOR = 25;

/** Ventana default de mitigación (Q1: extremo generoso, 120s). */
export const DEFAULT_MITIGATION_WINDOW_SEC = 120;

/** Silencio de cabina (Q8): X min sin anuncios → -5 entretenimiento. */
export const SILENCE_THRESHOLD_SEC = 15 * 60;
export const SILENCE_PENALTY = 5;

/** Penalización por varianza: si más del 20% tiene score <40, resta 7 (PDF §7). */
export const VARIANCE_FRACTION_THRESHOLD = 0.2;
export const VARIANCE_LOW_SCORE_THRESHOLD = 40;
export const VARIANCE_PENALTY = 7;

/** Clamp por llamada (anti-pausas del hilo: tab suspendido, etc.). */
export const MAX_DT_SEC = 30;

/** Atributos siempre 0-100. */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** "+8" / "−2" para el historial (usa signo menos tipográfico). */
function fmtSigned(amount: number): string {
  if (amount < 0) return `−${Math.abs(amount)}`;
  return `+${amount}`;
}

export interface NegativeEventInput {
  attribute: AttributeKey;
  /** Magnitud positiva del daño (se resta). */
  amount: number;
  mitigationWindowSeconds?: number;
}

/** Registro de un hecho que movió indicadores (para el monitor, no persiste). */
export type PassengerHistoryKind =
  | "announcement_boost"
  | "announcement_mitigate"
  | "mitigate_missed"
  | "duplicate_ignored"
  | "negative"
  | "silence";

export interface PassengerEventRecord {
  seq: number;
  /** Segundo de vuelo (elapsedSeconds) en que ocurrió. */
  tSecond: number;
  kind: PassengerHistoryKind;
  /** Clave del anuncio o tipo de evento negativo. */
  label: string;
  /** Resumen legible del impacto (ej. "calma +8"). */
  detail: string;
}

/** Agregado por arquetipo (para el monitor: perspectiva por segmento). */
export interface ArchetypeBreakdown {
  archetypeId: string;
  name: string;
  count: number;
  averages: AttributeState;
}

/** Tope del historial en memoria (suficiente para un vuelo + monitor). */
export const HISTORY_CAP = 100;

/** Ventana anti-duplicados: mismo anuncio completado dos veces en <10s
 *  (doble emit error+completed, clear+completed, re-mount de listeners)
 *  se cobra una sola vez. Un anuncio real nunca se repite tan rápido
 *  (el audio dura más y la cola deduplica simultáneos). */
export const DUPLICATE_WINDOW_SEC = 10;

export interface EngineOptions {
  /** Cantidad de pasajeros trackeados (default 10). */
  count?: number;
  /** Catálogo de arquetipos (default archetypes.json). */
  archetypes?: ArchetypeDefinition[];
  /** RNG inyectable (default Math.random; tests pasan uno determinista). */
  rng?: () => number;
}

function archetypesFromJson(): ArchetypeDefinition[] {
  // El JSON infiere number[] para las tuplas [min,max]; cast explícito.
  const data = archetypesData as unknown as {
    archetypes: ArchetypeDefinition[];
  };
  return data.archetypes;
}

export class PassengerEngine {
  private readonly archetypes: ArchetypeDefinition[];
  private readonly rng: () => number;
  private readonly count: number;

  private passengers: Passenger[] = [];
  private activeNegativeEvents: ActiveNegativeEvent[] = [];
  private elapsedSeconds = 0;
  private secondsSinceLastAnnouncement = 0;
  private negativeEventSeq = 0;
  private history: PassengerEventRecord[] = [];
  private historySeq = 0;
  /** Última aplicación por eventKey (anti-duplicados, elapsedSeconds). */
  private lastAppliedAt = new Map<string, number>();
  private started = false;

  constructor(options: EngineOptions = {}) {
    this.archetypes = options.archetypes ?? archetypesFromJson();
    this.rng = options.rng ?? Math.random;
    this.count = options.count ?? TRACKED_PASSENGER_COUNT;
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────

  /** Genera la muestra trackeada con rangos al abordar (PDF §2). */
  startFlight(): void {
    this.passengers = [];
    for (let i = 0; i < this.count; i++) {
      const archetype =
        this.archetypes[Math.floor(this.rng() * this.archetypes.length)];
      const attributes = {} as AttributeState;
      for (const key of ATTRIBUTE_KEYS) {
        const [min, max] =
          archetype.boardingRanges?.[key] ?? DEFAULT_BOARDING_RANGES[key];
        attributes[key] = min + this.rng() * (max - min);
      }
      this.passengers.push({
        id: `pax-${String(i + 1).padStart(2, "0")}`,
        archetypeId: archetype.id,
        attributes,
      });
    }
    this.activeNegativeEvents = [];
    this.elapsedSeconds = 0;
    this.secondsSinceLastAnnouncement = 0;
    this.negativeEventSeq = 0;
    this.history = [];
    this.historySeq = 0;
    this.lastAppliedAt = new Map();
    this.started = true;
  }

  reset(): void {
    this.passengers = [];
    this.activeNegativeEvents = [];
    this.elapsedSeconds = 0;
    this.secondsSinceLastAnnouncement = 0;
    this.negativeEventSeq = 0;
    this.history = [];
    this.historySeq = 0;
    this.lastAppliedAt = new Map();
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  // ── Tick ─────────────────────────────────────────────────────────────

  /**
   * Avanza la simulación `dtSeconds` en la fase dada. Llamar por cada muestra
   * de telemetría con el dt real (el clamp interno absorbe pausas).
   */
  tick(dtSeconds: number, phase: FlightPhase): void {
    if (!this.started) return;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, MAX_DT_SEC);
    this.elapsedSeconds += dt;
    this.secondsSinceLastAnnouncement += dt;

    const phaseMult = PHASE_DECAY_MULTIPLIER[phase] ?? 1;

    for (const pax of this.passengers) {
      const arch = this.findArchetype(pax.archetypeId);
      for (const key of ATTRIBUTE_KEYS) {
        let mult = phaseMult;
        if (
          (key === "calma" || key === "confortFisiologico") &&
          UNCOMFORTABLE_PHASES.has(phase)
        ) {
          mult *= UNCOMFORTABLE_EXTRA_MULTIPLIER;
        }
        const decay =
          (BASE_DECAY_PER_MIN[key] / 60) *
          dt *
          mult *
          arch.deteriorationMultipliers[key];
        const next = pax.attributes[key] - decay;
        // El piso de entretenimiento aplica solo al deterioro por tiempo
        // (los eventos negativos sí pueden empujarlo más abajo).
        pax.attributes[key] =
          key === "entretenimiento"
            ? Math.max(ENTERTAINMENT_DECAY_FLOOR, next)
            : Math.max(0, next);
      }
    }

    // Silencio de cabina (Q8): recursivo cada X min sin anuncios.
    if (this.secondsSinceLastAnnouncement >= SILENCE_THRESHOLD_SEC) {
      for (const pax of this.passengers) {
        const arch = this.findArchetype(pax.archetypeId);
        pax.attributes.entretenimiento = clamp(
          pax.attributes.entretenimiento -
            SILENCE_PENALTY * arch.deteriorationMultipliers.entretenimiento
        );
      }
      this.log("silence", "silencio_cabina", `entretenimiento −${SILENCE_PENALTY}`);
      this.secondsSinceLastAnnouncement = 0;
    }

    this.expireNegativeEvents();
  }

  // ── Efectos de anuncios (llamar al COMPLETAR reproducción, Q1) ────────

  /**
   * Aplica los efectos de un anuncio ya reproducido. Resetea además el
   * temporizador de silencio (cualquier anuncio comunica, Q8).
   *
   * - `boost`: mejora neta, siempre suma (× multiplicador de recuperación).
   * - `mitigate`: solo recupera si hay un evento negativo ACTIVO
   *   (no expirado, no mitigado) sobre el mismo atributo; si no, no-op
   *   (evita farmear puntos anunciando sin causa, PDF §9).
   *
   * Devuelve si algún `mitigate` encontró evento activo (para feedback de UI);
   * los tests existentes ignoran el retorno.
   */
  applyAnnouncementEffects(
    effects: PassengerEffect[],
    eventKey?: string
  ): { mitigated: boolean } {
    if (!this.started) return { mitigated: false };
    this.secondsSinceLastAnnouncement = 0;
    if (effects.length === 0) return { mitigated: false };
    const label = eventKey ?? "(sin clave)";

    // Anti-duplicados: mismo anuncio completado dos veces en la ventana
    // (doble emit error+completed, clear+completed, listeners duplicados).
    if (eventKey !== undefined) {
      const prev = this.lastAppliedAt.get(eventKey);
      if (prev !== undefined && this.elapsedSeconds - prev < DUPLICATE_WINDOW_SEC) {
        this.log("duplicate_ignored", label, "completion duplicado (no-op)");
        return { mitigated: false };
      }
      this.lastAppliedAt.set(eventKey, this.elapsedSeconds);
    }
    let mitigated = false;
    for (const effect of effects) {
      if (effect.mode === "boost") {
        for (const pax of this.passengers) {
          const arch = this.findArchetype(pax.archetypeId);
          pax.attributes[effect.attribute] = clamp(
            pax.attributes[effect.attribute] +
              effect.amount * arch.recoveryMultipliers[effect.attribute]
          );
        }
        this.log(
          "announcement_boost",
          label,
          `${effect.attribute} ${fmtSigned(effect.amount)}`
        );
      } else {
        const target = this.findMitigableEvent(effect.attribute);
        if (!target) {
          this.log(
            "mitigate_missed",
            label,
            `${effect.attribute} +${effect.amount} sin evento activo (no-op)`
          );
          continue;
        }
        target.mitigated = true;
        mitigated = true;
        for (const pax of this.passengers) {
          const arch = this.findArchetype(pax.archetypeId);
          pax.attributes[effect.attribute] = clamp(
            pax.attributes[effect.attribute] +
              effect.amount * arch.recoveryMultipliers[effect.attribute]
          );
        }
        this.log(
          "announcement_mitigate",
          label,
          `${effect.attribute} +${effect.amount} (mitiga ${target.id})`
        );
      }
    }
    return { mitigated };
  }

  // ── Eventos negativos (telemetría) ────────────────────────────────────

  /**
   * Aplica daño inmediato (× multiplicador de deterioro) y registra el evento
   * como mitigable durante la ventana. `amount` es magnitud positiva.
   */
  applyNegativeEvent(input: NegativeEventInput): void {
    if (!this.started) return;
    if (!Number.isFinite(input.amount) || input.amount <= 0) return;
    this.negativeEventSeq++;
    this.activeNegativeEvents.push({
      id: `neg-${this.negativeEventSeq}`,
      attribute: input.attribute,
      triggeredAtSecond: this.elapsedSeconds,
      mitigationWindowSeconds:
        input.mitigationWindowSeconds ?? DEFAULT_MITIGATION_WINDOW_SEC,
      mitigated: false,
    });
    this.log("negative", `neg-${this.negativeEventSeq}`, `${input.attribute} −${input.amount}`);
    for (const pax of this.passengers) {
      const arch = this.findArchetype(pax.archetypeId);
      pax.attributes[input.attribute] = clamp(
        pax.attributes[input.attribute] -
          input.amount * arch.deteriorationMultipliers[input.attribute]
      );
    }
  }

  // ── Lecturas ─────────────────────────────────────────────────────────

  /** Promedio agregado de los 4 atributos (para UI con semáforo, PDF §8). */
  getAverages(): AttributeState {
    const avg: AttributeState = {
      saciedad: 0,
      confortFisiologico: 0,
      calma: 0,
      entretenimiento: 0,
    };
    if (this.passengers.length === 0) return avg;
    for (const pax of this.passengers) {
      for (const key of ATTRIBUTE_KEYS) avg[key] += pax.attributes[key];
    }
    for (const key of ATTRIBUTE_KEYS) avg[key] /= this.passengers.length;
    return avg;
  }

  /**
   * Resumen final (lo único que sale del motor, PDF §11.7).
   * score_vuelo = promedio(scores individuales) − penalización por varianza.
   */
  getSummary(flightId: string): FlightPassengerSummary | null {
    if (!this.started || this.passengers.length === 0) return null;
    const averages = this.getAverages();
    let total = 0;
    let lowCount = 0;
    for (const pax of this.passengers) {
      const score =
        (pax.attributes.saciedad +
          pax.attributes.confortFisiologico +
          pax.attributes.calma +
          pax.attributes.entretenimiento) /
        4;
      total += score;
      if (score < VARIANCE_LOW_SCORE_THRESHOLD) lowCount++;
    }
    const mean = total / this.passengers.length;
    const penalty =
      lowCount / this.passengers.length > VARIANCE_FRACTION_THRESHOLD
        ? VARIANCE_PENALTY
        : 0;
    return {
      flightId,
      globalAttributeAverages: averages,
      overallScore: Math.max(0, mean - penalty),
      variancePenaltyApplied: penalty,
    };
  }

  /** Copia del estado runtime (para debug/monitor, no persistir). */
  getState(): PassengerEngineState {
    return {
      passengers: this.passengers.map((p) => ({
        ...p,
        attributes: { ...p.attributes },
      })),
      activeNegativeEvents: this.activeNegativeEvents.map((e) => ({ ...e })),
      elapsedSeconds: this.elapsedSeconds,
    };
  }

  /** Historial de hechos que movieron indicadores (más reciente último). */
  getHistory(): PassengerEventRecord[] {
    return this.history.map((r) => ({ ...r }));
  }

  /**
   * Promedios agrupados por arquetipo presente en la muestra
   * (para el monitor: cuántos hay de cada uno y cómo están).
   */
  getArchetypeBreakdown(): ArchetypeBreakdown[] {
    const groups = new Map<string, Passenger[]>();
    for (const pax of this.passengers) {
      const list = groups.get(pax.archetypeId) ?? [];
      list.push(pax);
      groups.set(pax.archetypeId, list);
    }
    const out: ArchetypeBreakdown[] = [];
    for (const [id, list] of groups) {
      const averages: AttributeState = {
        saciedad: 0,
        confortFisiologico: 0,
        calma: 0,
        entretenimiento: 0,
      };
      for (const pax of list) {
        for (const key of ATTRIBUTE_KEYS) averages[key] += pax.attributes[key];
      }
      for (const key of ATTRIBUTE_KEYS) averages[key] /= list.length;
      out.push({
        archetypeId: id,
        name: this.findArchetype(id).name,
        count: list.length,
        averages,
      });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  // ── Privados ─────────────────────────────────────────────────────────

  private log(kind: PassengerEventRecord["kind"], label: string, detail: string): void {
    this.historySeq++;
    this.history.push({
      seq: this.historySeq,
      tSecond: Math.round(this.elapsedSeconds),
      kind,
      label,
      detail,
    });
    if (this.history.length > HISTORY_CAP) {
      this.history.splice(0, this.history.length - HISTORY_CAP);
    }
  }

  private findArchetype(id: string): ArchetypeDefinition {
    const found = this.archetypes.find((a) => a.id === id);
    if (!found) throw new Error(`[PassengerEngine] arquetipo desconocido: ${id}`);
    return found;
  }

  private findMitigableEvent(
    attribute: AttributeKey
  ): ActiveNegativeEvent | undefined {
    // El más reciente primero (un anuncio mitiga el último evento pendiente).
    for (let i = this.activeNegativeEvents.length - 1; i >= 0; i--) {
      const e = this.activeNegativeEvents[i];
      if (e.attribute !== attribute || e.mitigated) continue;
      if (this.elapsedSeconds - e.triggeredAtSecond <= e.mitigationWindowSeconds) {
        return e;
      }
    }
    return undefined;
  }

  private expireNegativeEvents(): void {
    // Poda para no acumular basura: fuera los mitigados y los expirados
    // hace más de una ventana extra (ya cobrados, sin efecto futuro).
    this.activeNegativeEvents = this.activeNegativeEvents.filter((e) => {
      if (e.mitigated) return false;
      return (
        this.elapsedSeconds - e.triggeredAtSecond <=
        e.mitigationWindowSeconds + DEFAULT_MITIGATION_WINDOW_SEC
      );
    });
  }
}
