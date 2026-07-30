export type RuleTrigger =
  | "ENTER_PHASE"
  | "EXIT_PHASE"
  | "DELAY"
  | "PERCENTAGE"
  | "TELEMETRY"
  | "MANUAL";

export type RuleActionType =
  | "ANNOUNCEMENT"
  | "DISPLAY"
  | "LIGHTS"
  | "IFE"
  | "CUSTOM";

export interface RuleDefinition {
  trigger: RuleTrigger;
  action: RuleActionType;
  event?: string;
  delayMs?: number;
}
