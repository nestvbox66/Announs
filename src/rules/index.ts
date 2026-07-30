import { RuleDefinition } from "../types/rules";
import { boardingRules } from "./boarding";
import { preflightRules } from "./preflight";
import { taxiRules } from "./taxi";
import { takeoffRules } from "./takeoff";
import { climbRules } from "./climb";
import { cruiseRules } from "./cruise";
import { descentRules } from "./descent";
import { approachRules } from "./approach";
import { landingRules } from "./landing";
import { taxiInRules } from "./taxiIn";
import { atGateRules } from "./atGate";

export const phaseRules: Record<string, RuleDefinition[]> = {
  PRE_BOARDING: [],
  BOARDING: boardingRules,
  PRE_FLIGHT: preflightRules,
  TAXI: taxiRules,
  TAKEOFF: takeoffRules,
  CLIMB: climbRules,
  CRUISE: cruiseRules,
  DESCENT: descentRules,
  APPROACH: approachRules,
  LANDING: landingRules,
  TAXI_IN: taxiInRules,
  AT_GATE: atGateRules,
  FLIGHT_COMPLETED: [],
};
