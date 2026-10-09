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
import { telemetryPositionParams } from "../../services/AnnouncementService";
import {
  SAFETY_VIDEO_EVENT_KEY,
  safetyVideoPackService,
} from "../../services/SafetyVideoPackService";

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
      // Posición al disparar (el Edge la persiste en flight_audio_deliveries).
      ...telemetryPositionParams(context),
    };

    // ── Safety Video PACK ──────────────────────────────────────────
    // `taxi_crew_safety_brief` en modo PACK: NO se invoca a la Edge Function
    // `audio-get`; se reproduce en el IFE el video cacheado en local.
    // (Diagnóstico: este bloque loguea SIEMPRE el modo y el package para
    // distinguir "no estaba en PACK" de "PACK sin package".)
    if (event.eventKey === SAFETY_VIDEO_EVENT_KEY) {
      const safetyMode = context.getSettings().eventConfig?.[SAFETY_VIDEO_EVENT_KEY];
      const activePkg = safetyVideoPackService.getActivePackage();
      console.log("[AnnouncementEventHandler] safety-video check:", {
        eventKey: params.eventKey,
        mode: safetyMode ?? "(sin config)",
        packageId: activePkg?.id ?? null,
        hasUrl: !!activePkg?.package_url,
        cached: safetyVideoPackService.getActiveObjectUrl() != null,
      });
      fileLogger.log("[AnnouncementEventHandler] safety-video check", {
        eventKey: params.eventKey,
        mode: safetyMode ?? null,
        packageId: activePkg?.id ?? null,
        hasUrl: !!activePkg?.package_url,
      });
    }
    if (this.shouldPlaySafetyVideo(event.eventKey, context)) {
      const pkg = safetyVideoPackService.getActivePackage();
      if (pkg?.package_url) {
        console.log("[AnnouncementEventHandler] 🎬 Safety video PACK (sin audio-get):", {
          eventKey: params.eventKey,
          packageId: pkg.id,
        });
        fileLogger.log('[AnnouncementEventHandler] safety-video PACK', {
          eventKey: params.eventKey,
          packageId: pkg.id,
        });
        return this.queue
          .enqueueSafetyVideo(params, {
            eventKey: params.eventKey,
            packageId: pkg.id,
            packageName: pkg.package_name,
            objectUrl: safetyVideoPackService.getActiveObjectUrl(),
            remoteUrl: pkg.package_url,
            durationSeconds: pkg.duration_seconds,
          })
          .then(() => undefined);
      }
      console.warn("[AnnouncementEventHandler] PACK sin package de video: fallback a audio IA", {
        eventKey: params.eventKey,
      });
      fileLogger.warn("[AnnouncementEventHandler] PACK sin package, fallback audio", {
        eventKey: params.eventKey,
      });
    }

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

  /**
   * ¿Este dispatch debe reproducirse como video de seguridad en el IFE?
   * Solo `taxi_crew_safety_brief` con el switch en `PACK`.
   */
  private shouldPlaySafetyVideo(eventKey: string, context: FlightContext): boolean {
    if (eventKey !== SAFETY_VIDEO_EVENT_KEY) return false;
    try {
      return context.getSettings().eventConfig?.[SAFETY_VIDEO_EVENT_KEY] === "PACK";
    } catch {
      return false;
    }
  }
}
