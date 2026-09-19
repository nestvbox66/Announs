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

import { fileLogger } from "../services/FileLogger";

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    debugFlags?: Record<string, boolean>;
  }
}

/**
 * Valores iniciales de los flags desde el entorno (requieren recompilar).
 * OJO: acceso literal `import.meta.env.VITE_*` a propósito — es el único
 * patrón que Vite reemplaza estáticamente. Un helper genérico tipo
 * `(import.meta as any)?.env` ROMPE el reemplazo y deja al browser sin env
 * (incidente 2026-09-19: provider caído a "mock", sin Supabase). El try/catch
 * cubre runtimes sin import.meta (tests/node), donde todo queda en false.
 */
function envDefault(name: string): boolean {
  try {
    const v =
      name === "VITE_DEBUG_TELEMETRY"
        ? (import.meta.env.VITE_DEBUG_TELEMETRY as string | undefined)
        : name === "VITE_DEBUG_RULE_EVALUATION"
          ? (import.meta.env.VITE_DEBUG_RULE_EVALUATION as string | undefined)
          : name === "VITE_DEBUG_POLLING"
            ? (import.meta.env.VITE_DEBUG_POLLING as string | undefined)
            : name === "VITE_DEBUG_CRUISE_PROGRESS"
              ? (import.meta.env.VITE_DEBUG_CRUISE_PROGRESS as string | undefined)
              : name === "VITE_DEBUG_PHASE_DETECTOR"
                ? (import.meta.env.VITE_DEBUG_PHASE_DETECTOR as string | undefined)
                : name === "VITE_DEBUG_NARRATIVE_ENGINE"
                  ? (import.meta.env.VITE_DEBUG_NARRATIVE_ENGINE as string | undefined)
                  : undefined;
    return v === "true";
  } catch {
    return false;
  }
}

const FLAG_KEYS = [
  "telemetry",
  "ruleEvaluation",
  "polling",
  "cruiseProgress",
  "phaseDetector",
  "narrativeEngine",
] as const;

const ENV_BY_FLAG: Record<(typeof FLAG_KEYS)[number], string> = {
  telemetry: "VITE_DEBUG_TELEMETRY",
  ruleEvaluation: "VITE_DEBUG_RULE_EVALUATION",
  polling: "VITE_DEBUG_POLLING",
  cruiseProgress: "VITE_DEBUG_CRUISE_PROGRESS",
  phaseDetector: "VITE_DEBUG_PHASE_DETECTOR",
  narrativeEngine: "VITE_DEBUG_NARRATIVE_ENGINE",
};

// Defaults calculados UNA vez (son constantes de build).
const ENV_DEFAULTS: Record<string, boolean> = {};
for (const k of FLAG_KEYS) ENV_DEFAULTS[k] = envDefault(ENV_BY_FLAG[k]);

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
      return { ...ENV_DEFAULTS, ...(override as Record<string, boolean>) };
    }
  } catch {
    /* sin window (tests): defaults de entorno */
  }
  return { ...ENV_DEFAULTS };
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
  if (typeof window !== "undefined") {
    const w = window as unknown as { debugFlags?: Record<string, boolean> };
    if (!w.debugFlags) w.debugFlags = liveFlags();
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
