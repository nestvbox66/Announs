/**
 * FlightCompletionBonuses — cálculo de los 4 bonus de XP de entorno/sinergia
 * que se envían a la RPC `process_flight_completion` al cerrar el vuelo.
 *
 * - `ai_companion_synergy_xp`: 3 XP por cada evento de voz del conjunto
 *   de sinergia reproducido durante el vuelo (contador en memoria).
 * - `night_flight_bonus_xp`: 20 XP fijos si el vuelo es nocturno.
 * - `hard_airport_bonus_xp`: 30 XP si el destino tiene `airports.hard = true`.
 * - `weather_severity_bonus_xp`: 30 XP si el METAR de destino trae clima
 *   adverso (TS/SN/GR/FZ o ráfagas `G..KT`).
 *
 * Todo es fail-closed: sin datos o ante cualquier error el bonus es 0, para
 * no bloquear nunca el cierre del vuelo.
 *
 * El cliente Supabase se importa de forma perezosa (solo dentro de
 * `resolveHardAirportBonus`) para no acoplar las funciones puras.
 */

/** Eventos de voz que cuentan para la sinergia con el compañero IA. */
export const AI_SYNERGY_EVENT_KEYS: ReadonlySet<string> = new Set([
  "gate_crew_start_soon",
  "preflight_capt_delay",
  "preflight_capt_basic_info",
  "cruise_capt_general_info",
  "captain_special_event",
  "descent_capt_upcoming_actions",
  "descent_capt_close_desc",
  "taxitogate_crew_welcome",
]);

export const AI_SYNERGY_XP_PER_EVENT = 3;
export const NIGHT_FLIGHT_BONUS_XP = 20;
export const HARD_AIRPORT_BONUS_XP = 30;
export const WEATHER_SEVERITY_BONUS_XP = 30;

/**
 * Bonus de pasajeros — proporcional al XP base por tiempo, con techo.
 *
 * `passenger_xp = round(base_time_xp * score_factor * MAX_PCT)` donde
 * `score_factor = (overallScore - FLOOR) / (100 - FLOOR)` (lineal sobre el
 * piso, continua: en el piso paga 0, en 100 paga el techo completo).
 *
 * - El tiempo ya lo paga `base_time_xp`: este bonus solo amplifica ese pago
 *   según la calidad de atención, sin inventar una segunda fuente de XP por
 *   duración. Un 5h con mala atención gana el mismo % que uno de 20 min con
 *   la misma atención.
 * - Piso de calidad mínima (FLOOR): bajo ese score el bonus es 0 — no
 *   punitivo (nunca resta, solo no suma), fail-closed como el resto.
 */
export const PASSENGER_SCORE_FLOOR = 40;
export const PASSENGER_XP_MAX_PCT = 0.2;

/** Factor 0-1 del score de pasajeros (null/fuera de rango → 0). */
export function passengerScoreFactor(
  overallScore: number | null | undefined
): number {
  if (typeof overallScore !== "number" || !Number.isFinite(overallScore)) return 0;
  if (overallScore < PASSENGER_SCORE_FLOOR) return 0;
  const factor =
    (Math.min(overallScore, 100) - PASSENGER_SCORE_FLOOR) / (100 - PASSENGER_SCORE_FLOOR);
  return Math.min(1, Math.max(0, factor));
}

/** XP de pasajeros al cierre (fail-closed: cualquier duda → 0). */
export function resolvePassengerBonus(
  overallScore: number | null | undefined,
  baseTimeXp: number | null | undefined,
  maxPct: number = PASSENGER_XP_MAX_PCT
): number {
  const base = typeof baseTimeXp === "number" && Number.isFinite(baseTimeXp) ? Math.max(0, baseTimeXp) : 0;
  const pct = typeof maxPct === "number" && Number.isFinite(maxPct) ? Math.min(1, Math.max(0, maxPct)) : PASSENGER_XP_MAX_PCT;
  if (base <= 0 || pct <= 0) return 0;
  const factor = passengerScoreFactor(overallScore);
  if (factor <= 0) return 0;
  return Math.round(base * factor * pct);
}

/**
 * Desglose final de promedios para `flights.passenger_attributes_summary`.
 *
 * Convención legacy del reporte (niveles de NECESIDAD 0-100, bajo = bien,
 * como el mock histórico fear/hunger/bathroom): se invierten los atributos
 * de satisfacción del motor (altos = bien).
 */
export interface PassengerAttributesSummary {
  hunger: number;
  bladder: number;
  fear: number;
  boredom: number;
}

