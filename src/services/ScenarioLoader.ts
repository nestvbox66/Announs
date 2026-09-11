import { config } from "../config";
import { ScenarioDefinition } from "../scenarios/definitions/ScenarioDefinition";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { NarrativeTransition } from "../scenarios/narrative/NarrativeTransition";

interface PublishedScenarioStep {
  step_id: string;
  order: number;
  event: {
    key: string;
    display_name: string;
    speaker_role: string;
    is_pre_recorded: boolean;
  };
  transition: string;
  blocking: boolean;
  optional: boolean;
  delay_ms: number;
  enabled: boolean;
  conditions: any | null;
  parameters: any | null;
  preconditions?: any | null;
  restrictions?: any | null;
  producers?: string[];
  detection_strategy?: string;
  decision_maker?: string;
  scheduler_rule?: string | null;
}

interface PublishedScenarioData {
  scenario: {
    key: string;
    name: string;
    description: string | null;
    version: number;
    published_at: string | null;
  };
  phase: {
    key: string;
    name: string;
    steps: PublishedScenarioStep[];
  };
  metadata?: {
    events?: Record<string, any>;
  };
}

interface PublishedScenarioResponse {
  success: boolean;
  data?: PublishedScenarioData;
  error?: {
    code: string;
    message: string;
  };
}

interface CacheEntry {
  data: ScenarioDefinition;
  timestamp: number;
  version: number;
}

export class ScenarioLoader {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 60000;
  private readonly TIMEOUT_MS = 5000;

