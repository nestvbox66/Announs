import { Clock } from "./Clock";
import { AnnouncementQueue } from "./AnnouncementQueue";
import type { FlightContext } from "./FlightContext";
import {
  resolvePinnedSpeaker,
} from "./speakerResolver";
import { telemetryPositionParams } from "./AnnouncementService";

export interface TimerAction {
  id: string;
  delayMs: number;
  event: string;
  onFire?: (id: string) => void;
}

interface TimerRecord {
  action: TimerAction;
  deadlineMs: number;
}

export class TimerManager {
  private clock: Clock;
  private queue: AnnouncementQueue;
  private timers = new Map<string, TimerRecord>();
  private subscribed = false;
  private flightId: string | null = null;
  private languageId: string | null = null;
  /** Referencia viva al contexto (siempre fresca al disparar el timer). */
  private flightContext: FlightContext | null = null;

  constructor(clock: Clock, queue: AnnouncementQueue) {
    this.clock = clock;
    this.queue = queue;
  }

  setFlightContext(fc: FlightContext | null): void {
    this.flightContext = fc;
  }

  setEventContext(flightId: string | null, languageId: string | null): void {
    this.flightId = flightId;
    this.languageId = languageId;
  }

  schedule(action: TimerAction): void {
    const deadlineMs = this.clock.now() + action.delayMs;
    this.timers.set(action.id, { action, deadlineMs });

    if (!this.subscribed) {
      this.subscribed = true;
      this.clock.subscribe(this.onTick);
    }
  }

  cancel(id: string): void {
    this.timers.delete(id);
    this.checkUnsubscribe();
  }

  cancelAll(): void {
    this.timers.clear();
    this.checkUnsubscribe();
  }

  has(id: string): boolean {
    return this.timers.has(id);
  }

  /** Instantánea de timers pendientes (diagnóstico para el monitor). */
  getPendingTimers(): { id: string; event: string; remainingMs: number }[] {
    const now = this.clock.now();
    return Array.from(this.timers.entries()).map(([id, record]) => ({
      id,
      event: record.action.event,
      remainingMs: Math.max(0, record.deadlineMs - now),
    }));
  }

  private onTick = (): void => {
    const now = this.clock.now();
    const fired: string[] = [];

    for (const [id, record] of this.timers) {
      if (now >= record.deadlineMs) {
        fired.push(id);
      }
    }

    for (const id of fired) {
      const record = this.timers.get(id);
      if (record) {
        this.timers.delete(id);
        if (record.action.onFire) {
          record.action.onFire(id);
        } else {
          // Idioma global vigente + locutor explícito en gate_* (igual que el
          // handler): evita snapshot rancio y fallback del servidor (Mía ES).
          const fc = this.flightContext;
          const pinned = resolvePinnedSpeaker(record.action.event, fc);
          const languageId = pinned.languageId ?? this.languageId ?? "";
          const { role: speakerRole, voiceId } = pinned;
          this.queue.enqueue({
            eventKey: record.action.event,
            flightId: this.flightId,
            languageId,
            ...(voiceId ? { voiceId } : {}),
            ...(speakerRole ? { speakerRole } : {}),
            ...telemetryPositionParams(fc),
          }).catch((err) => {
            console.error('[TimerManager] ❌ enqueue fallido:', { event: record.action.event, error: (err as Error)?.message ?? String(err) });
          });
        }
      }
    }

    this.checkUnsubscribe();
  };

  private checkUnsubscribe(): void {
    if (this.subscribed && this.timers.size === 0) {
      this.clock.unsubscribe(this.onTick);
      this.subscribed = false;
    }
  }
}
