/**
 * RealRoutesService — buscador de rutas del mundo real (sección "Volar").
 *
 * Tablas (esquema OpenFlights, lectura pública):
 *  - `of_airlines` (airline_id, name, alias, iata, icao, ...): opciones y filtro.
 *  - `of_routes` (airline, airline_id, source_airport[_id],
 *    destination_airport[_id], equipment, ...): rutas + equipos.
 *  - `of_airports` (airport_id, name, city, country, iata, icao, ...):
 *    filtros de aeropuertos y enriquecimiento de la grilla.
 *  - `of_planes` (name, iata_code, icao_code, ...): traducción del equipo
 *    de la ruta (formato IATA, ej. "738") al código ICAO que espera
 *    SimBrief (ej. "B738").
 *
 * Convenciones de coincidencia:
 *  - Parcial (`ilike`): nombres de aeropuertos/ciudades/países y aerolíneas.
 *  - Exacta (`eq`, en mayúsculas): códigos ICAO (con fallback a IATA) y equipos.
 * Los filtros son opcionales y se combinan libremente (AND).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";

export interface RealRouteFilters {
  originCity: string;
  originAirport: string;
  originIcao: string;
  destCity: string;
  destAirport: string;
  destIcao: string;
  airline: string;
  aircraft: string;
  /** @deprecated Filtro de país eliminado de la UI; se ignora si se recibe. */
  originCountry?: string;
  /** @deprecated Filtro de país eliminado de la UI; se ignora si se recibe. */
  destCountry?: string;
}

export interface RealRouteResult {
  airlineName: string;
  /** ICAO de la aerolínea para SimBrief ("" si no es utilizable). */
  airlineIcao: string;
  /** IATA de la aerolínea (2 letras), fallback si no hay ICAO válido. */
  airlineIata: string;
  originCode: string;
  originName: string;
  originCity: string;
  destCode: string;
  destName: string;
  destCity: string;
  equipment: string;
}

/** Límite de filas de la grilla (las rutas pueden ser miles). */
export const REAL_ROUTES_PAGE_SIZE = 100;
/** Tope defensivo de IDs en cláusulas IN (evita URLs gigantes). */
const MAX_IN_IDS = 1000;

let airlineOptionsCache: string[] | null = null;
let equipmentOptionsCache: string[] | null = null;
/** Caché de traducción IATA → ICAO de aeronaves (clave: token IATA). */
const aircraftIcaoCache = new Map<string, string>();

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Nombres de aerolíneas (`of_airlines.name`) ordenados, una sola carga por
 * sesión (~6k filas paginadas).
 */
