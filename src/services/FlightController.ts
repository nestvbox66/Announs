/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contrato del FlightController: traduce información del simulador (MSFS,
 * X-Plane, mock) al modelo interno (`TelemetrySnapshot` → `FlightContext`).
 */

import type { TelemetrySnapshot } from "../types/telemetry";

export interface FlightController {
  /** Conecta con el simulador / inicia el polling. */
  connect(): Promise<void>;
  /** Desconecta y detiene el polling. */
  disconnect(): void;
  /** true si la conexión está activa. */
  isConnected(): boolean;
  /** Última telemetría recibida, o null si aún no hay datos. */
  getTelemetry(): TelemetrySnapshot | null;
  /** Callback invocado en cada actualización de telemetría. */
  onTelemetry: (snap: TelemetrySnapshot) => void;
}
