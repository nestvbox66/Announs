import { EventDefinition } from "../../events/types";
import { FlightContext } from "../../services/FlightContext";
import { AnnouncementQueue } from "../../services/AnnouncementQueue";
import { EventContextBuilder } from "../../eventContext/EventContextBuilder";
import { EventHandler } from "./EventHandler";
import {
  resolvePinnedSpeaker,
  shouldPinSpeaker,
} from "../../services/speakerResolver";
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

    // Idioma estrictamente global + locutor explícito en gate_* (pinning
    // endurecido: voz probada en el idioma, con alternativa y fail-open).
    const pinned = resolvePinnedSpeaker(event.eventKey, context);
    const languageId = pinned.languageId ?? flight.captainPrimaryLang;
    const { role: speakerRole, voiceId } = pinned;
    if (!languageId) {
      console.warn("[AnnouncementEventHandler] Payload sin language_id:", { eventKey: event.eventKey });
      fileLogger.warn("[AnnouncementEventHandler] sin language_id", { eventKey: event.eventKey });
    }
    if (shouldPinSpeaker(event.eventKey) && !voiceId) {
      console.warn("[AnnouncementEventHandler] Evento gate sin voz fijable:", {
        eventKey: event.eventKey,
        speakerRole,
        languageId: languageId || null,
      });
      fileLogger.warn("[AnnouncementEventHandler] gate sin voz", {
        eventKey: event.eventKey,
        speakerRole,
        languageId: languageId || null,
      });
    }

    const params = {
      eventKey: built.eventKey,
      flightId: flight.flightId,
      languageId,
      ...(voiceId ? { voiceId } : {}),
      ...(speakerRole ? { speakerRole } : {}),
      eventData: built.eventData,
    };
    console.log("[AnnouncementEventHandler] Encargando a la cola (payload):", params);
    fileLogger.log('[AnnouncementEventHandler] enqueue', {
      eventKey: params.eventKey,
      flightId: params.flightId,
      languageId: params.languageId,
      voiceId: voiceId ?? null,
      speakerRole: speakerRole ?? null,
      eventDataKeys: params.eventData ? Object.keys(params.eventData) : [],
    });

    return this.queue
      .enqueue(params)
      .then(() => undefined);
  }
}
