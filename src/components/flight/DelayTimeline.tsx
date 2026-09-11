/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DelayTimeline — barra visual para eventos de demora.
 * Muestra tres zonas (verde/amarillo/rojo) + marcadores + estado textual.
 */

import React, { useMemo } from "react";
import { secondsToHHMM, secondsToTimeRemaining } from "../../utils/timeUtils";

export interface DelayTimelineProps {
  eventKey: string;
  currentTime: number; // segundos UTC
  scheduledTakeoff: number; // segundos UTC
  thresholdMs: number; // milisegundos
  label: string;
}

type TimelineState = {
  text: string;
  color: string;
  bg: string;
  emoji: string;
};

export default function DelayTimeline({
  eventKey: _eventKey,
  currentTime,
  scheduledTakeoff,
  thresholdMs,
  label,
}: DelayTimelineProps) {
  const { limitTime, status, timeUntilLimit, timeUntilTakeoff, currentPos, limitPos, takeoffPos } = useMemo(() => {
    const hasData = typeof currentTime === "number" && typeof scheduledTakeoff === "number" && !Number.isNaN(currentTime) && !Number.isNaN(scheduledTakeoff) && typeof thresholdMs === "number";
    if (!hasData) {
      return {
        limitTime: null as number | null,
        status: { text: "Sin datos", color: "#94a3b8", bg: "bg-slate-500/20", emoji: "⚪" } as TimelineState,
        timeUntilLimit: null as number | null,
        timeUntilTakeoff: null as number | null,
        currentPos: null as number | null,
        limitPos: 33.33,
        takeoffPos: 66.66,
      };
    }
    const limit = scheduledTakeoff - thresholdMs / 1000;
    let s: TimelineState;
    if (currentTime >= scheduledTakeoff) {
      s = { text: "Demora crítica", color: "#ef4444", bg: "bg-red-500/20", emoji: "🔴" };
    } else if (currentTime >= limit) {
      s = { text: "Demora detectada", color: "#eab308", bg: "bg-yellow-500/20", emoji: "🟡" };
    } else {
      s = { text: "Sin demora", color: "#22c55e", bg: "bg-green-500/20", emoji: "🟢" };
    }

    const timeUntilLimitVal = limit - currentTime;
    const timeUntilTakeoffVal = scheduledTakeoff - currentTime;

    // Posiciones para marcadores dentro de la barra (0-100%)
    // Rango visual: [limit - threshold, scheduled + threshold] => 3*threshold
    // Así: verde = start→limit (33%), amarillo = limit→scheduled (33%), rojo = scheduled→end (33%)
    const thresholdSec = thresholdMs / 1000;
    const start = limit - thresholdSec;
    const end = scheduledTakeoff + thresholdSec;
    const total = Math.max(1, end - start);
    const clamp01 = (v: number) => Math.max(0, Math.min(100, v));
    const cp = clamp01(((currentTime - start) / total) * 100);
    const lp = clamp01(((limit - start) / total) * 100);
    const tp = clamp01(((scheduledTakeoff - start) / total) * 100);

    return {
      limitTime: limit,
      status: s,
      timeUntilLimit: timeUntilLimitVal,
      timeUntilTakeoff: timeUntilTakeoffVal,
      currentPos: cp,
      limitPos: lp,
      takeoffPos: tp,
    };
  }, [currentTime, scheduledTakeoff, thresholdMs]);

  const hasValidTimes = typeof currentTime === "number" && typeof scheduledTakeoff === "number" && limitTime !== null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-white/60">{label}</span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded border ${status.bg} border-white/10`} style={{ color: status.color }}>
          <span>{status.emoji}</span> {status.text}
        </span>
      </div>

      {/* Barra con 3 zonas */}
      <div className="relative h-3 rounded-full overflow-hidden flex border border-white/10">
        <div className="flex-1" style={{ backgroundColor: "#22c55e" }} title="Sin demora" />
        <div className="flex-1" style={{ backgroundColor: "#eab308" }} title="Demora detectada" />
        <div className="flex-1" style={{ backgroundColor: "#ef4444" }} title="Demora crítica" />
        {/* Marcadores */}
        {hasValidTimes && (
          <>
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)]"
              style={{ left: `${limitPos}%` }}
              title={`Hora Límite ${secondsToHHMM(limitTime!)}`}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/90"
              style={{ left: `${takeoffPos}%` }}
              title={`Hora Despegue ${secondsToHHMM(scheduledTakeoff)}`}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 shadow-md"
              style={{ left: `${currentPos}%`, borderColor: status.color, backgroundColor: "#fff" }}
              title={`Hora Actual ${secondsToHHMM(currentTime)}`}
            />
          </>
        )}
      </div>

      {/* Leyenda marcadores */}
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="flex items-center gap-1 text-white/70">
          <span className="w-2 h-2 rounded-full bg-white border" style={{ borderColor: status.color }} /> Hora Actual: {hasValidTimes ? secondsToHHMM(currentTime) : "--:--"}
        </span>
        <span className="flex items-center gap-1 text-[#eab308]">
          <span className="w-2 h-0.5 bg-[#eab308]" /> Hora Límite: {hasValidTimes && limitTime !== null ? secondsToHHMM(limitTime) : "--:--"}
        </span>
        <span className="flex items-center gap-1 text-[#ef4444]">
          <span className="w-2 h-0.5 bg-[#ef4444]" /> Hora Despegue: {typeof scheduledTakeoff === "number" ? secondsToHHMM(scheduledTakeoff) : "--:--"}
        </span>
      </div>

      {/* Tiempos restantes */}
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-white/60">
        <span>
          Restante hasta límite: {timeUntilLimit !== null ? secondsToTimeRemaining(timeUntilLimit) : "--:--"} <span className="text-white/30">({timeUntilLimit !== null ? `${timeUntilLimit}s` : "—"})</span>
        </span>
        <span>
          Restante hasta despegue: {timeUntilTakeoff !== null ? secondsToTimeRemaining(timeUntilTakeoff) : "--:--"} <span className="text-white/30">({timeUntilTakeoff !== null ? `${timeUntilTakeoff}s` : "—"})</span>
        </span>
      </div>
    </div>
  );
}
