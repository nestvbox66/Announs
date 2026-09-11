/**
 * Claves de configuración de eventos.
 *
 * `user_event_defaults` (user_id, event_key, value, scenario_key) guarda la
 * configuración por defecto del usuario POR ESCENARIO; `flight_event_config`
 * (flight_id, event_key, value, source, scenario_key) guarda la configuración
 * específica de un vuelo POR ESCENARIO.
 *
 * Ambas tablas usan filas dinámicas: una fila por `event_key` y `scenario_key`.
 * Convención de valores:
 *  - En la base de datos SIEMPRE en minúsculas: `off` | `pack` | `ia`
 *    (restricciones CHECK de `user_event_defaults` / `flight_event_config`).
 *  - En la UI/runtime SIEMPRE en mayúsculas: `OFF` | `PACK` | `IA`.
 * La normalización ocurre en el límite con la base de datos (servicios).
 */
export type EventSwitchValue = "OFF" | "PACK" | "IA";

/** Valor por defecto de un switch cuando no hay configuración. */
export const EVENT_CONFIG_DEFAULT_VALUE: EventSwitchValue = "IA";

/** Tipo del valor tal y como se persiste en la base de datos (minúsculas). */
export type EventDbValue = "off" | "pack" | "ia";

/** Escenario por defecto cuando no hay uno explícito. */
export const NORMAL_SCENARIO_KEY = "standard_commercial_flight";

/** Escenario de pruebas (modo manual del Desktop). */
export const TEST_SCENARIO_KEY = "test_scenario";

/**
 * Fases típicas de un vuelo, en orden lógico (las mismas que usa el Scenario
 * Designer del backoffice). Se usan para nombrar las fases de la configuración
 * de eventos y como catálogo de fases al reconstruir un escenario publicado.
 */
export const SCENARIO_DESIGNER_PHASES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "GATE", label: "Puerta de Embarque" },
  { key: "BOARDING", label: "Embarque" },
  { key: "PRE_FLIGHT", label: "Pre-Vuelo" },
  { key: "TAXI", label: "Rodaje" },
  { key: "TAKEOFF", label: "Despegue" },
  { key: "CLIMB", label: "Ascenso" },
  { key: "CRUISE", label: "Crucero" },
  { key: "DESCENT", label: "Descenso" },
  { key: "APPROACH", label: "Aproximación" },
  { key: "LANDING", label: "Aterrizaje" },
  { key: "TAXI_TO_GATE", label: "Rodaje a Puerta" },
  { key: "AT_GATE", label: "En Puerta" },
  { key: "FLIGHT_COMPLETED", label: "Vuelo Completado" },
];

export function scenarioPhaseLabel(phaseKey: string): string {
  const found = SCENARIO_DESIGNER_PHASES.find((phase) => phase.key === phaseKey);
  return found?.label ?? phaseKey;
}

/** Claves de los switches de anuncios (off / pack / IA) que muestra la UI. */
export const EVENT_CONFIG_KEYS: readonly string[] = [
  "gate_crew_start_soon",
  "gate_crew_started",
  "common_crew_boarding",
  "preflight_crew_welcome",
  "preflight_capt_welcome",
  "preflight_capt_delay",
  "preflight_capt_basic_info",
  "preflight_crew_basic_info",
  "taxi_capt_armdoors",
  "taxi_crew_safety_brief",
  "taxi_capt_dimlights",
  "taxi_crew_dimlights",
  "takeoff_capt_prepare",
  "climb_crew_upcoming_service",
  "cruise_capt_general_info",
  "cruise_crew_service_info1",
  "cruise_crew_service_info2",
  "cruise_crew_shopping_info",
  "cruise_crew_customs_forms",
  "cruise_crew_service_info3",
  "descent_capt_close_desc",
  "descent_capt_upcoming_actions",
  "descent_crew_upcoming_actions",
  "descent_capt_10kfeet",
  "descent_crew_landing_fewmin",
  "final_capt_take_seats",
  "taxitogate_crew_welcome",
  "taxitogate_crew_ramining_seating",
  "taxitogate_crew_delay_apologies",
  "atgate_capt_disarm_doors",
  "atgate_crew_deboarding",
  "common_capt_seatbelt",
  "common_crew_seatbelt",
];

/** Clave especial que persiste el flavor de anuncios (operative/cultural/...). */
export const EVENT_CONFIG_FLAVOR_KEY = "announcement_flavor";

/** Clave especial que persiste el sound pack activo de un vuelo. */
export const EVENT_CONFIG_PACKAGE_KEY = "packages_location";

export function isEventSwitchValue(value: string | null | undefined): value is EventSwitchValue {
  return value === "OFF" || value === "PACK" || value === "IA";
}

/** Normaliza un valor arbitrario al formato de la UI (mayúsculas). */
export function toUiSwitchValue(value: string | null | undefined): EventSwitchValue {
  const upper = (value ?? "").toUpperCase();
  return isEventSwitchValue(upper) ? upper : EVENT_CONFIG_DEFAULT_VALUE;
}

/** Normaliza un valor arbitrario al formato de la base de datos (minúsculas). */
export function toDbSwitchValue(value: string | null | undefined): EventDbValue {
  const lower = (value ?? "").toLowerCase();
  if (lower === "off" || lower === "pack" || lower === "ia") return lower;
  return "ia";
}
