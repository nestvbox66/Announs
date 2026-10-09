import { AnnouncementInfo } from "../types";
import { AnnouncementQueue } from "./AnnouncementQueue";
import { FlightContext } from "./FlightContext";
import { EventContextBuilder } from "../eventContext/EventContextBuilder";
import {
  resolvePinnedSpeaker,
} from "./speakerResolver";
import { fileLogger } from "./FileLogger";
import { telemetryPositionParams } from "./AnnouncementService";
import {
  SAFETY_VIDEO_EVENT_KEY,
  safetyVideoPackService,
} from "./SafetyVideoPackService";

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

    // Mismo pinning que el handler: idioma global + locutor explícito en gate_*.
    const pinned = resolvePinnedSpeaker(eventKey, fc);
    const languageId = pinned.languageId ?? flight.captainPrimaryLang;
    const { role: speakerRole, voiceId } = pinned;

    const params = {
      eventKey: context.eventKey,
      flightId: flight.flightId,
      languageId,
      ...(voiceId ? { voiceId } : {}),
      ...(speakerRole ? { speakerRole } : {}),
      eventData: context.eventData,
      ...telemetryPositionParams(fc),
    };

    // Safety Video PACK: mismo desvío que el handler (sin audio-get, video en IFE).
    if (context.eventKey === SAFETY_VIDEO_EVENT_KEY) {
      try {
        const packMode = fc.getSettings().eventConfig?.[SAFETY_VIDEO_EVENT_KEY] === "PACK";
        const pkg = safetyVideoPackService.getActivePackage();
        if (packMode && pkg?.package_url) {
          return this.queue.enqueueSafetyVideo(params, {
            eventKey: context.eventKey,
            packageId: pkg.id,
            packageName: pkg.package_name,
            objectUrl: safetyVideoPackService.getActiveObjectUrl(),
            remoteUrl: pkg.package_url,
            durationSeconds: pkg.duration_seconds,
          });
        }
      } catch {
        // fallback a la vía de audio tradicional
      }
    }

    return this.queue.enqueue(params);
  }
}
