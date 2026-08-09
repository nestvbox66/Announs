import { TriggerEvaluator } from "./TriggerEvaluator";
import { ManualTriggerEvaluator } from "./ManualTriggerEvaluator";
import { PhaseEnterTriggerEvaluator } from "./PhaseEnterTriggerEvaluator";
import { TimerTriggerEvaluator } from "./TimerTriggerEvaluator";
import { ConditionTriggerEvaluator } from "./ConditionTriggerEvaluator";

export class TriggerEvaluatorFactory {
  private static evaluators: Record<string, TriggerEvaluator> = {
    manual: new ManualTriggerEvaluator(),
    phase_enter: new PhaseEnterTriggerEvaluator(),
    timer: new TimerTriggerEvaluator(),
    condition: new ConditionTriggerEvaluator()
  };

  static get(triggerType: string): TriggerEvaluator {
    const evaluator = this.evaluators[triggerType];
    if (!evaluator) {
      throw new Error(`No evaluator registered for trigger type: ${triggerType}`);
    }
    return evaluator;
  }
}
