import { FlightPhase } from "../engine/FlightEngine";
import { Scheduler } from "./Scheduler";

type FSMListener = (phase: FlightPhase) => void;

const VALID_TRANSITIONS: [FlightPhase, FlightPhase][] = [
  [FlightPhase.GATE, FlightPhase.BOARDING],
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
  private currentState: FlightPhase = FlightPhase.GATE;
  private scheduler: Scheduler;
  private listeners = new Set<FSMListener>();
  private fsmCallId = 0;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
    console.log("[FSM] Estado inicial: " + this.currentState);
  }

  getCurrentState(): FlightPhase {
    return this.currentState;
  }

  transition(nextState: FlightPhase, source: 'simulator' | 'user' | 'auto' = 'auto'): boolean {
    this.fsmCallId++;
    const callId = this.fsmCallId;
    const from = this.currentState;

    console.log("[FSM TRACE]");
    console.log("action: transition");
    console.log("from: " + from);
    console.log("to: " + nextState);
    console.log("source: " + source);
    console.log("callId: " + callId);

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

    this.scheduler.enterPhase(this.currentState, source);

    for (const listener of this.listeners) {
      listener(this.currentState);
    }

    return true;
  }

  reset(): void {
    this.fsmCallId++;
    console.log("[FSM TRACE]");
    console.log("action: reset");
    console.log("from: " + this.currentState);
    console.log("to: " + FlightPhase.GATE);
    console.log("callId: " + this.fsmCallId);

    this.currentState = FlightPhase.GATE;
    console.log("[FSM] Reset a " + this.currentState);
  }

  subscribe(listener: FSMListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: FSMListener): void {
    this.listeners.delete(listener);
  }
}
