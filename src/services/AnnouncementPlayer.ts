import { AnnouncementInfo } from "../types";
import { AnnouncementQueue } from "./AnnouncementQueue";
import { FlightContext } from "./FlightContext";
import { EventContextBuilder } from "../eventContext/EventContextBuilder";

export class AnnouncementPlayer {
  private queue: AnnouncementQueue;
  private flightContext: FlightContext | null = null;

  constructor(queue: AnnouncementQueue) {
    this.queue = queue;
  }

  setFlightContext(fc: FlightContext): void {
    this.flightContext = fc;
  }

  play(eventKey: string): Promise<AnnouncementInfo> {
    const fc = this.flightContext;
    if (!fc) {
      return Promise.reject(new Error("AnnouncementPlayer: FlightContext not set"));
    }

    const context = EventContextBuilder.build(eventKey, fc);
    const flight = fc.getFlight();

    return this.queue.enqueue({
      eventKey: context.eventKey,
      flightId: flight.flightId,
      languageId: flight.captainPrimaryLang,
      eventData: context.eventData,
    });
  }
}
