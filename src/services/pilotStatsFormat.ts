/**
 * Formateadores puros del panel de estadísticas (sin dependencias de red).
 * Módulo propio para poder probarse fuera de Vite.
 */

const thousands = new Intl.NumberFormat("en-US");

/** Minutos → "1h 10m" / "45m" / "—". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  if (total <= 0) return "—";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours <= 0) return `${rest}m`;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Horas decimales → "79 h" / "55,5 h" / "—". */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours < 0) return "—";
  const rounded = Math.round(hours * 10) / 10;
  return `${thousands.format(rounded)} h`;
}

/** Minutos acumulados → "12.5 hrs" / "3 hrs" / "—". */
export function formatTotalHours(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) return "—";
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  return `${thousands.format(hours)} hrs`;
}

/** Millas náuticas → "1,650" / "96.7" / "—" (decimales limpios). */
export function formatNm(nm: number | null | undefined): string {
  if (nm === null || nm === undefined || !Number.isFinite(nm) || nm < 0) return "—";
  const rounded = Math.round(nm * 10) / 10;
  return thousands.format(rounded);
}

/** "2026-09" (o ISO) → "Sep". */
export function monthShortLabel(monthKey: string | null | undefined): string {
  if (!monthKey) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(monthKey.trim());
  if (!m) return monthKey;
  const idx = Number(m[2]) - 1;
  const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return names[idx] ?? monthKey;
}

/**
 * Racha de días consecutivos con actividad a partir de una lista de días
 * ("YYYY-MM-DD"). Acepta que hoy aún no tenga vuelos (arranca en ayer).
 * Devuelve 0 si no hay actividad reciente.
 */
export function computeDayStreak(dayKeys: string[], todayKey: string): number {
  const days = new Set(
    (dayKeys ?? [])
      .map((d) => (d ?? "").trim().slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  );
  if (days.size === 0) return 0;

  const shift = (key: string, deltaDays: number): string => {
    const dt = new Date(`${key}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) return "";
    return new Date(dt.getTime() + deltaDays * 86400000).toISOString().slice(0, 10);
  };

  let cursor = days.has(todayKey) ? todayKey : shift(todayKey, -1);
  let streak = 0;
  while (cursor && days.has(cursor)) {
    streak++;
    cursor = shift(cursor, -1);
  }
  return streak;
}

/** Día local "YYYY-MM-DD" de hoy (para la racha). */
export function todayKeyLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface DistributionInput {
  model: string;
  hours: number;
  flights: number;
  sharePct: number;
}

export interface TopRouteInput {
  origin: string;
  dest: string;
  originCity: string;
  destCity: string;
  count: number;
  distanceNm: number | null;
}

/**
 * Normaliza el array `distribution` de la RPC (claves tolerantes).
 * La RPC devuelve minutos en `total_air_time` y conteo en `flight_count`.
 */
export function normalizeDistribution(raw: unknown): DistributionInput[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.map((row: any) => {
    const minutes = num(row?.total_air_time_minutes ?? row?.air_time_minutes ?? row?.total_air_time);
    const hours = num(row?.total_air_time_hours ?? row?.hours ?? row?.air_time_hours)
      ?? (minutes !== null ? minutes / 60 : 0);
    return {
      model: String(row?.aircraft_type ?? row?.model ?? row?.aircraft ?? "—"),
      hours,
      flights: num(row?.flights ?? row?.flight_count ?? row?.count) ?? 0,
      sharePct: num(row?.share_pct ?? row?.share ?? row?.pct) ?? NaN,
    };
  });
  const totalHours = items.reduce((sum, item) => sum + item.hours, 0);
  const totalFlights = items.reduce((sum, item) => sum + item.flights, 0);
  return items
    .map((item) => {
      if (Number.isFinite(item.sharePct)) return item;
      if (totalHours > 0) {
        return { ...item, sharePct: Math.round((item.hours / totalHours) * 1000) / 10 };
      }
      return {
        ...item,
        sharePct: totalFlights > 0 ? Math.round((item.flights / totalFlights) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.hours - a.hours);
}

/** Normaliza el array `top_routes` de la RPC (claves tolerantes). */
export function normalizeTopRoutes(raw: unknown): TopRouteInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row: any) => ({
    origin: String(row?.depart_icao ?? row?.origin ?? row?.from ?? "—"),
    dest: String(row?.arrive_icao ?? row?.destination ?? row?.to ?? "—"),
    originCity: String(
      row?.depart_municipality ?? row?.origin_city ?? row?.depart_city ?? row?.originCity ?? ""
    ),
    destCity: String(
      row?.arrive_municipality ?? row?.dest_city ?? row?.arrive_city ?? row?.destCity ?? ""
    ),
    count: num(row?.flights ?? row?.flight_count ?? row?.count ?? row?.times) ?? 0,
    distanceNm: num(row?.distance_nm ?? row?.distance),
  }));
}
