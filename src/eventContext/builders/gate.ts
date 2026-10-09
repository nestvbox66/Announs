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
    // Hora LOCAL del aeropuerto (nunca UTC): es lo que se narra en cabina.
    const local = typeof flight.departureTimeLocal === "string" ? flight.departureTimeLocal.trim() : "";
    eventData.departure_time = local !== "" ? local : flight.departureTime;
  }

  return { eventKey, eventData };
}
