/**
 * Utilidades de vuelo: determinación de vuelo internacional por códigos ICAO.
 *
 * No depende de ninguna tabla de países: usa el prefijo ICAO asignado por la
 * OACI (1-2 letras por país/región) para derivar una clave de país y comparar
 * origen vs destino.
 */

/**
 * Deriva una clave de país/región desde un código ICAO de aeropuerto.
 *
 * - Excepciones de 1 letra (países grandes con prefijo único):
 *   K → USA, C → CAN, Y → AUS.
 * - Excepción Caribe / Antillas: los prefijos 'T' y 'M' se asignan por bloques
 *   de 3 letras (p. ej. TNCM, MKJP), por lo que se usan 3 caracteres.
 * - Regla general (90% del mundo): 2 primeras letras (p. ej. SA, LE, ED, SB).
 */
export function getCountryKey(icao: string): string {
  const code = (icao ?? "").trim().toUpperCase();

  // Excepciones de 1 letra (países grandes)
  if (code.startsWith("K")) return "USA";
  if (code.startsWith("C")) return "CAN";
  if (code.startsWith("Y")) return "AUS";

  // Excepción Caribe / Antillas (prefijos 'T' y 'M' comparten código)
  if (code.startsWith("T") || code.startsWith("M")) {
    return code.substring(0, 3);
  }

  // Regla general (90% del mundo)
  return code.substring(0, 2);
}

/**
 * Resuelve el tiempo de crucero en segundos desde datos crudos de SimBrief.
 *
 * IMPORTANTE: el JSON de SimBrief (`xml.fetcher.php?json=1`) NO incluye
 * `times.cruise_time` (su struct `times` solo trae sched/est out/off/on/in,
 * est_time_enroute, est_block, taxi_out/in, reserve, endurance...). Leer
 * `times.cruise_time` directamente siempre da 0. Por eso se deriva del
 * navlog: suma de `time_leg` de los fixes con `stage` de crucero (CRZ).
 *
 * Prioridad: 1) `times.cruise_time` explícito (> 0, por compatibilidad si el
 * dato viene enriquecido); 2) Σ navlog crucero (> 0); 3) 0 (sin dato).
 */
export function resolveCruiseTimeSeconds(rawData: any): {
  seconds: number;
  source: "cruise_time" | "navlog" | "none";
} {
  const explicit = Number(rawData?.times?.cruise_time);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { seconds: Math.round(explicit), source: "cruise_time" };
  }

  try {
    const fixesRaw = rawData?.navlog?.fix;
    const fixes: any[] = Array.isArray(fixesRaw) ? fixesRaw : fixesRaw ? [fixesRaw] : [];
    let sum = 0;
    for (const fix of fixes) {
      const stage = String(fix?.stage ?? "").trim().toUpperCase();
      if (stage === "CRZ" || stage === "CRUISE") {
        const leg = Number(fix?.time_leg);
        if (Number.isFinite(leg) && leg > 0) sum += leg;
      }
    }
    if (sum > 0) return { seconds: Math.round(sum), source: "navlog" };
  } catch {}

  return { seconds: 0, source: "none" };
}

/**
 * Distancia de círculo máximo en NM (fórmula de Haversine).
 * Radio terrestre 3440.065 NM (misma constante que RuleEngine).
 */
export function gcDistanceNm(
  lat1d: number, lon1d: number, lat2d: number, lon2d: number
): number {
  if ([lat1d, lon1d, lat2d, lon2d].some((v) => typeof v !== "number" || Number.isNaN(v))) {
    return NaN;
  }
  const R = 3440.065;
  const lat1 = (lat1d * Math.PI) / 180;
  const lat2 = (lat2d * Math.PI) / 180;
  const dLat = ((lat2d - lat1d) * Math.PI) / 180;
  const dLon = ((lon2d - lon1d) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function simbriefLatLon(point: any): { lat: number; lon: number } | null {
  if (!point || typeof point !== "object") return null;
  const lat = Number(point.pos_lat ?? point.posLat);
  const lon = Number(point.pos_long ?? point.posLong);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Resuelve la distancia total de la ruta en NM desde SimBrief.
 *
 * Prioridad: 1) `general.route_distance` explícito (> 0); 2) círculo máximo
 * origen→destino con `origin/destination.pos_lat|pos_long` (> 0);
 * 3) 0 (sin dato → el progreso usa fallback por tiempo).
 */
export function resolveTotalDistanceNm(rawData: any): {
  nm: number;
  source: "route_distance" | "gc" | "none";
} {
  const explicit = Number(rawData?.general?.route_distance);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { nm: Math.round(explicit), source: "route_distance" };
  }

  try {
    const o = simbriefLatLon(rawData?.origin);
    const d = simbriefLatLon(rawData?.destination);
    if (o && d) {
      const gc = gcDistanceNm(o.lat, o.lon, d.lat, d.lon);
      if (Number.isFinite(gc) && gc > 0) return { nm: Math.round(gc), source: "gc" };
    }
  } catch {}

  return { nm: 0, source: "none" };
}

/**
 * Determina si un vuelo es internacional comparando las claves de país
 * derivadas de los códigos ICAO de origen y destino.
 *
 * @returns false si los códigos son inválidos (< 4 caracteres).
 */
export function isInternationalFlight(originICAO: string, destICAO: string): boolean {
  const orig = (originICAO ?? "").trim().toUpperCase();
  const dest = (destICAO ?? "").trim().toUpperCase();

  if (orig.length < 4 || dest.length < 4) {
    console.warn("[isInternationalFlight] Códigos ICAO inválidos:", { orig, dest });
    return false;
  }

  return getCountryKey(orig) !== getCountryKey(dest);
}
