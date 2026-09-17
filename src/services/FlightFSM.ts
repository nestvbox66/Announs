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

// Transiciones de "recuperación": el avión puede adelantarse a la narrativa
// (p. ej. aterriza mientras el scheduler sigue en DESCENT porque un paso
// bloqueó el avance). Sin estas aristas, el detector las rechaza y el vuelo
// queda clavado en la fase vieja para siempre (silencio total en log).
const RECOVERY_TRANSITIONS: [FlightPhase, FlightPhase][] = [
  [FlightPhase.DESCENT, FlightPhase.LANDING],
  [FlightPhase.DESCENT, FlightPhase.TAXI],
  [FlightPhase.DESCENT, FlightPhase.TAXI_IN],
  [FlightPhase.APPROACH, FlightPhase.TAXI],
  [FlightPhase.APPROACH, FlightPhase.TAXI_IN],
  [FlightPhase.LANDING, FlightPhase.TAXI_IN],
];

const transitionAllowed = new Set(
  VALID_TRANSITIONS.map(([from, to]) => from + "\0" + to)
);

const recoveryAllowed = new Set(
  RECOVERY_TRANSITIONS.map(([from, to]) => from + "\0" + to)
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
    const isRecovery = !transitionAllowed.has(key) && recoveryAllowed.has(key);
    console.log('[FlightFSM] Transición solicitada:', {
      from: this.currentState,
      to: nextState,
      isValid: transitionAllowed.has(key) || recoveryAllowed.has(key),
      viaRecuperacion: isRecovery,
    });
    if (!transitionAllowed.has(key) && !recoveryAllowed.has(key)) {
      console.log(
        "[FSM] Transition rechazada: " + this.currentState + " -> " + nextState
      );
      return false;
    }
    if (isRecovery) {
      console.log(
        "[FSM] Transición de recuperación aceptada: " + this.currentState + " -> " + nextState
      );
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

  /**
   * Sincronización forzada con una fase (salta el grafo de transiciones).
   * Uso: al iniciar el vuelo, `executeFlightStart` entra fases vía
   * `scheduler.enterPhase()` directo; sin esto el FSM quedaba en GATE mientras
   * el Scheduler avanzaba, y el detector rechazaba todas las transiciones
   * (p. ej. CRUISE → DESCENT) desde el despegue. No llama al Scheduler
   * (el llamador ya hace enterPhase); solo actualiza estado + listeners.
   */
  syncState(nextState: FlightPhase, source: 'simulator' | 'user' | 'auto' = 'auto'): void {
    this.fsmCallId++;
    const from = this.currentState;
    console.log("[FSM] Sincronización forzada: " + from + " -> " + nextState + " (" + source + ")");
    this.currentState = nextState;
    for (const listener of this.listeners) {
      listener(this.currentState);
    }
  }

  subscribe(listener: FSMListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: FSMListener): void {
    this.listeners.delete(listener);
  }
}
