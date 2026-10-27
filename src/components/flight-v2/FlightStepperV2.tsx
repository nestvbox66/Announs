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
 * Reduce el tamaño de la tipografía lo justo para que la etiqueta quepa en el
 * ancho disponible sin partirse en varias líneas.
 */
function AutoFitLabel({ children }: { children: string }) {
  const containerRef = React.useRef<HTMLSpanElement | null>(null);
  const textRef = React.useRef<HTMLSpanElement | null>(null);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    let cancelled = false;

    const fit = () => {
      if (cancelled || !containerRef.current || !textRef.current) return;

      text.style.fontSize = "";
      const baseSize = Number.parseFloat(window.getComputedStyle(text).fontSize) || 10;
      const available = container.clientWidth;
      const needed = text.scrollWidth;

      if (available > 0 && needed > available) {
        const nextSize = Math.max(5, Math.floor(((baseSize * available) / needed) * 10) / 10);
        text.style.fontSize = `${nextSize}px`;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener("resize", fit);
    if (document.fonts) {
      void document.fonts.ready.then(fit);
    }

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [children]);

  return (
    <span ref={containerRef} className="block w-full overflow-hidden">
      <span ref={textRef} className="inline-block whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}

/**
 * Sandbox V2: pestañas horizontales de fase, sin contadores de eventos.
 * Se mantiene en una sola línea con scroll horizontal si el ancho no alcanza.
 */
export default function FlightStepper({
  phases,
  currentPhase,
  onPhaseChange,
}: FlightStepperProps) {
  const { t } = useTranslation();
  const activeIndex = phases.indexOf(currentPhase);

  const getState = (phase: string): "completed" | "active" | "pending" => {
    const stepIndex = phases.indexOf(phase);
    if (stepIndex < activeIndex) return "completed";
    if (stepIndex === activeIndex) return "active";
    return "pending";
  };

  const getLabel = (phase: string): string => {
    return t(`flight.phase.${phase.toLowerCase()}`, { defaultValue: phase });
  };

  if (phases.length === 0) return null;

  return (
    <div
      className="flex items-stretch gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10"
      role="tablist"
      aria-label={t("flight_view.stages_title")}
    >
      {phases.map((phase) => {
        const state = getState(phase);
        const isActive = state === "active";
        const isCompleted = state === "completed";

        return (
          <button
            key={phase}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPhaseChange(phase)}
            className={`flex flex-1 min-w-[62px] shrink-0 items-center justify-center whitespace-nowrap border px-2 py-1.5 text-center font-mono text-[9px] xl:text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              isActive
                ? "border-[#E600D2] bg-[#E600D2]/15 text-[#E600D2] shadow-[0_0_10px_rgba(230,0,210,0.25)]"
                : isCompleted
                  ? "border-[#45AFFF]/55 bg-[#002746]/70 text-[#45AFFF] hover:border-[#45AFFF]"
                  : "border-[#3B7EB2]/40 bg-[#001224]/60 text-white/45 hover:text-white/75 hover:border-[#45AFFF]/50"
            }`}
          >
            <AutoFitLabel>{getLabel(phase)}</AutoFitLabel>
          </button>
        );
      })}
    </div>
  );
}
