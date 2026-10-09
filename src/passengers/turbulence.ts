/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TurbulenceDetector — detector edge-triggered de turbulencia por VS.
 *
 * - Episódico con 3 niveles (leve/moderada/severa), daño solo a `calma`.
 * - Histéresis: el episodio acumula tiempo solo sobre el umbral y se
 *   resetea al caer bajo la banda de liberación (umbral × 0.6); los picos
 *   instantáneos no disparan, se exige sostenimiento.
 * - Cooldown tras cada evento: una turbulencia prolongada genera un evento,
 *   no uno por tick.
 * - Gateo por fase: nada en tierra; umbrales absolutos por fase porque el VS
 *   normal ya es alto en climb/descent (un umbral único dispararía siempre).
 * - Fail-closed: VS inválido, dt inválido o fase sin tabla → no dispara
 *   (y resetea el episodio en curso, nunca atribuye tiempo desconocido).
 *
 * Motor PURO: sin telemetría, UI ni Supabase. Se alimenta muestra a muestra
 * desde el bucle de telemetría con `sample(vs, dt, phase)`.
 */

import { FlightPhase } from "../engine/FlightEngine";

export type TurbulenceLevel = "leve" | "moderada" | "severa";

export interface TurbulenceOutcome {
  level: TurbulenceLevel;
  /** Daño a `calma` (magnitud positiva, se resta). */
  amount: number;
}

/** Daño a calma por nivel: duele más que un boost, sin one-shotear. */
export const TURBULENCE_DAMAGE: Record<TurbulenceLevel, number> = {
  leve: 4,
  moderada: 8,
  severa: 12,
};
/** Segundos sostenidos sobre el umbral para disparar (no picos). */
export const TURBULENCE_SUSTAIN_SEC = 6;

/** Silencio entre eventos (una turbulencia larga = un evento). */
export const TURBULENCE_COOLDOWN_SEC = 180;

/** Banda de liberación de histéresis (fracción del umbral leve). */
export const TURBULENCE_RELEASE_FACTOR = 0.6;

/**
 * Umbrales de |VS| en fpm por fase [leve, moderada, severa].
 * Sin entrada para una fase → no se detecta ahí (tierra y estados
 * no operativos). Los valores contemplan el VS normal de cada fase
 * (climb/descent ya vuelan alto de por sí).
 */
export const TURBULENCE_THRESHOLDS: Partial<
  Record<FlightPhase, readonly [number, number, number]>
> = {
  [FlightPhase.TAKEOFF]: [3000, 4000, 5000],
  [FlightPhase.CLIMB]: [3500, 4500, 5500],
  [FlightPhase.CRUISE]: [1000, 1800, 2600],
  [FlightPhase.DESCENT]: [2500, 3500, 4500],
  [FlightPhase.APPROACH]: [1500, 2200, 3000],
  [FlightPhase.LANDING]: [1200, 1800, 2500],
};

/**
 * Clasifica un |VS| en tier 0-3 para la fase dada (0 = bajo umbral o sin
 * tabla). Función pura compartida entre el detector y el monitor.
 */
export function classifyVs(vs: unknown, phase: FlightPhase | null | undefined): 0 | 1 | 2 | 3 {
  const thresholds = (phase != null ? TURBULENCE_THRESHOLDS[phase] : undefined) ?? null;
  if (!thresholds) return 0;
  const v = typeof vs === "number" && Number.isFinite(vs) ? vs : null;
  if (v === null) return 0;
  const abs = Math.abs(v);
  if (abs >= thresholds[2]) return 3;
  if (abs >= thresholds[1]) return 2;
  if (abs >= thresholds[0]) return 1;
  return 0;
}

export class TurbulenceDetector {
  private sustainedSec = 0;
  private peakTier = 0;
  private cooldownLeftSec = 0;
  private lastEvent: (TurbulenceOutcome & { at: string }) | null = null;

  reset(): void {
    this.sustainedSec = 0;
    this.peakTier = 0;
    this.cooldownLeftSec = 0;
    this.lastEvent = null;
  }

  /** Foto del estado interno para el monitor (no afecta la detección). */
  getSnapshot(): {
    sustainedSec: number;
    peakTier: number;
    cooldownLeftSec: number;
    lastEvent: (TurbulenceOutcome & { at: string }) | null;
  } {
    return {
      sustainedSec: Math.round(this.sustainedSec * 10) / 10,
      peakTier: this.peakTier,
      cooldownLeftSec: Math.round(this.cooldownLeftSec),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
    };
  }

  /**
   * Procesa una muestra. Devuelve el evento al cruzar el sostenimiento,
   * null en el resto de los casos (incluido cooldown y dato inválido).
   * Un evento de daño real = una etiqueta de UI; nunca una por tick.
   */
  sample(
    vs: unknown,
    dtSeconds: unknown,
    phase: FlightPhase | null | undefined
  ): TurbulenceOutcome | null {
    const dt =
      typeof dtSeconds === "number" &&
      Number.isFinite(dtSeconds) &&
      dtSeconds > 0
        ? Math.min(dtSeconds, 30)
        : null;
    if (dt === null) {
      this.resetEpisode();
      return null;
    }
    if (this.cooldownLeftSec > 0) {
      this.cooldownLeftSec = Math.max(0, this.cooldownLeftSec - dt);
      return null;
    }
    const thresholds = (phase != null ? TURBULENCE_THRESHOLDS[phase] : undefined) ?? null;
    if (!thresholds) {
      this.resetEpisode();
      return null;
    }
    const tier = classifyVs(vs, phase);
    // classifyVs ya validó el número; si dio 0 con número válido puede ser
    // banda muerta o liberación (se resuelve abajo con el valor crudo).
    const v = typeof vs === "number" && Number.isFinite(vs) ? vs : null;
    if (v === null) {
      this.resetEpisode();
      return null;
    }
    const abs = Math.abs(v);
    if (tier === 0) {
      // Banda muerta: se mantiene el episodio; bajo la banda se libera.
      if (abs < thresholds[0] * TURBULENCE_RELEASE_FACTOR) {
        this.resetEpisode();
      }
      return null;
    }
    if (tier > this.peakTier) this.peakTier = tier;
    this.sustainedSec += dt;
    if (this.sustainedSec < TURBULENCE_SUSTAIN_SEC) return null;
    const level: TurbulenceLevel =
      this.peakTier >= 3 ? "severa" : this.peakTier === 2 ? "moderada" : "leve";
    const outcome: TurbulenceOutcome = { level, amount: TURBULENCE_DAMAGE[level] };
    this.lastEvent = { ...outcome, at: new Date().toLocaleTimeString("es-ES", { hour12: false }) };
    this.sustainedSec = 0;
    this.peakTier = 0;
    this.cooldownLeftSec = TURBULENCE_COOLDOWN_SEC;
    return outcome;
  }

  private resetEpisode(): void {
    this.sustainedSec = 0;
    this.peakTier = 0;
  }
}

/** Copy de la etiqueta transitoria por nivel (tono del desktop, sin emojis). */
export const TURBULENCE_FLASH_TEXT: Record<TurbulenceLevel, string> = {
  leve: "Turbulencia leve — pasaje inquieto",
  moderada: "¡Turbulencia! Pasajeros inquietos",
  severa: "¡Turbulencia fuerte! Pánico en cabina",
};

/** Copy de la etiqueta transitoria de mitigación exitosa. */
export const TURBULENCE_MITIGATED_FLASH_TEXT = "Pasajeros más calmados";
