import { AnnouncementInfo } from "../types";
import { AnnouncementParams, AnnouncementEvent } from "../types/announcement";
import { AnnouncementService } from "./AnnouncementService";
import { fileLogger } from "./FileLogger";
import {
  safetyVideoPackService,
  type SafetyVideoPlayRequest,
} from "./SafetyVideoPackService";

interface QueueItem {
  params: AnnouncementParams;
  resolve: (ann: AnnouncementInfo) => void;
  reject: (err: Error) => void;
  /**
   * Vía video de seguridad (PACK): en lugar de `AnnouncementService.play()`
   * (Edge Function `audio-get`), se solicita la reproducción en el IFE y se
   * espera a que termine, emitiendo el mismo ciclo de vida para que la
   * narrativa, los pasajeros y el ducking de música funcionen igual.
   */
  safetyVideo?: {
    request: SafetyVideoPlayRequest;
  };
}

export class AnnouncementQueue {
  private service = new AnnouncementService();
  private queue: QueueItem[] = [];
  private processing = false;
  private processingEventKey: string | null = null;
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private queueCallId = 0;

  constructor() {
    this.service.on("generating", (...args) => this.emit("generating", ...args));
    this.service.on("announcement", (...args) => this.emit("announcement", ...args));
    this.service.on("playing", (v: boolean) => {
      this.emit("playing", v);
      if (v) this.emit("announcement:started");
    });
    this.service.on("error", (msg: string | null) => {
      this.emit("error", msg);
      // `AnnouncementService.play()` emite `error(null)` al INICIAR cada
      // reproducción (limpieza del error previo, ver línea ~96). Ese null NO
      // es una finalización: si lo propagamos como `announcement:completed`,
      // los oyentes (pasajeros, música) cobran el anuncio dos veces — una al
      // empezar (error) y otra al terminar (completed), separadas por ~30s
      // (lo que tarda audio-get + playback), fuera de la ventana
      // anti-duplicados de 10s del PassengerEngine. Solo los errores reales
      // (string) cierran el ciclo.
      if (msg == null) return;
      // Sin clave en el error del servicio: se informa la que estaba
      // procesándose (puede ser null si el fallo fue antes de empezar).
      fileLogger.log('[AnnouncementQueue] announcement:completed (error)', { eventKey: this.processingEventKey });
      this.emit("announcement:completed", this.processingEventKey);
    });
    this.service.on("completed", (eventKey: string) => {
      this.emit("completed", eventKey);
      // Q1 pasajeros: el efecto se cobra al COMPLETAR la reproducción, no al
      // encolar. Se propaga la clave para que los oyentes (motor de
      // pasajeros) apliquen los efectos del anuncio escuchado.
      fileLogger.log('[AnnouncementQueue] announcement:completed (completed)', { eventKey });
      this.emit("announcement:completed", eventKey);
    });
  }

