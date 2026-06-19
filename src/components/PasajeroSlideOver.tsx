import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Smile,
  Frown,
  Utensils,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertTriangle
} from "lucide-react";
import { Pasajero, SimBriefData } from "../types";
import SystemStatusFooter from "./SystemStatusFooter";

interface PasajeroSlideOverProps {
  pasajero: Pasajero | null;
  onClose: () => void;
  flightCode: string;
  passengerList: Pasajero[];
  onNavigate: (pasajero: Pasajero) => void;
  simBriefData: SimBriefData;
  airlineName?: string;
}

function getIndicatorLabel(value: number, type: "satisfaction" | "hunger" | "fear", t: (key: string) => string): string {
  if (type === "satisfaction") {
    if (value >= 81) return t("passenger_details.indicator.satisfaction.very_satisfied");
    if (value >= 61) return t("passenger_details.indicator.satisfaction.satisfied");
    if (value >= 31) return t("passenger_details.indicator.satisfaction.neutral");
    if (value >= 1) return t("passenger_details.indicator.satisfaction.dissatisfied");
    return t("passenger_details.indicator.satisfaction.very_dissatisfied");
  }
  if (type === "hunger") {
    if (value >= 75) return t("passenger_details.indicator.hunger.very_hungry");
    if (value >= 40) return t("passenger_details.indicator.hunger.hungry");
    if (value >= 15) return t("passenger_details.indicator.hunger.moderate");
    return t("passenger_details.indicator.hunger.full");
  }
  if (value >= 70) return t("passenger_details.indicator.fear.panicked");
  if (value >= 40) return t("passenger_details.indicator.fear.afraid");
  if (value >= 15) return t("passenger_details.indicator.fear.anxious");
  return t("passenger_details.indicator.fear.calm");
}

function getClassTranslation(clase: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    "Primera": t("passenger_details.status.first"),
    "Ejecutiva": t("passenger_details.status.business"),
    "Económica": t("passenger_details.status.economy"),
  };
  return map[clase] || clase;
}

function getGenderTranslation(g: string, t: (key: string) => string): string {
  if (g === "M") return t("passenger_details.status.male");
  if (g === "F") return t("passenger_details.status.female");
  return t("passenger_details.status.male");
}

