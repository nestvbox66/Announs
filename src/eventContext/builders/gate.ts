import { FlightContext } from "../../services/FlightContext";
import { EventContext } from "../types";

export function buildGateContext(eventKey: string, fc: FlightContext): EventContext {
  const flight = fc.getFlight();

  const eventData: Record<string, string> = {};

  if (eventKey === "gate_crew_start_soon") {
    eventData.airline = flight.airline;
    eventData.flight_number = flight.flightNumber;
    eventData.destination = flight.destCity;
    eventData.gate = flight.gate;
    eventData.departure_time = flight.departureTime;
  }

  return { eventKey, eventData };
}
