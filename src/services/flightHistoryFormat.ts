/**
 * Formateadores puros del historial de vuelos (sin dependencias de red).
 * Viven en módulo propio para poder probarse fuera de Vite.
 */

/** "20 sept 2026, 14:15" a partir de departure_date/time, con fallback a created_at. */
export function formatDepartLabel(
  departureDate: string | null | undefined,
  departureTime: string | null | undefined,
  createdAt: string | null | undefined
): string {
  const direct = parseDepartDate(departureDate, departureTime);
  const fallback = direct ?? (createdAt ? new Date(createdAt) : null);
  if (!fallback || Number.isNaN(fallback.getTime())) return "—";
  const date = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(fallback);
  const time = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(fallback);
  return `${date}, ${time}`;
}

export function formatShortDate(
  departureDate: string | null | undefined,
  createdAt: string | null | undefined
): string {
  const direct = departureDate ? new Date(`${departureDate}T00:00`) : null;
  const fallback = direct && !Number.isNaN(direct.getTime())
    ? direct
    : createdAt
      ? new Date(createdAt)
      : null;
  if (!fallback || Number.isNaN(fallback.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(fallback);
}

function parseDepartDate(
  departureDate: string | null | undefined,
  departureTime: string | null | undefined
): Date | null {
  if (!departureDate) return null;
  const time = (departureTime ?? "").trim().slice(0, 5) || "00:00";
  const parsed = new Date(`${departureDate}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Minutos (air_time con fallback a block_time) → "1h 10m" / "45m" / "—". */
export function formatDuration(
  airTime: string | null | undefined,
  blockTime: string | null | undefined
): string {
  const minutes = parseMinutes(airTime) ?? parseMinutes(blockTime);
  if (minutes === null || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function parseMinutes(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseInt(String(value).trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Distancia ortodrómica en millas náuticas (null si faltan coords). */
export function haversineNm(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined
): number | null {
  if (
    lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined ||
    lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined
  ) {
    return null;
  }
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 3440.065; // radio terrestre en NM
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.asin(Math.sqrt(a));
}
