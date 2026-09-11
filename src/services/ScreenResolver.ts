/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ScreenType, PhaseScreenMapping } from "../types/flightPhase";
import {
  DEFAULT_PHASE_MAPPING,
} from "../config/defaultPhaseMapping";

/**
 * Resuelve qué pantalla debe mostrar el Desktop según la fase actual.
 *
 * El resolver busca primero en el mapeo del escenario (si se le provee uno).
 * Si la fase no está mapeada, aplica fallbacks:
 *   1. GATE        -> pre_boarding
 *   2. BOARDING    -> boarding
 *   3. cualquier otra -> flight
 */
export class ScreenResolver {
  private phaseMapping: PhaseScreenMapping[];

  constructor(phaseMapping?: PhaseScreenMapping[]) {
    this.phaseMapping = phaseMapping || DEFAULT_PHASE_MAPPING;
  }

  resolveScreenType(phaseKey: string): ScreenType {
    const mapping = this.phaseMapping.find((m) => m.phaseKey === phaseKey);
    if (mapping) return mapping.screenType;

    if (phaseKey === "GATE") return "pre_boarding";
    if (phaseKey === "BOARDING") return "boarding";

    return "flight";
  }

  isFixedPhase(phaseKey: string): boolean {
    const mapping = this.phaseMapping.find((m) => m.phaseKey === phaseKey);
    return mapping?.isFixed || phaseKey === "GATE" || phaseKey === "BOARDING";
  }

  isRequiredPhase(phaseKey: string): boolean {
    const mapping = this.phaseMapping.find((m) => m.phaseKey === phaseKey);
    return mapping?.isRequired || phaseKey === "GATE" || phaseKey === "BOARDING";
  }
}
