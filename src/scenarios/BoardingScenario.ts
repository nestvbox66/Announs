import { FlightContext } from "../services/FlightContext";
import { FlightScenario } from "./FlightScenario";
import { ScenarioDefinition } from "./definitions/ScenarioDefinition";
import { BoardingScenarioDefinition } from "./definitions/BoardingScenarioDefinition";

export class BoardingScenario implements FlightScenario {
  readonly name = "BoardingScenario";
  readonly phases = ["BOARDING"];
  readonly definition: ScenarioDefinition = new BoardingScenarioDefinition();

  onEnter(_context: FlightContext): void {
    console.log("[SCENARIO]");
    console.log("Entering Boarding Scenario");
  }

  onExit(_context: FlightContext): void {
    console.log("[SCENARIO]");
    console.log("Leaving Boarding Scenario");
  }

  update(_context: FlightContext): void {
    // reserved for future use
  }
}