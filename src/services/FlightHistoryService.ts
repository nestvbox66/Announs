/**
 * FlightHistoryService — historial de vuelos recientes del piloto.
 *
 * Lee `public.flights` del usuario autenticado (auth.uid(), con filtro
 * explícito `user_id` además de RLS), ordenado por `created_at DESC` y
 * limitado a los últimos vuelos. El historial solo incluye operaciones
 * completadas (`flight_status = 'ended'`). Resuelve los nombres de ciudad de
 * origen/destino vía `airportService` (DB + caché, fallback hardcodeado).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import { getAirportCity, getAirportByIcao } from "./airportService";
import { getAirlineName } from "../utils/airlineMapping";
import { hasAircraftSilhouette } from "../utils/aircraftSilhouettes";
import { formatDepartLabel, formatShortDate, formatDuration, parseDurationMinutes } from "./flightHistoryFormat";

export interface FlightHistoryEntry {
  flightId: string;
  airline: string;
  flightNumber: string;
  departIcao: string;
  arriveIcao: string;
  departCity: string;
  arriveCity: string;
  /** Etiqueta amigable de partida ("20 sept 2026, 14:15") o "—". */
  departLabel: string;
  /** Etiqueta corta para la ficha de detalle. */
  fechaCorta: string;
  /** Duración ("1h 10m") o "—". */
  durationLabel: string;
  createdAt: string | null;
}

/** Ficha completa de un vuelo para la pantalla de detalle. */
export interface FlightDetailData {
  flightId: string;
  flightNumber: string;
  airline: string;
  /** Código ICAO de la aerolínea (para el banner; puede venir vacío). */
  airlineIcao: string | null;
  aircraft: string;
  aircraftReg: string;
  /** Categoría del avión para la silueta (de `flights.aircraft_type`). */
  aircraftCategory: string | null;
  originIcao: string;
  originName: string;
  originCity: string;
  originLat: number | null;
  originLon: number | null;
  destIcao: string;
  destName: string;
  destCity: string;
  destLat: number | null;
  destLon: number | null;
  departLabel: string;
  departTime: string;
  arriveTime: string;
  durationLabel: string;
  /** Minutos crudos de duración (para "X Minutos") o null. */
  durationMinutes: number | null;
  /** Fecha y hora de creación del registro ("20 sept 2026, 21:33") o "—". */
  createdLabel: string;
  status: string | null;
  /** URL pública de la "Foto de la Sesión" (`flights.photo_url`) o null. */
  photoUrl: string | null;
}

interface FlightRow {
  id: string;
  saved_flight?: string | null;
  airlane_icao?: string | null;
  flight_number?: string | null;
  depart_icao?: string | null;
  arrive_icao?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  air_time?: string | null;
  block_time?: string | null;
  flight_status?: string | null;
  created_at?: string | null;
  photo_url?: string | null;
}

export const FLIGHT_HISTORY_PAGE_SIZE = 10;

export interface FlightHistoryPage {
  entries: FlightHistoryEntry[];
  total: number;
}