  async loadPublishedScenario(
    phase: string,
    scenarioKey?: string,
    forceRefresh = false
  ): Promise<ScenarioDefinition | null> {
    const cacheKey = `${phase}:${scenarioKey ?? "default"}`;

    console.log("[ScenarioLoader] 📋 Cargando escenario:", {
      phase,
      scenarioKey: scenarioKey ?? "default",
      forceRefresh,
      cachedVersion: this.cache.get(cacheKey)?.version ?? null,
      cachedTimestamp: this.cache.get(cacheKey)?.timestamp ?? null,
    });

    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log(`[ScenarioLoader] Usando escenario cacheado para fase: ${phase}`);
        return cached.data;
      }
    } else {
      console.log(
        `[ScenarioLoader] forceRefresh solicitado para fase: ${phase} (ignorando caché)`
      );
    }

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn(
        `[ScenarioLoader] Supabase no configurado; no se puede cargar escenario para fase: ${phase}`
      );
      return null;
    }

    console.log(
      `[ScenarioLoader] Cargando escenario: ${scenarioKey ?? "default"} (fase: ${phase}, forceRefresh: ${forceRefresh})`
    );

    console.log("[ScenarioLoader] 🔍 Construyendo URL para fase:", phase);

    try {
      const baseUrl = config.supabaseUrl.replace(/\/+$/, "");
      const url = new URL(`${baseUrl}/functions/v1/scenarios-active`);
      url.searchParams.append("phase", phase);
      url.searchParams.append("include_metadata", "true");
      if (scenarioKey) {
        url.searchParams.append("scenario_key", scenarioKey);
      }

      console.log("[ScenarioLoader] 📝 URL completa:", url.toString());
      console.log("[ScenarioLoader] 📝 Headers:", {
        Authorization: `Bearer ${config.supabaseAnonKey?.substring(0, 10)}...`,
      });
      console.log("[ScenarioLoader] 📝 Parámetros:", {
        phase,
        scenarioKey: scenarioKey ?? null,
        includeMetadata: true,
      });

      const requestInit: RequestInit = {
        headers: {
          Authorization: `Bearer ${config.supabaseAnonKey}`,
        },
      };

      if (typeof AbortSignal.timeout === "function") {
        requestInit.signal = AbortSignal.timeout(this.TIMEOUT_MS);
      }

      const response = await fetch(url.toString(), requestInit);

      console.log("[ScenarioLoader] 📥 Respuesta status:", response.status);
      console.log("[ScenarioLoader] 📥 Respuesta statusText:", response.statusText);

      if (response.status === 404) {
        console.log(`[ScenarioLoader] No hay escenario publicado para fase: ${phase} (HTTP 404)`);
        return null;
      }

      if (!response.ok) {
        let errorBody: string | null = null;
        try {
          errorBody = await response.text();
        } catch {
          errorBody = null;
        }
        console.log(
          "[ScenarioLoader] 📥 Error body:",
          errorBody ?? "(no se pudo leer el body de la respuesta)"
        );
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as PublishedScenarioResponse;

      if (!result.success) {
        console.warn(
          `[ScenarioLoader] Error en Edge Function: ${result.error?.code ?? "UNKNOWN"} - ${
            result.error?.message ?? "sin mensaje"
          }`
        );
        return null;
      }

      if (!result.data || !result.data.phase) {
        return null;
      }

      const definition = this.adaptToScenarioDefinition(result.data);
      const version = result.data.scenario.version ?? 0;

      const existing = this.cache.get(cacheKey);
      if (existing && existing.version !== version) {
        console.log(
          `[ScenarioLoader] Versión actualizada del escenario: ${existing.version} -> ${version} (fase: ${phase})`
        );
      }

      this.cache.set(cacheKey, {
        data: definition,
        timestamp: Date.now(),
        version,
      });

      console.log("[ScenarioLoader] 📊 Escenario cargado:", {
        scenarioKey: result.data.scenario.key,
        version,
        phases: result.data.phase.key,
        steps: result.data.phase.steps.map((s) => s.event.key),
      });
      console.log(
        `[ScenarioLoader] Escenario cargado exitosamente: ${result.data.scenario.key} (versión ${version}, ${definition.steps.length} pasos en ${phase})`
      );

      return definition;
    } catch (error) {
      console.error(
        `[ScenarioLoader] Error cargando escenario para fase ${phase}:`,
        error
      );
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resuelve las preconditions de un paso aunque el Edge Function las devuelva
   * en una ubicación alternativa (causa raíz del "type:none" en el monitor):
   * 1) step.preconditions (contrato actual),
   * 2) step.conditions.preconditions (anidado),
   * 3) step.conditions cuando ES el objeto phase_transition (columna equivocada),
   * 4) metadata.events[eventKey].preconditions (snapshot por evento).
   */
  /** eventKey en forma normalizada (event.key) o plana del snapshot (event_key). */
  private resolveEventKey(step: any): string {
    return step?.event?.key ?? step?.event_key ?? step?.eventKey ?? "";
  }

  private resolvePreconditions(step: any, metadataEvents?: Record<string, any>): any | undefined {
    if (step.preconditions !== undefined && step.preconditions !== null) return step.preconditions;
    const cond: any = step.conditions;
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if (cond.preconditions !== undefined && cond.preconditions !== null) return cond.preconditions;
      // El JSON phase_transition se guardó en la columna conditions en vez de preconditions
      if (cond.type === "phase_transition") return cond;
    }
    const fromMeta = metadataEvents?.[this.resolveEventKey(step)]?.preconditions;
    if (fromMeta !== undefined && fromMeta !== null) return fromMeta;
    return undefined;
  }

  private resolveSchedulerRule(step: any, metadataEvents?: Record<string, any>): string | null {
    const direct = (step as any).scheduler_rule ?? (step as any).schedulerRule;
    if (typeof direct === "string" && direct.trim() !== "") return direct;
    if (direct !== undefined && direct !== null) return direct;
    const fromMeta = metadataEvents?.[this.resolveEventKey(step)]?.scheduler_rule ?? metadataEvents?.[this.resolveEventKey(step)]?.schedulerRule;
    if (typeof fromMeta === "string" && fromMeta.trim() !== "") return fromMeta;
    return null;
  }

  private adaptToScenarioDefinition(data: PublishedScenarioData): ScenarioDefinition {
    const isTestScenario = data.scenario.key === "test_scenario";
    const steps = data.phase.steps.map((step: any, index) => {
      // Forma normalizada del Edge (event.key/order) o plana del snapshot (event_key/step_id)
      const eventKey: string = this.resolveEventKey(step);
      const order: number = step?.order ?? (typeof step?.id === "number" ? step.id : undefined) ?? index + 1;
      if (eventKey === "transition_to_taxi") {
        console.log('[ScenarioLoader] 📦 transition_to_taxi recibido:', {
          raw: step,
          preconditions: step?.preconditions ?? null,
          scheduler_rule: step?.scheduler_rule ?? step?.schedulerRule ?? null,
          transition: step?.transition ?? null,
          optional: step?.optional ?? null,
          enabled: step?.enabled ?? null,
        });
      }
      const preconditions = this.resolvePreconditions(step, data.metadata?.events);
      const schedulerRule = this.resolveSchedulerRule(step, data.metadata?.events);
      if (eventKey === "transition_to_taxi") {
        console.log('[ScenarioLoader] 📦 Paso transition_to_taxi cargado:', {
          hasSchedulerRule: !!schedulerRule,
          hasPreconditions: !!preconditions,
          schedulerRule,
          preconditions,
        });
      }
      const adaptedStep = new NarrativeStep(
        order,
        eventKey,
        this.parseTransition(step?.transition),
        step?.blocking,
        step?.optional,
        step?.delay_ms ?? step?.delayMs ?? 0,
        step?.conditions ?? undefined,
        step?.parameters ?? undefined,
        preconditions,
        step?.restrictions ?? undefined,
        step?.producers && step.producers.length > 0
          ? step.producers
          : isTestScenario
            ? ["desktop", "user"]
            : ["scheduler"],
        step?.detection_strategy ?? step?.detectionStrategy ?? (isTestScenario ? "manual" : "polling"),
        step?.decision_maker ?? step?.decisionMaker ?? (isTestScenario ? "user" : "scheduler"),
        schedulerRule
      );

      console.log("[ScenarioLoader] Paso cargado:", {
        eventKey: adaptedStep.eventKey,
        decision_maker: adaptedStep.decision_maker,
        detection_strategy: adaptedStep.detection_strategy,
        producers: adaptedStep.producers,
      });

      if (adaptedStep.eventKey === "transition_to_taxi") {
        console.log('[ScenarioLoader] 📦 Paso adaptado:', {
          eventKey: adaptedStep.eventKey,
          transition: adaptedStep.transition,
          transitionName: NarrativeTransition[adaptedStep.transition],
          preconditions: adaptedStep.preconditions ?? null,
          schedulerRule: adaptedStep.scheduler_rule ?? null,
          rawStep: {
            preconditions: (step as any).preconditions ?? null,
            conditions: (step as any).conditions ?? null,
            scheduler_rule: (step as any).scheduler_rule ?? (step as any).schedulerRule ?? null,
            transition: (step as any).transition ?? null,
            metadataPreconditions: data.metadata?.events?.["transition_to_taxi"]?.preconditions ?? null,
            metadataSchedulerRule: data.metadata?.events?.["transition_to_taxi"]?.scheduler_rule ?? null,
          },
        });
      }

      return adaptedStep;
    });

    return {
      scenario: data.scenario.key,
      steps,
      phases: data.phase?.key ? [data.phase.key] : [],
    };
  }

  private parseTransition(value: string): NarrativeTransition {
    switch (String(value ?? "").toUpperCase()) {
      case "IMMEDIATE":
        return NarrativeTransition.IMMEDIATE;
      case "AFTER_DELAY":
        return NarrativeTransition.AFTER_DELAY;
      case "WAIT_CONDITION":
        return NarrativeTransition.WAIT_CONDITION;
      case "AFTER_COMPLETION":
      default:
        if (value && String(value).toUpperCase() !== "AFTER_COMPLETION") {
          console.warn(`[ScenarioLoader] transition desconocida "${value}"; usando AFTER_COMPLETION`);
        }
        return NarrativeTransition.AFTER_COMPLETION;
    }
  }
}
