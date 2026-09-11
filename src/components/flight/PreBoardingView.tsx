/**
 * @license SPDX-License-Identifier: Apache-2.0
 * PreBoardingView — pantalla de pre-embarque que muestra la hora local del aeropuerto de origen.
 * departureTime (UTC) se mantiene para cálculos internos (detección de demoras vs ZULU TIME).
 * departureTimeLocal se muestra al usuario.
 */

import React from "react";
import type { FlightInfo } from "../../services/FlightContext";

export interface PreBoardingViewProps {
  flight: FlightInfo;
}

export default function PreBoardingView({ flight }: PreBoardingViewProps) {
  // Prioriza hora local; fallback a UTC si aún no se importó SimBrief
  const displayTime = flight.departureTimeLocal || flight.departureTime || "--:--";
  const isLocal = !!flight.departureTimeLocal;

  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm font-mono text-white">
        Hora de salida: {displayTime} {isLocal ? "(hora local)" : flight.departureTime ? "(hora local)" : ""}
      </div>
      {/* UTC siempre disponible para debug / cálculos internos */}
      {flight.departureTime && flight.departureTimeLocal && flight.departureTime !== flight.departureTimeLocal && (
        <div className="text-[10px] font-mono text-white/40">
          UTC: {flight.departureTime}
        </div>
      )}
    </div>
  );
}
