import { FlightContext } from "./FlightContext";

export interface VariableDefinition {
  source: string; // "flight", "user", "context", "telemetry", "simbrief"
  source_path: string; // p.ej. "route", "PLANE_ALTITUDE", "customPilotName"
  required?: boolean;
  fallback?: string;
  description?: string;
}

type FallbackStrategy = "strict" | "permissive" | "simulated";

export class VariableResolver {
  private dataSources: Map<string, any> = new Map();

  constructor(flightContext: FlightContext) {
    this.buildDataSources(flightContext);
  }

  // Construye las fuentes de datos a partir de la instancia de FlightContext.
  // Se invoca de nuevo en cada `resolveVariables` para garantizar que se usen
  // los datos ACTUALES de la instancia recibida (evita referencias viejas).
  private buildDataSources(flightContext: FlightContext): void {
    this.dataSources = new Map([
      ["flight", flightContext.getFlight()],
      ["user", flightContext.getUserSettings()],
      ["context", flightContext.getContext()],
      ["telemetry", flightContext.getTelemetry()],
      ["simbrief", flightContext.getSimBriefData()],
    ]);
  }

  resolveVariables(
    variableDefs: Record<string, VariableDefinition>,
    flightContext: FlightContext,
    isTestMode: boolean = false,
    eventKey?: string
  ): Record<string, any> {
    // Reconstruir las fuentes con la instancia recibida en el momento exacto de
    // resolver (no en el constructor): así el resolver usa SIEMPRE los datos
    // actuales de ese FlightContext, no una referencia capturada antes.
    this.buildDataSources(flightContext);

    const result: Record<string, any> = {};
    const simulatedKeys: string[] = [];

    // [DEBUG] Instancia de FlightContext usada por el resolver.
    console.log("[DEBUG] VariableResolver - Instancia de FlightContext:", {
      eventKey,
      flightNumber: this.dataSources.get("flight")?.flightNumber,
      destCity: this.dataSources.get("flight")?.destCity,
      departureTime: this.dataSources.get("flight")?.departureTime,
      gate: this.dataSources.get("flight")?.gate,
      simbriefFlightNumber: this.dataSources.get("simbrief")?.general?.flight_number,
      isTestMode,
    });

    for (const [key, def] of Object.entries(variableDefs)) {
      const source = this.dataSources.get(def.source);
      const strategy = this.getFallbackStrategy(def.source);

      // 1. Intentar obtener el valor real
      let value = source ? this.getValueByPath(source, def.source_path) : undefined;
      let usedSimulated = false;
      let usedFallback: string | null = null;

      // 2. Si no hay valor, aplicar estrategia de fallback
      if (value === undefined || value === null) {
        switch (strategy) {
          case "strict":
            // Datos que SIEMPRE deberían existir
            value = def.fallback || `[${key} no disponible]`;
            usedFallback = "strict";
            break;

          case "simulated":
            // Datos que pueden no existir (telemetría en modo pruebas)
            if (isTestMode) {
              // En modo pruebas, generar valor simulado realista
              value = this.generateSimulatedValue(def.source, def.source_path);
              usedSimulated = true;
              usedFallback = "simulated";

              console.warn(
                `[VariableResolver] Valor simulado para ${key}: ` +
                  `"${value}" (fuente: ${def.source}.${def.source_path} no disponible en modo pruebas)`
              );
            } else if (def.fallback) {
              value = def.fallback;
              usedFallback = "fallback";
            } else if (def.required) {
              value = `[${key} no disponible]`;
              usedFallback = "required";
            }
            // Si es opcional y no hay fallback, se omite
            break;

          case "permissive":
            // Datos opcionales
            if (def.required && def.fallback) {
              value = def.fallback;
              usedFallback = "fallback";
            } else if (def.required) {
              value = `[${key} no disponible]`;
              usedFallback = "required";
            }
            // Si es opcional, se omite (value queda undefined)
            break;
        }
      }

      // [DEBUG] De dónde sale el valor de cada variable.
      console.log("[DEBUG] VariableResolver - Resolución de variable:", {
        eventKey,
        key,
        source: def.source,
        sourcePath: def.source_path,
        rawValue: value,
        fallback: usedFallback,
        simulated: usedSimulated,
      });

      // Log específico para special_event (requerido por capitán evento especial)
      if (key === "special_event") {
        console.log("[VariableResolver] Resolviendo special_event:", {
          specialEvent: this.dataSources.get("flight")?.specialEvent,
          sourcePath: def.source_path,
          value: value,
        });
      }

      // 3. Añadir al resultado si hay valor
      if (value !== undefined && value !== null) {
        result[key] = value;

        if (usedSimulated) {
          simulatedKeys.push(key);
          console.debug(`[VariableResolver] "${key}" = "${value}" (simulado)`);
        }
      }
    }

    console.log("[VariableResolver] Resolviendo variables:", {
      isTestMode,
      variableDefs,
      resolved: result,
      simulated: simulatedKeys,
    });

    return result;
  }

