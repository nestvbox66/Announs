/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tipos y constructores de datos para la pantalla de In-Flight
 * Entertainment (fase 1: maquetado). Los builders toleran datos
 * ausentes (SimBrief sin cargar) con fallbacks visuales, dejando los
 * contenedores listos para conectar datos reales y videos en fases
 * posteriores.
 */
import { getAirlineLogo, getGenericAirlineLogo } from "../../utils/airlineLogos";
import { getAirlineName } from "../../utils/airlineMapping";
import { formatLocalHHMM, getAirportTimezone } from "../../utils/airportMapping";

/** Resumen de vuelo que muestra la pantalla de bienvenida del IFE. */
export interface IfeFlightInfo {
  airlineIcao: string;
  airlineName: string;
  logoUrl: string;
  flightNumber: string;
  /** Nombre de la aeronave (p. ej. "Boeing 777-300ER"). */
  aircraftName: string;
  originIcao: string;
  originCity: string;
  destIcao: string;
  destCity: string;
  departureLocal: string;
  arrivalLocal: string;
  /** Progreso de ruta 0-100 (fase 1: despegue, se animará con datos reales). */
  progressPct: number;
  /** Tiempo remanente de vuelo para la topbar (fase 1: duración estimada). */
  remainingLabel: string;
}

/** Pasajero destacado en la bienvenida ("usuario" del IFE). */
export interface IfeGuest {
  name: string;
  seat: string;
  cabinClass: string;
}

const FALLBACK_FLIGHT: IfeFlightInfo = {
  airlineIcao: "",
  airlineName: "—",
  logoUrl: getGenericAirlineLogo(),
  flightNumber: "—",
  aircraftName: "",
  originIcao: "—",
  originCity: "",
  destIcao: "—",
  destCity: "",
  departureLocal: "--:--",
  arrivalLocal: "--:--",
  progressPct: 0,
  remainingLabel: "--:--",
};

function formatHMM(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

/**
 * Construye el resumen de vuelo desde `simbriefRawData` (any tolerante).
 * Horarios en hora local de cada aeropuerto (IANA + fallback UTC).
 */
export function buildIfeFlightInfo(raw: any): IfeFlightInfo {
  if (!raw) return { ...FALLBACK_FLIGHT };

  const general = raw.general ?? {};
  const origin = raw.origin ?? {};
  const destination = raw.destination ?? {};
  const times = raw.times ?? {};

  const airlineIcao = String(general.icao_airline ?? "").toUpperCase().trim();
  const flightNumberRaw = `${general.icao_airline ?? ""}${general.flight_number ?? ""}`.trim();

  const originIcao = String(origin.icao_code ?? "").toUpperCase();
  const destIcao = String(destination.icao_code ?? "").toUpperCase();

  const schedOut = Number(general.sched_out ?? times.sched_out ?? NaN);
  const enrouteSec = Number(times.est_time_enroute ?? NaN);

  const departureLocal =
    formatLocalHHMM(schedOut, getAirportTimezone(originIcao), null) ?? "--:--";
  const arrivalLocal =
    Number.isFinite(schedOut) && Number.isFinite(enrouteSec)
      ? (formatLocalHHMM(schedOut + enrouteSec, getAirportTimezone(destIcao), null) ?? "--:--")
      : "--:--";

  return {
    airlineIcao,
    airlineName: airlineIcao ? getAirlineName(airlineIcao) : "—",
    logoUrl: getAirlineLogo(airlineIcao) ?? getGenericAirlineLogo(),
    flightNumber: flightNumberRaw || "—",
    aircraftName: String(raw.aircraft?.name ?? "").trim(),
    originIcao: originIcao || "—",
    originCity: String(origin.city ?? origin.name ?? ""),
    destIcao: destIcao || "—",
    destCity: String(destination.city ?? destination.name ?? ""),
    departureLocal,
    arrivalLocal,
    progressPct: 0,
    remainingLabel: Number.isFinite(enrouteSec) ? formatHMM(enrouteSec / 60) : "--:--",
  };
}

/** Elige al azar un pasajero embarcado para personalizar la bienvenida. */
export function pickIfeGuest(
  boarded: Array<{ nombre: string; asiento: string; clase: string }>
): IfeGuest | null {
  if (!boarded || boarded.length === 0) return null;
  const pick = boarded[Math.floor(Math.random() * boarded.length)];
  return { name: pick.nombre, seat: pick.asiento, cabinClass: pick.clase };
}
