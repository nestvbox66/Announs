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
