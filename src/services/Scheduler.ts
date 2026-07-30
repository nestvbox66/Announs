import { FlightPhase } from "../engine/FlightEngine";
import { RuleEngine } from "./RuleEngine";
import { TimerManager } from "./TimerManager";
import { AnnouncementPlayer } from "./AnnouncementPlayer";

export interface TelemetrySnapshot {
  groundspeed: number;
  altitude: number;
  verticalSpeed: number;
  heading: number;
  latitude: number;
  longitude: number;
}

export class Scheduler {
  private player: AnnouncementPlayer;
  private ruleEngine: RuleEngine;
  private timerManager: TimerManager;

  constructor(player: AnnouncementPlayer, ruleEngine: RuleEngine, timerManager: TimerManager) {
    this.player = player;
    this.ruleEngine = ruleEngine;
    this.timerManager = timerManager;
  }

  enterPhase(phase: FlightPhase): void {
    console.log("[Scheduler] Enter phase " + phase);

    const actions = this.ruleEngine.enterPhase(phase);
    for (const action of actions) {
      if (action.type === "announcement") {
        console.log("[Scheduler] Playing " + action.event);
        this.player.play(action.event).catch(() => {});
      } else if (action.type === "timer") {
        console.log("[Scheduler] Scheduling " + action.event + " in " + action.delayMs + "ms (id=" + action.id + ")");
        this.timerManager.schedule({
          id: action.id,
          delayMs: action.delayMs,
          event: action.event,
        });
      }
    }
  }

  leavePhase(_phase: FlightPhase): void {
    // reserved for future use
  }

  notifyEvent(_event: string): void {
    // reserved for future use
  }

  notifyTelemetry(_data: TelemetrySnapshot): void {
    // reserved for future use
  }
}
