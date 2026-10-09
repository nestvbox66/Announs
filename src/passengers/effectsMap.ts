/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * effectsMap — tabla local eventKey → efectos sobre pasajeros (Fase 1).
 *
 * Fuente de valores: docs/Sistema de Pasajeros.pdf §9, mapeada contra las
 * claves reales (catálogos locales + escenario remoto) y aprobada por diseño.
 *
 * Rol: fuente PRIMARIA hasta que el Backoffice exponga `events.effects` en el
 * snapshot publicado o vía RLS (hoy la columna existe pero no es legible desde
 * este entorno). Cuando eso ocurra, este mapa pasa a ser fallback local para
 * desarrollo/mock sin conexión, con override por lo remoto.
 *
 * Convención: `amount` positivo suma, negativo resta (ej. permanecer sentado
 * incomoda: confort −2). `mode` distingue mejora neta (`boost`, siempre suma)
 * de mitigación (`mitigate`, solo si hay evento negativo activo).
 */

import type { PassengerEffect } from "./types";
import { ATTRIBUTE_KEYS } from "./types";

export const EVENT_EFFECTS: Record<string, PassengerEffect[]> = {
  // ── Boarding ──
  gate_crew_start_soon: [{ attribute: "entretenimiento", amount: 2, mode: "boost" }],
  gate_crew_started: [{ attribute: "entretenimiento", amount: 2, mode: "boost" }],
  preflight_crew_welcome: [{ attribute: "calma", amount: 3, mode: "boost" }],
  preflight_crew_basic_info: [{ attribute: "calma", amount: 3, mode: "boost" }],
  preflight_capt_welcome: [{ attribute: "calma", amount: 5, mode: "boost" }],
  preflight_capt_basic_info: [
    { attribute: "calma", amount: 5, mode: "boost" },
    { attribute: "entretenimiento", amount: 3, mode: "boost" },
  ],
  common_crew_boarding: [{ attribute: "entretenimiento", amount: 1, mode: "boost" }],

  // ── Delays (mitigadores, no mejoras puras) ──
  preflight_capt_delay: [{ attribute: "calma", amount: 8, mode: "mitigate" }],
  preflight_capt_delay_parked: [{ attribute: "calma", amount: 8, mode: "mitigate" }],
  preflight_capt_delay_taxi: [{ attribute: "calma", amount: 6, mode: "mitigate" }],
  preflight_capt_delay_takeoff: [{ attribute: "calma", amount: 6, mode: "mitigate" }],
  taxitogate_crew_delay_apologies: [{ attribute: "calma", amount: 5, mode: "mitigate" }],

  // ── Taxi / Takeoff pre-despegue ──
  taxi_capt_armdoors: [],
  taxi_capt_dimlights: [],
  taxi_crew_safety_brief: [{ attribute: "calma", amount: 5, mode: "boost" }],
  taxi_crew_dimlights: [{ attribute: "entretenimiento", amount: 1, mode: "boost" }],
  takeoff_capt_prepare: [],

  // ── Climb / Cruise ──
  climb_crew_upcoming_service: [{ attribute: "saciedad", amount: 3, mode: "boost" }],
  cruise_crew_service_info: [{ attribute: "saciedad", amount: 15, mode: "boost" }],
  cruise_crew_service_info1: [{ attribute: "saciedad", amount: 15, mode: "boost" }],
  cruise_capt_general_info: [
    { attribute: "entretenimiento", amount: 8, mode: "boost" },
    { attribute: "calma", amount: 3, mode: "boost" },
  ],
  cruise_crew_shopping_info: [{ attribute: "entretenimiento", amount: 2, mode: "boost" }],
  cruise_crew_service_info2: [
    { attribute: "saciedad", amount: 5, mode: "boost" },
    { attribute: "confortFisiologico", amount: 3, mode: "boost" },
  ],
  cruise_crew_service_info3: [{ attribute: "saciedad", amount: 8, mode: "boost" }],
  cruise_crew_customs_forms: [{ attribute: "entretenimiento", amount: 2, mode: "boost" }],
  captain_special_event: [],

  // ── Transversal turbulencia (mitigadores) ──
  common_capt_seatbelt: [{ attribute: "calma", amount: 4, mode: "mitigate" }],
  common_crew_seatbelt: [{ attribute: "calma", amount: 2, mode: "mitigate" }],

  // ── Descent ──
  descent_capt_close_desc: [
    { attribute: "calma", amount: 2, mode: "boost" },
    { attribute: "entretenimiento", amount: 2, mode: "boost" },
  ],
  descent_crew_upcoming_actions: [
    { attribute: "confortFisiologico", amount: 5, mode: "boost" },
  ],
  descent_capt_10kfeet: [{ attribute: "calma", amount: 2, mode: "boost" }],
  descent_capt_upcoming_actions: [
    { attribute: "entretenimiento", amount: 5, mode: "boost" },
    { attribute: "calma", amount: 3, mode: "boost" },
  ],
  descent_crew_landing_fewmin: [{ attribute: "calma", amount: 5, mode: "boost" }],
  final_capt_take_seats: [],

  // ── Taxi to Gate / At Gate ──
  taxitogate_crew_welcome: [{ attribute: "entretenimiento", amount: 3, mode: "boost" }],
  // Restricción: genera impaciencia leve (monto negativo, misma vía de código).
  taxitogate_crew_ramining_seating: [
    { attribute: "confortFisiologico", amount: -2, mode: "boost" },
  ],
  atgate_capt_disarm_doors: [],
  atgate_crew_deboarding: [
    { attribute: "calma", amount: 3, mode: "boost" },
    { attribute: "entretenimiento", amount: 3, mode: "boost" },
  ],
};

/** Efectos de un evento (array vacío si no impacta o si la clave es nueva). */
export function getEventEffects(eventKey: string): PassengerEffect[] {
  return EVENT_EFFECTS[eventKey] ?? [];
}

/**
 * Normaliza el campo remoto `events.effects` (cuando el Backoffice lo exponga).
 * El PDF §10 muestra dos variantes (`[...]` y `{effects: [...]}`): se aceptan
 * ambas. Entradas inválidas se descartan (fail-closed, sin romper el motor).
 */
export function normalizeEffects(input: unknown): PassengerEffect[] {
  if (input == null) return [];
  const raw: unknown = Array.isArray(input)
    ? input
    : typeof input === "object" && Array.isArray((input as { effects?: unknown }).effects)
      ? (input as { effects: unknown }).effects
      : [];
  if (!Array.isArray(raw)) return [];
  const out: PassengerEffect[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { attribute, amount, mode } = item as Record<string, unknown>;
    if (
      typeof attribute === "string" &&
      (ATTRIBUTE_KEYS as string[]).includes(attribute) &&
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      (mode === "boost" || mode === "mitigate")
    ) {
      out.push({
        attribute: attribute as PassengerEffect["attribute"],
        amount,
        mode,
      });
    }
  }
  return out;
}
