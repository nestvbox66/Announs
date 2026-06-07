import React, { useState } from "react";
import { VueloReciente } from "../types";
import { Activity, ShieldAlert, Award, Compass, Timer, Navigation } from "lucide-react";

interface TelemetryViewProps {
  flight: VueloReciente;
}

export default function TelemetryView({ flight }: TelemetryViewProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredGIndex, setHoveredGIndex] = useState<number | null>(null);

  // Generate deterministic telemetry data based on current flight parameters
  const getTelemetryData = () => {
    const isAndes = (flight.origen === "SAEZ" && flight.destino === "SCEL") || (flight.origen === "SCEL" && flight.destino === "SAEZ");
    const cruiseAlt = isAndes ? 34000 : 36000;
    const dataPoints = 25;
    const data = [];

    for (let i = 0; i <= dataPoints; i++) {
      const progress = i / dataPoints; // 0 to 1
      let altitude = 0;
      let speed = 0;
      let terrain = 150 + Math.sin(progress * Math.PI * 4) * 80;

      // Special terrain mapping for spectacular immersion
      if (isAndes) {
        // SAEZ-SCEL Andes Mountains spike in the middle of cruise flight
        if (progress > 0.4 && progress < 0.8) {
          const mountainProgress = (progress - 0.4) / 0.4; // 0 to 1
          terrain = 1500 + Math.sin(mountainProgress * Math.PI) * 14500 + Math.cos(progress * 50) * 800;
        } else {
          terrain = 200 + Math.sin(progress * 5) * 100;
        }
      } else {
        // Normal flat plains or minor hills
        terrain = 80 + Math.sin(progress * Math.PI * 2) * 200 + (Math.cos(progress * 40) * 40);
        if (terrain < 0) terrain = 20;
      }

      // Altitude Profile
      if (progress < 0.3) {
        // Climb phase (0% - 30%)
        const climbProgress = progress / 0.3;
        // smooth ease out curve
        altitude = Math.round(cruiseAlt * Math.sin(climbProgress * Math.PI / 2));
      } else if (progress < 0.75) {
        // Cruise (30% - 75%)
        altitude = cruiseAlt + Math.round(Math.sin(progress * 30) * 120); // minor cruise corrections
      } else {
        // Descent phase (75% - 100%)
        const descentProgress = (1 - progress) / 0.25;
        altitude = Math.round(cruiseAlt * Math.pow(descentProgress, 1.5));
      }

      // Speed profile in KTS
      if (progress < 0.1) {
        // Ramp up from takeoff
        speed = Math.round(140 + (progress / 0.1) * 140);
      } else if (progress < 0.3) {
        // Climb speed
        speed = Math.round(280 + ((progress - 0.1) / 0.2) * 120);
      } else if (progress < 0.75) {
        // Cruise Speed in Knots (Mach 0.78 is ~450-470 TAS)
        speed = Math.round(445 + Math.sin(progress * 15) * 5);
      } else if (progress < 0.95) {
        // Decelerating
        const descSpeedProgress = (progress - 0.75) / 0.20;
        speed = Math.round(445 - descSpeedProgress * 260);
      } else {
        // Final approach and touchdown
        const touchProgress = (progress - 0.95) / 0.05;
        speed = Math.round(185 - touchProgress * 45); // touches at ~140 KTS
      }

      // Check boundaries
      if (altitude < 0) altitude = 0;
      if (speed < 0) speed = 0;
      if (terrain < 0) terrain = 0;
      // Terrain can't exceed plane altitude (safety)
      if (terrain >= altitude && i > 0 && i < dataPoints) {
        terrain = altitude - 300;
      }

      // Time stamp calculation
      const totalMinutes = flight.duracion.includes("h") 
        ? parseInt(flight.duracion.split("h")[0]) * 60 + parseInt(flight.duracion.split("h")[1].replace("m", "").trim())
        : 60;
      const currentMin = Math.round(progress * totalMinutes);
      const hours = Math.floor(currentMin / 60);
      const mins = currentMin % 60;
      const timeStr = `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;

      data.push({
        time: timeStr,
        altitude,
        speed,
        terrain: Math.round(terrain),
      });
    }
    return data;
  };

  // Generate high resolution touchdown crash/landing damper profile G-Force vs Time
  const getGForceProfile = () => {
    const isHard = Math.abs(flight.fpmLanding) >= 200;
    const isSuave = Math.abs(flight.fpmLanding) <= 100;
    const peakG = isHard 
      ? 1.95 + (Math.abs(flight.fpmLanding) - 200) * 0.005 
      : isSuave 
        ? 1.08 + (Math.abs(flight.fpmLanding) / 100) * 0.12
        : 1.28 + (Math.abs(flight.fpmLanding) - 100) * 0.004;

    const dataPoints = 30;
    const data = [];
    
    for (let i = 0; i < dataPoints; i++) {
      const centiseconds = (i - 5) * 4; // -20cs to +100cs
      let gForce = 1.0; // normal cruise level flight Gs

      if (centiseconds < 0) {
        // Level flight approach just before touchdown
        gForce = 1.0 + Math.sin(i) * 0.015;
      } else if (centiseconds === 0) {
        // Dynamic impact compression!
        gForce = peakG;
      } else if (centiseconds < 24) {
        // Pivot spring attenuation rebound
        const step = centiseconds / 24;
        const baseG = 1.0 + (peakG - 1.0) * Math.exp(-step * 3);
        const oscillation = Math.cos(step * Math.PI * 3.5) * (peakG - 1.0) * 0.45 * Math.exp(-step * 2);
        gForce = baseG + oscillation;
      } else {
        // Rollout stabilization
        const step = (centiseconds - 24) / 76;
        gForce = 1.0 + Math.sin(centiseconds) * 0.01 * (1 - step);
      }

      data.push({
        time: `${centiseconds >= 0 ? "+" : ""}${centiseconds}cs`,
        g: parseFloat(gForce.toFixed(3)),
      });
    }
    return data;
  };

  const telemetryData = getTelemetryData();
  const rawGData = getGForceProfile();

  // Width & height of vector graphics
  const chartWidth = 560;
  const chartHeight = 220;
  const paddingLeft = 45;
  const paddingRight = 45;
  const paddingTop = 20;
  const paddingBottom = 30;

  const contentWidth = chartWidth - paddingLeft - paddingRight;
  const contentHeight = chartHeight - paddingTop - paddingBottom;

  // Maximum scales for coordinate conversion
  const maxAltitude = 40000;
  const maxSpeed = 500;
  const maxG = 2.5;

  // Convert telemetry point to X and Y SVG coordinates
  const getX = (index: number, total: number) => {
    return paddingLeft + (index / total) * contentWidth;
  };

  const getAltitudeY = (alt: number) => {
    return chartHeight - paddingBottom - (alt / maxAltitude) * contentHeight;
  };

  const getSpeedY = (spd: number) => {
    return chartHeight - paddingBottom - (spd / maxSpeed) * contentHeight;
  };

  const getGY = (g: number) => {
    // scale from 0 to 2.5G
    return chartHeight - paddingBottom - (g / maxG) * contentHeight;
  };

  // SVG Paths
  const altPath = telemetryData.map((d, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx, telemetryData.length - 1)} ${getAltitudeY(d.altitude)}`).join(" ");
  const spdPath = telemetryData.map((d, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx, telemetryData.length - 1)} ${getSpeedY(d.speed)}`).join(" ");
  const terrainPath = telemetryData.map((d, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx, telemetryData.length - 1)} ${getAltitudeY(d.terrain)}`).join(" ");
  
  // Filled path for terrain representation
  const terrainAreaPath = [
    `M ${getX(0, telemetryData.length - 1)} ${chartHeight - paddingBottom}`,
    ...telemetryData.map((d, idx) => `L ${getX(idx, telemetryData.length - 1)} ${getAltitudeY(d.terrain)}`),
    `L ${getX(telemetryData.length - 1, telemetryData.length - 1)} ${chartHeight - paddingBottom}`,
    "Z"
  ].join(" ");

  // G Force path
  const gPath = rawGData.map((d, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx, rawGData.length - 1)} ${getGY(d.g)}`).join(" ");
  const gAreaPath = [
    `M ${getX(0, rawGData.length - 1)} ${chartHeight - paddingBottom}`,
    ...rawGData.map((d, idx) => `L ${getX(idx, rawGData.length - 1)} ${getGY(d.g)}`),
    `L ${getX(rawGData.length - 1, rawGData.length - 1)} ${chartHeight - paddingBottom}`,
    "Z"
  ].join(" ");

  return (
    <div className="space-y-6 animate-fadeIn" id="telemetry-view-dashboard">
      
      {/* Grid structure for side by side blocks */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Dynamic Timeline altitude / speed */}
        <div className="bg-[#001b33]/40 border border-[#3B7EB2]/25 rounded-[5px] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-[#45AFFF] rounded-full animate-pulse"></div>
              <h3 className="text-xs font-mono font-extrabold text-[#45AFFF] uppercase tracking-wider">
                Perfil de Vuelo y Terreno Cruzado
              </h3>
            </div>
            <div className="flex items-center gap-4 text-[9px] font-mono text-white/50">
              <span className="flex items-center gap-1">
                <span className="w-2 h-1 bg-[#43E600] inline-block"></span> ALTITUD
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-1 bg-[#00E1D9] inline-block"></span> VELOCIDAD
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-1 bg-amber-600/60 inline-block"></span> ALT. TERRENO
              </span>
            </div>
          </div>

          <div className="relative">
            {/* Legend or values under cursor if hovered */}
            <div className="absolute top-1 left-12 bg-[#022442] border border-white/10 px-2 py-1 rounded text-[9px] font-mono flex gap-3 text-white">
              {hoveredIndex === null ? (
                <>
                  <span>Altitude Máx: <strong className="text-[#43E600]">36,000 FT</strong></span>
                  <span>Velocidad crucero: <strong className="text-[#00E1D9]">445 KTS</strong></span>
                </>
              ) : (
                <>
                  <span className="text-white/50">Tiempo: <strong className="text-white">{telemetryData[hoveredIndex].time}</strong></span>
                  <span>Alt: <strong className="text-[#43E600]">{telemetryData[hoveredIndex].altitude.toLocaleString()} FT</strong></span>
                  <span>Vel: <strong className="text-[#00E1D9]">{telemetryData[hoveredIndex].speed} KTS</strong></span>
                  <span>Terr: <strong className="text-amber-500">{telemetryData[hoveredIndex].terrain.toLocaleString()} FT</strong></span>
                </>
              )}
            </div>

            {/* Render chart of profile */}
            <div className="w-full h-fit flex justify-center mt-6">
              <svg 
                viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
                className="w-full max-w-[620px] select-none text-slate-300 font-mono text-[9px]"
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Horizontal reference lines */}
                {[0, 10000, 20000, 30000, 40000].map((val) => {
                  const y = getAltitudeY(val);
                  return (
                    <g key={val} className="opacity-15">
                      <line x1={paddingLeft} y1={y} x2={chartWidth - paddingRight} y2={y} stroke="white" strokeWidth="1" strokeDasharray="3,3" />
                      <text x={paddingLeft - 5} y={y + 3} textAnchor="end" fill="white">{val / 1000}k</text>
                    </g>
                  );
                })}

                {/* Right side axis: speed reference values */}
                {[100, 200, 300, 400, 500].map((val) => {
                  const y = getSpeedY(val);
                  return (
                    <g key={val} className="opacity-15">
                      <text x={chartWidth - paddingRight + 5} y={y + 3} textAnchor="start" fill="#00E1D9">{val}</text>
                    </g>
                  );
                })}

                {/* Vertical time grids */}
                {telemetryData.map((d, idx) => {
                  if (idx % 6 === 0) {
                    const x = getX(idx, telemetryData.length - 1);
                    return (
                      <g key={idx} className="opacity-25">
                        <line x1={x} y1={paddingTop} x2={x} y2={chartHeight - paddingBottom} stroke="white" strokeWidth="1" strokeDasharray="3,3" />
                        <text x={x} y={chartHeight - paddingBottom + 12} textAnchor="middle" fill="white">{d.time}</text>
                      </g>
                    );
                  }
                  return null;
                })}

                {/* Solid Terrain fill */}
                <path d={terrainAreaPath} fill="url(#terrain-gradient)" opacity="0.4" />
                <path d={terrainPath} fill="none" stroke="#CA6A00" strokeWidth="1.5" opacity="0.6" />

                {/* Speed Line Graph */}
                <path d={spdPath} fill="none" stroke="#00E1D9" strokeWidth="2" strokeLinecap="round" />

                {/* Altitude Line Graph */}
                <path d={altPath} fill="none" stroke="#43E600" strokeWidth="2.5" strokeLinecap="round" />

                {/* Interactive cursor lines */}
                {telemetryData.map((d, idx) => {
                  const x = getX(idx, telemetryData.length - 1);
                  return (
                    <rect
                      key={idx}
                      x={x - (contentWidth / telemetryData.length) / 2}
                      y={paddingTop}
                      width={contentWidth / telemetryData.length}
                      height={contentHeight}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoveredIndex(idx)}
                    />
                  );
                })}

                {/* Indicator dot on active hovered index */}
                {hoveredIndex !== null && (
                  <g>
                    <line 
                      x1={getX(hoveredIndex, telemetryData.length - 1)} 
                      y1={paddingTop} 
                      x2={getX(hoveredIndex, telemetryData.length - 1)} 
                      y2={chartHeight - paddingBottom} 
                      stroke="#45AFFF" 
                      strokeWidth="1.5" 
                      opacity="0.5" 
                    />
                    <circle 
                      cx={getX(hoveredIndex, telemetryData.length - 1)} 
                      cy={getAltitudeY(telemetryData[hoveredIndex].altitude)} 
                      r="4" 
                      fill="#43E600" 
                      stroke="white" 
                      strokeWidth="1.5"
                    />
                    <circle 
                      cx={getX(hoveredIndex, telemetryData.length - 1)} 
                      cy={getSpeedY(telemetryData[hoveredIndex].speed)} 
                      r="4" 
                      fill="#00E1D9" 
                      stroke="white" 
                      strokeWidth="1.5"
                    />
                  </g>
                )}

                {/* Define gradient shaders */}
                <defs>
                  <linearGradient id="terrain-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A85300" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#00172e" stopOpacity="0.1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>

          <div className="text-[10px] text-white/50 font-mono leading-relaxed bg-[#00172e]/55 p-3 rounded border border-white/5 flex gap-2">
            <Compass className="w-5 h-5 text-[#45AFFF] shrink-0" />
            <div>
              <span className="text-[#45AFFF] font-bold">DETALLE DE RECORRIDO: </span>
              El altímetro muestra un ascenso controlado de empuje simétrico hasta alcanzar altitud nominal. El mapa de velocidad indica reducción secuencial a menos de 250 nudos por debajo de FL100 según protocolo internacional.
            </div>
          </div>
        </div>

        {/* High Resolution Touchdown Shock Attenuation G-Analysis */}
        <div className="bg-[#001b33]/40 border border-[#3B7EB2]/25 rounded-[5px] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></div>
              <h3 className="text-xs font-mono font-extrabold text-red-400 uppercase tracking-wider">
                Análisis de Aterrizaje (G-Force de Touchdown)
              </h3>
            </div>
            <div className="text-[10px] font-mono text-[#E68B00]">
              MÁX G: <strong className="text-white">{(Math.abs(flight.fpmLanding) / 1000 + 1.1 + (Math.abs(flight.fpmLanding) > 150 ? 0.3 : 0)).toFixed(2)} Gs</strong>
            </div>
          </div>

          <div className="relative">
            {/* Dynamic cursor reading banner */}
            <div className="absolute top-1 left-12 bg-red-950/40 border border-red-500/15 px-2 py-1 rounded text-[9px] font-mono flex gap-3 text-red-300">
              {hoveredGIndex === null ? (
                <>
                  <span>Aterrizaje: <strong className="text-white">{flight.fpmLanding} FPM</strong></span>
                  <span>Estructura límite: <strong className="text-red-400">2.5G</strong></span>
                </>
              ) : (
                <>
                  <span>Intervalo: <strong className="text-white">{rawGData[hoveredGIndex].time}</strong></span>
                  <span>Fuerza de Choque: <strong className="text-[#43E600]">{rawGData[hoveredGIndex].g} Gs</strong></span>
                </>
              )}
            </div>

            {/* Render touchdown graph */}
            <div className="w-full h-fit flex justify-center mt-6">
              <svg 
                viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
                className="w-full max-w-[620px] select-none text-slate-300 font-mono text-[9px]"
                onMouseLeave={() => setHoveredGIndex(null)}
              >
                {/* Horizontal reference lines for G limit */}
                {[0, 0.5, 1.0, 1.5, 2.0, 2.5].map((val) => {
                  const y = getGY(val);
                  const isLimit = val >= 2.0;
                  return (
                    <g key={val} className={isLimit ? "opacity-30" : "opacity-15"}>
                      <line 
                        x1={paddingLeft} 
                        y1={y} 
                        x2={chartWidth - paddingRight} 
                        y2={y} 
                        stroke={isLimit ? "#EF4444" : "white"} 
                        strokeWidth="1" 
                        strokeDasharray={isLimit ? "none" : "3,3"} 
                      />
                      <text x={paddingLeft - 5} y={y + 3} textAnchor="end" fill={isLimit ? "#EF4444" : "white"}>{val}G</text>
                    </g>
                  );
                })}

                {/* Vertical grids for centiseconds */}
                {rawGData.map((d, idx) => {
                  if (idx % 5 === 0) {
                    const x = getX(idx, rawGData.length - 1);
                    return (
                      <g key={idx} className="opacity-25">
                        <line x1={x} y1={paddingTop} x2={x} y2={chartHeight - paddingBottom} stroke="white" strokeWidth="1" strokeDasharray="3,3" />
                        <text x={x} y={chartHeight - paddingBottom + 12} textAnchor="middle" fill="white">{d.time}</text>
                      </g>
                    );
                  }
                  return null;
                })}

                {/* Highlight line for Touchdown moment (0 cs) */}
                {(() => {
                  const xZero = getX(5, rawGData.length - 1);
                  return (
                    <g>
                      <line x1={xZero} y1={paddingTop} x2={xZero} y2={chartHeight - paddingBottom} stroke="#EF4444" strokeWidth="2" opacity="0.6" />
                      <text x={xZero} y={paddingTop - 5} textAnchor="middle" fill="#EF4444" className="font-extrabold text-[8px]">TOUCHDOWN ✈</text>
                    </g>
                  );
                })()}

                {/* Attenuation line and area gradients */}
                <path d={gAreaPath} fill="url(#g-gradient)" opacity="0.25" />
                <path d={gPath} fill="none" stroke="#F87171" strokeWidth="2.5" strokeLinecap="round" />

                {/* Interactive markers */}
                {rawGData.map((d, idx) => {
                  const x = getX(idx, rawGData.length - 1);
                  return (
                    <rect
                      key={idx}
                      x={x - (contentWidth / rawGData.length) / 2}
                      y={paddingTop}
                      width={contentWidth / rawGData.length}
                      height={contentHeight}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoveredGIndex(idx)}
                    />
                  );
                })}

                {/* Cursor indicator indicator */}
                {hoveredGIndex !== null && (
                  <g>
                    <line 
                      x1={getX(hoveredGIndex, rawGData.length - 1)} 
                      y1={paddingTop} 
                      x2={getX(hoveredGIndex, rawGData.length - 1)} 
                      y2={chartHeight - paddingBottom} 
                      stroke="#EF4444" 
                      strokeWidth="1.5" 
                      opacity="0.4" 
                    />
                    <circle 
                      cx={getX(hoveredGIndex, rawGData.length - 1)} 
                      cy={getGY(rawGData[hoveredGIndex].g)} 
                      r="4.5" 
                      fill="#EF4444" 
                      stroke="white" 
                      strokeWidth="1.5"
                    />
                  </g>
                )}

                {/* Gradient shader for touchdown shock */}
                <defs>
                  <linearGradient id="g-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#00172e" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>

          <div className="text-[10px] text-white/50 font-mono leading-relaxed bg-[#00172e]/55 p-3 rounded border border-white/5 flex gap-2">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <span className="text-red-400 font-bold">CRONOLOGÍA DE IMPACTO: </span>
              El sensor de los puntales registra compresión dinámica instantánea en T=0cs. La amplitud y tasa de amortiguación indican que las fuerzas se disolvieron eficientemente según el tren principal del equipo de vuelo.
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
