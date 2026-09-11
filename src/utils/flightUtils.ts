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
