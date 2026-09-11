/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConnectionStatus — muestra el estado de conexión con simuladores
 * en la barra lateral (reemplaza el mockup estático).
 */

import React, { useEffect, useState } from "react";
import { Wifi, WifiOff, Activity } from "lucide-react";
import { ConnectionStatusService, ConnectionStatus as ConnStatus, connectionStatusService } from "../../services/ConnectionStatusService";
import type { FlightController } from "../../services/FlightController";
import { fileLogger } from "../../services/FileLogger";

interface ConnectionStatusProps {
  flightController?: FlightController | null;
  service?: ConnectionStatusService;
  /** Modo compacto (sidebar colapsado): solo ícono + indicador. */
  compact?: boolean;
}

function statusIcon(type: ConnStatus["type"], connected: boolean, className = "w-3.5 h-3.5") {
  if (type === "msfs" || type === "xplane") {
    return <Wifi className={className} />;
  }
  if (type === "mock") {
    return <Activity className={className} />;
  }
  return <WifiOff className={className} />;
}

export default function ConnectionStatus({ flightController, service, compact = false }: ConnectionStatusProps) {
  const svc = service ?? connectionStatusService;
  const [status, setStatus] = useState<ConnStatus>(() => svc.getStatus());

  useEffect(() => {
    // Sincronizar controlador activo con el servicio
    if (flightController) {
      svc.setActiveController(flightController);
    }
    svc.start();
    const unsub = svc.onStatusChange((s) => {
      fileLogger.log('[ConnectionStatus] 🔍 Estado en tiempo real', {
        type: s.type,
        connected: s.connected,
        label: s.label,
        detail: s.detail,
      });
      setStatus(s);
    });

    // Polling adicional por si el controlador cambia fuera del servicio
    const id = window.setInterval(() => {
      if (flightController) {
        svc.setActiveController(flightController);
      }
      svc.refresh();
    }, 1500);

    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [flightController, svc]);

  const isConnected = status.connected;
  const isMock = status.type === "mock";
  const isDisconnected = status.type === "disconnected";

  if (compact) {
    const label = status.connected
      ? status.label + (isMock ? " (Modo prueba)" : "")
      : "Sin conexión";
    return (
      <div
        id="sim-status-compact"
        className="flex flex-col items-center justify-center py-2 gap-1"
        title={label}
      >
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: status.color }}
          aria-hidden
        />
        <span className="text-white/40 text-[10px]">{status.icon}</span>
      </div>
    );
  }

  return (
    <div id="sim-status-card" className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-3 text-xs mb-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-white/70">CONEXIÓN AL SIMULADOR:</span>
        {isConnected ? (
          <span
            className={`flex items-center gap-1.5 font-bold ${isMock ? "text-[#94a3b8]" : "text-[#43E600]"}`}
            title={status.detail}
          >
            {statusIcon(status.type, true)}
            {isMock ? "MODO PRUEBA" : "CONECTADO"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[#E68B00] font-bold">
            <WifiOff className="w-3.5 h-3.5" />
            DESCONECTADO
          </span>
        )}
      </div>

      <div className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] font-mono">
        <span className="flex items-center gap-1.5">
          <span>{status.icon}</span>
          <span className={isDisconnected ? "text-red-400" : isMock ? "text-slate-300" : "text-white/90"}>
            {status.label}
          </span>
        </span>
        <span className="text-white/50 text-[10px]">{status.detail}</span>
      </div>

      {/* Detalle secundario para Mock / desconexión */}
      <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-white/40">
        <span>
          {status.type === "msfs" && "SimConnect activo"}
          {status.type === "xplane" && "X-Plane activo — futuro"}
          {status.type === "mock" && "MockFlightController"}
          {status.type === "disconnected" && "Sin simulador disponible"}
        </span>
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: status.color }}
          aria-hidden
        />
      </div>
    </div>
  );
}
