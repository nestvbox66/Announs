/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Logger centralizado con flags de debug. Los logs de alta frecuencia
 * (telemetría, evaluación de reglas, polling, detector, narrativa) están
 * DESACTIVADOS por defecto y se activan en caliente desde la consola del
 * navegador, sin recompilar:
 *
 *   window.debugFlags.telemetry = true;
 *   window.debugFlags.ruleEvaluation = true;
 *   window.debugFlags.polling = true;
 *   window.debugFlags.cruiseProgress = true;
 *   window.debugFlags.phaseDetector = true;
 *   window.debugFlags.narrativeEngine = true;
 *
 * Los logs permanentes (audio, fases, errores) siempre activos.
 */

import { debugFlags } from "../config";
import { fileLogger } from "../services/FileLogger";

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    debugFlags?: Record<string, boolean>;
  }
}

function liveFlags(): Record<string, boolean> {
  try {
    const g = globalThis as unknown as { debugFlags?: unknown };
    const w =
      typeof window !== "undefined"
        ? (window as unknown as { debugFlags?: unknown }).debugFlags
        : null;
    // window primero (consola del navegador), globalThis como fallback (tests).
    const override = w && typeof w === "object" ? w : g?.debugFlags;
    if (override && typeof override === "object") {
      return { ...debugFlags, ...(override as Record<string, boolean>) };
    }
  } catch {
    /* sin window (tests): defaults de config */
  }
  return { ...debugFlags };
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

function enabled(key: string): boolean {
  try {
    return liveFlags()[key] === true;
  } catch {
    return false;
  }
}

// Exponer para toggle en caliente desde la consola (una sola vez).
try {
  if (typeof window !== "undefined" && !(window as unknown as { debugFlags?: unknown }).debugFlags) {
    (window as unknown as { debugFlags: Record<string, boolean> }).debugFlags = { ...debugFlags };
    console.log(
      "[Announs] Debug de logs: usá window.debugFlags para activar (telemetry, ruleEvaluation, polling, cruiseProgress, phaseDetector, narrativeEngine)"
    );
  }
} catch {
  /* sin window */
}

export const logger = {
  /** Telemetría MSFS (10 Hz). Cuando se activa, también va al FileLogger. */
  telemetry(message: unknown, data?: unknown): void {
    if (!enabled("telemetry")) return;
    console.log(`[Telemetry] ${fmt(message)}`, data);
    try {
      fileLogger.log(`[Telemetry] ${fmt(message)}`, data);
    } catch {
      /* logging nunca debe romper */
    }
  },
  /** Evaluación de reglas / precondiciones / schedulerules. */
  ruleEvaluation(message: unknown, data?: unknown): void {
    if (!enabled("ruleEvaluation")) return;
    console.log(`[RuleEngine] ${fmt(message)}`, data);
  },
  /** Polling de WAIT_CONDITION (cada 2s) y timers. */
  polling(message: unknown, data?: unknown): void {
    if (!enabled("polling")) return;
    console.log(`[Polling] ${fmt(message)}`, data);
  },
  /** Cálculos de progreso de crucero (cada 1s desde el monitor). */
  cruiseProgress(message: unknown, data?: unknown): void {
    if (!enabled("cruiseProgress")) return;
    console.log(`[CruiseProgress] ${fmt(message)}`, data);
  },
  /** Diagnóstico interno del FlightPhaseDetector. */
  phaseDetector(message: unknown, data?: unknown): void {
    if (!enabled("phaseDetector")) return;
    console.log(`[PhaseDetector] ${fmt(message)}`, data);
  },
  /** Ciclo de vida narrativo (pasos, escenarios). */
  narrative(message: unknown, data?: unknown): void {
    if (!enabled("narrativeEngine")) return;
    console.log(`[Narrative] ${fmt(message)}`, data);
  },
  /** Ciclo de audio: PERMANENTE (dispatch/generating/playing/completed/error). */
  audio(message: unknown, data?: unknown): void {
    console.log(`[Audio] ${fmt(message)}`, data);
  },
  /** Transiciones de fase: PERMANENTE. */
  phase(message: unknown, data?: unknown): void {
    console.log(`[FlightFSM] ${fmt(message)}`, data);
  },
  /** Errores: PERMANENTE. */
  error(message: unknown, data?: unknown): void {
    console.error(`[Error] ${fmt(message)}`, data);
  },
};
