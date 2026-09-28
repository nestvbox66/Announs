/**
 * PilotStatsService — panel "Análisis Estadístico" del User HUB.
 *
 * Consume la función RPC `get_pilot_stats(target_user_id)` y normaliza la
 * respuesta de forma defensiva (claves tolerantes). La racha de días se
 * calcula de `public.flights` (días distintos con actividad, consecutivos).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import { todayKeyLocal, normalizeDistribution, normalizeTopRoutes } from "./pilotStatsFormat";

export interface CareerStats {
  totalFlights: number;
  totalDistanceNm: number;
  avgAirTimeMinutes: number;
  uniqueAirports: number;
  uniqueCountries: number;
}

export interface PerformanceStats {
  maxAirTimeMinutes: number;
  maxDistanceNm: number;
}

export interface AircraftShare {
  model: string;
  hours: number;
  flights: number;
  sharePct: number;
}

export interface TopRoute {
  origin: string;
  dest: string;
  originCity: string;
  destCity: string;
  count: number;
  distanceNm: number | null;
}

export interface MonthlyPoint {
  key: string;
  label: string;
  flights: number;
}

/** País conquistado para el Pasaporte / Mapa Mundi. */
export interface AtlasCountry {
  iso: string;
  /** Operaciones (cada despegue/aterrizaje cuenta 1). */
  ops: number;
  /** ICAOs distintos operados en el país. */
  airports: number;
  /** ISO de la fecha del último vuelo (YYYY-MM-DD) o null. */
  lastFlight: string | null;
}

export interface PilotAtlas {
  countries: AtlasCountry[];
  totalAirports: number;
}

export interface PilotStats {
  career: CareerStats;
  performance: PerformanceStats;
  distribution: AircraftShare[];
  topRoutes: TopRoute[];
  monthlyActivity: MonthlyPoint[];
  currentStreakDays: number;
}

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class PilotStatsService {
  /** Estadísticas completas del usuario autenticado (RPC + racha). */
  static async loadPilotStats(): Promise<ServiceResult<PilotStats>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tus estadísticas.");
      }

      const { data, error } = await supabase.rpc("get_pilot_stats", {
        target_user_id: user.id,
      });
      if (error) return fail(error.message);

      const raw: any = data ?? {};
      const career = raw.career ?? {};
      const performance = raw.performance ?? {};
      const distribution = normalizeDistribution(raw.distribution);
      const topRoutes = normalizeTopRoutes(raw.top_routes);
      const monthlyActivity = normalizeMonthly(raw.monthly_activity);
      const currentStreakDays = await loadDayStreak(user.id);

      return ok({
        career: {
          totalFlights: num(career.total_flights) ?? 0,
          totalDistanceNm: num(career.total_distance_nm) ?? 0,
          avgAirTimeMinutes: num(career.avg_air_time_minutes) ?? 0,
          uniqueAirports: num(career.unique_airports) ?? 0,
          uniqueCountries: num(career.unique_countries) ?? 0,
        },
        performance: {
          maxAirTimeMinutes: num(performance.max_air_time_minutes) ?? 0,
          maxDistanceNm: num(performance.max_distance_nm) ?? 0,
        },
        distribution,
        topRoutes,
        monthlyActivity,
        currentStreakDays,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Atlas de conquista: países únicos de vuelos finalizados (`flight_status =
   * 'ended'`), cruzando `depart_icao`/`arrive_icao` con `airports.iso_country`.
   * Por país: operaciones, aeropuertos distintos y fecha del último vuelo.
   */
  static async loadAtlas(): Promise<ServiceResult<PilotAtlas>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tu pasaporte.");
      }

      const { data, error } = await supabase
        .from("flights")
        .select("depart_icao,arrive_icao,departure_date,created_at")
        .eq("user_id", user.id)
        .eq("flight_status", "ended")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) return fail(error.message);
      const rows = (data ?? []) as Array<{
        depart_icao?: string | null;
        arrive_icao?: string | null;
        departure_date?: string | null;
        created_at?: string | null;
      }>;
      if (rows.length === 0) return ok({ countries: [], totalAirports: 0 });

      const icaos = Array.from(
        new Set(
          rows
            .flatMap((row) => [row.depart_icao ?? "", row.arrive_icao ?? ""])
            .map((code) => code.toUpperCase().trim())
            .filter(Boolean)
        )
      );

      // Lookup de iso_country por ICAO (en bloques para no saturar la URL).
      const isoByIcao = new Map<string, string>();
      const CHUNK = 60;
      for (let i = 0; i < icaos.length; i += CHUNK) {
        const chunk = icaos.slice(i, i + CHUNK);
        const { data: airports, error: airportsError } = await supabase
          .from("airports")
          .select("icao_code,iso_country")
          .in("icao_code", chunk);
        if (airportsError) return fail(airportsError.message);
        for (const row of (airports ?? []) as Array<{ icao_code?: string | null; iso_country?: string | null }>) {
          const code = (row.icao_code ?? "").toUpperCase().trim();
          const iso = (row.iso_country ?? "").toUpperCase().trim();
          if (code && iso) isoByIcao.set(code, iso);
        }
      }

      const byCountry = new Map<string, { ops: number; airports: Set<string>; lastFlight: string | null }>();
      const dayOf = (row: (typeof rows)[number]): string | null => {
        const direct = (row.departure_date ?? "").trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
        const created = (row.created_at ?? "").slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : null;
      };
      for (const row of rows) {
        const day = dayOf(row);
        for (const raw of [row.depart_icao, row.arrive_icao]) {
          const code = (raw ?? "").toUpperCase().trim();
          if (!code) continue;
          const iso = isoByIcao.get(code);
          if (!iso) continue;
          let entry = byCountry.get(iso);
          if (!entry) {
            entry = { ops: 0, airports: new Set(), lastFlight: null };
            byCountry.set(iso, entry);
          }
          entry.ops += 1;
          entry.airports.add(code);
          if (day && (!entry.lastFlight || day > entry.lastFlight)) entry.lastFlight = day;
        }
      }

      const countries: AtlasCountry[] = Array.from(byCountry.entries())
        .map(([iso, entry]) => ({
          iso,
          ops: entry.ops,
          airports: entry.airports.size,
          lastFlight: entry.lastFlight,
        }))
        .sort((a, b) => b.ops - a.ops);
      const totalAirports = new Set(
        Array.from(byCountry.values()).flatMap((entry) => Array.from(entry.airports))
      ).size;

      return ok({ countries, totalAirports });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

/** Días distintos con vuelo (departure_date, fallback created_at) → racha. */
async function loadDayStreak(userId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("flights")
      .select("departure_date,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error || !data) return 0;

    const { computeDayStreak } = await import("./pilotStatsFormat");
    const days = (data as Array<{ departure_date?: string | null; created_at?: string | null }>)
      .map((row) => row.departure_date ?? row.created_at?.slice(0, 10) ?? "")
      .filter(Boolean);
    return computeDayStreak(days, todayKeyLocal());
  } catch {
    return 0;
  }
}

function normalizeMonthly(raw: unknown): MonthlyPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row: any) => {
    const key = String(row?.month ?? row?.key ?? "");
    const m = /^(\d{4})-(\d{2})/.exec(key);
    const label = m ? MONTH_NAMES[Number(m[2]) - 1] ?? key : key;
    return { key, label, flights: num(row?.flights ?? row?.count) ?? 0 };
  });
}
