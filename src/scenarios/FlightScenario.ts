import { FlightContext } from "../services/FlightContext";
import { ScenarioDefinition } from "./definitions/ScenarioDefinition";

export interface FlightScenario {
  readonly name: string;

  /** Fases del vuelo cubiertas por este escenario, en el orden definido. */
  readonly phases: string[];

  readonly definition: ScenarioDefinition;

  onEnter(context: FlightContext): void;

  onExit(context: FlightContext): void;

  update(context: FlightContext): void;
}