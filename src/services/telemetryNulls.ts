/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Higiene del borde de telemetría: el backend Rust serializa `None` como
 * `null` JSON, pero el contrato TS distingue `undefined` (desconocido, rama
 * legacy) de `false` (medido). P. ej. `atcOnParkingSpot: null` hacía que
 * `hasAdvancedGroundData` tomara la rama avanzada imposible en vez de la
 * legacy (`null !== undefined` es true). Esta función normaliza `null` a
 * `undefined` en el borde, antes de cualquier evaluación.
 *
 * Solo toca claves con valor `null`; el resto (incluidos `false` y `0`) se
 * preserva tal cual. Mutación in-place: los snapshots de Tauri son objetos
 * frescos por evento/poll.
 */
export function stripTelemetryNulls<T extends object>(snap: T): T {
  const rec = snap as unknown as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (rec[key] === null) {
      rec[key] = undefined;
    }
  }
  return snap;
}
