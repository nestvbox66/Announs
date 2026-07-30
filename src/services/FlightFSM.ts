import { FlightPhase } from "../engine/FlightEngine";
import { Scheduler } from "./Scheduler";

type FSMListener = (phase: FlightPhase) => void;

const VALID_TRANSITIONS: [FlightPhase, FlightPhase][] = [
  [FlightPhase.PRE_BOARDING, FlightPhase.BOARDING],
  [FlightPhase.BOARDING, FlightPhase.PRE_FLIGHT],
  [FlightPhase.PRE_FLIGHT, FlightPhase.TAXI],
  [FlightPhase.TAXI, FlightPhase.TAKEOFF],
  [FlightPhase.TAKEOFF, FlightPhase.CLIMB],
  [FlightPhase.CLIMB, FlightPhase.CRUISE],
  [FlightPhase.CRUISE, FlightPhase.DESCENT],
  [FlightPhase.DESCENT, FlightPhase.APPROACH],
  [FlightPhase.APPROACH, FlightPhase.LANDING],
  [FlightPhase.LANDING, FlightPhase.TAXI_IN],
  [FlightPhase.TAXI_IN, FlightPhase.AT_GATE],
  [FlightPhase.AT_GATE, FlightPhase.FLIGHT_COMPLETED],
];

const transitionAllowed = new Set(
  VALID_TRANSITIONS.map(([from, to]) => from + "\0" + to)
);

export class FlightFSM {
  private currentState: FlightPhase = FlightPhase.PRE_BOARDING;
  private scheduler: Scheduler;
  private listeners = new Set<FSMListener>();

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
    console.log("[FSM] Estado inicial: " + this.currentState);
  }

  getCurrentState(): FlightPhase {
    return this.currentState;
  }

  transition(nextState: FlightPhase): boolean {
    const key = this.currentState + "\0" + nextState;
    if (!transitionAllowed.has(key)) {
      console.log(
        "[FSM] Transition rechazada: " + this.currentState + " -> " + nextState
      );
      return false;
    }

    console.log(
      "[FSM] Transition: " + this.currentState + " -> " + nextState
    );
    this.currentState = nextState;
    console.log("[FSM] Transition aceptada");
    console.log("[FSM] Notificando Scheduler");

    this.scheduler.enterPhase(this.currentState);

    for (const listener of this.listeners) {
      listener(this.currentState);
    }

    return true;
  }

  reset(): void {
    this.currentState = FlightPhase.PRE_BOARDING;
    console.log("[FSM] Reset a " + this.currentState);
  }

  subscribe(listener: FSMListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: FSMListener): void {
    this.listeners.delete(listener);
  }
}
