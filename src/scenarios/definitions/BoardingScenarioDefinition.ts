import { NarrativeStep } from "../narrative/NarrativeStep";
import { NarrativeTransition } from "../narrative/NarrativeTransition";
import { ScenarioDefinition } from "./ScenarioDefinition";

export class BoardingScenarioDefinition implements ScenarioDefinition {
  readonly scenario = "boarding";

  readonly steps = [
    new NarrativeStep(
      1,
      "preflight_crew_welcome",
      NarrativeTransition.AFTER_COMPLETION,
      true,
      false
    ),
    new NarrativeStep(
      2,
      "preflight_crew_basic_info",
      NarrativeTransition.AFTER_COMPLETION,
      true,
      false
    ),
    new NarrativeStep(
      3,
      "preflight_capt_welcome",
      NarrativeTransition.AFTER_COMPLETION,
      true,
      false
    ),
    new NarrativeStep(
      4,
      "preflight_capt_basic_info",
      NarrativeTransition.AFTER_COMPLETION,
      true,
      false
    ),
  ];
}
