import { EventDefinition } from "../../events/types";
import { FlightContext } from "../../services/FlightContext";
import { AnnouncementQueue } from "../../services/AnnouncementQueue";
import { EventContextBuilder } from "../../eventContext/EventContextBuilder";
import { EventHandler } from "./EventHandler";
import { fileLogger } from "../../services/FileLogger";

export class AnnouncementEventHandler implements EventHandler {
  private queue: AnnouncementQueue;
  private handlerCallId = 0;

  constructor(queue: AnnouncementQueue) {
    this.queue = queue;
  }

  async handle(event: EventDefinition, context: FlightContext): Promise<void> {
    this.handlerCallId++;
    const callId = this.handlerCallId;

    console.log("[HANDLER TRACE]");
    console.log("event: " + event.eventKey);
    console.log("callId: " + callId);

    console.log("[HANDLER]");
    console.log("AnnouncementEventHandler");
    console.log("Event: " + event.eventKey);

    const built = await EventContextBuilder.build(event.eventKey, context);
    const flight = context.getFlight();

    const params = {
      eventKey: built.eventKey,
      flightId: flight.flightId,
      languageId: flight.captainPrimaryLang,
      eventData: built.eventData,
    };
    console.log("[AnnouncementEventHandler] Encargando a la cola (payload):", params);
    fileLogger.log('[AnnouncementEventHandler] enqueue', {
      eventKey: params.eventKey,
      flightId: params.flightId,
      languageId: params.languageId,
      eventDataKeys: params.eventData ? Object.keys(params.eventData) : [],
    });

    return this.queue
      .enqueue(params)
      .then(() => undefined);
  }
}
