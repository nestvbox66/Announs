/**
 * Simulador registrado por vuelo (`public.flights.simulator`).
 *
 * El proveedor interno (`SimProvider`: "msfs" | "xplane" | "mock") se mapea
 * a los valores permitidos por la columna: "MSFS2024" y "XPLANE12".
 * "mock" (pruebas sin simulador) queda en null (histórico).
 */

export const FLIGHT_SIMULATORS = ["MSFS2024", "XPLANE12"] as const;

export type FlightSimulator = (typeof FLIGHT_SIMULATORS)[number];

/** Mapea el proveedor activo al valor persistido (null si no aplica). */
export function resolveFlightSimulator(
  provider: string | null | undefined,
): FlightSimulator | null {
  if (provider === "msfs") return "MSFS2024";
  if (provider === "xplane") return "XPLANE12";
  return null;
}

/** Valida un valor leído de la base (defensivo ante datos viejos). */
export function isFlightSimulator(value: unknown): value is FlightSimulator {
  return value === "MSFS2024" || value === "XPLANE12";
}

/**
 * Mapea la preferencia guardada (`setting_general.simulator`) al proveedor
 * interno del setup de vuelo (`SimProvider`). Devuelve null si no hay
 * preferencia válida (el setup conserva su selección actual).
 */
export function resolveSimProvider(
  simulator: string | null | undefined,
): "msfs" | "xplane" | null {
  if (simulator === "MSFS2024") return "msfs";
  if (simulator === "XPLANE12") return "xplane";
  return null;
}

export interface SimulatorShare {
  simulator: FlightSimulator;
  flights: number;
}

/**
 * Agrega conteos por simulador para la torta del HUB.
 * Orden estable: MSFS2024 primero, XPLANE12 después; ignora nulos/otros.
 */
export function aggregateSimulatorShares(
  simulators: Array<string | null | undefined>,
): SimulatorShare[] {
  let msfs = 0;
  let xplane = 0;
  for (const value of simulators) {
    if (value === "MSFS2024") msfs += 1;
    else if (value === "XPLANE12") xplane += 1;
  }
  return [
    { simulator: "MSFS2024", flights: msfs },
    { simulator: "XPLANE12", flights: xplane },
  ];
}
