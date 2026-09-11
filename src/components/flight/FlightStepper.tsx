/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { useTranslation } from "react-i18next";

export interface FlightStepperProps {
  /** Fases del escenario cargado, en el orden definido por el escenario. */
  phases: string[];
  /** Fase actual del vuelo. */
  currentPhase: string;
  /** Callback al hacer click en una fase (solo visual, no transiciona). */
  onPhaseChange: (phase: string) => void;
}

/**
 * Etiqueta corta (tipo de sub-indicador) para cada fase.
 */
const PHASE_TAG: Record<string, string> = {
  GATE: "TIERRA",
  BOARDING: "PRE-FLT",
  PRE_FLIGHT: "PRE-FLT",
  TAXI: "RODAJE",
  TAKEOFF: "DESPEGUE",
  CLIMB: "ASCENSO",
  CRUISE: "EN VUELO",
  DESCENT: "DESCENSO",
  LANDING: "ATERRIZAJE",
  TAXI_TO_GATE: "ARRIV",
  AT_GATE: "ARRIV",
};

export default function FlightStepper({
  phases,
  currentPhase,
  onPhaseChange,
}: FlightStepperProps) {
  const { t } = useTranslation();
  const activeIndex = phases.indexOf(currentPhase);

  /**
   * Estado visual de una fase según su posición respecto a la fase actual:
   * - "completed": fases anteriores a la actual (índice menor).
   * - "active":    la fase actual.
   * - "pending":   fases posteriores a la actual (índice mayor).
   */
  const getState = (phase: string): "completed" | "active" | "pending" => {
    const stepIndex = phases.indexOf(phase);
    if (stepIndex < activeIndex) return "completed";
    if (stepIndex === activeIndex) return "active";
    return "pending";
  };

  // Traducción de la etiqueta de fase vía `flight.phase.<clave>`.
  // `TAXI_TO_GATE` → `taxi_to_gate`, `PRE_FLIGHT` → `pre_flight`, etc.
  // Si la clave no existe, muestra el código de fase (fallback).
  const getLabel = (phase: string): string => {
    return t(`flight.phase.${phase.toLowerCase()}`, { defaultValue: phase });
  };

  if (phases.length === 0) return null;

  // Log de depuración: se ejecuta en CADA render del stepper, así que queda
  // silenciado por defecto para no saturar la consola.
  const DEBUG_STEPPER = false;
  if (DEBUG_STEPPER) {
    console.log("[FlightStepper] Actualizando stepper:", {
      currentPhase,
      phases,
      phaseStates: phases.map((p) => ({ phase: p, state: getState(p) })),
    });
  }

  return (
    <div className="relative flex flex-col">
      <div className="relative flex items-start justify-between gap-2 md:gap-0 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10">
        {/* Connecting line for desktop background */}
        <div className="absolute top-[18px] left-[20px] right-[20px] h-[2px] bg-white/5 hidden lg:block z-0" />

        {/* Active Progress line for desktop */}
        <div
          className="absolute top-[18px] left-[20px] h-[2px] bg-[#45AFFF]/60 hidden lg:block z-0 transition-all duration-500"
          style={{
            width: `${
              activeIndex >= 0 && phases.length > 1
                ? (activeIndex / (phases.length - 1)) * 95
                : 0
            }%`,
            maxWidth: "calc(100% - 40px)",
          }}
        />

        {phases.map((phase, idx) => {
          const state = getState(phase);
          const isActive = state === "active";
          const isCompleted = state === "completed";

          return (
            <button
              key={phase}
              type="button"
              onClick={() => onPhaseChange(phase)}
              className={`relative flex md:flex-col items-center gap-3 md:gap-2 flex-1 min-w-[72px] text-left md:text-center z-10 transition-all focus:outline-none cursor-pointer group ${
                isActive || isCompleted ? "opacity-100" : "opacity-35 hover:opacity-70"
              }`}
            >
              {/* Step Circle with conditional styling */}
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border font-mono text-xs font-bold transition-all duration-300 shrink-0 ${
                  isActive
                    ? "bg-[#43E600] text-black border-[#43E600] shadow-[0_0_12px_rgba(67,230,0,0.5)] ring-4 ring-[#43E600]/10 animate-pulse scale-105"
                    : isCompleted
                      ? "bg-[#002746] text-[#45AFFF] border-[#3B7EB2]/60 hover:border-[#45AFFF]"
                      : "bg-[#001224] text-white/30 border-white/10"
                }`}
              >
                {isCompleted ? "✓" : idx + 1}
              </div>

              {/* Step Text Label */}
              <div className="flex flex-col md:items-center min-w-0">
                <span
                  className={`font-sans text-[10px] font-semibold tracking-tight transition-all duration-300 leading-snug break-words hyphens-auto ${
                    isActive
                      ? "text-[#43E600] font-black"
                      : isCompleted
                        ? "text-[#45AFFF] font-medium"
                        : "text-white/40 font-normal"
                  }`}
                >
                  {getLabel(phase)}
                </span>

                {/* Small sub-indicator */}
                <span className="text-[7.5px] font-mono text-white/20 tracking-wider uppercase mt-0.5 hidden xl:block">
                  {PHASE_TAG[phase] ?? "FLIGHT"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
