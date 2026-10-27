import airlinesData from "../../data/airlines.json";
import type { FlightStartPreferences } from "../../services/FlightContext";

/**
 * Sandbox V2: preferencias de inicio que viajan de Flight Setup a la sesión
 * clonada. Los IDs de voz/idioma son opcionales para permitir el arranque
 * aunque el catálogo del setup todavía muestre los fallbacks locales.
 */
export interface SandboxStartPreferences extends FlightStartPreferences {
  languageId?: string | null;
  captainVoiceId?: string | null;
  crewVoiceId?: string | null;
  gateAgentVoiceId?: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Minutos para columnas numéricas de `flights` (`air_time` / `block_time`).
 * SimBrief expresa los tiempos en horas decimales. Devuelve `null` ante
 * vacío/ausente/cero: enviar `""` a una columna numeric rompe el INSERT
 * con `invalid input syntax for type numeric: ""`.
 */
export function toFlightMinutesOrNull(raw: unknown): number | null {
  const n = parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
}

export interface VoiceCatalogEntry {
  id: string;
  role: string;
  languages?: string[];
}

/**
 * Voz de puerta efectiva para los eventos `gate_*` (réplica del flujo
 * original): la elegida si es una voz `gate` válida para el idioma; si no,
 * la primera voz `gate` válida para el idioma. Nunca devuelve una voz
 * `crew`: sin esta garantía el resolver cae a `crew` y el pregrabado
 * (evento, voz, idioma) del segundo anuncio de puerta no existe.
 */
export function resolveGateVoiceId(
  voices: readonly VoiceCatalogEntry[],
  currentGateVoiceId: string | null | undefined,
  languageId: string | null | undefined,
): string | null {
  const lang = (languageId ?? "").trim();
  const matches = (v: VoiceCatalogEntry): boolean =>
    !v.languages || v.languages.length === 0 || (lang !== "" && v.languages.includes(lang));
  const current = (currentGateVoiceId ?? "").trim();
  const currentEntry = voices.find((v) => v.id === current);
  if (current !== "" && currentEntry && currentEntry.role === "gate" && matches(currentEntry)) {
    return current;
  }
  if (current !== "" && !currentEntry) {
    // Elegida en Setup pero aún no está en el catálogo de la sesión:
    // se respeta (el catálogo puede no haber terminado de cargar).
    return current;
  }
  const firstGate = voices.find((v) => v.role === "gate" && matches(v));
  return firstGate?.id ?? null;
}

interface AirlineCatalogEntry {
  IATA?: string;
  ICAO?: string;
  Aerolinea?: string;
}

const airlineCatalog = airlinesData as AirlineCatalogEntry[];

/**
 * Normaliza la aerolínea a su código ICAO/IATA para mostrarla junto al número
 * de vuelo. Acepta tanto un código ("KLM") como el nombre completo
 * ("KLM Royal Dutch Airlines") y cae al valor original si no hay coincidencia.
 */
function resolveAirlineDisplayCode(airline: string): string {
  const raw = String(airline ?? "").trim();
  if (!raw) return "";

  const key = raw.toUpperCase();
  const entry = airlineCatalog.find((candidate) => {
    const icao = (candidate.ICAO ?? "").trim().toUpperCase();
    const iata = (candidate.IATA ?? "").trim().toUpperCase();
    const name = (candidate.Aerolinea ?? "").trim().toUpperCase();
    return icao === key || iata === key || name === key;
  });

  const code = (entry?.ICAO ?? "").trim() || (entry?.IATA ?? "").trim();
  return code ? code.toUpperCase() : raw;
}

/**
 * Sandbox V2: compone el código visible de vuelo como "AEROLÍNEA NÚMERO"
 * (p. ej. "KLM 890"), evitando duplicar el código si el número ya lo incluye.
 */
export function formatAirlineFlightCode(
  airline: string | null | undefined,
  flightNumber: string | null | undefined,
): string {
  const number = String(flightNumber ?? "").trim();
  const airlineRaw = String(airline ?? "").trim();

  if (!number) return resolveAirlineDisplayCode(airlineRaw);
  if (!airlineRaw) return number;

  const code = resolveAirlineDisplayCode(airlineRaw);
  const compactCode = code.replace(/\s+/g, "").toUpperCase();
  const compactNumber = number.replace(/\s+/g, "").toUpperCase();

  if (compactCode !== "" && compactNumber.startsWith(compactCode)) {
    const rest = number.replace(/\s+/g, "").slice(compactCode.length).trim();
    return rest ? `${code} ${rest}` : code;
  }

  return `${code} ${number}`.replace(/\s+/g, " ").trim();
}

/** Devuelve el UUID limpio o `null` (vacío / placeholder / formato inválido). */
export function toUuidOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}
