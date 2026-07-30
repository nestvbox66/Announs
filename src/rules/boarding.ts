import { RuleDefinition } from "../types/rules";

export const boardingRules: RuleDefinition[] = [
  { trigger: "ENTER_PHASE", action: "ANNOUNCEMENT", event: "gate_crew_start_soon" },
  { trigger: "DELAY", delayMs: 60000, action: "ANNOUNCEMENT", event: "gate_crew_started" },
];
