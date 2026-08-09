import { EventDefinition } from "../events/types";
import { FlightContext } from "../services/FlightContext";
import { TriggerEvaluator } from "./TriggerEvaluator";

export class ConditionTriggerEvaluator implements TriggerEvaluator {
  evaluate(_event: EventDefinition, _context: FlightContext): boolean {
    return false;
  }
}
