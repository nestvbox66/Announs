/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConnectionStatusService — monitorea el estado de conexión con los simuladores
 * soportados (MSFS, X-Plane, Mock) en secuencia y notifica cambios en tiempo real.
 */

import type { FlightController } from "./FlightController";
import { fileLogger } from "./FileLogger";
import { config } from "../config";

export type ConnectionType = "msfs" | "xplane" | "mock" | "disconnected";

export interface ConnectionStatus {
  type: ConnectionType;
  connected: boolean;
  label: string;
  icon: string;
  color: string;
  detail: string;
}

const STATUS_MAP: Record<ConnectionType, Omit<ConnectionStatus, "type" | "connected">> = {
  msfs: {
    label: "Conectado a MSFS",
    icon: "🔵",
    color: "#43E600",
    detail: "MSFS 2020",
  },
  xplane: {
    label: "Conectado a X-Plane",
    icon: "🔵",
    color: "#43E600",
    detail: "X-Plane 12",
  },
  mock: {
    label: "Modo prueba (Mock)",
    icon: "⚪",
    color: "#94a3b8",
    detail: "Simulación interna",
  },
  disconnected: {
    label: "Sin conexión",
    icon: "🔴",
    color: "#ef4444",
    detail: "Sin simulador",
  },
};

function buildStatus(type: ConnectionType): ConnectionStatus {
  const base = STATUS_MAP[type];
  return {
    type,
    connected: type !== "disconnected",
    label: base.label,
    icon: base.icon,
    color: base.color,
    detail: base.detail,
  };
}

/**
 * Identifica el tipo de controlador por nombre de clase o marca registrada.
 * Evita instanceof circular import usando constructor.name.
 */
function identifyControllerType(controller: FlightController): ConnectionType {
  const name = (controller as any)?.constructor?.name ?? "";
  if (name === "MsfsFlightController") return "msfs";
  if (name === "XPlaneFlightController") return "xplane";
  if (name === "MockFlightController") return "mock";
  // Heurística fallback: campos característicos
  if ("pollInterval" in (controller as any) || name.toLowerCase().includes("msfs")) return "msfs";
  if (name.toLowerCase().includes("xplane")) return "xplane";
  return "mock";
}

export class ConnectionStatusService {
  private status: ConnectionStatus = buildStatus("disconnected");
  private listeners = new Set<(status: ConnectionStatus) => void>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private activeController: FlightController | null = null;
  private msfsController: FlightController | null = null;
  private xplaneController: FlightController | null = null;
  private mockController: FlightController | null = null;
  private pollMs: number;

  constructor(options?: { pollMs?: number }) {
    this.pollMs = options?.pollMs ?? 1500;
  }

  /** Registra controladores conocidos para chequeo secuencial MSFS → X-Plane → Mock */
  setControllers(controllers: {
    msfs?: FlightController | null;
    xplane?: FlightController | null;
    mock?: FlightController | null;
    active?: FlightController | null;
  }): void {
    if (controllers.msfs !== undefined) this.msfsController = controllers.msfs;
    if (controllers.xplane !== undefined) this.xplaneController = controllers.xplane;
    if (controllers.mock !== undefined) this.mockController = controllers.mock;
    if (controllers.active !== undefined) this.activeController = controllers.active;
    this.checkStatus();
  }

  setActiveController(controller: FlightController | null): void {
    this.activeController = controller;
    this.checkStatus();
  }

  /** Escucha eventos de conexión/desconexión expuestos por FlightController (si existen) */
  bindControllerEvents(controller: FlightController): void {
    // Hook onTelemetry / connect wrappers if controller emits events
    // Polling covers generic case
    this.setActiveController(controller);
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.checkStatus();
    this.intervalId = setInterval(() => this.checkStatus(), this.pollMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(callback);
    // Emit current immediately
    callback(this.status);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Fuerza re-evaluación inmediata */
  refresh(): void {
    this.checkStatus();
  }

  private checkStatus(): void {
    const next = this.resolveStatus();
    if (next.type !== this.status.type || next.connected !== this.status.connected) {
      this.status = next;
      fileLogger.log('[ConnectionStatus] 🔍 Estado actualizado', {
        provider: config.sim.provider,
        isConnected: next.connected,
        connectionType: next.type,
      });
      this.emit();
    }
  }

  /**
   * Chequea en secuencia MSFS → X-Plane → Mock.
   * Prioridad: MSFS > X-Plane > Mock > disconnected
   */
  private resolveStatus(): ConnectionStatus {
    // 1. Chequeo directo del controlador activo (más rápido)
    if (this.activeController?.isConnected()) {
      const type = identifyControllerType(this.activeController);
      return buildStatus(type);
    }

    // 2. Secuencia completa si no hay activo o no está conectado
    const candidates: Array<{ type: ConnectionType; controller: FlightController | null }> = [
      { type: "msfs", controller: this.msfsController },
      { type: "xplane", controller: this.xplaneController },
      { type: "mock", controller: this.mockController },
    ];

    for (const cand of candidates) {
      if (cand.controller?.isConnected()) {
        return buildStatus(cand.type);
      }
    }

    // También revisar el activo aunque no esté en lista separada (último fallback)
    if (this.activeController?.isConnected()) {
      return buildStatus(identifyControllerType(this.activeController));
    }

    return buildStatus("disconnected");
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.status);
      } catch (e) {
        console.warn("[ConnectionStatusService] listener error:", e);
      }
    }
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }
}

// Singleton opcional para uso global en UI
export const connectionStatusService = new ConnectionStatusService();
