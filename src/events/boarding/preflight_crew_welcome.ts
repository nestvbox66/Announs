import { FlightPhase } from "../../engine/FlightEngine";
import { EventDefinition } from "../types";

export const preflightCrewWelcome: EventDefinition = {
  eventKey: "preflight_crew_welcome",
  phase: FlightPhase.BOARDING,
  triggerType: "phase_enter",
  enabledSwitch: "preflight_crew_welcome",
  priority: 10,
  blocking: true,
  speakerRole: "crew",
  preRecorded: true,
};
