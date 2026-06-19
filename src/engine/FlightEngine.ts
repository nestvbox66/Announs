export type FlightPhase =
  | "PRE_FLIGHT"
  | "BOARDING"
  | "BOARDING_COMPLETED"
  | "DOORS_CLOSED";

export interface StateTransition {
  from: FlightPhase;
  event: string;
  to: FlightPhase;
}

const TRANSITIONS: StateTransition[] = [
  { from: "PRE_FLIGHT", event: "START_BOARDING", to: "BOARDING" },
  { from: "BOARDING", event: "BOARDING_COMPLETE", to: "BOARDING_COMPLETED" },
  { from: "BOARDING_COMPLETED", event: "CLOSE_DOORS", to: "DOORS_CLOSED" },
];

export function transitionState(
  currentState: FlightPhase,
  event: string
): FlightPhase {
  const match = TRANSITIONS.find(
    (t) => t.from === currentState && t.event === event
  );
  return match ? match.to : currentState;
}

export function canTransition(
  currentState: FlightPhase,
  event: string
): boolean {
  return TRANSITIONS.some(
    (t) => t.from === currentState && t.event === event
  );
}
