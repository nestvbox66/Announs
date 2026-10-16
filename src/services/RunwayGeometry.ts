/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RunwayGeometry — geometría pura de pistas (sin dependencias de la app).
 *
 * Responde "¿está el punto dentro del rectángulo de alguna pista?" para
 * emular `ON_ANY_RUNWAY` de MSFS en X-Plane (vía paridad): verdadero en
 * cualquier punto de la pista, no solo en cabecera. Sin rumbo, sin
 * alineación, sin corrección magnética (no se compara ningún rumbo).
 *
 * Proyección local plana alrededor del punto medio de la pista: suficiente
 * para distancias de centenas de metros (error submétrico).
 */

export interface RunwayEnd {
  /** Designador del extremo (p. ej. "09", "27L"). */
  designator: string;
  /** Latitud del extremo FÍSICO sobre el eje, grados decimales. */
  lat: number;
  /** Longitud del extremo FÍSICO sobre el eje, grados decimales. */
  lon: number;
  /** Umbral desplazado en metros (informativo; el rectángulo usa extremos físicos). */
  displacedThresholdM: number;
}

export interface RunwayGeometry {
  /** Ancho de pista en metros (apt.dat, fila 100). */
  widthM: number;
  /** Extremos físicos [A, B]. */
  ends: [RunwayEnd, RunwayEnd];
  /** Tipo de superficie apt.dat (informativo). */
  surface?: number;
}

/**
 * Margen lateral/longitudinal sobre el rectángulo físico, en metros.
 *
 * Justificación (requerimiento: disparar AL ENTRAR a la pista):
 * - Coordenadas apt.dat con 8 decimales (resolución milimétrica; precisión
 *   real de relevamiento ~1-3 m) y posición del sim exacta (sin ruido GPS).
 * - El punto evaluado es la referencia del avión; 10 m cubre el error de
 *   relevamiento + la entrada en ángulo oblicuo sin adelantar el disparo
 *   (a 15 kt de rodaje son ~1.3 s de anticipación como máximo).
 * - Una calle de rodaje paralela típica está a >30 m del borde de pista, así
 *   que 10 m no la alcanza; el punto de espera previo al umbral queda fuera
 *   porque está antes del extremo físico (ver `isPointOnRunway`).
 */
export const RUNWAY_MARGIN_M = 10;

/** Umbral del fallback degradado (ver RunwayProximityService), en nudos. */
export const FALLBACK_GROUNDSPEED_KT = 30;

/**
 * Radio de "estacionado en puesto" alrededor de un ramp-start apt.dat,
 * en metros.
 *
 * Justificación: el punto 1300 marca la parada y sin VDGS un piloto detiene
 * el avión a ~10-30 m de ella (la referencia del sim es el CG, no el morro:
 * +10-20 m de offset según el avión). 40 m cubre esa dispersión; las puertas
 * de airliners distan >50 m entre sí, así que no hay confusión entre stands
 * vecinos en aeropuertos comerciales. En plataformas GA densas (tie-downs a
 * 15-20 m) puede marcar el stand vecino: se informa el nombre del stand en
 * el log para auditarlo, y el freno+velocidad acotan el falso positivo.
 */
export const PARKING_RADIUS_M = 40;

const DEG_TO_RAD = Math.PI / 180;
// Metros por grado de latitud (aprox. WGS84, suficiente para este uso).
const M_PER_DEG_LAT = 111320;

function lonScale(latDeg: number): number {
  return M_PER_DEG_LAT * Math.cos(latDeg * DEG_TO_RAD);
}

export interface RunwayPointCheck {
  inside: boolean;
  /** Distancia perpendicular al eje, en metros (siempre >= 0). */
  crossTrackM: number;
  /** Distancia a lo largo del eje desde el extremo A, en metros. */
  alongTrackM: number;
  /** Longitud del rectángulo (distancia entre extremos), en metros. */
  lengthM: number;
  /** Semiancho efectivo usado (semiancho físico + margen), en metros. */
  halfWidthM: number;
}

/**
 * Chequea un punto contra UNA pista (rectángulo físico + margen).
 * Extremos físicos: el avión en punto de espera (antes del extremo) queda
 * fuera; más allá del extremo opuesto también queda fuera.
 */
export function isPointOnRunway(
  lat: number,
  lon: number,
  runway: RunwayGeometry,
  marginM: number = RUNWAY_MARGIN_M
): RunwayPointCheck {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(runway.widthM) ||
    runway.widthM <= 0
  ) {
    return { inside: false, crossTrackM: NaN, alongTrackM: NaN, lengthM: NaN, halfWidthM: NaN };
  }
  const [a, b] = runway.ends;
  const midLat = (a.lat + b.lat) / 2;
  const kx = lonScale(midLat);
  const ax = (a.lon) * kx;
  const ay = a.lat * M_PER_DEG_LAT;
  const bx = b.lon * kx;
  const by = b.lat * M_PER_DEG_LAT;
  const px = lon * kx;
  const py = lat * M_PER_DEG_LAT;
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (!(len2 > 0)) {
    return { inside: false, crossTrackM: NaN, alongTrackM: NaN, lengthM: 0, halfWidthM: NaN };
  }
  const lengthM = Math.sqrt(len2);
  // Parámetro sin fijar para saber si cae entre los extremos físicos.
  const tRaw = ((px - ax) * abx + (py - ay) * aby) / len2;
  // Proyección fijada al segmento para medir la distancia perpendicular.
  const t = Math.min(1, Math.max(0, tRaw));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const crossTrackM = Math.hypot(px - cx, py - cy);
  const alongTrackM = t * lengthM;
  const halfWidthM = runway.widthM / 2 + Math.max(0, marginM);
  // Extremos sin capuchón: dentro solo entre los extremos físicos (0<=t<=1)
  // y dentro del semiancho efectivo. Así el punto de espera previo al umbral
  // queda fuera y el disparo ocurre AL ENTRAR a la pista (criterio MSFS).
  const inside = tRaw >= 0 && tRaw <= 1 && crossTrackM <= halfWidthM;
  return { inside, crossTrackM, alongTrackM, lengthM, halfWidthM };
}

