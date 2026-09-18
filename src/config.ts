const IMETA_ENV: Record<string, string | undefined> =
  (((import.meta as any)?.env ?? {}) as Record<string, string | undefined>);
const PROC_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && (process as any)?.env
    ? ((process as any).env as Record<string, string | undefined>)
    : {};

/**
 * Lee una variable de entorno con fallback a `process.env` (tests/node).
 * En Vite siempre hay `import.meta.env`; el fallback no cambia nada en prod.
 */
function envVar(name: string): string | undefined {
  return IMETA_ENV[name] ?? PROC_ENV[name];
}

export const config = {
  supabaseUrl: envVar("VITE_SUPABASE_URL") ?? "",
  supabaseAnonKey: envVar("VITE_SUPABASE_ANON_KEY") ?? "",
  sim: {
    provider: (envVar("VITE_SIM_PROVIDER") as "msfs" | "xplane" | "mock" | undefined) ?? "mock",
    autoConnect: envVar("VITE_SIM_AUTOCONNECT") === "true",
    pollInterval: Number(envVar("VITE_SIM_POLL_INTERVAL")) || 100,
  },
  mock: {
    enabled: envVar("VITE_MOCK_ENABLED") !== "false",
    speedMultiplier: Number(envVar("VITE_MOCK_SPEED")) || 1,
    autoTransition: envVar("VITE_MOCK_AUTO_TRANSITION") !== "false",
    autoStart: envVar("VITE_MOCK_AUTO_START") === "true",
  },
};

/**
 * Flags de logs de debug (desactivados por defecto). Valores iniciales desde
 * variables de entorno (requieren recompilar); en caliente desde la consola
 * del navegador vía `window.debugFlags` (ver `src/utils/logger.ts`):
 * `window.debugFlags.telemetry = true`, etc. Los logs permanentes (audio,
 * fases, versión, errores) no usan flags: siempre activos.
 */
export const debugFlags = {
  telemetry: envVar("VITE_DEBUG_TELEMETRY") === "true",
  ruleEvaluation: envVar("VITE_DEBUG_RULE_EVALUATION") === "true",
  polling: envVar("VITE_DEBUG_POLLING") === "true",
  cruiseProgress: envVar("VITE_DEBUG_CRUISE_PROGRESS") === "true",
  phaseDetector: envVar("VITE_DEBUG_PHASE_DETECTOR") === "true",
  narrativeEngine: envVar("VITE_DEBUG_NARRATIVE_ENGINE") === "true",
};

export type DebugFlagKey = keyof typeof debugFlags;
