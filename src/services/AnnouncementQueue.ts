import { AnnouncementInfo } from "../types";
import { AnnouncementParams, AnnouncementEvent } from "../types/announcement";
import { AnnouncementService } from "./AnnouncementService";
import { fileLogger } from "./FileLogger";

interface QueueItem {
  params: AnnouncementParams;
  resolve: (ann: AnnouncementInfo) => void;
  reject: (err: Error) => void;
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
      this.emit("announcement:completed");
    });
    this.service.on("completed", (...args) => {
      this.emit("completed", ...args);
      this.emit("announcement:completed");
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

    return new Promise((resolve, reject) => {
      this.queue.push({ params, resolve, reject });
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
    this.emit("announcement:completed");
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
        const ann = await this.service.play(item.params);
        item.resolve(ann);
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
}
