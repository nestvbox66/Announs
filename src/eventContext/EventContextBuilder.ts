import { supabase } from "../lib/supabase";
import { config } from "../config";
import { FlightContext } from "../services/FlightContext";
import { VariableResolver, VariableDefinition } from "../services/VariableResolver";
import { EventContext } from "./types";

// Definiciones por defecto (fallback local). Se usan cuando la tabla
// `prompts.variables` aún no tiene catálogo publicado para un evento.
// Mantienen funcionando los eventos existentes y proveen datos a los que
// antes no tenían builder.
const DEFAULT_VARIABLE_DEFINITIONS: Record<string, Record<string, VariableDefinition>> = {
  gate_crew_start_soon: {
    airline: { source: "flight", source_path: "airline", required: true },
    flight_number: { source: "flight", source_path: "flightNumber", required: true },
    destination: { source: "flight", source_path: "destCity", required: true },
    gate: { source: "flight", source_path: "gate", required: true },
    departure_time: { source: "flight", source_path: "departureTime", required: true },
  },
  gate_crew_started: {
    airline: { source: "flight", source_path: "airline" },
    flight_number: { source: "flight", source_path: "flightNumber" },
    destination: { source: "flight", source_path: "destCity" },
    gate: { source: "flight", source_path: "gate" },
    departure_time: { source: "flight", source_path: "departureTime" },
  },
  preflight_capt_basic_info: {
    airline: { source: "flight", source_path: "airline" },
    flight_number: { source: "flight", source_path: "flightNumber" },
    origin: { source: "flight", source_path: "originCity" },
    destination: { source: "flight", source_path: "destCity" },
    departure_time: { source: "flight", source_path: "departureTime" },
    aircraft: { source: "simbrief", source_path: "aircraft.name" },
    cruising_altitude: { source: "simbrief", source_path: "general.route_altitude" },
    duration: { source: "simbrief", source_path: "times.est_time_enroute" },
    pax_count: { source: "simbrief", source_path: "weights.pax_count" },
    altitude: { source: "telemetry", source_path: "altitude" },
    groundspeed: { source: "telemetry", source_path: "groundspeed" },
    vertical_speed: { source: "telemetry", source_path: "verticalSpeed" },
    heading: { source: "telemetry", source_path: "heading" },
  },
};

export class EventContextBuilder {
  private static readonly defCache = new Map<string, Record<string, VariableDefinition>>();

  static async build(
    eventKey: string,
    flightContext: FlightContext
  ): Promise<EventContext> {
    const variableDefs = await this.getVariableDefinitions(eventKey);

    if (!variableDefs || Object.keys(variableDefs).length === 0) {
      console.log(`[EventContextBuilder] No hay variables definidas para ${eventKey}`);
      return { eventKey, eventData: {} };
    }

    // [DEBUG] Datos de vuelo en el momento exacto de construir el contexto.
    console.log("[DEBUG] EventContextBuilder.build() - Datos de vuelo:", {
      eventKey,
      flightData: flightContext.getFlight(),
      fullContext: {
        flight: flightContext.getFlight(),
        telemetry: flightContext.getTelemetry(),
        simbrief: flightContext.getSimBriefData(),
      },
    });

    const variableResolver = new VariableResolver(flightContext);

    // Obtener el modo de ejecución (pruebas/normal) desde el contexto.
    const isTestMode = flightContext.getContext()?.isTestMode || false;

    const eventData = variableResolver.resolveVariables(variableDefs, flightContext, isTestMode, eventKey);

    console.log("[DEBUG] EventContextBuilder.build() - Variables resueltas:", {
      eventKey,
      resolvedVariables: eventData,
    });

    return {
      eventKey,
      eventData,
    };
  }

  // Obtiene las definiciones de variables desde prompts.variables (catálogo).
  // Si el catálogo no está publicado o falla la consulta, usa el fallback local.
  private static async getVariableDefinitions(
    eventKey: string
  ): Promise<Record<string, VariableDefinition> | null> {
    const cached = this.defCache.get(eventKey);
    if (cached) return cached;

    let defs: Record<string, VariableDefinition> | null = null;

    if (config.supabaseUrl && config.supabaseAnonKey) {
      try {
        const { data: eventData, error: eventError } = await supabase
          .from("events")
          .select("id")
          .eq("event_key", eventKey)
          .single();

        if (eventError) {
          console.warn(
            `[EventContextBuilder] No se pudo resolver el evento para ${eventKey}: ${eventError.message}`
          );
        } else if (eventData?.id) {
          const { data, error } = await supabase
            .from("prompts")
            .select("variables")
            .eq("event_id", eventData.id)
            .maybeSingle();

          if (error) {
            console.warn(
              `[EventContextBuilder] No se pudieron cargar variables para ${eventKey}: ${error.message}`
            );
          } else if (data?.variables && typeof data.variables === "object") {
            defs = data.variables as Record<string, VariableDefinition>;
          }
        }
      } catch (err) {
        console.warn(
          `[EventContextBuilder] Error consultando prompts para ${eventKey}:`,
          err
        );
      }
    }

    if (!defs || Object.keys(defs).length === 0) {
      defs = DEFAULT_VARIABLE_DEFINITIONS[eventKey] ?? null;
    }

    if (defs) {
      this.defCache.set(eventKey, defs);
    }
    return defs;
  }
}
