/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tipos de pantalla que el Desktop puede mostrar según la fase actual.
 *
 * - `pre_boarding`: pantalla de pre-embarque (fase GATE) — monitor de embarque + lista de pasajeros.
 * - `boarding`: pantalla de embarque (fase BOARDING) — misma pantalla con animación de pasajeros.
 * - `flight`: pantalla de vuelo (todas las demás fases) — indicadores de vuelo.
 */
export type ScreenType = "pre_boarding" | "boarding" | "flight";

/**
 * Asociación entre una fase del vuelo y el tipo de pantalla que debe mostrar.
 */
export interface PhaseScreenMapping {
  phaseKey: string;
  screenType: ScreenType;
  /** true para GATE y BOARDING: no se pueden omitir del stepper. */
  isFixed: boolean;
  /** true si el Desktop espera esta fase (GATE y BOARDING lo son). */
  isRequired: boolean;
  /** Fase a la que transicionar si esta no existe en el escenario. */
  fallbackPhase?: string;
}
