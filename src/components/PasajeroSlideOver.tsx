/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { 
  X, 
  Smile, 
  Frown, 
  AlertTriangle, 
  Utensils, 
  HelpCircle,
  Award,
  Calendar,
  Sparkles,
  Tag
} from "lucide-react";
import { Pasajero, Incidencia } from "../types";

interface PasajeroSlideOverProps {
  pasajero: Pasajero | null;
  onClose: () => void;
  flightCode: string;
}

export default function PasajeroSlideOver({
  pasajero,
  onClose,
  flightCode
}: PasajeroSlideOverProps) {
  if (!pasajero) return null;

  // Render gender indicator
  const getGenderLabel = (g: string) => {
    if (g === "M") return "Masculino";
    if (g === "F") return "Femenino";
    return "Otro";
  };

  // Determine emotional status colors
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

  return (
    <div 
      id="pasajero-slideover-overlay"
      className="fixed inset-0 bg-black/60 z-50 flex justify-end animate-fadeIn"
    >
      {/* Background click listener */}
      <div className="flex-1" onClick={onClose} />

      {/* Main Slide Panel */}
      <div 
        id="pasajero-slideover-panel"
        className="w-[450px] bg-[#001f37] border-l border-[#3B7EB2] h-full shadow-2xl flex flex-col justify-between overflow-y-auto"
      >
        {/* Header container */}
        <div className="p-5 border-b border-[#3B7EB2]/50 flex items-center justify-between bg-[#2C6591]/30">
          <div>
            <span className="text-[10px] font-mono text-[#45AFFF] tracking-wider uppercase block">
              DETALLES DEL PASAJERO
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

        {/* Core content body */}
        <div id="slideover-body-content" className="p-5 flex-1 space-y-6">
          
          {/* ================= SIMULATED BOARDING PASS (TARJETA DE EMBARQUE) ================= */}
          <div 
            id="simulated-boarding-pass" 
            className="bg-[#2C6591] rounded-[7px] border-2 border-dashed border-white/60 p-4 text-white relative overflow-hidden"
          >
            {/* Watermark Logo backdrop */}
            <div className="absolute right-[-15px] top-[-10px] text-7xl opacity-5 select-none font-sans font-black">
              PASS
            </div>

            <div className="flex justify-between items-center text-[10px] font-mono border-b border-white/20 pb-2 mb-3">
              <span className="font-extrabold text-[#45AFFF]">ANNOUNS AIRLINES</span>
              <span className="bg-[#43E600] text-black px-1.5 py-0.2 rounded font-bold uppercase">
                {pasajero.clase}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-xs mb-3">
              <div>
                <span className="text-[9px] text-white/60 block uppercase">PASAJERO:</span>
                <strong className="text-white truncate block">{pasajero.nombre}</strong>
              </div>
              <div>
                <span className="text-[9px] text-white/60 block uppercase">VUELO:</span>
                <strong className="text-white block">{flightCode}</strong>
              </div>
              <div>
                <span className="text-[9px] text-white/60 block uppercase">ASIENTO:</span>
                <strong className="text-[#43E600] font-extrabold text-sm block">{pasajero.asiento}</strong>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-xs border-t border-dashed border-white/30 pt-3">
              <div>
                <span className="text-[9px] text-white/60 block uppercase">EDAD / COMPAÑÍA:</span>
                <strong className="text-white block">{pasajero.edad} años / {getGenderLabel(pasajero.genero)}</strong>
              </div>
              <div>
                <span className="text-[9px] text-white/60 block uppercase">NACIONALIDAD:</span>
                <strong className="text-[#45AFFF] block uppercase">{pasajero.nacionalidad} ({pasajero.nacionalidadCodigo})</strong>
              </div>
            </div>

            {/* Custom Barcode look-alike lines */}
            <div className="mt-4 pt-3 border-t border-white/20 flex flex-col items-center">
              <div 
                className="w-full bg-[#00345C]/40 border border-white/10 rounded h-10 tracking-[0.25em] text-[10px] text-white/80 font-mono flex items-center justify-center select-none"
                style={{ fontFamily: "'Courier New', monospace" }}
              >
                ||| | |||| | ||| | ||| |||| | || || | ||| {pasajero.id}
              </div>
              <span className="text-[9px] text-white/50 mt-1 font-mono uppercase">
                SABES-SACOS DETECT CHECK-IN DISP
              </span>
            </div>

            {/* Simulated pass cut corners */}
            <div className="absolute left-[-8.5px] top-[48%] w-[17px] h-[17px] bg-[#001f37] rounded-full" />
            <div className="absolute right-[-8.5px] top-[48%] w-[17px] h-[17px] bg-[#001f37] rounded-full" />
          </div>

          {/* ================= BIOLOGICAL & EMOTIONAL METERS ================= */}
          <div id="passenger-needs-block" className="space-y-4">
            <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1 flex items-center gap-1">
              <Sparkles className="w-4 h-4" /> REQUERIMIENTOS Y SENSACIÓN BIOLÓGICA
            </h3>

            {/* Fila 1: Satisfacción & Miedo */}
            <div className="grid grid-cols-2 gap-4">
              
              {/* Satisfaction Meter */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <Smile className="w-3.5 h-3.5 text-[#43E600]" />
                    SATISFACCIÓN:
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
                  {pasajero.satisfaccion >= 70 ? "Muy contento" : pasajero.satisfaccion >= 45 ? "Aceptable" : "Disconforme"}
                </span>
              </div>

              {/* Fear Meter */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <Frown className="w-3.5 h-3.5 text-[#E600D2]" />
                    MIEDO / FOBIA:
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
                  {pasajero.miedo >= 70 ? "⚠️ Pánico / Fobia extrema" : pasajero.miedo >= 35 ? "Ansioso" : "Muy calmo"}
                </span>
              </div>

            </div>

            {/* Fila 2: Apetito & Baño */}
            <div className="grid grid-cols-2 gap-4">
              
              {/* Hunger Meter */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    <Utensils className="w-3.5 h-3.5 text-[#E68B00]" />
                    APETITO / HAMBRE:
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
                  {pasajero.hambre >= 75 ? "⚠️ ¡Pide refrigerio!" : pasajero.hambre >= 40 ? "Satisfecho" : "Sin hambre"}
                </span>
              </div>

              {/* Bathroom Meter */}
              <div className="bg-[#2C6591] border border-white/70 p-3 rounded-[7px]">
                <div className="flex justify-between items-center text-xs font-mono mb-2">
                  <span className="flex items-center gap-1 text-white">
                    🚻
                    BAÑO:
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
                  {pasajero.bano >= 75 ? "🚨 Baño urgente" : pasajero.bano >= 40 ? "Ganas de orinar" : "Calmo"}
                </span>
              </div>

            </div>
          </div>

          {/* ================= INCIDENT TIMELINE TABLE ================= */}
          <div id="incidents-timeline-block" className="space-y-3">
            <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1">
              📜 HISTORIAL DE INCIDENCIAS EN VUELO
            </h3>

            {pasajero.incidencias.length === 0 ? (
              <div className="text-center py-6 bg-black/15 border border-[#3B7EB2]/20 rounded text-xs text-white/50 italic font-mono">
                Pasajero calmo. Ninguna incidencia transcurrida.
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
                        <span>Fase: <strong className="text-white">{inc.tiempo}</strong></span>
                        <span className="text-[#45AFFF] uppercase font-bold">{inc.tipo}</span>
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

        {/* Footer Area */}
        <div className="p-5 border-t border-[#3B7EB2]/50 bg-black/20 text-center font-mono text-[10px] text-white/40">
          IDENTIFICADOR CLAVE: {pasajero.id}
        </div>

      </div>
    </div>
  );
}
