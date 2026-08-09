import { EventDefinition } from "../events/types";
import { FlightContext } from "../services/FlightContext";

export interface TriggerEvaluator {
  evaluate(event: EventDefinition, context: FlightContext): boolean;
}
