import { ScenarioLoader } from "./ScenarioLoader";
import { ScenarioDefinition } from "../scenarios/definitions/ScenarioDefinition";

export type ExecutionMode = "normal" | "test";

export const NORMAL_SCENARIO_KEY = "standard_commercial_flight";
export const TEST_SCENARIO_KEY = "test_scenario";

export class ScenarioResolver {
  private scenarioLoader: ScenarioLoader;

  constructor(scenarioLoader: ScenarioLoader) {
    this.scenarioLoader = scenarioLoader;
  }

  resolveScenarioKey(mode: ExecutionMode, scenarioKey?: string): string {
    switch (mode) {
      case "test":
        return TEST_SCENARIO_KEY;
      case "normal":
      default:
        return scenarioKey || NORMAL_SCENARIO_KEY;
    }
  }

  async resolveScenario(
    phase: string,
    mode: ExecutionMode,
    scenarioKey?: string,
    options?: { forceRefresh?: boolean }
  ): Promise<ScenarioDefinition | null> {
    const key = this.resolveScenarioKey(mode, scenarioKey);

    console.log(`[ScenarioResolver] Modo: ${mode}, Escenario: ${key}, Fase: ${phase}`);
    console.log(
      `[ScenarioResolver] Cargando escenario: ${key} (modo: ${mode}${options?.forceRefresh ? ", forceRefresh: true" : ""})`
    );

    return await this.scenarioLoader.loadPublishedScenario(
      phase,
      key,
      options?.forceRefresh
    );
  }
}
