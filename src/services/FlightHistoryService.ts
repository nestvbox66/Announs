/**
 * FlightHistoryService — historial de vuelos recientes del piloto.
 *
 * Lee `public.flights` del usuario autenticado (auth.uid(), con filtro
 * explícito `user_id` además de RLS), ordenado por `created_at DESC` y
 * limitado a los últimos vuelos. Resuelve los nombres de ciudad de
 * origen/destino vía `airportService` (DB + caché, fallback hardcodeado).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import { getAirportCity, getAirportByIcao } from "./airportService";
import { getAirlineName } from "../utils/airlineMapping";
import { formatDepartLabel, formatShortDate, formatDuration } from "./flightHistoryFormat";

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
  aircraft: string;
  aircraftReg: string;
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
  status: string | null;
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
}

const RECENT_FLIGHTS_LIMIT = 10;

export class FlightHistoryService {
  /**
   * Últimos vuelos del usuario autenticado (más recientes primero).
   * Nunca falla por lista vacía: sin vuelos devuelve `ok([])`.
   */
  static async loadRecentFlights(limit: number = RECENT_FLIGHTS_LIMIT): Promise<ServiceResult<FlightHistoryEntry[]>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tu historial.");
      }

      const { data, error } = await supabase
        .from("flights")
        .select("id, saved_flight, airlane_icao, flight_number, depart_icao, arrive_icao, departure_date, departure_time, air_time, block_time, flight_status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return fail(error.message);

      const rows = (data ?? []) as FlightRow[];
      if (rows.length === 0) return ok([]);

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
      return ok(entries);
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
        .select("id, saved_flight, airlane_icao, flight_number, atc_callsign, depart_icao, arrive_icao, aircraft_type, variant_airframe, airframe, departure_date, departure_time, arrival_time, air_time, block_time, flight_status, created_at")
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
      };
      const departIcao = (row.depart_icao ?? "").toUpperCase().trim();
      const arriveIcao = (row.arrive_icao ?? "").toUpperCase().trim();

      const [origin, dest] = await Promise.all([
        departIcao ? getAirportByIcao(departIcao).catch(() => null) : Promise.resolve(null),
        arriveIcao ? getAirportByIcao(arriveIcao).catch(() => null) : Promise.resolve(null),
      ]);

      const aircraft = [row.aircraft_type, row.variant_airframe].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || "—";
      const departTime = (row.departure_time ?? "").trim().slice(0, 5) || "—";
      const arriveTime = (row.arrival_time ?? "").trim().slice(0, 5) || "—";

      return ok({
        flightId: row.id,
        flightNumber: row.saved_flight?.trim() || row.flight_number?.trim() || "—",
        airline: getAirlineName(row.airlane_icao ?? ""),
        aircraft,
        aircraftReg: (row.airframe ?? "").trim() || "—",
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
        status: row.flight_status ?? null,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

function mapRowToEntry(row: FlightRow, cityByIcao: Map<string, string>): FlightHistoryEntry {
  const departIcao = (row.depart_icao ?? "").toUpperCase().trim();
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
