/**
 * Servicio para la tabla `flight_event_config`
 * (flight_id, event_key, value, source, scenario_key).
 *
 * Guarda la configuración específica de los anuncios de un vuelo POR ESCENARIO
 * como filas dinámicas. Convención: la DB guarda SIEMPRE en minúsculas
 * (`off` | `pack` | `ia`, restricción CHECK) y la UI trabaja en mayúsculas
 * (`OFF` | `PACK` | `IA`). La normalización ocurre en este servicio.
 *
 * Al cargar, se combina sobre los defaults del usuario (`user_event_defaults`):
 * la configuración del vuelo sobrescribe los defaults.
 */
import { supabase } from "../lib/supabase";
import { UserEventDefaultsService } from "./UserEventDefaultsService";
import { ServiceResult, ok, okVoid, fail } from "./ServiceResult";
import {
  NORMAL_SCENARIO_KEY,
  EventSwitchValue,
  isEventSwitchValue,
  isConfigurableEvent,
  toDbSwitchValue,
} from "./eventConfigConstants";

/** Origen de la configuración del vuelo. */
export type FlightEventConfigSource = "user" | "default" | "system";

interface FlightEventConfigRow {
  event_key: string;
  value: string;
}

export interface FlightEventConfigOptions {
  /** Escenario de la configuración (default: `standard_commercial_flight`). */
  scenarioKey?: string;
  /** Flavor de anuncios del vuelo (operative/cultural/scenic/casual). */
  flavor?: string;
  /** Sound pack activo del vuelo (ej. "aerolineas"). */
  packageLocation?: string;
  /** Origen de la configuración (default: "user"). */
  source?: FlightEventConfigSource;
}

export class FlightEventConfigService {
  /**
   * Carga las sobrescrituras de configuración de un vuelo para un escenario como
   * un mapa event_key -> value. Solo devuelve las claves con fila en la tabla.
   */
  static async loadForFlight(
    flightId: string,
    scenarioKey: string = NORMAL_SCENARIO_KEY
  ): Promise<ServiceResult<Record<string, string>>> {
    try {
      const { data, error } = await supabase
        .from("flight_event_config")
        .select("event_key, value")
        .eq("flight_id", flightId)
        .eq("scenario_key", scenarioKey);

      if (error) return fail(error.message);

      const map: Record<string, string> = {};
      for (const row of (data ?? []) as FlightEventConfigRow[]) {
        // La UI/runtime trabaja en mayúsculas; la DB guarda en minúsculas.
        map[row.event_key] = row.value.toUpperCase();
      }
      return ok(map);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Configuración de eventos combinada para un vuelo y escenario:
   * defaults del usuario + sobrescrituras del vuelo (el vuelo gana).
   */
  static async loadMergedForFlight(
    userId: string,
    flightId: string,
    scenarioKey: string = NORMAL_SCENARIO_KEY
  ): Promise<ServiceResult<Record<string, EventSwitchValue>>> {
    const [defaultsResult, flightResult] = await Promise.all([
      UserEventDefaultsService.loadEffectiveUserConfig(userId, scenarioKey),
      this.loadForFlight(flightId, scenarioKey),
    ]);

    if (!defaultsResult.success && !flightResult.success) {
      return fail(
        `${defaultsResult.error ?? "Error de defaults"} / ${flightResult.error ?? "Error de vuelo"}`
      );
    }

    const merged: Record<string, EventSwitchValue> = {};
    for (const [key, value] of Object.entries(defaultsResult.data ?? {})) {
      if (isEventSwitchValue(value)) merged[key] = value;
    }
    for (const [key, value] of Object.entries(flightResult.data ?? {})) {
      if (isEventSwitchValue(value)) merged[key] = value;
    }
    return ok(merged);
  }

  /**
   * Persiste la configuración de eventos de un vuelo (upsert por evento y escenario).
   *
   * IMPORTANTE: `flight_event_config.value` tiene una restricción CHECK que solo
   * permite `'off' | 'pack' | 'ia'`. Por eso:
   *  - Los switches se normalizan a minúsculas antes de enviarlos.
   *  - El flavor (operative/cultural/scenic/casual) y el sound pack
   *    ("aerolineas", ...) NO se persisten en esta tabla (violarían la CHECK);
   *    quedan como estado local de la pantalla de vuelo.
   */
  static async saveForFlight(
    flightId: string,
    config: Record<string, EventSwitchValue>,
    options: FlightEventConfigOptions = {}
  ): Promise<ServiceResult<void>> {
    const source: FlightEventConfigSource = options.source ?? "user";
    const scenarioKey = options.scenarioKey ?? NORMAL_SCENARIO_KEY;

    const rows: Array<{
      flight_id: string;
      event_key: string;
      value: string;
      source: FlightEventConfigSource;
      scenario_key: string;
    }> = [];

    for (const [key, value] of Object.entries(config)) {
      if (!isEventSwitchValue(value)) continue;
      // Las anclas de transición de fase no son configurables: nunca persistir.
      if (!isConfigurableEvent(key)) continue;
      // La DB guarda en minúsculas (off/pack/ia) — restricciones CHECK.
      const normalized = toDbSwitchValue(value);
      console.log("[FlightEventConfigService] Guardando switch:", {
        eventKey: key,
        scenarioKey,
        originalValue: value,
        normalizedValue: normalized,
      });
      rows.push({ flight_id: flightId, event_key: key, value: normalized, source, scenario_key: scenarioKey });
    }

    if (options.flavor != null) {
      console.warn(
        "[FlightEventConfigService] El flavor del vuelo no se persiste en flight_event_config " +
          "(la CHECK constraint solo permite off/pack/ia). Se mantiene localmente:",
        options.flavor
      );
    }
    if (options.packageLocation != null) {
      console.warn(
        "[FlightEventConfigService] El sound pack del vuelo no se persiste en flight_event_config " +
          "(la CHECK constraint solo permite off/pack/ia). Se mantiene localmente:",
        options.packageLocation
      );
    }

    if (rows.length === 0) return okVoid();

    try {
      const { error } = await supabase.from("flight_event_config").upsert(rows, {
        onConflict: "flight_id,event_key,scenario_key",
      });
      if (error) {
        console.error("[FlightEventConfigService] Error al guardar flight_event_config:", {
          error: error.message,
          rows: rows.map((row) => ({ eventKey: row.event_key, value: row.value })),
        });
        return fail(error.message);
      }
      return okVoid();
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}
