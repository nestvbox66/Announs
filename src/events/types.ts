import { FlightPhase } from "../engine/FlightEngine";

export interface EventDefinition {
  eventKey: string;
  phase: FlightPhase;
  triggerType: "manual" | "phase_enter" | "timer" | "condition";
  enabledSwitch: string;
  priority: number;
  blocking: boolean;
  description?: string;
  speakerRole?: "captain" | "crew" | "gate";
  preRecorded?: boolean;
}