  private getFallbackStrategy(source: string): FallbackStrategy {
    switch (source) {
      case "simbrief":
        return "strict"; // SimBrief siempre debe tener datos
      case "telemetry":
        return "simulated"; // Puede no tener datos → usar simulados (en modo pruebas)
      case "user":
        return "permissive"; // Datos opcionales
      case "context":
        return "strict"; // Contexto siempre disponible
      case "flight":
        return "strict"; // Datos de vuelo siempre disponibles
      default:
        return "permissive";
    }
  }

  private generateSimulatedValue(source: string, sourcePath: string): any {
    // Valores simulados para telemetría en modo pruebas (SimConnect / MSFS)
    const simulatedTelemetry: Record<string, any> = {
      PLANE_ALTITUDE: 35000,
      INDICATED_ALTITUDE: 32000,
      GROUND_VELOCITY: 450,
      AIRSPEED_INDICATED: 280,
      AIRSPEED_TRUE: 480,
      VERTICAL_SPEED: 0,
      PLANE_HEADING_DEGREES_GYRO: 180,
      PLANE_LATITUDE: -34.8222,
      PLANE_LONGITUDE: -58.5358,
      PLANE_PITCH_DEGREES: 2.5,
      PLANE_BANK_DEGREES: 0,
      SIMULATION_FLIGHT_PHASE: "CRUISE",
      IS_SLEW_ACTIVE: false,
      GENERAL_ENG_COMBUSTION: true,
      ZULU_TIME: 43200,
      LOCAL_TIME: 36000,
      SIMULATION_RATE: 1.0,

      // Variables X-Plane (sim/)
      "sim/flightmodel/position/elevation": 35000,
      "sim/cockpit2/gauges/indicators/altitude_ft_pilot": 32000,
      "sim/flightmodel/position/groundspeed": 450,
      "sim/cockpit2/gauges/indicators/airspeed_kts_pilot": 280,
      "sim/cockpit2/gauges/indicators/true_airspeed_kts_pilot": 480,
      "sim/cockpit2/gauges/indicators/vvi_fpm_pilot": 0,
      "sim/cockpit2/gauges/indicators/heading_AHARS_deg_pilot": 180,
      "sim/flightmodel/position/latitude": -34.8222,
      "sim/flightmodel/position/longitude": -58.5358,
      "sim/flightmodel/position/pitch": 2.5,
      "sim/flightmodel/position/roll": 0,
      "sim/flightmodel/engine/ENGN_running": true,
      "sim/time/zulu_time_sec": 43200,
      "sim/time/local_time_sec": 36000,
    };

    // Aliases amigables para source_paths en formato "telemetry.altitude"
    const aliases: Record<string, Record<string, any>> = {
      telemetry: {
        altitude: 35000,
        indicated_altitude: 32000,
        ground_speed: 450,
        groundspeed: 450,
        indicated_airspeed: 280,
        true_airspeed: 480,
        vertical_speed: 0,
        verticalSpeed: 0,
        heading: 180,
        latitude: -34.8222,
        longitude: -58.5358,
        pitch: 2.5,
        bank: 0,
        roll: 0,
        flight_phase: "CRUISE",
        flightPhase: "CRUISE",
        is_slew_active: false,
        isSlewActive: false,
        is_engine_running: true,
        isEngineRunning: true,
        zulu_time: 43200,
        zuluTime: 43200,
        local_time: 36000,
        localTime: 36000,
        sim_rate: 1.0,
        simRate: 1.0,
      },
    };

    // 1. Buscar en aliases por source
    if (aliases[source] && aliases[source][sourcePath] !== undefined) {
      return aliases[source][sourcePath];
    }

    // 2. Buscar en simulatedTelemetry por sourcePath exacto
    if (simulatedTelemetry[sourcePath] !== undefined) {
      return simulatedTelemetry[sourcePath];
    }

    // 3. Fallback: devolver string descriptivo
    return `[${source}.${sourcePath} simulado]`;
  }

  private getValueByPath(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }
}
