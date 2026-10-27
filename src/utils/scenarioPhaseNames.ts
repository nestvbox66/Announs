/**
 * Nombres de fase del escenario por clave, en el idioma de la UI.
 *
 * Origen del problema que resuelve: `scenario_versions.snapshot` trae
 * `phases[].name` en idiomas mezclados (p. ej. `GATE`/`BOARDING` en inglés y
 * el resto en español), y las pantallas lo mostraban tal cual. Desde ahora el
 * nombre visible se resuelve SIEMPRE por clave contra los bundles de i18next
 * (`flight.phase.*`), por lo que todas las fases salen en un solo idioma.
 *
 * El `name` del snapshot se ignora a propósito: es dato de diseño, no texto
 * visible. Las claves de fase (`GATE`, `BOARDING`, …) nunca se traducen.
 */
import es from "../locales/es.json";
import en from "../locales/en.json";
import { normalizeLanguage } from "./translationOverlay";

interface FlightPhaseDict {
  flight: {
    phase: Record<string, string>;
  };
}

function dictFor(language: string): Record<string, string> {
  const normalized = normalizeLanguage(language);
  if (normalized === "es") {
    return (es as unknown as FlightPhaseDict).flight.phase;
  }
  return (en as unknown as FlightPhaseDict).flight.phase;
}

/** Clave de `flight.phase.*` para una clave de fase del escenario. */
export function scenarioPhaseLocaleKey(phaseKey: string): string {
  return String(phaseKey ?? "").trim().toLowerCase();
}

/**
 * Nombre visible de una fase en el idioma dado (`es` → español, cualquier
 * otro → inglés, igual que el `fallbackLng` del i18n).
 * Ante clave desconocida devuelve la clave en crudo (igual que antes).
 */
export function resolveScenarioPhaseName(phaseKey: string, language: string): string {
  const key = String(phaseKey ?? "").trim();
  if (!key) return "";
  return dictFor(language)[scenarioPhaseLocaleKey(key)] ?? key;
}
