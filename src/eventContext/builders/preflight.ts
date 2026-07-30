import { FlightContext } from "../../services/FlightContext";
import { EventContext } from "../types";

export function buildPreflightContext(_eventKey: string, _fc: FlightContext): EventContext {
  return { eventKey: _eventKey, eventData: {} };
}
