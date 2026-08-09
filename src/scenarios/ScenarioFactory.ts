import { FlightPhase } from "../engine/FlightEngine";
import { FlightScenario } from "./FlightScenario";
import { BoardingScenario } from "./BoardingScenario";
import { PreBoardingScenario } from "./PreBoardingScenario";

export class ScenarioFactory {
  static getForPhase(phase: FlightPhase): FlightScenario | null {
    switch (phase) {
      case FlightPhase.BOARDING:
        return new PreBoardingScenario();
      default:
        return null;
    }
  }

  static getByName(name: string): FlightScenario | null {
    switch (name) {
      case "preboarding":
        return new PreBoardingScenario();
      case "boarding":
        return new BoardingScenario();
      default:
        return null;
    }
  }
}
