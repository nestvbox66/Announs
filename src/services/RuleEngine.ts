import { FlightPhase } from "../engine/FlightEngine";
import { RuleDefinition } from "../types/rules";
import { phaseRules } from "../rules";

interface AnnouncementAction {
  type: "announcement";
  event: string;
}

interface TimerAction {
  type: "timer";
  id: string;
  delayMs: number;
  event: string;
}

export type RuleAction = AnnouncementAction | TimerAction;

export class RuleEngine {
  private timerCounter = 0;

  enterPhase(phase: FlightPhase): RuleAction[] {
    const rules: RuleDefinition[] = phaseRules[phase] ?? [];
    console.log("[RULE ENGINE]");
    console.log("Phase: " + phase);
    console.log("Loaded rules: " + rules.length);

    const actions: RuleAction[] = [];

    for (const rule of rules) {
      if (rule.trigger === "ENTER_PHASE") {
        console.log("ENTER_PHASE -> " + (rule.event ?? "(none)"));
        if (rule.action === "ANNOUNCEMENT" && rule.event) {
          actions.push({ type: "announcement", event: rule.event });
        }
      } else if (rule.trigger === "DELAY") {
        console.log("DELAY(" + rule.delayMs + ") -> " + (rule.event ?? "(none)"));
        if (rule.action === "ANNOUNCEMENT" && rule.event && rule.delayMs != null) {
          const id = rule.event + "-" + this.timerCounter++;
          actions.push({ type: "timer", id, delayMs: rule.delayMs, event: rule.event });
        }
      }
    }

    return actions;
  }
}
