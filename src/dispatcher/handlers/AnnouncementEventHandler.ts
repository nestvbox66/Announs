import { EventDefinition } from "../../events/types";
import { FlightContext } from "../../services/FlightContext";
import { AnnouncementQueue } from "../../services/AnnouncementQueue";
import { EventContextBuilder } from "../../eventContext/EventContextBuilder";
import { EventHandler } from "./EventHandler";

export class AnnouncementEventHandler implements EventHandler {
  private queue: AnnouncementQueue;
  private handlerCallId = 0;

  constructor(queue: AnnouncementQueue) {
    this.queue = queue;
  }

  handle(event: EventDefinition, context: FlightContext): Promise<void> {
    this.handlerCallId++;
    const callId = this.handlerCallId;

    console.log("[HANDLER TRACE]");
    console.log("event: " + event.eventKey);
    console.log("callId: " + callId);

    console.log("[HANDLER]");
    console.log("AnnouncementEventHandler");
    console.log("Event: " + event.eventKey);

    const built = EventContextBuilder.build(event.eventKey, context);
    const flight = context.getFlight();

    return this.queue
      .enqueue({
        eventKey: built.eventKey,
        flightId: flight.flightId,
        languageId: flight.captainPrimaryLang,
        eventData: built.eventData,
      })
      .then(() => undefined);
  }
}
