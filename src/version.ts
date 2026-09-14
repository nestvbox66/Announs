/**
 * Versión del binario para trazabilidad en logs.
 * Valores inyectados por vite.config.ts (`define`); fuera de Vite (tsx/tests)
 * caen a valores "dev" sin romper.
 */
declare const __APP_VERSION__: string | undefined;
declare const __GIT_COMMIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

function readDefined(name: "__APP_VERSION__" | "__GIT_COMMIT__" | "__BUILD_TIME__", fallback: string): string {
  try {
    const v =
      name === "__APP_VERSION__" ? __APP_VERSION__
      : name === "__GIT_COMMIT__" ? __GIT_COMMIT__
      : __BUILD_TIME__;
    return typeof v === "string" && v !== "" ? v : fallback;
  } catch {
    return fallback;
  }
}

export const APP_VERSION = readDefined("__APP_VERSION__", "dev");
export const GIT_COMMIT = readDefined("__GIT_COMMIT__", "unknown");
export const BUILD_TIME = readDefined("__BUILD_TIME__", "unknown");

/** Marcadores de fixes incluidos (P0/P1/fallback/expr/monitor/Rust). */
export const BUILD_FIXES = [
  "P0-optional-skip",
  "P1-immediate-advance",
  "evaluateStep-fallback",
  "CRUISE_PROGRESS-expr",
  "monitor-scheduler-engine",
  "rust-vspeed-live",
].join(",");
