import { FlightPhase } from "../engine/FlightEngine";
import { FlightScenario } from "./FlightScenario";
import { BoardingScenario } from "./BoardingScenario";
import { PreBoardingScenario } from "./PreBoardingScenario";
import { ScenarioLoader } from "../services/ScenarioLoader";
import { ScenarioDefinition } from "./definitions/ScenarioDefinition";
import { NarrativeStep } from "./narrative/NarrativeStep";
import { FlightContext } from "../services/FlightContext";
import { TEST_SCENARIO_KEY } from "../services/ScenarioResolver";

interface ScenarioSource {
  edgePhaseKey: string;
  fallback: () => FlightScenario | null;
}

const PHASE_SOURCES: Partial<Record<FlightPhase, ScenarioSource>> = {
  [FlightPhase.GATE]: {
    edgePhaseKey: "GATE",
    fallback: () => new PreBoardingScenario(),
  },
  [FlightPhase.BOARDING]: {
    edgePhaseKey: "BOARDING",
    fallback: () => new BoardingScenario(),
  },
  // Aliases internos del Desktop → clave canónica del Backoffice. El Edge
  // Function `scenarios-active` solo acepta claves canónicas (p. ej.
  // TAXI_TO_GATE, AT_GATE): sin esto pedía `phase=TAXI_IN` → HTTP 400
  // INVALID_PHASE, la fase quedaba con 0 pasos y el fallback la saltaba a
  // AT_GATE en 5s (incidente 2026-09-20: TAXI_TO_GATE mudo). No tienen
  // fallback hardcodeado: si no hay publicación, devuelven null como el resto.
  [FlightPhase.TAXI_IN]: {
    edgePhaseKey: "TAXI_TO_GATE",
    fallback: () => null,
  },
  [FlightPhase.FLIGHT_COMPLETED]: {
    edgePhaseKey: "AT_GATE",
    fallback: () => null,
  },
};

const NAME_SOURCES: Record<string, ScenarioSource> = {
  preboarding: {
    edgePhaseKey: "GATE",
    fallback: () => new PreBoardingScenario(),
  },
  boarding: {
    edgePhaseKey: "BOARDING",
    fallback: () => new BoardingScenario(),
  },
};

export class ScenarioFactory {
  private static loader: ScenarioLoader = new ScenarioLoader();

  static setLoader(loader: ScenarioLoader): void {
    this.loader = loader;
  }

  static clearCache(): void {
    this.loader.clearCache();
    console.log("[ScenarioFactory] Caché de escenarios limpiada.");
  }

  static async getForPhase(
    phase: FlightPhase,
    scenarioKey?: string,
    forceRefresh = false
  ): Promise<FlightScenario | null> {
    const source = PHASE_SOURCES[phase];
    // Cualquier fase (PRE_FLIGHT, TAXI, CRUISE, ...) intenta cargar su
    // escenario publicado desde el Backoffice. Solo GATE y BOARDING tienen
    // fallback hardcodeado; el resto devuelve null si no hay publicación.
    const edgePhaseKey = source?.edgePhaseKey ?? phase;

    const definition = await this.loader.loadPublishedScenario(
      edgePhaseKey,
      scenarioKey,
      forceRefresh
    );
    if (definition) {
      return ScenarioFactory.fromDefinition(definition);
    }

    if (!source?.fallback) {
      console.log(
        `[ScenarioFactory] Sin escenario publicado para fase: ${phase} (sin fallback)`
      );
      return null;
    }

    console.log(
      `[ScenarioFactory] Fallback a escenario hardcodeado para fase: ${phase} (razón: no hay escenario publicado)`
    );

    const fallback = source.fallback();
    if (!fallback) return null;

    if (scenarioKey === TEST_SCENARIO_KEY) {
      console.log(
        "[ScenarioFactory] Modo pruebas: marcando pasos del escenario de respaldo como manuales"
      );
      return ScenarioFactory.fromDefinition(
        ScenarioFactory.toManualDefinition(fallback.definition)
      );
    }

    return fallback;
  }

  static async getByName(
    name: string,
    scenarioKey: string = name,
    forceRefresh = false
  ): Promise<FlightScenario | null> {
    const source = NAME_SOURCES[name];
    if (!source) return null;

    const definition = await this.loader.loadPublishedScenario(
      source.edgePhaseKey,
      scenarioKey,
      forceRefresh
    );
    if (definition) {
      return ScenarioFactory.fromDefinition(definition);
    }

    console.log(
      `[ScenarioLoader] Fallback a escenario hardcodeado para: ${name} (razón: no hay escenario publicado)`
    );

    const fallback = source.fallback();
    if (!fallback) return null;

    if (scenarioKey === TEST_SCENARIO_KEY) {
      console.log(
        "[ScenarioFactory] Modo pruebas: marcando pasos del escenario de respaldo como manuales"
      );
      return ScenarioFactory.fromDefinition(
        ScenarioFactory.toManualDefinition(fallback.definition)
      );
    }

    return fallback;
  }

  private static fromDefinition(definition: ScenarioDefinition): FlightScenario {
    return {
      name: definition.scenario,
      phases: definition.phases ? Array.from(definition.phases) : [],
      definition,
      onEnter(_context: FlightContext): void {},
      onExit(_context: FlightContext): void {},
      update(_context: FlightContext): void {},
    };
  }

  // Convierte una definición en una versión "modo pruebas": todos los pasos
  // esperan la acción manual del usuario.
  private static toManualDefinition(
    definition: ScenarioDefinition
  ): ScenarioDefinition {
    return {
      scenario: definition.scenario,
      steps: definition.steps.map(
        (step) =>
          new NarrativeStep(
            step.id,
            step.eventKey,
            step.transition,
            step.blocking,
            step.optional,
            step.delayMs,
            step.conditions,
            step.parameters,
            step.preconditions,
            step.restrictions,
            ["desktop", "user"],
            "manual",
            "user",
            step.scheduler_rule
          )
      ),
    };
  }
}
