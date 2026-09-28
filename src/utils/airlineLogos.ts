/**
 * Logos de aerolíneas (banners fr24, Jxck-S/airline-logos, uso local).
 *
 * Los archivos viven en `src/assets/airline-logos/{ICAO}.png` y se resuelven
 * en build-time vía `import.meta.glob`, por lo que funcionan offline y en el
 * bundle de Tauri sin rutas dinámicas al servidor.
 */
import airlinesData from "../data/airlines.json";
import genericLogoUrl from "../assets/airline-logos/airline-generic.svg";

interface AirlineEntry {
  IATA: string;
  ICAO: string;
  Aerolinea: string;
  CallSign: string;
  Pais: string;
  Observaciones: string;
}

const airlines = airlinesData as AirlineEntry[];

/** Mapa nombre-archivo (MAYÚSCULAS) → URL empaquetada. */
const logoByCode: Record<string, string> = (() => {
  const modules = import.meta.glob<string>("../assets/airline-logos/*.png", {
    eager: true,
    query: "?url",
    import: "default",
  });
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const file = path.split("/").pop() ?? "";
    const code = file.replace(/\.png$/i, "").toUpperCase();
    if (code) map[code] = url as string;
  }
  return map;
})();

/** Cantidad de logos disponibles (diagnóstico). */
export const AIRLINE_LOGO_COUNT = Object.keys(logoByCode).length;

/**
 * URL local del banner de la aerolínea según su código ICAO
 * (p. ej. "ARG"). Devuelve null si no hay logo para ese código.
 */
export function getAirlineLogo(icao: string | null | undefined): string | null {
  const code = (icao ?? "").toUpperCase().trim();
  if (!code) return null;
  return logoByCode[code] ?? null;
}

/** Logo genérico para aerolíneas sin banner. */
export function getGenericAirlineLogo(): string {
  return genericLogoUrl;
}

/**
 * Código ICAO a partir del nombre de la aerolínea (búsqueda inversa en el
 * catálogo). Devuelve null si no hay coincidencia.
 */
export function getAirlineIcaoByName(name: string | null | undefined): string | null {
  const clean = (name ?? "").trim().toLowerCase();
  if (!clean) return null;
  const entry = airlines.find((a) => (a.Aerolinea ?? "").trim().toLowerCase() === clean);
  return entry?.ICAO?.toUpperCase() ?? null;
}
