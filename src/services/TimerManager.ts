import { Clock } from "./Clock";
import { AnnouncementQueue } from "./AnnouncementQueue";

export interface TimerAction {
  id: string;
  delayMs: number;
  event: string;
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

  constructor(clock: Clock, queue: AnnouncementQueue) {
    this.clock = clock;
    this.queue = queue;
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
        this.queue.enqueue({
          eventKey: record.action.event,
          flightId: this.flightId,
          languageId: this.languageId ?? "",
        }).catch(() => {});
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
