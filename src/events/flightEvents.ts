import { FlightPhase } from "../engine/FlightEngine";
import { EventDefinition } from "./types";

function defineEvent(
  eventKey: string,
  phase: FlightPhase,
  speakerRole: EventDefinition["speakerRole"],
  description: string,
  priority = 10
): EventDefinition {
  return {
    eventKey,
    phase,
    triggerType: "phase_enter",
    enabledSwitch: eventKey,
    priority,
    blocking: true,
    description,
    speakerRole,
    preRecorded: true,
  };
}

/**
 * Catálogo de eventos de las fases de vuelo (PRE_FLIGHT → AT_GATE).
 * Complementa a `EventCatalog` (gate) y `BoardingEventCatalog` (boarding).
 * Se registran en `EventCatalogService` para que la narrativa y las reglas
 * por fase puedan resolver cualquier evento que el escenario publicado
 * del Backoffice referencie (p. ej. los eventos de TAXI).
 */
export const FlightEvents: Record<string, EventDefinition> = {
  common_crew_boarding: defineEvent(
    "common_crew_boarding",
    FlightPhase.BOARDING,
    "crew",
    "Mensajes rutinarios dentro de la cabina mientras los pasajeros buscan sus asientos"
  ),
  preflight_capt_delay: defineEvent(
    "preflight_capt_delay",
    FlightPhase.PRE_FLIGHT,
    "captain",
    "Explicación sobre posibles demoras por tráfico ATC o carga"
  ),
  // ── BOARDING — delay parked (WAIT_CONDITION / delay_detection) ──
  preflight_capt_delay_parked: {
    eventKey: "preflight_capt_delay_parked",
    phase: FlightPhase.BOARDING,
    triggerType: "condition",
    enabledSwitch: "preflight_capt_delay_parked",
    priority: 10,
    blocking: false,
    description: "Aviso de demora en puerta (parked) — se dispara al superar umbral antes de salida",
    speakerRole: "captain",
    preRecorded: false,
    default_delay_ms: 600000,
  },
  // ── PRE_FLIGHT — delay taxi (WAIT_CONDITION / delay_detection) ──
  preflight_capt_delay_taxi: {
    eventKey: "preflight_capt_delay_taxi",
    phase: FlightPhase.PRE_FLIGHT,
    triggerType: "condition",
    enabledSwitch: "preflight_capt_delay_taxi",
    priority: 10,
    blocking: false,
    description: "Aviso de demora en puerta sin movimiento (taxi) — PRE_FLIGHT, en parking y GROUND VELOCITY < 1kt",
    speakerRole: "captain",
    preRecorded: false,
    default_delay_ms: 900000,
  },

  // ── TAXI ──
  taxi_capt_armdoors: defineEvent(
    "taxi_capt_armdoors",
    FlightPhase.TAXI,
    "captain",
    "Orden a la tripulación para armar toboganes y verificar puertas (cross-check)"
  ),
  taxi_crew_safety_brief: defineEvent(
    "taxi_crew_safety_brief",
    FlightPhase.TAXI,
    "crew",
    "Demostración de seguridad (manual o por pantallas)"
  ),
  taxi_capt_dimlights: defineEvent(
    "taxi_capt_dimlights",
    FlightPhase.TAXI,
    "captain",
    "Orden para reducir la iluminación general (típicamente en vuelos nocturnos)"
  ),
  taxi_crew_dimlights: defineEvent(
    "taxi_crew_dimlights",
    FlightPhase.TAXI,
    "crew",
    "Aviso a los pasajeros sobre la atenuación de luces para el despegue"
  ),

  // ── TAKEOFF ──
  takeoff_capt_prepare: defineEvent(
    "takeoff_capt_prepare",
    FlightPhase.TAKEOFF,
    "captain",
    "Orden ejecutiva indicando a los tripulantes que tomen sus lugares para el despegue"
  ),

  // ── CLIMB ──
  climb_crew_upcoming_service: defineEvent(
    "climb_crew_upcoming_service",
    FlightPhase.CLIMB,
    "crew",
    "Aviso sobre los servicios a bordo que se ofrecerán al superar los 10.000 pies"
  ),

  // ── CRUISE ──
  cruise_capt_general_info: defineEvent(
    "cruise_capt_general_info",
    FlightPhase.CRUISE,
    "captain",
    "Actualización a mitad del vuelo sobre el progreso y la ruta"
  ),
  // Evento sin sufijo numérico: el escenario publicado (p. ej. test_scenario)
  // lo referencia como "cruise_crew_service_info" (no info1/info2/info3).
  cruise_crew_service_info: defineEvent(
    "cruise_crew_service_info",
    FlightPhase.CRUISE,
    "crew",
    "Servicio de comidas a bordo (fase CRUISE)"
  ),
  cruise_crew_service_info1: defineEvent(
    "cruise_crew_service_info1",
    FlightPhase.CRUISE,
    "crew",
    "Inicio del servicio primario de comidas o bebidas"
  ),
  cruise_crew_service_info2: defineEvent(
    "cruise_crew_service_info2",
    FlightPhase.CRUISE,
    "crew",
    "Segundo pase en cabina (recolección de bandejas, té/café)"
  ),
  cruise_crew_shopping_info: defineEvent(
    "cruise_crew_shopping_info",
    FlightPhase.CRUISE,
    "crew",
    "Promoción de la venta a bordo (Duty Free)"
  ),
  cruise_crew_customs_forms: defineEvent(
    "cruise_crew_customs_forms",
    FlightPhase.CRUISE,
    "crew",
    "Aviso sobre formularios de migraciones y aduanas"
  ),
  cruise_crew_service_info3: defineEvent(
    "cruise_crew_service_info3",
    FlightPhase.CRUISE,
    "crew",
    "Tercer servicio ocasional antes del descenso"
  ),

  // ── CRUISE — Evento especial ──
  captain_special_event: {
    eventKey: "captain_special_event",
    phase: FlightPhase.CRUISE,
    triggerType: "condition",
    enabledSwitch: "captain_special_event",
    priority: 30,
    blocking: false,
    description: "Evento Especial en Cabina",
    speakerRole: "captain",
    preRecorded: false,
  },

  // ── DESCENT ──
  descent_capt_close_desc: defineEvent(
    "descent_capt_close_desc",
    FlightPhase.DESCENT,
    "captain",
    "Aviso previo al Top of Descent"
  ),
  descent_capt_upcoming_actions: defineEvent(
    "descent_capt_upcoming_actions",
    FlightPhase.DESCENT,
    "captain",
    "Detalles finales sobre pista, terminal y clima en destino"
  ),
  descent_crew_upcoming_actions: defineEvent(
    "descent_crew_upcoming_actions",
    FlightPhase.DESCENT,
    "crew",
    "Solicitud a los pasajeros de guardar mesas y enderezar respaldos"
  ),
  descent_capt_10kfeet: defineEvent(
    "descent_capt_10kfeet",
    FlightPhase.DESCENT,
    "captain",
    "Cabina estéril al cruzar 10.000 pies"
  ),
  descent_crew_landing_fewmin: defineEvent(
    "descent_crew_landing_fewmin",
    FlightPhase.DESCENT,
    "crew",
    "Chequeo final de cabina minutos antes del aterrizaje"
  ),
  final_capt_take_seats: defineEvent(
    "final_capt_take_seats",
    FlightPhase.DESCENT,
    "captain",
    "Orden de ocupar los transportines para el aterrizaje"
  ),

  // ── TAXI_IN (TAXI_TO_GATE) ──
  taxitogate_crew_welcome: defineEvent(
    "taxitogate_crew_welcome",
    FlightPhase.TAXI_IN,
    "crew",
    "Bienvenida oficial al destino y confirmación de la hora local"
  ),
  taxitogate_crew_ramining_seating: defineEvent(
    "taxitogate_crew_ramining_seating",
    FlightPhase.TAXI_IN,
    "crew",
    "Recordatorio de permanecer sentados hasta apagar la señal"
  ),
  taxitogate_crew_delay_apologies: defineEvent(
    "taxitogate_crew_delay_apologies",
    FlightPhase.TAXI_IN,
    "crew",
    "Gestión de demoras en plataforma"
  ),

  // ── AT_GATE ──
  atgate_capt_disarm_doors: defineEvent(
    "atgate_capt_disarm_doors",
    FlightPhase.AT_GATE,
    "captain",
    "Orden para desarmar los toboganes de evacuación"
  ),
  atgate_crew_deboarding: defineEvent(
    "atgate_crew_deboarding",
    FlightPhase.AT_GATE,
    "crew",
    "Instrucciones finales sobre el flujo de salida"
  ),
};
