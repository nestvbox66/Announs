/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PhaseScreenMapping } from "../types/flightPhase";

/**
 * Mapeo por defecto (fallback) entre fases del vuelo y tipo de pantalla.
 *
 * GATE y BOARDING son fases fijas y obligatorias: el Desktop siempre las
 * muestra aunque el escenario cargado no las defina.
 */
export const DEFAULT_PHASE_MAPPING: PhaseScreenMapping[] = [
  { phaseKey: "GATE", screenType: "pre_boarding", isFixed: true, isRequired: true },
  { phaseKey: "BOARDING", screenType: "boarding", isFixed: true, isRequired: true },
  { phaseKey: "PRE_FLIGHT", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "TAXI", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "TAKEOFF", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "CLIMB", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "CRUISE", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "DESCENT", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "LANDING", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "TAXI_TO_GATE", screenType: "flight", isFixed: false, isRequired: false },
  { phaseKey: "AT_GATE", screenType: "flight", isFixed: false, isRequired: false },
];

/**
 * Fases de vuelo en su orden canónico de progresión.
 * Se usan para completar el stepper cuando el escenario cargado no define
 * explícitamente toda la secuencia de vuelo.
 */
export const DEFAULT_FLIGHT_SEQUENCE: string[] = [
  "PRE_FLIGHT",
  "TAXI",
  "TAKEOFF",
  "CLIMB",
  "CRUISE",
  "DESCENT",
  "LANDING",
  "TAXI_TO_GATE",
  "AT_GATE",
];

/** Fases fijas que el stepper siempre incluye, en este orden. */
export const FIXED_PHASES: string[] = ["GATE", "BOARDING"];
