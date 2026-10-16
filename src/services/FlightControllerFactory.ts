/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FlightControllerFactory — selección manual del proveedor de telemetría
 * (Fase 2 X-Plane: selección manual obligatoria, sin autodetección).
 *
 * - `getEffectiveSimProvider()`: override de runtime en localStorage
 *   (`announs_sim_provider`) con fallback a `VITE_SIM_PROVIDER` (`config`).
 * - `createFlightController(provider)`: único punto de construcción de
 *   controladores (MSFS / X-Plane 12 / Mock). Evita ternarios acoplados en la
 *   vista: para añadir un proveedor basta registrarlo aquí.
 */

import type { FlightController } from "./FlightController";
import { MockFlightController } from "./MockFlightController";
import { MsfsFlightController } from "./MsfsFlightController";
import { XPlaneFlightController } from "./XPlaneFlightController";
import { config } from "../config";

export type SimProvider = "msfs" | "xplane" | "mock";

/** Clave de persistencia de la selección manual del usuario. */
export const SIM_PROVIDER_STORAGE_KEY = "announs_sim_provider";

const VALID_PROVIDERS: readonly SimProvider[] = ["msfs", "xplane", "mock"];

function isSimProvider(value: unknown): value is SimProvider {
  return (
    typeof value === "string" &&
    (VALID_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Proveedor efectivo: selección manual guardada (localStorage) o, en su
 * ausencia, el default de compilación (`VITE_SIM_PROVIDER` vía `config`).
 * Nunca lanza: ante cualquier valor inválido devuelve `"mock"`.
 */
export function getEffectiveSimProvider(): SimProvider {
  try {
    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(SIM_PROVIDER_STORAGE_KEY)
        : null;
    if (isSimProvider(stored)) return stored;
  } catch {
    // almacenamiento no disponible (SSR/tests): seguir al default.
  }
  const fallback: unknown = config.sim.provider;
  return isSimProvider(fallback) ? fallback : "mock";
}

/** Persiste la selección manual del usuario (ignora valores inválidos). */
export function setEffectiveSimProvider(provider: SimProvider): void {
  if (!isSimProvider(provider)) return;
  try {
    localStorage.setItem(SIM_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // almacenamiento no disponible: la selección vive solo en memoria.
  }
}

/** true para proveedores reales (MSFS / X-Plane); false para Mock. */
export function isRealSimProvider(provider: SimProvider): boolean {
  return provider === "msfs" || provider === "xplane";
}

export interface MockControllerOptions {
  speedMultiplier?: number;
  autoTransition?: boolean;
  autoStart?: boolean;
}

/**
 * Construye el controlador del proveedor indicado. El Mock acepta opciones;
 * los proveedores reales se conectan bajo demanda (`connect()` explícito).
 */
export function createFlightController(
  provider: SimProvider,
  mockOptions?: MockControllerOptions
): FlightController {
  switch (provider) {
    case "msfs":
      return new MsfsFlightController();
    case "xplane":
      return new XPlaneFlightController();
    case "mock":
    default:
      return new MockFlightController({
        speedMultiplier: mockOptions?.speedMultiplier ?? config.mock.speedMultiplier,
        autoTransition: mockOptions?.autoTransition ?? config.mock.autoTransition,
        autoStart: mockOptions?.autoStart ?? false,
      });
  }
}
