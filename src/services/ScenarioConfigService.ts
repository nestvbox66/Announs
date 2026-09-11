/**
 * Servicio de escenarios para la configuración de eventos.
 *
 * - Lista los escenarios activos (`scenarios`).
 * - Carga el snapshot publicado de un escenario (`scenario_versions.snapshot`)
 *   con los eventos agrupados por fase.
 *
 * Si la lectura directa de `scenario_versions` no es posible (p. ej. RLS), se
 * rearma el escenario consultando la edge function `scenarios-active` por fase.
 */
import { config } from "../config";
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import {
  NORMAL_SCENARIO_KEY,
  SCENARIO_DESIGNER_PHASES,
  scenarioPhaseLabel,
} from "./eventConfigConstants";

export interface ScenarioOption {
  id: string;
  key: string;
  name: string;
  description: string | null;
  defaultPhase: string | null;
}

export interface ScenarioEventConfig {
  eventKey: string;
  displayName: string;
  description: string | null;
  speakerRole: string | null;
}

export interface ScenarioPhaseConfig {
  key: string;
  name: string;
  events: ScenarioEventConfig[];
}

export interface ScenarioConfigSnapshot {
  scenarioKey: string;
  scenarioName: string;
  version: number;
  phases: ScenarioPhaseConfig[];
}

interface PublishedStepRaw {
  id?: string;
  order?: number;
  event_key: string;
  display_name?: string | null;
  speaker_role?: string | null;
}

interface PublishedPhaseRaw {
  key: string;
  name?: string | null;
  steps?: PublishedStepRaw[];
}

interface PublishedSnapshotRaw {
  scenario_key?: string;
  scenario_name?: string;
  version?: number;
  phases?: PublishedPhaseRaw[];
}

interface ScenarioVersionRow {
  id: string;
  scenario_id: string;
  version: number;
  status: string;
  snapshot: PublishedSnapshotRaw | null;
  published_at: string | null;
}

interface EdgeEventRow {
  event_key: string;
  display_name: string;
  description: string | null;
  speaker_role: string | null;
}

const EDGE_FUNCTION_TIMEOUT_MS = 5000;

