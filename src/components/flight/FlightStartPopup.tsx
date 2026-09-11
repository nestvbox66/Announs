/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FlightStartPopup — modal para elegir el estado inicial del vuelo.
 * Aparece al iniciar vuelo y respeta la elección en Scheduler/FlightContext.
 */

import React, { useState, useEffect } from "react";
import { X, Plane, DoorClosed, Zap } from "lucide-react";
import type { FlightStartPreferences } from "../../services/FlightContext";

interface FlightStartPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (preferences: FlightStartPreferences) => void;
  defaultPreferences?: FlightStartPreferences;
}

export default function FlightStartPopup({
  isOpen,
  onClose,
  onConfirm,
  defaultPreferences,
}: FlightStartPopupProps) {
  const [initialState, setInitialState] = useState<FlightStartPreferences["initialState"]>(
    defaultPreferences?.initialState ?? "gate_engines_on"
  );
  const [includeBoarding, setIncludeBoarding] = useState<boolean>(
    defaultPreferences?.includeBoarding ?? true
  );

  // Reset al abrir con los defaults si se proveen
  useEffect(() => {
    if (isOpen && defaultPreferences) {
      setInitialState(defaultPreferences.initialState);
      setIncludeBoarding(defaultPreferences.includeBoarding);
    }
  }, [isOpen, defaultPreferences]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const prefs: FlightStartPreferences = {
      initialState,
      includeBoarding: initialState === "gate_engines_on" ? includeBoarding : true,
    };
    onConfirm(prefs);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Estado inicial del vuelo"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[#00172e] border border-[#3B7EB2]/50 rounded-[10px] shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3B7EB2]/30 bg-[#002440]/80">
          <h2 className="font-mono font-black text-sm text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
            <Plane className="w-4 h-4" />
            Estado inicial del vuelo
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[12px] font-sans text-white/70 leading-relaxed">
            Elegí cómo comienza tu vuelo en el simulador. La elección se respeta en el flujo narrativo y en el embarque.
          </p>

          {/* Opciones de estado inicial */}
          <div className="space-y-2">
            <label
              className={`flex items-start gap-3 p-3 rounded-[6px] border cursor-pointer transition-all ${
                initialState === "cold_and_dark"
                  ? "bg-[#2C6591]/30 border-[#45AFFF] ring-1 ring-[#45AFFF]/30"
                  : "bg-[#002440]/40 border-white/10 hover:border-white/20"
              }`}
            >
              <input
                type="radio"
                name="flight-start-state"
                value="cold_and_dark"
                checked={initialState === "cold_and_dark"}
                onChange={() => setInitialState("cold_and_dark")}
                className="mt-0.5 accent-[#45AFFF]"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-white">
                  <DoorClosed className="w-3.5 h-3.5 text-[#45AFFF]" />
                  En puerta (Cool & Dark)
                </span>
                <span className="block text-[11px] text-white/50 mt-0.5">Aeronave apagada en puerta. Flujo completo desde GATE.</span>
              </span>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-[6px] border cursor-pointer transition-all ${
                initialState === "gate_engines_on"
                  ? "bg-[#2C6591]/30 border-[#45AFFF] ring-1 ring-[#45AFFF]/30"
                  : "bg-[#002440]/40 border-white/10 hover:border-white/20"
              }`}
            >
              <input
                type="radio"
                name="flight-start-state"
                value="gate_engines_on"
                checked={initialState === "gate_engines_on"}
                onChange={() => setInitialState("gate_engines_on")}
                className="mt-0.5 accent-[#45AFFF]"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-white">
                  <Zap className="w-3.5 h-3.5 text-[#43E600]" />
                  En puerta (motores encendidos)
                </span>
                <span className="block text-[11px] text-white/50 mt-0.5">Motores encendidos en puerta. Podés incluir u omitir el abordaje.</span>
              </span>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-[6px] border cursor-pointer transition-all ${
                initialState === "runway"
                  ? "bg-[#2C6591]/30 border-[#45AFFF] ring-1 ring-[#45AFFF]/30"
                  : "bg-[#002440]/40 border-white/10 hover:border-white/20"
              }`}
            >
              <input
                type="radio"
                name="flight-start-state"
                value="runway"
                checked={initialState === "runway"}
                onChange={() => setInitialState("runway")}
                className="mt-0.5 accent-[#45AFFF]"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-white">
                  <Plane className="w-3.5 h-3.5 text-[#E68B00]" />
                  En cabecera de pista
                </span>
                <span className="block text-[11px] text-white/50 mt-0.5">Listo para despegue. Embarque automático y sin pantalla de embarque.</span>
              </span>
            </label>
          </div>

          {/* Checkbox solo para gate_engines_on */}
          {initialState === "gate_engines_on" && (
            <label className="flex items-center gap-2 p-3 bg-black/20 border border-white/10 rounded-[6px] cursor-pointer hover:bg-black/30 transition-colors">
              <input
                type="checkbox"
                checked={includeBoarding}
                onChange={(e) => setIncludeBoarding(e.target.checked)}
                className="accent-[#43E600] w-4 h-4"
              />
              <span className="text-xs font-mono text-white/80">Incluir proceso de abordaje</span>
            </label>
          )}
          {initialState === "gate_engines_on" && !includeBoarding && (
            <p className="text-[10px] font-mono text-[#45AFFF]/70 px-1">Se omitirá BOARDING y se avanzará directo a PRE_FLIGHT.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10 bg-black/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[5px] text-xs font-mono font-bold bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 rounded-[5px] text-xs font-mono font-black bg-[#43E600] hover:bg-[#3bcc00] text-black transition-colors shadow-[0_0_10px_rgba(67,230,0,0.3)]"
          >
            Confirmar e iniciar
          </button>
        </div>
      </div>
    </div>
  );
}
