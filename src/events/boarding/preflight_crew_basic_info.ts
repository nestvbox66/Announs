import { FlightPhase } from "../../engine/FlightEngine";
import { EventDefinition } from "../types";

export const preflightCrewBasicInfo: EventDefinition = {
  eventKey: "preflight_crew_basic_info",
  phase: FlightPhase.BOARDING,
  triggerType: "phase_enter",
  enabledSwitch: "preflight_crew_basic_info",
  priority: 20,
  blocking: true,
  speakerRole: "crew",
  preRecorded: true,
};