export async function loadAirlineOptions(): Promise<ServiceResult<string[]>> {
  try {
    if (airlineOptionsCache) return ok(airlineOptionsCache);
    const rows = await fetchAllPages<{ name: unknown }>(
      (from, to) => supabase.from("of_airlines").select("name").order("name").range(from, to) as unknown as Promise<{ data: { name: unknown }[] | null; error: { message: string } | null }>,
      1000
    );
    const names = Array.from(
      new Set(
        rows.map((r) => String(r.name ?? "").trim()).filter((n) => n !== "" && n !== "-")
      )
    ).sort((a, b) => a.localeCompare(b));
    airlineOptionsCache = names;
    return ok(names);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Tipos de avión individuales (`equipment` tokenizado por espacios).
 * El campo crudo mezcla varios tipos por ruta ("738 320 319"); acá se
 * devuelven tokens únicos ordenados (~168), una sola carga por sesión.
 */
export async function loadEquipmentOptions(): Promise<ServiceResult<string[]>> {
  try {
    if (equipmentOptionsCache) return ok(equipmentOptionsCache);
    const rows = await fetchAllPages<{ equipment: unknown }>(
      (from, to) => supabase.from("of_routes").select("equipment").range(from, to) as unknown as Promise<{ data: { equipment: unknown }[] | null; error: { message: string } | null }>,
      1000
    );
    const values = Array.from(
      new Set(
        rows.flatMap((r) =>
          String(r.equipment ?? "")
            .trim()
            .toUpperCase()
            .split(/\s+/)
            .filter((tok) => /^[A-Z0-9]{2,4}$/.test(tok))
        )
      )
    ).sort();
    equipmentOptionsCache = values;
    return ok(values);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Divide un valor crudo de `equipment` en tokens individuales. */
export function splitEquipmentTokens(raw: unknown): string[] {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((tok) => tok !== "");
}

/** Escapa comodines para patrones `ilike` de PostgREST. */
function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Códigos placeholder que nunca son válidos (aunque pasen el formato). */
const PLACEHOLDER_CODES = new Set(["NA", "N/A", "-", "--", "UNK", "NUL", "TBA"]);

/** ICAO de aerolínea válido para SimBrief (2-3 alfanuméricos; "" si no sirve). */
function sanitizeAirlineIcao(raw: unknown): string {
  const code = String(raw ?? "").trim().toUpperCase();
  if (PLACEHOLDER_CODES.has(code)) return "";
  return /^[A-Z0-9]{2,3}$/.test(code) ? code : "";
}

/** IATA de aerolínea (2 alfanuméricos; "" si no sirve). Fallback ante ICAO ausente. */
function sanitizeAirlineIata(raw: unknown): string {
  const code = String(raw ?? "").trim().toUpperCase();
  if (PLACEHOLDER_CODES.has(code)) return "";
  return /^[A-Z0-9]{2}$/.test(code) ? code : "";
}

/** Código de aeropuerto válido para SimBrief (3-4 alfanuméricos). */
function isUsableAirportCode(code: string): boolean {
  return /^[A-Z0-9]{3,4}$/.test((code ?? "").trim().toUpperCase());
}

/**
 * Genera un número de vuelo aleatorio de 3-4 dígitos (100-9999) para los
 * envíos a SimBrief de vuelos basados en ruta real (`of_routes` no trae
 * número de vuelo). Evita que el despacho se genere como `0000` cuando el
 * usuario no lo modifica manualmente en SimBrief.
 */
export function randomFlightNumber(): string {
  return String(100 + Math.floor(Math.random() * 9900));
}

/**
 * Traduce un equipo de `of_routes` (formato IATA, ej. "738") al código ICAO
 * que espera SimBrief (ej. "B738"), consultando `of_planes` por `iata_code`.
 *
 * Consulta segura ante duplicados: como un mismo `iata_code` puede tener
 * múltiples registros, se usa `.limit(1)` (primer coincidente por `id`)
 * en lugar de `.single()`, que lanzaría error con más de una fila.
 *
 * Fallback seguro: si no hay mapeo, el código es inválido o la consulta
 * falla, se devuelve el equipo original (primer token en mayúsculas).
 */
export async function resolveAircraftIcao(equipment: string): Promise<string> {
  const code = splitEquipmentTokens(equipment)[0] ?? "";
  if (!/^[A-Z0-9]{2,4}$/.test(code)) return code;
  const cached = aircraftIcaoCache.get(code);
  if (cached !== undefined) return cached;
  try {
    const { data, error } = await supabase
      .from("of_planes")
      .select("icao_code")
      .eq("iata_code", code)
      .order("id")
      .limit(1);
    if (error) throw new Error(error.message);
    const raw = String((data?.[0] as { icao_code?: unknown } | undefined)?.icao_code ?? "")
      .trim()
      .toUpperCase();
    const resolved = /^[A-Z0-9]{2,4}$/.test(raw) ? raw : code;
    aircraftIcaoCache.set(code, resolved);
    return resolved;
  } catch {
    // Fallback seguro: ante cualquier fallo se usa el equipo original.
    aircraftIcaoCache.set(code, code);
    return code;
  }
}

/**
 * URL de despacho de SimBrief con los campos precargados (guía oficial
 * "Dispatch Redirect": `dispatch.simbrief.com/options/custom?airline=&
 * type=&orig=&dest=`). El usuario solo presiona "Generate Flight Plan" y
 * luego el flujo estándar de importación lo lee en Announs.
 *
 * `equipment` debe ser el código ICAO de la aeronave (ej. "B738"); usar
 * `resolveAircraftIcao()` para traducir el formato IATA de `of_routes`.
 * Aerolínea: se envía el ICAO (3 letras); si no hay uno válido (288
 * aerolíneas en `of_airlines` tienen `icao` NULL o placeholder), se usa el
 * IATA (2 letras) como fallback antes de omitir el parámetro.
 */
export function buildSimbriefDispatchUrl(route: {
  originCode: string;
  destCode: string;
  airlineIcao: string;
  airlineIata?: string;
  equipment: string;
  /** N° de vuelo (se combina con la aerolínea). Opcional. */
  flightNumber?: string;
  /** Fecha de partida SimBrief (DDMMMYY). Opcional. */
  date?: string;
  /** Hora de partida (0-23). Opcional. */
  depHour?: string;
  /** Minuto de partida (00-59). Opcional. */
  depMinute?: string;
}): string {
  const params = new URLSearchParams();
  if (isUsableAirportCode(route.originCode)) params.set("orig", route.originCode.trim().toUpperCase());
  if (isUsableAirportCode(route.destCode)) params.set("dest", route.destCode.trim().toUpperCase());
  // Aerolínea: ICAO primero, IATA como fallback (mejor que omitir).
  const airline = sanitizeAirlineIcao(route.airlineIcao) !== ""
    ? sanitizeAirlineIcao(route.airlineIcao)
    : sanitizeAirlineIata(route.airlineIata ?? "");
  if (airline !== "") {
    params.set("airline", airline);
  }
  const type = splitEquipmentTokens(route.equipment)[0] ?? "";
  if (/^[A-Z0-9]{2,4}$/.test(type)) params.set("type", type);
  // Campos opcionales (vuelos de campaña): n° de vuelo y fecha/hora.
  const fltnum = (route.flightNumber ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{1,4}$/.test(fltnum)) params.set("fltnum", fltnum);
  const date = (route.date ?? "").trim().toUpperCase();
  if (/^\d{2}[A-Z]{3}\d{2}$/.test(date)) params.set("date", date);
  const deph = Number(route.depHour ?? "");
  if (Number.isInteger(deph) && deph >= 0 && deph <= 23) params.set("deph", String(deph));
  const depm = Number(route.depMinute ?? "");
  if (Number.isInteger(depm) && depm >= 0 && depm <= 59) {
    params.set("depm", String(depm).padStart(2, "0"));
  }
  return `https://dispatch.simbrief.com/options/custom?${params.toString()}`;
}

interface AirportRef {
  airport_id: string;
}

async function findAirportIds(filters: {
  city: string;
  name: string;
  icao: string;
}): Promise<string[]> {
  const city = filters.city.trim();
  const name = filters.name.trim();
  const icao = filters.icao.trim().toUpperCase();
  if (!city && !name && !icao) return [];

  let query = supabase.from("of_airports").select("airport_id").limit(MAX_IN_IDS);
  if (city) query = query.ilike("city", `%${city}%`);
  if (name) query = query.ilike("name", `%${name}%`);
  if (icao) query = query.or(`icao.eq.${icao},iata.eq.${icao}`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as AirportRef[]).map((r) => String(r.airport_id));
}

async function findAirlineIds(nameFilter: string): Promise<string[] | null> {
  const name = nameFilter.trim();
  if (!name) return null;
  const { data, error } = await supabase
    .from("of_airlines")
    .select("airline_id")
    .ilike("name", `%${name}%`)
    .limit(MAX_IN_IDS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { airline_id: unknown }[]).map((r) => String(r.airline_id));
}

interface RouteRow {
  airline_id: unknown;
  source_airport_id: unknown;
  destination_airport_id: unknown;
  equipment: unknown;
}

/**
 * Búsqueda dinámica en `of_routes` con combinaciones libres de filtros.
 * Devuelve hasta REAL_ROUTES_PAGE_SIZE filas enriquecidas para la grilla.
 */
export async function searchRealRoutes(
  filters: RealRouteFilters
): Promise<ServiceResult<RealRouteResult[]>> {
  try {
    const hasAnyFilter = Object.values(filters).some((v) => (v ?? "").trim() !== "");
    if (!hasAnyFilter) return ok([]);

    const [originIds, destIds, airlineIds] = await Promise.all([
      findAirportIds({
        city: filters.originCity,
        name: filters.originAirport,
        icao: filters.originIcao,
      }),
      findAirportIds({
        city: filters.destCity,
        name: filters.destAirport,
        icao: filters.destIcao,
      }),
      findAirlineIds(filters.airline),
    ]);

    // Filtro con criterios pero sin coincidencias → sin resultados (sin
    // consultar rutas).
    if (
      ((filters.originCity || filters.originAirport || filters.originIcao) && originIds.length === 0) ||
      ((filters.destCity || filters.destAirport || filters.destIcao) && destIds.length === 0) ||
      (filters.airline.trim() !== "" && (airlineIds ?? []).length === 0)
    ) {
      return ok([]);
    }

    const aircraft = filters.aircraft.trim().toUpperCase();
    let query = supabase
      .from("of_routes")
      .select("airline_id, source_airport_id, destination_airport_id, equipment")
      .order("id")
      // Con filtro de equipo se amplía la ventana: el match exacto por token
      // se aplica en cliente y necesita margen antes del corte final.
      .limit(aircraft ? REAL_ROUTES_PAGE_SIZE * 5 : REAL_ROUTES_PAGE_SIZE);
    if (originIds.length > 0) query = query.in("source_airport_id", originIds);
    if (destIds.length > 0) query = query.in("destination_airport_id", destIds);
    if (airlineIds && airlineIds.length > 0) query = query.in("airline_id", airlineIds);
    if (aircraft) query = query.ilike("equipment", `%${escapeIlike(aircraft)}%`);

    const { data: routeRows, error: routesError } = await query;
    if (routesError) return fail(routesError.message);
    // Coincidencia exacta a nivel token ("738" matchea "738 320", no "7380").
    let routes = ((routeRows ?? []) as RouteRow[]);
    if (aircraft) {
      routes = routes.filter((r) => splitEquipmentTokens(r.equipment).includes(aircraft));
    }
    routes = routes.slice(0, REAL_ROUTES_PAGE_SIZE);
    if (routes.length === 0) return ok([]);

    // Enriquecimiento por lotes (nombres reales para la grilla).
    const airportIds = Array.from(
      new Set(
        routes.flatMap((r) => [String(r.source_airport_id), String(r.destination_airport_id)])
      )
    );
    const airlineIdList = Array.from(new Set(routes.map((r) => String(r.airline_id))));
    const [airportsRes, airlinesRes] = await Promise.all([
      supabase.from("of_airports").select("airport_id, icao, iata, name, city").in("airport_id", airportIds),
      supabase.from("of_airlines").select("airline_id, name, iata, icao").in("airline_id", airlineIdList),
    ]);
    if (airportsRes.error) return fail(airportsRes.error.message);
    if (airlinesRes.error) return fail(airlinesRes.error.message);

    const airportById = new Map(
      ((airportsRes.data ?? []) as Array<{ airport_id: unknown; icao: unknown; iata: unknown; name: unknown; city: unknown }>).map((a) => [
        String(a.airport_id),
        {
          code: String(a.icao ?? a.iata ?? "").toUpperCase() || "—",
          name: String(a.name ?? "").trim() || "—",
          city: String(a.city ?? "").trim(),
        },
      ])
    );
    const airlineById = new Map(
      ((airlinesRes.data ?? []) as Array<{ airline_id: unknown; name: unknown; iata: unknown; icao: unknown }>).map((a) => [
        String(a.airline_id),
        {
          name: String(a.name ?? "").trim() || "—",
          icao: sanitizeAirlineIcao(a.icao),
          iata: sanitizeAirlineIata(a.iata),
        },
      ])
    );

    return ok(
      routes.map((r) => {
        const origin = airportById.get(String(r.source_airport_id)) ?? { code: "—", name: "—", city: "" };
        const dest = airportById.get(String(r.destination_airport_id)) ?? { code: "—", name: "—", city: "" };
        const airline = airlineById.get(String(r.airline_id)) ?? { name: "—", icao: "", iata: "" };
        return {
          airlineName: airline.name,
          airlineIcao: airline.icao,
          airlineIata: airline.iata,
          originCode: origin.code,
          originName: origin.name,
          originCity: origin.city,
          destCode: dest.code,
          destName: dest.name,
          destCity: dest.city,
          equipment: String(r.equipment ?? "").toUpperCase() || "—",
        };
      })
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
