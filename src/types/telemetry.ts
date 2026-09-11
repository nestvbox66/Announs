/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Telemetría canónica del simulador, independiente del provider (MSFS/X-Plane/mock).
 * Extraído de `Scheduler.TelemetrySnapshot` y ampliado en Fase 3 con SimVars completas.
 */

export interface TelemetrySnapshot {
  // --- Básicos (obligatorios) ---
  /** Altitud indicada / presión en pies. */
  altitude: number;
  /** Velocidad respecto a tierra en nudos. */
  groundspeed: number;
  /** Velocidad vertical en pies/minuto (positivo ascenso). */
  verticalSpeed: number;
  /** Rumbo magnético en grados (0-360). */
  heading: number;
  /** Latitud en grados decimales. */
  latitude: number;
  /** Longitud en grados decimales. */
  longitude: number;

  // --- Extendidos (opcionales) ---
  /** IAS en nudos. */
  indicated_airspeed?: number;
  /** TAS en nudos. */
  true_airspeed?: number;
  /** Pitch en grados. */
  pitch?: number;
  /** Bank/roll en grados. */
  bank?: number;

  // --- Motores ---
  /** true si el motor 1 está en combustión. */
  engineRunning?: boolean;
  /** Número de motores (NUMBER OF ENGINES). */
  numberOfEngines?: number;
  /** true si el motor 2 está en combustión. */
  engCombustion2?: boolean;
  /** true si el motor 3 está en combustión. */
  engCombustion3?: boolean;
  /** true si el motor 4 está en combustión. */
  engCombustion4?: boolean;
  /** N1 RPM motor 1 (opcional, para futuro). */
  engN1?: number;
  /** N2 RPM motor 1 (opcional, para futuro). */
  engN2?: number;

  // --- Frenos y puertas ---
  /** true si freno de parking activo. */
  parkingBrake?: boolean;
  /** true cuando el simulador reporta puertas principales cerradas. */
  doorsClosed?: boolean;

  // --- Cinturones ---
  /** true si cinturones encendidos. */
  seatbeltOn?: boolean;
  /** true si ATC en parking spot (ATC ON PARKING SPOT). */
  atcOnParkingSpot?: boolean;
  /** true si ATC autorizó el despegue (ATC CLEARED TAKEOFF). */
  atcClearedTakeoff?: boolean;
  /** true si el avión está sobre cualquier pista (ON ANY RUNWAY). */
  onAnyRunway?: boolean;
  /** true si SIM ON GROUND. */
  simOnGround?: boolean;
  /** true si PLANE IN PARKING STATE. */
  planeInParkingState?: boolean;

  // --- Pushback ---
  /** true si pushback activo. */
  pushbackActive?: boolean;

  // --- Fase de vuelo (simulación) ---
  /** 0=preflight, 1=takeoff, 2=climb, 3=cruise, 4=descent, 5=approach, 6=landing, 7=postflight */
  simPhase?: number;

  // --- Tiempo ---
  /** Zulu time en segundos. */
  zuluTime?: number;
  /** Local time en segundos. */
  localTime?: number;
  /** Tiempo restante de crucero en segundos. */
  remainingTime?: number;

  // --- Clima ---
  /** Temperatura ambiente en °C. */
  temperature?: number;
  /** Velocidad del viento en nudos. */
  windSpeed?: number;
  /** Dirección del viento en grados. */
  windDirection?: number;

  // --- Ruta ---
  /** Nombre del próximo waypoint del plan de vuelo. */
  nextWaypoint?: string;

  // --- Compatibilidad con extensiones previas ---
  /** Altura sobre el terreno en pies (AGL). */
  agl?: number;
  /** true si está en tierra. */
  onGround?: boolean;
  /** Posición de flaps. */
  flapsPosition?: number;
  /** true si tren abajo. */
  gearDown?: boolean;
}