export class FlightHistoryService {
  /**
   * Página de vuelos del usuario autenticado (más recientes primero).
   * Filtro estricto: solo operaciones completadas (`flight_status = 'ended'`);
   * los vuelos en curso, cancelados o en estados intermedios no se listan.
   * Nunca falla por lista vacía: sin vuelos devuelve página vacía con total 0.
   */
  static async loadRecentFlights(
    limit: number = FLIGHT_HISTORY_PAGE_SIZE,
    offset: number = 0
  ): Promise<ServiceResult<FlightHistoryPage>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tu historial.");
      }

      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || FLIGHT_HISTORY_PAGE_SIZE));
      const safeOffset = Math.max(0, Math.floor(offset) || 0);
      const { data, error, count } = await supabase
        .from("flights")
        .select("id, saved_flight, airlane_icao, flight_number, depart_icao, arrive_icao, departure_date, departure_time, air_time, block_time, flight_status, created_at", { count: "exact" })
        .eq("user_id", user.id)
        .eq("flight_status", "ended")
        .order("created_at", { ascending: false })
        .range(safeOffset, safeOffset + safeLimit - 1);

      if (error) return fail(error.message);

      const rows = (data ?? []) as FlightRow[];
      if (rows.length === 0) return ok({ entries: [], total: count ?? 0 });

      // Resolver ciudades una sola vez por ICAO distinto.
      const icaos = Array.from(
        new Set(
          rows.flatMap((row) => [row.depart_icao ?? "", row.arrive_icao ?? ""])
            .map((code) => code.toUpperCase().trim())
            .filter(Boolean)
        )
      );
      const cityByIcao = new Map<string, string>();
      await Promise.all(
        icaos.map(async (code) => {
          try {
            cityByIcao.set(code, await getAirportCity(code));
          } catch {
            cityByIcao.set(code, code);
          }
        })
      );

      const entries: FlightHistoryEntry[] = rows.map((row) =>
        mapRowToEntry(row, cityByIcao)
      );
      return ok({ entries, total: count ?? entries.length });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Ficha completa de un vuelo por `flight_id` (cabecera + panel de ruta del
   * detalle). Resuelve nombres de aeropuertos vía `airports`.
   */
  static async loadFlightDetail(flightId: string): Promise<ServiceResult<FlightDetailData | null>> {
    if (!flightId) return fail("flight_id es obligatorio.");
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver el detalle.");
      }

      const { data, error } = await supabase
        .from("flights")
        .select("id, saved_flight, airlane_icao, flight_number, atc_callsign, depart_icao, arrive_icao, aircraft_type, variant_airframe, airframe, departure_date, departure_time, arrival_time, air_time, block_time, flight_status, photo_url, created_at")
        .eq("id", flightId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) return fail(error.message);
      if (!data) return ok(null);

      const row = data as FlightRow & {
        atc_callsign?: string | null;
        aircraft_type?: string | null;
        variant_airframe?: string | null;
        airframe?: string | null;
        arrival_time?: string | null;
        photo_url?: string | null;
      };
      const departIcao = (row.depart_icao ?? "").toUpperCase().trim();
      const arriveIcao = (row.arrive_icao ?? "").toUpperCase().trim();

      const [origin, dest, aircraftCat] = await Promise.all([
        departIcao ? getAirportByIcao(departIcao).catch(() => null) : Promise.resolve(null),
        arriveIcao ? getAirportByIcao(arriveIcao).catch(() => null) : Promise.resolve(null),
        // `flights.aircraft_type` ya trae la categoría (p. ej. "B737"); solo se
        // consulta `aircraft_types` como respaldo si no hay imagen local.
        resolveAircraftCategory(row.aircraft_type),
      ]);

      const aircraft = [row.aircraft_type, row.variant_airframe].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || "—";
      const departTime = (row.departure_time ?? "").trim().slice(0, 5) || "—";
      const arriveTime = (row.arrival_time ?? "").trim().slice(0, 5) || "—";

      return ok({
        flightId: row.id,
        flightNumber: row.saved_flight?.trim() || row.flight_number?.trim() || "—",
        airline: getAirlineName(row.airlane_icao ?? ""),
        airlineIcao: (row.airlane_icao ?? "").toUpperCase().trim() || null,
        aircraft,
        aircraftReg: (row.airframe ?? "").trim() || "—",
        aircraftCategory: aircraftCat,
        originIcao: departIcao || "—",
        originName: origin?.name || departIcao || "—",
        originCity: origin?.municipality || departIcao || "—",
        originLat: origin?.latitude_deg ?? null,
        originLon: origin?.longitude_deg ?? null,
        destIcao: arriveIcao || "—",
        destName: dest?.name || arriveIcao || "—",
        destCity: dest?.municipality || arriveIcao || "—",
        destLat: dest?.latitude_deg ?? null,
        destLon: dest?.longitude_deg ?? null,
        departLabel: formatDepartLabel(row.departure_date, row.departure_time, row.created_at),
        departTime,
        arriveTime,
        durationLabel: formatDuration(row.air_time, row.block_time),
        durationMinutes: parseDurationMinutes(row.air_time, row.block_time),
        createdLabel: formatDepartLabel(null, null, row.created_at),
        status: row.flight_status ?? null,
        photoUrl: (row.photo_url ?? "").trim() || null,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

/** Categoría para la silueta: el valor directo de `flights.aircraft_type`, con
 * respaldo a `aircraft_types.category` solo si no hay imagen local. */
async function resolveAircraftCategory(aircraftType: string | null | undefined): Promise<string | null> {
  const direct = (aircraftType ?? "").trim();
  if (direct && hasAircraftSilhouette(direct)) {
    return direct.toUpperCase();
  }
  const code = direct.toUpperCase();
  if (!code) return null;
  try {
    const { data, error } = await supabase
      .from("aircraft_types")
      .select("category")
      .eq("icao_code", code)
      .limit(1)
      .maybeSingle();
    if (error || !data) return direct || null;
    const category = ((data as { category?: unknown }).category ?? "").toString().trim();
    return category ? category.toUpperCase() : direct || null;
  } catch {
    return direct || null;
  }
}

function mapRowToEntry(row: FlightRow, cityByIcao: Map<string, string>): FlightHistoryEntry {  const departIcao = (row.depart_icao ?? "").toUpperCase().trim();
  const arriveIcao = (row.arrive_icao ?? "").toUpperCase().trim();
  const flightNumber = row.saved_flight?.trim() || row.flight_number?.trim() || "—";

  return {
    flightId: row.id,
    airline: getAirlineName(row.airlane_icao ?? ""),
    flightNumber,
    departIcao,
    arriveIcao,
    departCity: cityByIcao.get(departIcao) ?? departIcao,
    arriveCity: cityByIcao.get(arriveIcao) ?? arriveIcao,
    departLabel: formatDepartLabel(row.departure_date, row.departure_time, row.created_at),
    fechaCorta: formatShortDate(row.departure_date, row.created_at),
    durationLabel: formatDuration(row.air_time, row.block_time),
    createdAt: row.created_at ?? null,
  };
}
