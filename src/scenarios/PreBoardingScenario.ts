import { FlightContext } from "../services/FlightContext";
import { FlightScenario } from "./FlightScenario";
import { ScenarioDefinition } from "./definitions/ScenarioDefinition";
import { PreBoardingScenarioDefinition } from "./definitions/PreBoardingScenarioDefinition";

export class PreBoardingScenario implements FlightScenario {
  readonly name = "PreBoardingScenario";
  readonly phases = ["GATE"];
  readonly definition: ScenarioDefinition = new PreBoardingScenarioDefinition();

  onEnter(_context: FlightContext): void {
    console.log("[SCENARIO]");
    console.log("Entering PreBoarding Scenario");
  }

  onExit(_context: FlightContext): void {
    console.log("[SCENARIO]");
    console.log("Leaving PreBoarding Scenario");
  }

  update(_context: FlightContext): void {
    // reserved for future use
  }
}