export type TickListener = (elapsedMs: number) => void;

export class Clock {
  private elapsed = 0;
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<TickListener>();

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(() => {
      this.elapsed += 1000;
      this.notify();
    }, 1000);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset(): void {
    this.stop();
    this.elapsed = 0;
  }

  now(): number {
    return this.elapsed;
  }

  subscribe(listener: TickListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: TickListener): void {
    this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.elapsed);
    }
  }
}
