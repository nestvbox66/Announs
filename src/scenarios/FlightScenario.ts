import { FlightContext } from "../services/FlightContext";
import { ScenarioDefinition } from "./definitions/ScenarioDefinition";

export interface FlightScenario {
  readonly name: string;

  readonly definition: ScenarioDefinition;

  onEnter(context: FlightContext): void;

  onExit(context: FlightContext): void;

  update(context: FlightContext): void;
}