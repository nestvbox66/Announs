import { supabase } from '../lib/supabase';
import { getAirportName } from '../utils/airportMapping';

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días
const CACHE_KEY = 'airports_cache';

interface CacheEnvelope {
  data: Record<string, CachedAirport>;
  timestamp: number;
}

export interface CachedAirport {
  icao_code: string;
  municipality: string;
  name: string;
  latitude_deg: number;
  longitude_deg: number;
  iso_country: string;
}

function readCacheEnvelope(): CacheEnvelope | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached) as CacheEnvelope;
  } catch {
    console.warn('[airportService] Caché corrupto, ignorando');
    return null;
  }
}

async function getAirportsCache(): Promise<Record<string, CachedAirport>> {
  const parsed = readCacheEnvelope();
  if (parsed && Date.now() - parsed.timestamp < CACHE_TTL) {
    return parsed.data ?? {};
  }
  // Caché expirado o ausente: no se borra aquí para permitir merge posterior.
  return {};
}

function writeAirportsCache(cache: Record<string, CachedAirport>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data: cache,
      timestamp: Date.now(),
    } as CacheEnvelope));
  } catch (e) {
    console.warn('[airportService] No se pudo persistir la caché:', e);
  }
}

export async function getAirportByIcao(icaoCode: string): Promise<CachedAirport | null> {
  if (!icaoCode) return null;

  const code = icaoCode.toUpperCase().trim();
  if (!code) return null;

  const cache = await getAirportsCache();

  if (cache[code]) {
    console.log('[airportService] Aeropuerto desde caché:', code);
    return cache[code];
  }

  const { data, error } = await supabase
    .from('airports')
    .select('icao_code, municipality, name, latitude_deg, longitude_deg, iso_country')
    .eq('icao_code', code)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn('[airportService] Error consultando airports:', code, error.message);
    } else {
      console.warn('[airportService] Aeropuerto no encontrado:', code);
    }
    return null;
  }

  // Actualizar caché. Se re-lee justo antes de escribir para no perder
  // entradas guardadas por una resolución concurrente (origen y destino se
  // resuelven en paralelo con Promise.all y cada una parte de su propia foto).
  const fresh = await getAirportsCache();
  writeAirportsCache({ ...fresh, [code]: data as CachedAirport });

  console.log('[airportService] Aeropuerto desde DB:', code, (data as CachedAirport).municipality);
  return data as CachedAirport;
}

/**
 * Resuelve el nombre de ciudad para un ICAO:
 * 1) Tabla `airports` de Supabase (con caché localStorage 7 días).
 * 2) Fallback a `airportMapping.ts` hardcodeado.
 * 3) Último recurso: el propio código ICAO.
 */
export async function getAirportCity(icaoCode: string): Promise<string> {
  if (!icaoCode) return icaoCode;
  const airport = await getAirportByIcao(icaoCode);
  if (airport?.municipality) return airport.municipality;
  return getAirportName(icaoCode) || icaoCode;
}

/** Versión síncrona (solo fallback hardcodeado) para contextos donde no se puede usar await. */
export function getAirportCitySync(icaoCode: string): string {
  return getAirportName(icaoCode) || icaoCode;
}

export function clearAirportsCache(): void {
  localStorage.removeItem(CACHE_KEY);
  console.log('[airportService] Caché limpiado');
}
