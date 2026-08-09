import { NarrativeTransition } from "./NarrativeTransition";

export class NarrativeStep {
  readonly id: number;
  readonly eventKey: string;
  readonly transition: NarrativeTransition;
  readonly blocking: boolean;
  readonly optional: boolean;
  readonly delayMs?: number;

  constructor(
    id: number,
    eventKey: string,
    transition: NarrativeTransition,
    blocking: boolean,
    optional: boolean,
    delayMs?: number
  ) {
    this.id = id;
    this.eventKey = eventKey;
    this.transition = transition;
    this.blocking = blocking;
    this.optional = optional;
    this.delayMs = delayMs;
  }
}
