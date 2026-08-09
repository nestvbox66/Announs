import { FlightPhase } from "../engine/FlightEngine";
import { EventCatalogService } from "../events/EventCatalogService";
import { TriggerEvaluatorFactory } from "../triggers/TriggerEvaluatorFactory";
import { FlightContext } from "./FlightContext";

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

  enterPhase(phase: FlightPhase, context: FlightContext): RuleAction[] {
    const events = EventCatalogService.getByPhase(phase);
    const actions: RuleAction[] = [];

    for (const ev of events) {
      const evaluator = TriggerEvaluatorFactory.get(ev.triggerType);

      console.log("[RULE ENGINE]");
      console.log("Evaluating:");
      console.log(ev.eventKey);
      console.log("↓");
      console.log(evaluator.constructor.name);

      const isTriggered = evaluator.evaluate(ev, context);
      console.log("↓");
      console.log(isTriggered ? "TRUE" : "FALSE");

      if (isTriggered) {
        if (ev.priority === 10) {
          actions.push({ type: "announcement", event: ev.eventKey });
        } else if (ev.priority === 20) {
          const id = ev.eventKey + "-" + this.timerCounter++;
          actions.push({ type: "timer", id, delayMs: 60000, event: ev.eventKey });
        }
      }
    }

    return actions;
  }
}
