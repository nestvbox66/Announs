import React from "react";
import { VueloReciente } from "../types";
import { Plane, Navigation, Shield, Compass, MapPin } from "lucide-react";

interface RouteMapViewProps {
  flight: VueloReciente;
}

export default function RouteMapView({ flight }: RouteMapViewProps) {
  // Define coordinate map for airports
  const airportCoords: Record<string, { x: number; y: number; name: string }> = {
    SABE: { x: 320, y: 210, name: "Aeroparque Jorge Newbery" },
    SAEZ: { x: 305, y: 220, name: "Ezeiza Intl" },
    SACO: { x: 190, y: 180, name: "Córdoba Pajas Blancas" },
    SCEL: { x: 95, y: 195, name: "Santiago de Chile Pudahuel" },
    SBGR: { x: 505, y: 90, name: "São Paulo Guarulhos" },
    SBPA: { x: 425, y: 165, name: "Porto Alegre Salgado Filho" },
    SASA: { x: 160, y: 85, name: "Salta Martín Miguel de Güemes" }
  };

  const originCode = flight.origen.toUpperCase();
  const destCode = flight.destino.toUpperCase();

  const origin = airportCoords[originCode] || { x: 150, y: 180, name: flight.origenCiudad };
  const dest = airportCoords[destCode] || { x: 450, y: 120, name: flight.destinoCiudad };

  // Calculate midpoints for bezier curve control points
  const midX = (origin.x + dest.x) / 2;
  const midY = (origin.y + dest.y) / 2 - 35; // push up for nice flight arch

  // SVG parameters
  const svgWidth = 600;
  const svgHeight = 290;

  return (
    <div className="bg-[#001b33]/40 border border-[#3B7EB2]/25 rounded-[5px] p-5 space-y-4 animate-fadeIn" id="route-map-container">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <Navigation className="w-4 h-4 text-[#45AFFF]" />
          <h3 className="text-xs font-mono font-extrabold text-[#45AFFF] uppercase tracking-wider">
            Navegación Táctica e Historial de Ruta (RADAR TR-300)
          </h3>
        </div>
        <div className="text-[9px] font-mono text-white/50 bg-[#00172e] px-2 py-0.5 rounded border border-white/5 uppercase">
          MODO: REPORTE POST-VUELO
        </div>
      </div>

      <div className="relative border border-white/5 rounded overflow-hidden bg-[#011425]/90">
        
        {/* Background Coordinate grid markings */}
        <div className="absolute inset-0 grid grid-cols-6 grid-rows-4 pointer-events-none opacity-5">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="border-t border-l border-white font-mono text-[7px] p-1 select-none">
              {34 + (i % 6) * 4}°S {54 + Math.floor(i / 6) * 4}°W
            </div>
          ))}
        </div>

        {/* Side panel statistics integrated into the map frame */}
        <div className="absolute bottom-3 left-3 bg-[#012442]/85 border border-[#3B7EB2]/30 p-2.5 rounded font-mono text-[9px] text-white/90 space-y-1 shadow-md z-10 max-w-[170px]">
          <div className="text-[#45AFFF] font-bold border-b border-white/10 pb-1 mb-1 uppercase tracking-wider flex items-center gap-1">
            <Compass className="w-3 h-3 text-[#45AFFF]" /> Telemetría GPS
          </div>
          <div>ESTADO: <span className="text-[#43E600] font-bold">HISTORIAL COMPLETO</span></div>
          <div>DESVIACIÓN: <span className="text-[#43E600]">0.0% (LNAV)</span></div>
          <div>ALT. CRUCERO: <span className="text-[#45AFFF]">FL360</span></div>
          <div>VIENTO PROMEDIO: <span>A/T 14 KTS</span></div>
        </div>

        {/* SVG Drawing of the flight and territories */}
        <svg 
          viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
          className="w-full h-auto select-none opacity-90"
        >
          {/* Subtle outline representing South American Continent features */}
          <g className="stroke-white/5 stroke-[1.5] fill-none" strokeLinecap="round" strokeLinejoin="round">
            {/* Andes ridge decoration */}
            <path d="M 80 40 L 90 90 L 85 140 L 95 180 L 90 220 L 100 280" strokeDasharray="3,4" strokeWidth="1" />
            <path d="M 75 45 L 85 92 L 80 138 L 92 185 L 88 224 L 98 276" strokeDasharray="1,6" strokeWidth="1" />
            
            {/* Coastline visual simulation */}
            <path d="M 320 280 C 350 250, 390 210, 410 190 C 430 170, 460 175, 490 150 C 520 120, 560 110, 590 60" />
            <path d="M 320 280 L 290 280 M 300 230 C 270 230, 240 210, 200 210" />
          </g>

          {/* Radar circle markers highlighting origin & destination */}
          <g className="stroke-[#45AFFF]/25 fill-none stroke-[0.8]" strokeDasharray="2,2">
            <circle cx={origin.x} cy={origin.y} r="15" />
            <circle cx={origin.x} cy={origin.y} r="35" />
            <circle cx={dest.x} cy={dest.y} r="15" />
            <circle cx={dest.x} cy={dest.y} r="35" />
          </g>

          {/* Flight Path Arc */}
          {/* Neon shadow effect */}
          <path 
            d={`M ${origin.x} ${origin.y} Q ${midX} ${midY} ${dest.x} ${dest.y}`} 
            fill="none" 
            stroke="#45AFFF" 
            strokeWidth="3.5" 
            opacity="0.25" 
            strokeLinecap="round"
          />
          {/* Main solid path */}
          <path 
            d={`M ${origin.x} ${origin.y} Q ${midX} ${midY} ${dest.x} ${dest.y}`} 
            fill="none" 
            stroke="#45AFFF" 
            strokeDasharray="4,4"
            strokeWidth="1.5" 
            strokeLinecap="round"
          />

          {/* Origin Marker */}
          <g transform={`translate(${origin.x}, ${origin.y})`}>
            <circle cx="0" cy="0" r="5" fill="#43E600" className="animate-pulse" />
            <circle cx="0" cy="0" r="8" fill="none" stroke="#43E600" strokeWidth="1" opacity="0.6" />
            <text x="10" y="-8" fill="white" className="font-mono font-bold text-[10px] drop-shadow-md">{originCode}</text>
            <text x="10" y="3" fill="white/65" className="font-sans text-[8px] max-w-[80px] drop-shadow-sm">{flight.origenCiudad.split("(")[0].trim()}</text>
          </g>

          {/* Destination Marker */}
          <g transform={`translate(${dest.x}, ${dest.y})`}>
            <circle cx="0" cy="0" r="5" fill="#EF4444" />
            <circle cx="0" cy="0" r="8" fill="none" stroke="#EF4444" strokeWidth="1" opacity="0.6" />
            <text x="10" y="-8" fill="white" className="font-mono font-bold text-[10px] drop-shadow-md">{destCode}</text>
            <text x="10" y="3" fill="white/65" className="font-sans text-[8px] max-w-[80px] drop-shadow-sm">{flight.destinoCiudad.split("(")[0].trim()}</text>
          </g>

          {/* Animated or placed airplane icon moving along path */}
          {/* Placed around 65% of route to show it in flight report context */}
          {(() => {
            // Bezier parametric equation for Q bezier curve
            const t = 0.65; // position
            const planeX = (1-t)*(1-t)*origin.x + 2*(1-t)*t*midX + t*t*dest.x;
            const planeY = (1-t)*(1-t)*origin.y + 2*(1-t)*t*midY + t*t*dest.y;

            // Simple tangent angle calculation for plane heading
            const t1 = 0.64;
            const t2 = 0.66;
            const p1x = (1-t1)*(1-t1)*origin.x + 2*(1-t1)*t1*midX + t1*t1*dest.x;
            const p1y = (1-t1)*(1-t1)*origin.y + 2*(1-t1)*t1*midY + t1*t1*dest.y;
            const p2x = (1-t2)*(1-t2)*origin.x + 2*(1-t2)*t2*midX + t2*t2*dest.x;
            const p2y = (1-t2)*(1-t2)*origin.y + 2*(1-t2)*t2*midY + t2*t2*dest.y;
            
            const dx = p2x - p1x;
            const dy = p2y - p1y;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90; // Add 90 because Plane icon is upward pointing originally

            return (
              <g transform={`translate(${planeX}, ${planeY}) rotate(${angle})`}>
                <rect x="-8" y="-8" width="16" height="16" fill="none" />
                {/* Visual airplane design */}
                <path 
                  d="M0,-8 L2,-3 L8,1 L2,1 L1,6 L4,8 L0,7 L-4,8 L-1,6 L-8,1 L-2,1 L-2,-3 Z" 
                  fill="#45AFFF" 
                  stroke="white" 
                  strokeWidth="0.8" 
                />
              </g>
            );
          })()}
        </svg>

        {/* Live radar overlay style sweep effect */}
        <div className="absolute top-0 right-0 w-full h-full pointer-events-none opacity-[0.03] bg-gradient-to-r from-transparent via-[#45AFFF] to-transparent animate-radarSweep"></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-white/90">
        <div className="bg-[#00172e]/55 border border-white/5 rounded p-3 text-left">
          <span className="text-[9px] text-[#45AFFF] font-mono block">DEPARTURE WEATHER</span>
          <span className="font-mono text-xs font-bold text-white uppercase mt-0.5 block">VFR • CAVOK</span>
          <span className="text-[10px] text-white/40 font-mono">Viento: 120/06KT | QNH: 1014hPa</span>
        </div>
        <div className="bg-[#00172e]/55 border border-white/5 rounded p-3 text-left">
          <span className="text-[9px] text-[#45AFFF] font-mono block">ARRIVAL WEATHER</span>
          <span className="font-mono text-xs font-bold text-white uppercase mt-0.5 block">IFR • RAIN SHWR</span>
          <span className="text-[10px] text-white/40 font-mono">Viento: 260/15KT | QNH: 1008hPa</span>
        </div>
        <div className="bg-[#00172e]/55 border border-white/5 rounded p-3 text-left">
          <span className="text-[9px] text-[#45AFFF] font-mono block">EVALUACIÓN DE CRUCERO</span>
          <span className="font-mono text-xs font-bold text-[#43E600] uppercase mt-0.5 block">Sólida • Turb. Leve</span>
          <span className="text-[10px] text-white/40 font-mono">Consumo total: 4,450 KGS de Jet-A1</span>
        </div>
      </div>
    </div>
  );
}
