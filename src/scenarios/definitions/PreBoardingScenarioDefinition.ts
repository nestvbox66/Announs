import { NarrativeStep } from "../narrative/NarrativeStep";
import { NarrativeTransition } from "../narrative/NarrativeTransition";
import { ScenarioDefinition } from "./ScenarioDefinition";

export class PreBoardingScenarioDefinition implements ScenarioDefinition {
  readonly scenario = "preboarding";

  readonly steps = [
    new NarrativeStep(
      1,
      "gate_crew_start_soon",
      NarrativeTransition.AFTER_DELAY,
      false,
      false,
      60000
    ),
    new NarrativeStep(
      2,
      "gate_crew_started",
      NarrativeTransition.AFTER_COMPLETION,
      false,
      false
    ),
  ];
}