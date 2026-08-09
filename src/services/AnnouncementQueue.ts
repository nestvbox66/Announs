import { AnnouncementInfo } from "../types";
import { AnnouncementParams, AnnouncementEvent } from "../types/announcement";
import { AnnouncementService } from "./AnnouncementService";

interface QueueItem {
  params: AnnouncementParams;
  resolve: (ann: AnnouncementInfo) => void;
  reject: (err: Error) => void;
}

export class AnnouncementQueue {
  private service = new AnnouncementService();
  private queue: QueueItem[] = [];
  private processing = false;
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private queueCallId = 0;

  constructor() {
    this.service.on("generating", (...args) => this.emit("generating", ...args));
    this.service.on("announcement", (...args) => this.emit("announcement", ...args));
    this.service.on("playing", (...args) => this.emit("playing", ...args));
    this.service.on("error", (...args) => this.emit("error", ...args));
    this.service.on("completed", (...args) => this.emit("completed", ...args));
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
    this.queueCallId++;
    const callId = this.queueCallId;

    console.log("[QUEUE TRACE]");
    console.log("action: enqueue");
    console.log("event: " + params.eventKey);
    console.log("callId: " + callId);

    console.log("[QUEUE]");
    console.log("Enqueue");
    console.log(params.eventKey);

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
    for (const item of pending) {
      item.reject(new Error("Cancelled"));
    }
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
      try {
        const ann = await this.service.play(item.params);
        item.resolve(ann);
      } catch {
        item.reject(new Error("Playback failed"));
      }
    }
    this.processing = false;
  }
}