export class ScenarioConfigService {
  /** Escenarios activos para el selector. */
  static async listActiveScenarios(): Promise<ServiceResult<ScenarioOption[]>> {
    try {
      const { data, error } = await supabase
        .from("scenarios")
        .select("id, key, name, description, default_phase, is_active")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) return fail(error.message);

      const options: ScenarioOption[] = (data ?? []).map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description ?? null,
        defaultPhase: row.default_phase ?? null,
      }));

      return ok(options);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** Escenario activo por key (o el primero activo si no se encuentra). */
  static async getScenarioByKey(scenarioKey: string): Promise<ServiceResult<ScenarioOption | null>> {
    try {
      const { data, error } = await supabase
        .from("scenarios")
        .select("id, key, name, description, default_phase, is_active")
        .eq("is_active", true)
        .eq("key", scenarioKey)
        .maybeSingle();

      if (error) return fail(error.message);
      if (!data) return ok(null);

      return ok({
        id: data.id,
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        defaultPhase: data.default_phase ?? null,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Escenario por defecto del usuario (`users.default_scenario_key`).
   * Si la columna no existe o no hay valor, devuelve `standard_commercial_flight`.
   */
  static async getUserDefaultScenario(userId: string): Promise<ServiceResult<string>> {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("default_scenario_key")
        .eq("id", userId)
        .maybeSingle();

      if (error || !data?.default_scenario_key) {
        return ok(NORMAL_SCENARIO_KEY);
      }
      return ok(data.default_scenario_key);
    } catch {
      return ok(NORMAL_SCENARIO_KEY);
    }
  }

  /**
   * Carga el snapshot publicado de un escenario. Primero intenta leer
   * `scenario_versions` directamente; si falla, rearma el escenario vía la
   * edge function `scenarios-active` por fase.
   */
  static async loadPublishedSnapshot(
    scenarioKey: string = NORMAL_SCENARIO_KEY
  ): Promise<ServiceResult<ScenarioConfigSnapshot>> {
    const direct = await this.loadFromVersions(scenarioKey);
    if (direct.success && direct.data && direct.data.phases.length > 0) {
      return direct;
    }

    return await this.loadFromEdgeFunction(scenarioKey);
  }

  // ── Carga directa desde scenario_versions.snapshot ──────────────────────

  private static async loadFromVersions(
    scenarioKey: string
  ): Promise<ServiceResult<ScenarioConfigSnapshot>> {
    try {
      const scenarioResult = await this.getScenarioByKey(scenarioKey);
      if (!scenarioResult.success || !scenarioResult.data) {
        return fail(scenarioResult.error ?? `El escenario '${scenarioKey}' no está activo.`);
      }

      const { data, error } = await supabase
        .from("scenario_versions")
        .select("id, scenario_id, version, status, snapshot, published_at")
        .eq("scenario_id", scenarioResult.data.id)
        .eq("status", "published")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return fail(error.message);
      if (!data?.snapshot) {
        return fail(`El escenario '${scenarioKey}' no tiene una versión publicada.`);
      }

      const version = data as unknown as ScenarioVersionRow;
      const snapshot = version.snapshot ?? { phases: [] };
      const phasesRaw = snapshot.phases ?? [];

      const phases: ScenarioPhaseConfig[] = phasesRaw.map((phase) => {
        const phaseName = phase.name || scenarioPhaseLabel(phase.key);
        const events = (phase.steps ?? []).map((step): ScenarioEventConfig => ({
          eventKey: step.event_key,
          displayName: step.display_name || step.event_key,
          description: null,
          speakerRole: step.speaker_role ?? null,
        }));
        return { key: phase.key, name: phaseName, events };
      });

      const snapshotData: ScenarioConfigSnapshot = {
        scenarioKey: snapshot.scenario_key || scenarioKey,
        scenarioName: snapshot.scenario_name || scenarioResult.data.name,
        version: version.version ?? snapshot.version ?? 0,
        phases,
      };

      return await this.enrichFromEventCatalog(snapshotData);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Fallback: edge function scenarios-active (una llamada por fase) ─────

  private static async loadFromEdgeFunction(
    scenarioKey: string
  ): Promise<ServiceResult<ScenarioConfigSnapshot>> {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return fail("Supabase no está configurado.");
    }

    try {
      const results = await Promise.all(
        SCENARIO_DESIGNER_PHASES.map((phase) =>
          this.fetchEdgePhase(scenarioKey, phase.key)
        )
      );

      const phases = results.filter(Boolean) as ScenarioPhaseConfig[];
      if (phases.length === 0) {
        return fail(`No se pudo cargar el escenario '${scenarioKey}'.`);
      }

      const scenario = await this.getScenarioByKey(scenarioKey);
      const snapshot: ScenarioConfigSnapshot = {
        scenarioKey,
        scenarioName: scenario.success && scenario.data ? scenario.data.name : scenarioKey,
        version: 0,
        phases,
      };

      return await this.enrichFromEventCatalog(snapshot);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  private static async fetchEdgePhase(
    scenarioKey: string,
    phaseKey: string
  ): Promise<ScenarioPhaseConfig | null> {
    try {
      const baseUrl = config.supabaseUrl.replace(/\/+$/, "");
      const url = new URL(`${baseUrl}/functions/v1/scenarios-active`);
      url.searchParams.append("phase", phaseKey);
      url.searchParams.append("scenario_key", scenarioKey);
      url.searchParams.append("include_metadata", "true");

      const requestInit: RequestInit = {
        headers: { Authorization: `Bearer ${config.supabaseAnonKey}` },
      };
      if (typeof AbortSignal.timeout === "function") {
        requestInit.signal = AbortSignal.timeout(EDGE_FUNCTION_TIMEOUT_MS);
      }

      const response = await fetch(url.toString(), requestInit);
      if (!response.ok) return null;

      const result = await response.json();
      if (!result?.success || !result?.data?.phase) return null;

      const phase = result.data.phase;
      const name = phase.name || scenarioPhaseLabel(phaseKey);

      const events: ScenarioEventConfig[] = (phase.steps ?? []).map((step: any) => ({
        eventKey: step.event?.key ?? step.event_key,
        displayName: step.event?.display_name || step.event?.key || step.event_key,
        description: null,
        speakerRole: step.event?.speaker_role ?? null,
      }));

      return { key: phaseKey, name, events };
    } catch {
      return null;
    }
  }

  /**
   * Umbrales de demora (ms) de la tabla `events.default_delay_ms` para los
   * eventos indicados. Fuente única de verdad del Backoffice: si el usuario
   * reparametriza (ej. preflight_capt_delay_taxi 15→5 min), acá se refleja.
   */
  static async loadDelayThresholds(
    keys: string[]
  ): Promise<Record<string, number>> {
    if (!config.supabaseUrl || !config.supabaseAnonKey) return {};
    if (keys.length === 0) return {};
    try {
      const { data, error } = await supabase
        .from("events")
        .select("event_key, default_delay_ms")
        .in("event_key", keys);

      if (error) {
        console.warn(
          `[ScenarioConfigService] loadDelayThresholds error: ${error.message}`
        );
        return {};
      }

      const map: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ event_key: string; default_delay_ms: unknown }>) {
        const ms = Number(row.default_delay_ms);
        if (row.default_delay_ms != null && !Number.isNaN(ms) && ms > 0) {
          map[row.event_key] = Math.round(ms);
        }
      }
      if (Object.keys(map).length > 0) {
        console.log("[ScenarioConfigService] loadDelayThresholds:", map);
      }
      return map;
    } catch (err) {
      console.warn("[ScenarioConfigService] loadDelayThresholds catch:", err);
      return {};
    }
  }

  // ── Enriquecimiento con el catálogo de eventos (display_name / description) ─

  /**
   * Completa título y descripción desde `events` (display_name / description).
   * Si `events` no tiene fila para una clave, conserva los valores del snapshot.
   */
  private static async enrichFromEventCatalog(
    snapshot: ScenarioConfigSnapshot
  ): Promise<ServiceResult<ScenarioConfigSnapshot>> {
    const eventKeys = Array.from(
      new Set(snapshot.phases.flatMap((phase) => phase.events.map((event) => event.eventKey)))
    );
    if (eventKeys.length === 0) return ok(snapshot);

    try {
      const { data, error } = await supabase
        .from("events")
        .select("event_key, display_name, description, speaker_role")
        .in("event_key", eventKeys);

      if (error || !data) return ok(snapshot);

      const byKey = new Map<string, EdgeEventRow>();
      for (const row of data as EdgeEventRow[]) {
        byKey.set(row.event_key, row);
      }

      const enriched: ScenarioConfigSnapshot = {
        ...snapshot,
        phases: snapshot.phases.map((phase) => ({
          ...phase,
          events: phase.events.map((event) => {
            const catalog = byKey.get(event.eventKey);
            if (!catalog) return event;
            return {
              ...event,
              displayName: catalog.display_name || event.displayName,
              description: catalog.description || event.description,
              speakerRole: catalog.speaker_role ?? event.speakerRole,
            };
          }),
        })),
      };

      return ok(enriched);
    } catch {
      return ok(snapshot);
    }
  }
}
