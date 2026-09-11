import { NarrativeTransition } from "./NarrativeTransition";

export class NarrativeStep {
  readonly id: number;
  readonly eventKey: string;
  readonly transition: NarrativeTransition;
  readonly blocking: boolean;
  readonly optional: boolean;
  readonly delayMs?: number;
  readonly conditions?: any;
  readonly parameters?: any;
  readonly preconditions?: any;
  readonly restrictions?: any;
  readonly producers?: string[];
  readonly detection_strategy?: string;
  readonly decision_maker?: string;
  readonly scheduler_rule?: string | null;

  constructor(
    id: number,
    eventKey: string,
    transition: NarrativeTransition,
    blocking: boolean,
    optional: boolean,
    delayMs?: number,
    conditions?: any,
    parameters?: any,
    preconditions?: any,
    restrictions?: any,
    producers?: string[],
    detection_strategy?: string,
    decision_maker?: string,
    scheduler_rule?: string | null
  ) {
    this.id = id;
    this.eventKey = eventKey;
    this.transition = transition;
    this.blocking = blocking;
    this.optional = optional;
    this.delayMs = delayMs;
    this.conditions = conditions;
    this.parameters = parameters;
    this.preconditions = preconditions;
    this.restrictions = restrictions;
    this.producers = producers;
    this.detection_strategy = detection_strategy;
    this.decision_maker = decision_maker;
    this.scheduler_rule = scheduler_rule;
  }
}