  on(event: AnnouncementEvent, callback: (...args: any[]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: AnnouncementEvent, ...args: any[]) {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  enqueue(params: AnnouncementParams): Promise<AnnouncementInfo> {
    // Evitar encolar el mismo evento dos veces (previene duplicados por múltiples
    // enterPhase). Cubre tanto los pendientes en cola como el que está procesándose
    // (ya desplazado fuera de `queue`), que es el caso que generaba el duplicado
    // de `preflight_crew_welcome` a ~350ms.
    const isDuplicate =
      this.queue.some((item) => item.params.eventKey === params.eventKey) ||
      this.processingEventKey === params.eventKey;
    if (isDuplicate) {
      console.warn('[AnnouncementQueue] Duplicado ignorado:', params.eventKey);
      fileLogger.warn('[AnnouncementQueue] Duplicado ignorado', { eventKey: params.eventKey, queueLength: this.queue.length, processing: this.processingEventKey });
      // Retornar promesa resuelta sin encolar para no romper el flujo del dispatcher
      return Promise.resolve(null as unknown as AnnouncementInfo);
    }

    this.queueCallId++;
    const callId = this.queueCallId;

    console.log("[QUEUE TRACE]");
    console.log("action: enqueue");
    console.log("event: " + params.eventKey);
    console.log("callId: " + callId);

    console.log("[QUEUE]");
    console.log("Enqueue");
    console.log(params.eventKey);

    fileLogger.log('[AnnouncementQueue] enqueue', { eventKey: params.eventKey, callId, queueLength: this.queue.length + 1, flightId: params.flightId, languageId: params.languageId });

    // Aviso de reproducción aceptada (con clave): es el punto único por el
    // que pasa TODO el audio (pasos narrativos, phase-rules del Scheduler,
    // fallbacks y disparos manuales). Los oyentes (p. ej. sinergia XP)
    // cuentan aquí en vez de en `step:executed`, que solo cubre la vía
    // narrativa. Los duplicados rechazados arriba no emiten (no suenan).
    this.emit("announcement:enqueued", params.eventKey);

    return new Promise((resolve, reject) => {
      this.queue.push({ params, resolve, reject });
      if (!this.processing) {
        this.processing = true;
        this.processNext();
      }
    });
  }

  /**
   * Encola un evento de video de seguridad (modo PACK): NO invoca a la Edge
   * Function `audio-get`; reproduce el archivo cacheado en el IFE y completa
   * el mismo ciclo de vida (`announcement`, `playing`, `completed`,
   * `announcement:completed`) para no bloquear la narrativa.
   */
  enqueueSafetyVideo(
    params: AnnouncementParams,
    request: SafetyVideoPlayRequest
  ): Promise<AnnouncementInfo> {
    const isDuplicate =
      this.queue.some((item) => item.params.eventKey === params.eventKey) ||
      this.processingEventKey === params.eventKey;
    if (isDuplicate) {
      console.warn('[AnnouncementQueue] Duplicado ignorado (safety video):', params.eventKey);
      fileLogger.warn('[AnnouncementQueue] Duplicado ignorado (safety video)', { eventKey: params.eventKey });
      return Promise.resolve(null as unknown as AnnouncementInfo);
    }

    this.queueCallId++;
    const callId = this.queueCallId;

    console.log("[QUEUE TRACE]");
    console.log("action: enqueueSafetyVideo");
    console.log("event: " + params.eventKey);
    console.log("callId: " + callId);

    fileLogger.log('[AnnouncementQueue] enqueueSafetyVideo', { eventKey: params.eventKey, callId, packageId: request.packageId });

    this.emit("announcement:enqueued", params.eventKey);

    return new Promise((resolve, reject) => {
      this.queue.push({ params, resolve, reject, safetyVideo: { request } });
      if (!this.processing) {
        this.processing = true;
        this.processNext();
      }
    });
  }

  clear(): void {
    const pending = this.queue.splice(0);
    this.service.cancel();
    this.processing = false;
    this.processingEventKey = null;
    for (const item of pending) {
      item.reject(new Error("Cancelled"));
    }
    // Si se interrumpió un anuncio, la música debe recuperar su volumen.
    // Se informa la clave en curso (o null) igual que en error/completed.
    fileLogger.log('[AnnouncementQueue] announcement:completed (clear)', { eventKey: this.processingEventKey });
    this.emit("announcement:completed", this.processingEventKey);
  }

  isBusy(): boolean {
    return this.processing;
  }

  size(): number {
    return this.queue.length;
  }

  private async processNext(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.processingEventKey = item.params.eventKey;
      try {
        if (item.safetyVideo) {
          const ann = await this.playSafetyVideo(item);
          item.resolve(ann);
        } else {
          const ann = await this.service.play(item.params);
          item.resolve(ann);
        }
      } catch (err) {
        console.error('[Audio] ❌ error:', { eventKey: item.params.eventKey, error: (err as Error)?.message ?? String(err) });
        fileLogger.error('[AnnouncementQueue] playback failed', { eventKey: item.params.eventKey, error: (err as Error)?.message ?? String(err) });
        item.reject(new Error("Playback failed"));
      } finally {
        this.processingEventKey = null;
      }
    }
    this.processing = false;
  }

  /**
   * Reproduce un video de seguridad en el IFE en lugar de generar audio.
   * Emite el ciclo de vida estándar para que oyentes (narrativa, pasajeros,
   * música) reaccionen igual que ante un anuncio de audio.
   */
  private async playSafetyVideo(item: QueueItem): Promise<AnnouncementInfo> {
    const { params, safetyVideo } = item;
    const request = safetyVideo!.request;
    const { eventKey } = params;

    console.log('[Audio] 🎬 safety-video dispatch (sin audio-get):', { eventKey, packageId: request.packageId });
    fileLogger.log('[AnnouncementQueue] safety-video dispatch', { eventKey, packageId: request.packageId });

    // Anuncio virtual para la UI (LastAnnouncementBox, historial): el audio
    // real lo sustituye el video del IFE.
    const virtual: AnnouncementInfo = {
      audio_url: request.objectUrl ?? request.remoteUrl,
      text: `Video de seguridad: ${request.packageName}`,
      speaker_role: params.speakerRole ?? "crew",
      language_id: params.languageId,
      is_pre_recorded: true,
    };

    this.emit("generating", true);
    this.emit("announcement", virtual);
    // `playing(true)` al arrancar para el ducking de música durante el video
    // (también propaga `announcement:started` a los oyentes).
    this.emit("playing", true);

    const outcome = await safetyVideoPackService.requestPlayAndWait(request);

    this.emit("playing", false);
    this.emit("generating", false);
    this.emit("completed", eventKey);
    fileLogger.log('[AnnouncementQueue] announcement:completed (safety-video)', { eventKey, outcome });
    this.emit("announcement:completed", eventKey);

    return virtual;
  }
}
