import { FlightPhase } from "../../engine/FlightEngine";
import { EventDefinition } from "../types";

export const preflightCaptBasicInfo: EventDefinition = {
  eventKey: "preflight_capt_basic_info",
  phase: FlightPhase.BOARDING,
  triggerType: "phase_enter",
  enabledSwitch: "preflight_capt_basic_info",
  priority: 40,
  blocking: true,
  speakerRole: "captain",
  preRecorded: false,
};
