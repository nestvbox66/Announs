import { EventDefinition } from "../../events/types";
import { FlightContext } from "../../services/FlightContext";

export interface EventHandler {
  handle(event: EventDefinition, context: FlightContext): Promise<void>;
}
