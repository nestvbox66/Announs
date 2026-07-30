import { FlightPhase } from "../engine/FlightEngine";
import { FlightFSM } from "./FlightFSM";

export class SimulationController {
  private running = false;
  private flightFSM: FlightFSM;

  constructor(flightFSM: FlightFSM) {
    this.flightFSM = flightFSM;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.flightFSM.reset();
    console.log("[Simulation] Started");
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    console.log("[Simulation] Stopped");
  }

  nextPhase(): void {
    const orderedPhases: FlightPhase[] = [
      FlightPhase.PRE_BOARDING,
      FlightPhase.BOARDING,
      FlightPhase.PRE_FLIGHT,
      FlightPhase.TAXI,
      FlightPhase.TAKEOFF,
      FlightPhase.CLIMB,
      FlightPhase.CRUISE,
      FlightPhase.DESCENT,
      FlightPhase.APPROACH,
      FlightPhase.LANDING,
      FlightPhase.TAXI_IN,
      FlightPhase.AT_GATE,
      FlightPhase.FLIGHT_COMPLETED,
    ];

    const currentIdx = orderedPhases.indexOf(this.flightFSM.getCurrentState());
    if (currentIdx >= 0 && currentIdx < orderedPhases.length - 1) {
      const next = orderedPhases[currentIdx + 1];
      this.flightFSM.transition(next);
    }
  }

  triggerEvent(eventKey: string): void {
    console.log("[Simulation] Trigger event " + eventKey);
  }

  isRunning(): boolean {
    return this.running;
  }

  getCurrentStage(): FlightPhase {
    return this.flightFSM.getCurrentState();
  }
}
