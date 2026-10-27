/**
 * ofResolvers — resolución de nombres contra las tablas OpenFlights
 * (`of_airports`, `of_airlines`), con caché en memoria por sesión.
 *
 * Convención del proyecto (ver `RealRoutesService`, `CampaignService`):
 * códigos ICAO en mayúsculas conmatch exacto (`eq`/`in`).
 * Nunca lanza: ante cualquier fallo devuelve `null` y el llamador aplica
 * su fallback local (`airportMapping`, catálogo `airlines.json` o el código).
 */
import { supabase } from "../lib/supabase";

const cityCache = new Map<string, string | null>();
const airlineCache = new Map<string, string | null>();

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t !== "" ? t : null;
}

/** Ciudad de un aeropuerto (`of_airports.city`) por ICAO, o `null`. */
export async function resolveOfAirportCity(icao: string): Promise<string | null> {
  const code = (icao || "").toUpperCase().trim();
  if (!code) return null;
  if (cityCache.has(code)) return cityCache.get(code) ?? null;
  try {
    const { data, error } = await supabase
      .from("of_airports")
      .select("city")
      .eq("icao", code)
      .maybeSingle();
    if (error) throw error;
    const city = clean((data as { city?: unknown } | null)?.city);
    cityCache.set(code, city);
    return city;
  } catch {
    cityCache.set(code, null);
    return null;
  }
}

/** Nombre de aerolínea (`of_airlines.name`) por código ICAO/IATA, o `null`. */
export async function resolveOfAirlineName(code: string): Promise<string | null> {
  const key = (code || "").toUpperCase().trim();
  if (!key) return null;
  if (airlineCache.has(key)) return airlineCache.get(key) ?? null;
  try {
    const { data, error } = await supabase
      .from("of_airlines")
      .select("name")
      .or(`icao.eq.${key},iata.eq.${key}`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const name = clean((data as { name?: unknown } | null)?.name);
    const usable = name && !["N/A", "-", "NA"].includes(name.toUpperCase()) ? name : null;
    airlineCache.set(key, usable);
    return usable;
  } catch {
    airlineCache.set(key, null);
    return null;
  }
}

/**
 * Código ICAO de aerolínea desde un OFP crudo, probando varias fuentes en
 * orden: `general.icao_airline`, `general.airline` (si es código puro),
 * prefijo del `atc_callsign` / `flight_number` (p. ej. "DAL123" → "DAL").
 * Nunca usa el nombre ("Delta Air Lines" no es un código).
 */
export function extractAirlineCode(raw: unknown): string {
  const gen = (raw as any)?.general ?? {};
  const pure = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim().toUpperCase();
    return /^[A-Z]{2,3}$/.test(t) ? t : null;
  };
  const fromCallsign = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const m = v.trim().toUpperCase().match(/^([A-Z]{2,3})(?=\d)/);
    return m ? m[1] : null;
  };
  return (
    pure(gen.icao_airline) ??
    pure(gen.airline) ??
    fromCallsign(gen.atc_callsign) ??
    fromCallsign(gen.flight_number) ??
    fromCallsign((raw as any)?.atc_callsign) ??
    ""
  );
}

/** Limpia la caché (tests / cambio de sesión). */
export function clearOfResolversCache(): void {
  cityCache.clear();
  airlineCache.clear();
}
