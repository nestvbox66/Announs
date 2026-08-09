import { EventDefinition } from "../events/types";
import { FlightContext } from "../services/FlightContext";
import { TriggerEvaluator } from "./TriggerEvaluator";

export class ManualTriggerEvaluator implements TriggerEvaluator {
  evaluate(event: EventDefinition, _context: FlightContext): boolean {
    return event.triggerType === "manual";
  }
}
