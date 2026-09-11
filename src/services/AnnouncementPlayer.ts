import { AnnouncementInfo } from "../types";
import { AnnouncementQueue } from "./AnnouncementQueue";
import { FlightContext } from "./FlightContext";
import { EventContextBuilder } from "../eventContext/EventContextBuilder";
import { fileLogger } from "./FileLogger";

export class AnnouncementPlayer {
  private queue: AnnouncementQueue;
  private flightContext: FlightContext | null = null;
  private playbackIdCounter = 0;

  constructor(queue: AnnouncementQueue) {
    this.queue = queue;
  }

  setFlightContext(fc: FlightContext): void {
    this.flightContext = fc;
  }

  async play(eventKey: string): Promise<AnnouncementInfo> {
    this.playbackIdCounter++;
    const playbackId = this.playbackIdCounter;

    console.log("[PLAYER TRACE]");
    console.log("action: play");
    console.log("event: " + eventKey);
    console.log("playbackId: " + playbackId);

    console.log("[PLAYER]");
    console.log("Play");
    console.log(eventKey);

    fileLogger.log('[AnnouncementPlayer] play', { eventKey, playbackId, flightId: this.flightContext?.getFlight().flightId ?? null, language: this.flightContext?.getFlight().captainPrimaryLang ?? null });

    const fc = this.flightContext;
    if (!fc) {
      return Promise.reject(new Error("AnnouncementPlayer: FlightContext not set"));
    }

    const context = await EventContextBuilder.build(eventKey, fc);
    const flight = fc.getFlight();

    console.log(`[AnnouncementPlayer] 🔊 Encargando reproducción para: ${eventKey}`);

    return this.queue.enqueue({
      eventKey: context.eventKey,
      flightId: flight.flightId,
      languageId: flight.captainPrimaryLang,
      eventData: context.eventData,
    });
  }
}
