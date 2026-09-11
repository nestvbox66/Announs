import { NarrativeStep } from "../narrative/NarrativeStep";

export interface ScenarioDefinition {
  readonly scenario: string;
  readonly steps: readonly NarrativeStep[];
  /** Fases del vuelo cubiertas por este escenario, en el orden definido. */
  readonly phases?: readonly string[];
}