export function toPassengerAttributesSummary(averages: {
  saciedad: number;
  confortFisiologico: number;
  calma: number;
  entretenimiento: number;
} | null | undefined): PassengerAttributesSummary | null {
  if (!averages) return null;
  const need = (v: unknown): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    return Math.min(100, Math.max(0, Math.round(100 - n)));
  };
  return {
    hunger: need(averages.saciedad),
    bladder: need(averages.confortFisiologico),
    fear: need(averages.calma),
    boredom: need(averages.entretenimiento),
  };
}

/**
 * Alias hacia la clave canónica de sinergia. En la práctica el aviso de
 * demora nunca se ejecuta como `preflight_capt_delay` sino como sus
 * variantes (`_parked`/`_taxi`/`_takeoff`); todas computan al mismo casillero
 * (deduplicado: varias variantes en un vuelo cuentan una sola vez).
 */
export const AI_SYNERGY_EVENT_ALIASES: Record<string, string> = {
  preflight_capt_delay_parked: "preflight_capt_delay",
  preflight_capt_delay_taxi: "preflight_capt_delay",
  preflight_capt_delay_takeoff: "preflight_capt_delay",
};

/**
 * Normaliza una clave disparada a su casillero canónico de sinergia, o null
 * si no pertenece al conjunto (ni directa ni por alias).
 */
export function normalizeSynergyEventKey(eventKey: string | null | undefined): string | null {
  const key = (eventKey ?? "").trim();
  if (!key) return null;
  if (AI_SYNERGY_EVENT_KEYS.has(key)) return key;
  const canonical = AI_SYNERGY_EVENT_ALIASES[key];
  return canonical && AI_SYNERGY_EVENT_KEYS.has(canonical) ? canonical : null;
}

/** 3 XP por cada evento de sinergia distinto reproducido (deduplica). */
export function countAiSynergyBonus(eventKeys: Iterable<string>): number {
  const unique = new Set<string>();
  for (const key of eventKeys) {
    if (AI_SYNERGY_EVENT_KEYS.has(key)) unique.add(key);
  }
  return unique.size * AI_SYNERGY_XP_PER_EVENT;
}

/** 20 XP fijos si el vuelo transcurrió en condiciones nocturnas. */
export function resolveNightFlightBonus(isNight: boolean): number {
  return isNight === true ? NIGHT_FLIGHT_BONUS_XP : 0;
}

/**
 * 30 XP si el aeropuerto de destino está marcado como difícil
 * (`airports.hard = true`). Sin columna/dato/error → 0.
 */
export async function resolveHardAirportBonus(destIcao: string | null | undefined): Promise<number> {
  const code = (destIcao ?? "").toUpperCase().trim();
  if (!code) return 0;
  try {
    const { supabase } = await import("../lib/supabase");
    const { data, error } = await supabase
      .from("airports")
      .select("hard")
      .eq("icao_code", code)
      .maybeSingle();
    if (error) {
      console.warn("[FlightCompletionBonuses] No se pudo consultar airports.hard:", code, error.message);
      return 0;
    }
    return (data as { hard?: unknown } | null)?.hard === true ? HARD_AIRPORT_BONUS_XP : 0;
  } catch (err) {
    console.warn("[FlightCompletionBonuses] Excepción consultando airports.hard:", err);
    return 0;
  }
}

/**
 * ¿El METAR trae clima adverso? Grupos TS (tormenta), SN (nieve),
 * GR (granizo) o FZ (congelamiento) —incluye variantes como `+TSRA`,
 * `-SN`, `VCTS`, `FZRA`— o ráfagas (`31012G22KT`). Insensible a
 * mayúsculas; `null`/vacío → false.
 *
 * Se excluyen el tipo de reporte (METAR/SPECI) y el identificador OACI,
 * donde esas letras serían falsos positivos (p. ej. VTSM).
 */
export function hasSevereWeather(metar: string | null | undefined): boolean {
  if (!metar || typeof metar !== "string") return false;
  const tokens = metar.toUpperCase().trim().split(/\s+/);
  let start = 0;
  if (tokens[0] === "METAR" || tokens[0] === "SPECI") start = 1;
  const body = tokens.slice(start + 1).join(" ");
  if (!body) return false;
  if (/(TS|SN|GR|FZ)/.test(body)) return true;
  // Ráfagas fuertes: componente `G..KT` (p. ej. `31012G22KT`).
  if (/G\d{2}KT/.test(body)) return true;
  return false;
}

/** 30 XP por operar en condiciones meteorológicas complejas. */
export function resolveWeatherSeverityBonus(metar: string | null | undefined): number {
  return hasSevereWeather(metar) ? WEATHER_SEVERITY_BONUS_XP : 0;
}