export interface OnAnyRunwayResult {
  onRunway: boolean;
  /** Designador del extremo de referencia de la pista coincidente, o null. */
  matchedDesignator: string | null;
  /** True si coincidió una pista distinta de la planificada. */
  planMismatch: boolean;
  /** Distancia perpendicular al eje de la coincidencia, en metros. */
  crossTrackM: number | null;
}

function normalizeDesignator(d: string | null | undefined): string | null {
  if (typeof d !== "string") return null;
  const t = d.trim().toUpperCase();
  return t === "" ? null : t;
}

/**
 * Chequea un punto contra TODAS las pistas (semántica MSFS: cualquier pista).
 * La planificada se chequea primero como early-out barato; si coincide otra,
 * se informa mismatch (se dispara igual + log, nunca se silencia).
 */
export function checkOnAnyRunway(
  lat: number,
  lon: number,
  runways: RunwayGeometry[],
  opts?: { marginM?: number; planRwy?: string | null }
): OnAnyRunwayResult {
  const marginM = opts?.marginM ?? RUNWAY_MARGIN_M;
  const plan = normalizeDesignator(opts?.planRwy);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || runways.length === 0) {
    return { onRunway: false, matchedDesignator: null, planMismatch: false, crossTrackM: null };
  }
  const ordered = [...runways].sort((r1, r2) => {
    const p1 = plan !== null && r1.ends.some((e) => normalizeDesignator(e.designator) === plan) ? 0 : 1;
    const p2 = plan !== null && r2.ends.some((e) => normalizeDesignator(e.designator) === plan) ? 0 : 1;
    return p1 - p2;
  });
  for (const rwy of ordered) {
    const check = isPointOnRunway(lat, lon, rwy, marginM);
    if (check.inside) {
      // Designador del extremo más cercano como referencia.
      const [a, b] = rwy.ends;
      const midLat = (a.lat + b.lat) / 2;
      const kx = lonScale(midLat);
      const da = Math.hypot((lon - a.lon) * kx, (lat - a.lat) * M_PER_DEG_LAT);
      const db = Math.hypot((lon - b.lon) * kx, (lat - b.lat) * M_PER_DEG_LAT);
      const matched = da <= db ? a.designator : b.designator;
      const planMismatch =
        plan !== null && normalizeDesignator(matched) !== plan;
      return { onRunway: true, matchedDesignator: matched, planMismatch, crossTrackM: check.crossTrackM };
    }
  }
  return { onRunway: false, matchedDesignator: null, planMismatch: false, crossTrackM: null };
}

/** Puesto de estacionamiento apt.dat (fila 1300). */
export interface RampStart {
  lat: number;
  lon: number;
  /** gate|hangar|misc|tie-down|unknown. */
  kind: string;
  /** Nombre del stand (p. ej. "A7"), puede ser vacío. */
  name: string;
}

/** Distancia haversine en metros (para tests y diagnósticos). */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface NearRampResult {
  near: boolean;
  /** Stand más cercano dentro del radio (o null). */
  stand: RampStart | null;
  /** Distancia al stand más cercano, en metros (o null sin rampas). */
  distanceM: number | null;
}

/**
 * ¿Está el punto junto a un puesto de estacionamiento? Base de la paridad
 * `atcOnParkingSpot` (MSFS la informa desde su ATC; X-Plane no expone nada
 * equivalente, así que se aproxima con geometría apt.dat fila 1300).
 * Solo distancia: las condiciones de detenido/freno las evalúa el llamador
 * (igual que la regla las combina con SIM_ON_GROUND y PARKING_BRAKE).
 */
export function checkNearRamp(
  lat: number,
  lon: number,
  ramps: RampStart[],
  radiusM: number = PARKING_RADIUS_M
): NearRampResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || ramps.length === 0) {
    return { near: false, stand: null, distanceM: ramps.length === 0 ? null : NaN };
  }
  let best: RampStart | null = null;
  let bestD = Infinity;
  for (const ramp of ramps) {
    if (!Number.isFinite(ramp.lat) || !Number.isFinite(ramp.lon)) continue;
    const d = haversineM(lat, lon, ramp.lat, ramp.lon);
    if (d < bestD) {
      bestD = d;
      best = ramp;
    }
  }
  if (best === null) {
    return { near: false, stand: null, distanceM: null };
  }
  const radius = Math.max(0, radiusM);
  return bestD <= radius
    ? { near: true, stand: best, distanceM: bestD }
    : { near: false, stand: null, distanceM: bestD };
}
