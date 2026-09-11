/**
 * Servicio para la tabla `user_event_defaults` (user_id, event_key, value, scenario_key).
 *
 * Guarda la configuración por defecto de los anuncios del usuario POR ESCENARIO
 * como filas dinámicas. Convención: la DB guarda SIEMPRE en minúsculas
 * (`off` | `pack` | `ia`, restricción CHECK) y la UI trabaja en mayúsculas
 * (`OFF` | `PACK` | `IA`). La normalización ocurre en este servicio.
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, okVoid, fail } from "./ServiceResult";
import {
  EVENT_CONFIG_KEYS,
  NORMAL_SCENARIO_KEY,
  EventSwitchValue,
  isEventSwitchValue,
  toDbSwitchValue,
} from "./eventConfigConstants";

interface UserEventDefaultRow {
  event_key: string;
  value: string;
}

export interface UserEventDefaultsOptions {
  /** Escenario de la configuración (default: `standard_commercial_flight`). */
  scenarioKey?: string;
  /** Flavor de anuncios (operative/cultural/scenic/casual). */
  flavor?: string;
}

export class UserEventDefaultsService {
  /**
   * Carga las filas de configuración del usuario para un escenario como un mapa
   * event_key -> value. Solo devuelve las claves con fila en la tabla (sin
   * rellenar las ausentes), para que la UI pueda preservar sus valores por
   * defecto locales.
   */
  static async loadForUser(
    userId: string,
    scenarioKey: string = NORMAL_SCENARIO_KEY
  ): Promise<ServiceResult<Record<string, string>>> {
    try {
      const { data, error } = await supabase
        .from("user_event_defaults")
        .select("event_key, value")
        .eq("user_id", userId)
        .eq("scenario_key", scenarioKey);

      if (error) return fail(error.message);

      const map: Record<string, string> = {};
      for (const row of (data ?? []) as UserEventDefaultRow[]) {
        // La UI/runtime trabaja en mayúsculas; la DB guarda en minúsculas.
        map[row.event_key] = row.value.toUpperCase();
      }
      return ok(map);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Valores por defecto del catálogo (`events.enabled_switch`).
   * Se usa como respaldo cuando falla la carga de configuración.
   */
  static async loadCatalogDefaults(): Promise<Record<string, string>> {
    try {
      const { data, error } = await supabase
        .from("events")
        .select("event_key, enabled_switch");

      if (error) return {};

      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.enabled_switch != null) {
          map[row.event_key] = String(row.enabled_switch).toUpperCase();
        }
      }
      return map;
    } catch {
      return {};
    }
  }

  /**
   * Configuración efectiva del usuario por escenario.
   *
   * Precedencia: defaults del catálogo (`events.enabled_switch`) como base,
   * sobrescritos por las filas guardadas del usuario (`user_event_defaults`).
   * Si la carga falla, quedan los defaults del catálogo o `'IA'`.
   *
   * Devuelve un mapa completo (todas las claves de switches + filas especiales
   * como `announcement_flavor`). Los componentes deben filtrar con
   * `isEventSwitchValue` para la configuración de switches y leer por separado
   * el flavor.
   */
  static async loadEffectiveUserConfig(
    userId: string,
    scenarioKey: string = NORMAL_SCENARIO_KEY
  ): Promise<ServiceResult<Record<string, string>>> {
    const [userResult, catalog] = await Promise.all([
      this.loadForUser(userId, scenarioKey),
      this.loadCatalogDefaults(),
    ]);

    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(catalog)) {
      map[key] = value;
    }
    for (const key of EVENT_CONFIG_KEYS) {
      if (!(key in map)) map[key] = "IA";
    }

    if (userResult.success) {
      for (const [key, value] of Object.entries(userResult.data ?? {})) {
        map[key] = value;
      }
    }

    return ok(map);
  }

  /**
   * Persiste la configuración de eventos del usuario (upsert por evento y escenario).
   *
   * IMPORTANTE: `user_event_defaults.value` tiene una restricción CHECK que solo
   * permite `'off' | 'pack' | 'ia'`. Por eso:
   *  - Los switches se normalizan a minúsculas antes de enviarlos.
   *  - El flavor de anuncios (operative/cultural/scenic/casual) NO se persiste en
   *    esta tabla (violaría la CHECK); queda como estado local (localStorage).
   */
  static async saveForUser(
    userId: string,
    config: Record<string, EventSwitchValue>,
    options: UserEventDefaultsOptions = {}
  ): Promise<ServiceResult<void>> {
    const scenarioKey = options.scenarioKey ?? NORMAL_SCENARIO_KEY;
    const rows: Array<{
      user_id: string;
      event_key: string;
      value: string;
      scenario_key: string;
    }> = [];

    for (const [key, value] of Object.entries(config)) {
      if (!isEventSwitchValue(value)) continue;
      // La DB guarda en minúsculas (off/pack/ia) — restricciones CHECK.
      const normalized = toDbSwitchValue(value);
      console.log("[UserEventDefaultsService] Guardando switch:", {
        eventKey: key,
        scenarioKey,
        originalValue: value,
        normalizedValue: normalized,
      });
      rows.push({ user_id: userId, event_key: key, value: normalized, scenario_key: scenarioKey });
    }

    if (options.flavor != null) {
      console.warn(
        "[UserEventDefaultsService] El flavor de anuncios no se persiste en user_event_defaults " +
          "(la CHECK constraint solo permite off/pack/ia). Se mantiene localmente:",
        options.flavor
      );
    }

    if (rows.length === 0) return okVoid();

    try {
      const { error } = await supabase.from("user_event_defaults").upsert(rows, {
        onConflict: "user_id,event_key,scenario_key",
      });
      if (error) {
        console.error("[UserEventDefaultsService] Error al guardar user_event_defaults:", {
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