export default function PasajeroSlideOver({
  pasajero,
  onClose,
  flightCode,
  passengerList,
  onNavigate,
  simBriefData,
  airlineName = "ANNOUNS AIRLINES",
}: PasajeroSlideOverProps) {
  const { t } = useTranslation();

  const currentIndex = useMemo(() => {
    if (!pasajero) return -1;
    return passengerList.findIndex((p) => p.id === pasajero.id);
  }, [pasajero, passengerList]);

  if (!pasajero) return null;

  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= passengerList.length - 1;

  const handlePrevious = () => {
    if (!isFirst && currentIndex > 0) {
      onNavigate(passengerList[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (!isLast && currentIndex < passengerList.length - 1) {
      onNavigate(passengerList[currentIndex + 1]);
    }
  };

  const satisfactionColor = pasajero.satisfaccion >= 70
    ? "text-[#43E600]"
    : pasajero.satisfaccion >= 45
      ? "text-[#E68B00]"
      : "text-[#E600D2]";

  const fearColor = pasajero.miedo >= 70
    ? "text-[#E600D2]"
    : pasajero.miedo >= 35
      ? "text-[#E68B00]"
      : "text-[#43E600]";

  const classStyles: Record<string, { container: string; badge: string }> = {
    Primera: {
      container: "border-amber-400/70 bg-amber-900/15",
      badge: "bg-amber-500 text-black",
    },
    Ejecutiva: {
      container: "border-slate-400/70 bg-slate-800/20",
      badge: "bg-slate-500 text-white",
    },
    Económica: {
      container: "border-gray-400/70 bg-gray-800/20",
      badge: "bg-gray-500 text-white",
    },
  };
  const bpStyle = classStyles[pasajero.clase] || classStyles.Económica;

  return (
    <div
      id="pasajero-slideover-overlay"
      className="fixed inset-0 bg-black/60 z-50 flex justify-end animate-fadeIn"
    >
      <div className="flex-1" onClick={onClose} />

      <div
        id="pasajero-slideover-panel"
        className={`w-[450px] bg-[#001f37] border-l h-full shadow-2xl flex flex-col overflow-y-auto ${
          pasajero.alert ? "border-red-500/70" : "border-[#3B7EB2]"
        }`}
      >
        {/* Alert banner */}
        {pasajero.alert && (
          <div className="flex items-center gap-2 px-5 py-2 bg-red-500/15 border-b border-red-500/30">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-[11px] font-mono text-red-300 font-semibold tracking-wide">
              {t("passenger_details.alert_banner")}
            </span>
          </div>
        )}

        {/* Navigation header */}
        <div className="px-5 pt-5 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              id="btn-prev-passenger"
              onClick={handlePrevious}
              disabled={isFirst}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                isFirst
                  ? "text-white/20 bg-white/5 cursor-not-allowed"
                  : "text-white bg-[#2C6591]/60 hover:bg-[#2C6591] border border-white/10 hover:border-white/30"
              }`}
            >
              <ChevronLeft className="w-3 h-3" />
              {t("passenger_details.previous")}
            </button>
            <button
              id="btn-next-passenger"
              onClick={handleNext}
              disabled={isLast}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                isLast
                  ? "text-white/20 bg-white/5 cursor-not-allowed"
                  : "text-white bg-[#2C6591]/60 hover:bg-[#2C6591] border border-white/10 hover:border-white/30"
              }`}
            >
              {t("passenger_details.next")}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <span className="text-[10px] font-mono text-white/40">
            {t("passenger_details.passenger_index", {
              current: currentIndex + 1,
              total: passengerList.length,
            })}
          </span>
        </div>

        {/* Header */}
        <div className="p-5 border-b border-[#3B7EB2]/50 flex items-center justify-between bg-[#2C6591]/30">
          <div>
            <span className="text-[10px] font-mono text-[#45AFFF] tracking-wider uppercase block">
              {t("passenger_details.title")}
            </span>
            <h2 className="text-xl font-display font-extrabold text-white">
              {pasajero.nombre}
            </h2>
          </div>
          <button
            id="btn-close-slideover"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-white/20 hover:border-white/60 bg-[#2C6591] text-white flex items-center justify-center hover:scale-105 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body content */}
        <div id="slideover-body-content" className="p-5 flex-1 space-y-6">

          {/* Boarding Pass */}
          <div
            id="simulated-boarding-pass"
            className={`rounded-[7px] border-2 border-dashed p-4 text-white relative overflow-hidden ${bpStyle.container}`}
          >
            <div className="absolute right-[-15px] top-[-10px] text-7xl opacity-5 select-none font-sans font-black">
              PASS
            </div>

            <div className="flex justify-between items-center text-[10px] font-mono border-b border-white/20 pb-2 mb-3">
              <span className="font-extrabold text-[#45AFFF]">{airlineName}</span>
              <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] ${bpStyle.badge}`}>
                {getClassTranslation(pasajero.clase, t)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-xs mb-3">
              <div>
                <span className="text-[9px] text-white/60 block uppercase">
                  {t("passenger_details.boarding_pass.passenger_label")}
                </span>
                <strong className="text-white truncate block">{pasajero.nombre}</strong>
              </div>
              <div>
                <span className="text-[9px] text-white/60 block uppercase">
                  {t("passenger_details.boarding_pass.flight_label")}
                </span>
                <strong className="text-white block">{flightCode}</strong>
              </div>
              <div>
                <span className="text-[9px] text-white/60 block uppercase">
                  {t("passenger_details.boarding_pass.seat_label")}
                </span>
                <strong className="text-[#43E600] font-extrabold text-sm block">{pasajero.asiento}</strong>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-xs border-t border-dashed border-white/30 pt-3">
              <div>
                <span className="text-[9px] text-white/60 block uppercase">
                  {t("passenger_details.boarding_pass.age_gender_label")}
                </span>
                <strong className="text-white block">{pasajero.edad} {t("passenger_details.boarding_pass.years")} / {getGenderTranslation(pasajero.genero, t)}</strong>
              </div>
              <div>
                <span className="text-[9px] text-white/60 block uppercase">
                  {t("passenger_details.boarding_pass.nationality_label")}
                </span>
                <strong className="text-[#45AFFF] block uppercase">{pasajero.nacionalidad} ({pasajero.nacionalidadCodigo})</strong>
              </div>
            </div>

            {/* Barcode */}
            <div className="mt-4 pt-3 border-t border-white/20 flex flex-col items-center">
              <div
                className="w-full bg-[#00345C]/40 border border-white/10 rounded h-10 tracking-[0.25em] text-[10px] text-white/80 font-mono flex items-center justify-center select-none"
                style={{ fontFamily: "'Courier New', monospace" }}
              >
                ||| | |||| | ||| | ||| |||| | || || | ||| {pasajero.id}
              </div>

              {/* SystemStatusFooter replaces the old hardcoded text */}
              <div className="w-full mt-1.5">
                <SystemStatusFooter simBriefData={simBriefData} passengerId={pasajero.id} />
              </div>
            </div>

            <div className="absolute left-[-8.5px] top-[48%] w-[17px] h-[17px] bg-[#001f37] rounded-full" />
            <div className="absolute right-[-8.5px] top-[48%] w-[17px] h-[17px] bg-[#001f37] rounded-full" />
          </div>

          {/* Needs Block */}
          <div id="passenger-needs-block" className="space-y-4">
            <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1 flex items-center gap-1">
              <Sparkles className="w-4 h-4" /> {t("passenger_details.needs.title")}
            </h3>

            <div className="grid grid-cols-2 gap-4">
              {/* Satisfaction */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <Smile className="w-3.5 h-3.5 text-[#43E600]" />
                    {t("passenger_details.needs.satisfaction")}
                  </span>
                  <span className={`font-bold ${satisfactionColor}`}>{pasajero.satisfaccion}%</span>
                </div>
                <div className="w-full bg-black/35 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#43E600] rounded-full transition-all duration-300"
                    style={{ width: `${pasajero.satisfaccion}%` }}
                  />
                </div>
                <span className="text-[9.5px] text-white/70 font-mono mt-1.5 block">
                  {getIndicatorLabel(pasajero.satisfaccion, "satisfaction", t)}
                </span>
              </div>

              {/* Fear */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <Frown className="w-3.5 h-3.5 text-[#E600D2]" />
                    {t("passenger_details.needs.fear")}
                  </span>
                  <span className={`font-bold ${fearColor}`}>{pasajero.miedo}%</span>
                </div>
                <div className="w-full bg-black/35 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E600D2] rounded-full transition-all duration-300"
                    style={{ width: `${pasajero.miedo}%` }}
                  />
                </div>
                <span className="text-[9.5px] text-white/70 font-mono mt-1.5 block">
                  {getIndicatorLabel(pasajero.miedo, "fear", t)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Hunger */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <Utensils className="w-3.5 h-3.5 text-[#E68B00]" />
                    {t("passenger_details.needs.hunger")}
                  </span>
                  <span className="font-bold text-[#E68B00]">{pasajero.hambre}%</span>
                </div>
                <div className="w-full bg-black/35 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E68B00] rounded-full transition-all duration-300"
                    style={{ width: `${pasajero.hambre}%` }}
                  />
                </div>
                <span className="text-[9.5px] text-white/70 font-mono mt-1.5 block">
                  {getIndicatorLabel(pasajero.hambre, "hunger", t)}
                </span>
              </div>

              {/* Bathroom */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <span className="text-sm">🚻</span>
                    {t("passenger_details.needs.bathroom")}
                  </span>
                  <span className="font-bold text-[#E600D2]">{pasajero.bano}%</span>
                </div>
                <div className="w-full bg-black/35 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E600D2] rounded-full transition-all duration-300"
                    style={{ width: `${pasajero.bano}%` }}
                  />
                </div>
                <span className="text-[9.5px] text-white/70 font-mono mt-1.5 block">
                  {pasajero.bano >= 75 ? "🚨 " + t("passenger_details.indicator.bathroom.urgent") : pasajero.bano >= 40 ? t("passenger_details.indicator.bathroom.moderate") : t("passenger_details.indicator.bathroom.calm")}
                </span>
              </div>
            </div>
          </div>

          {/* Incidents */}
          <div id="incidents-timeline-block" className="space-y-3">
            <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1">
              {t("passenger_details.incidents.title")}
            </h3>

            {pasajero.incidencias.length === 0 ? (
              <div className="text-center py-6 bg-black/15 border border-[#3B7EB2]/20 rounded text-xs text-white/50 italic font-mono">
                {t("passenger_details.incidents.empty")}
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
                {pasajero.incidencias.map((inc, index) => {
                  let alertSign = "📋";
                  if (inc.tipo === "turbulencia") alertSign = "⛈️";
                  if (inc.tipo === "miedo") alertSign = "😰";
                  if (inc.tipo === "servicio") alertSign = "☕";
                  if (inc.tipo === "satisfaccion") alertSign = "💖";

                  return (
                    <div
                      key={inc.id || index}
                      className="bg-[#2C6591] border border-white/40 rounded-[5px] p-2.5 font-mono"
                    >
                      <div className="flex justify-between items-center text-[10px] text-white/60 mb-1 border-b border-white/10 pb-1">
                        <span>
                          {t("passenger_details.incidents.phase_label")} <strong className="text-white">{inc.tiempo}</strong>
                        </span>
                        <span className="text-[#45AFFF] uppercase font-bold">
                          {t("passenger_details.incidents.type_label")}: {inc.tipo}
                        </span>
                      </div>
                      <div className="font-bold text-white flex items-center gap-1 mb-0.5">
                        <span>{alertSign}</span>
                        <span>{inc.titulo}</span>
                      </div>
                      <p className="text-[10px] text-white/80 leading-relaxed">
                        {inc.descripcion}
                      </p>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] border-t border-white/5 pt-1.5 font-bold">
                        <span className={inc.impactoSatisfaccion > 0 ? "text-[#43E600]" : inc.impactoSatisfaccion < 0 ? "text-[#E600D2]" : "text-white/40"}>
                          😊 Sat: {inc.impactoSatisfaccion > 0 ? `+${inc.impactoSatisfaccion}` : inc.impactoSatisfaccion}%
                        </span>
                        <span className={inc.impactoMiedo > 0 ? "text-[#E600D2]" : inc.impactoMiedo < 0 ? "text-[#43E600]" : "text-white/40"}>
                          😰 Miedo: {inc.impactoMiedo > 0 ? `+${inc.impactoMiedo}` : inc.impactoMiedo}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
