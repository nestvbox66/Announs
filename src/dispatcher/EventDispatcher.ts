import { EventDefinition } from "../events/types";
import { FlightContext } from "../services/FlightContext";

export interface EventDispatcher {
  dispatch(event: EventDefinition, context: FlightContext): Promise<void>;
}
