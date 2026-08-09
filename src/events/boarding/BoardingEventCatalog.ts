import { EventDefinition } from "../types";
import { preflightCrewWelcome } from "./preflight_crew_welcome";
import { preflightCrewBasicInfo } from "./preflight_crew_basic_info";
import { preflightCaptWelcome } from "./preflight_capt_welcome";
import { preflightCaptBasicInfo } from "./preflight_capt_basic_info";

export const BoardingEventCatalog: Map<string, EventDefinition> = new Map([
  [preflightCrewWelcome.eventKey, preflightCrewWelcome],
  [preflightCrewBasicInfo.eventKey, preflightCrewBasicInfo],
  [preflightCaptWelcome.eventKey, preflightCaptWelcome],
  [preflightCaptBasicInfo.eventKey, preflightCaptBasicInfo],
]);
