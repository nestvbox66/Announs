import { NarrativeStep } from "../narrative/NarrativeStep";

export interface ScenarioDefinition {
  readonly scenario: string;
  readonly steps: readonly NarrativeStep[];
}
