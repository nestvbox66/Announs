import { FlightPhase } from "../../engine/FlightEngine";
import { EventDefinition } from "../types";

export const preflightCaptWelcome: EventDefinition = {
  eventKey: "preflight_capt_welcome",
  phase: FlightPhase.BOARDING,
  triggerType: "phase_enter",
  enabledSwitch: "preflight_capt_welcome",
  priority: 30,
  blocking: true,
  speakerRole: "captain",
  preRecorded: true,
};
