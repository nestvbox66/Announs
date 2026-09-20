/**
 * FlightDetailView — pantalla de Detalle de Vuelo (User HUB).
 *
 * Estructura:
 *  - Cabecera: N° de vuelo, aerolínea, aeronave + foto (upload placeholder local).
 *  - Panel de ruta: origen (ICAO + nombre), destino, hora de partida/arribo.
 *  - Tabs: "Vista General" (mapa interactivo del GeoJSON de `flight_paths`) y
 *    "Telemetría Avanzada" (gráfico Velocidad + Altitud).
 *
 * Carga `flights` + `flight_paths` por `flight_id`. Sin `flight_id` (filas
 * legacy/mock) usa los campos de la fila y muestra estados vacíos.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Plane, Camera, Upload } from "lucide-react";
import type { VueloReciente } from "../../types";
import { FlightHistoryService, FlightDetailData } from "../../services/FlightHistoryService";
import { FlightPathService } from "../../services/FlightPathService";
import type { FlightPathFeature } from "../../services/FlightPathRecorder";
import { haversineNm } from "../../services/flightHistoryFormat";
import FlightTrackMap from "./FlightTrackMap";
import FlightTelemetryChart from "./FlightTelemetryChart";

interface FlightDetailViewProps {
  flight: VueloReciente;
  onBack: () => void;
}

function getAircraftByFlight(codigo: string, aerolinea: string): string {
  const code = (codigo || "").toUpperCase();
  const aero = (aerolinea || "").toLowerCase();
  if (code.includes("G3") || aero.includes("gol")) return "Boeing 737 MAX 8 - B38M";
  if (code.includes("LA") || aero.includes("latam")) return "Airbus A320neo - A20N";
  if (code.includes("WJ") || aero.includes("smart")) return "Airbus A321neo - A21N";
  if (code.includes("FB") || aero.includes("bondi")) return "Boeing 737 800 - B738";
  return "Boeing 737 800 - B738";
}

function badgeInitials(name: string): string {
  const clean = (name || "").trim();
  if (!clean || clean === "—") return "✈";
  const words = clean.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function FlightDetailView({ flight, onBack }: FlightDetailViewProps) {
  const [tab, setTab] = useState<"overview" | "telemetry">("overview");
  const [detail, setDetail] = useState<FlightDetailData | null>(null);
  const [path, setPath] = useState<FlightPathFeature | null>(null);
  const [loading, setLoading] = useState<boolean>(!!flight.flightId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    if (!flight.flightId) {
      setDetail(null);
      setPath(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      const [detailRes, pathRes] = await Promise.all([
        FlightHistoryService.loadFlightDetail(flight.flightId as string),
        FlightPathService.loadFlightPath(flight.flightId as string),
      ]);
      if (cancelled) return;
      if (detailRes.success && detailRes.data) {
        setDetail(detailRes.data);
      } else if (!detailRes.success) {
        setLoadError(detailRes.error ?? "No se pudo cargar el vuelo.");
      }
      if (pathRes.success && pathRes.data) {
        setPath(pathRes.data);
      }
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [flight.flightId]);

  const handlePhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
  };

  // Datos presentados: detalle real o fallback de la fila.
  const flightNumber = detail?.flightNumber ?? flight.codigo;
  const airline = detail?.airline ?? flight.aerolinea;
  const aircraft = detail && detail.aircraft !== "—"
    ? `${detail.aircraft}${detail.aircraftReg !== "—" ? ` · ${detail.aircraftReg}` : ""}`
    : getAircraftByFlight(flight.codigo, flight.aerolinea);
  const originIcao = detail?.originIcao ?? flight.origen;
  const originName = detail?.originName ?? flight.origenCiudad;
  const destIcao = detail?.destIcao ?? flight.destino;
  const destName = detail?.destName ?? flight.destinoCiudad;
  const depTime = detail?.departTime ?? "—";
  const arrTime = detail?.arriveTime ?? "—";
  const duration = detail?.durationLabel ?? flight.duracion;
  const distanceNm = detail
    ? haversineNm(detail.originLat, detail.originLon, detail.destLat, detail.destLon)
    : null;

  const coordinates = path?.geometry?.coordinates ?? [];
  const startedAt = path?.properties?.started_at ?? null;
  const endedAt = path?.properties?.ended_at ?? null;

  return (
    <div id="flight-detail-view" className="space-y-6 animate-fadeIn">
      {/* Barra superior */}
      <div className="flex items-center justify-between border-b border-[#3B7EB2]/50 pb-4">
        <div className="flex items-center gap-3">
          <button
            id="details-back-button"
            onClick={onBack}
            className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white p-2 rounded-[5px] transition-all cursor-pointer flex items-center justify-center"
            title="Volver"
          >
            <ArrowLeft className="w-5 h-5 text-[#45AFFF]" />
          </button>
          <div>
            <div className="text-xs text-[#45AFFF]/60 font-mono tracking-widest uppercase mb-0.5">DETALLE DE REGISTRO</div>
            <h1 className="font-display font-extrabold text-2xl tracking-tight text-[#45AFFF] uppercase flex items-center gap-2">
              REPORTE DE VUELO: {flightNumber}
            </h1>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-10 flex items-center justify-center gap-2 text-white/60 font-mono text-xs">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Cargando detalle del vuelo…
        </div>
      ) : (
        <>
          {loadError && (
            <div className="bg-red-900/30 border border-red-500/40 rounded px-3 py-2 text-[11px] font-mono text-red-300">
              {loadError} Se muestran los datos básicos de la fila.
            </div>
          )}

          {/* Cabecera: metadatos + foto */}
          <div id="flight-detail-header" className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-6 shadow-md">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              <div className="lg:col-span-2 flex flex-col justify-center gap-4">
                <div>
                  <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">Número de vuelo</div>
                  <div className="font-sans font-black text-4xl text-white tracking-wide">{flightNumber}</div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">Aerolínea</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="w-7 h-7 rounded bg-[#3B7EB2]/60 border border-white/20 text-white font-mono font-extrabold text-[11px] flex items-center justify-center shrink-0">
                        {badgeInitials(airline)}
                      </span>
                      <span className="font-semibold text-white/95">{airline}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">Aeronave</div>
                    <div className="text-sm font-bold text-white mt-1">{aircraft}</div>
                  </div>
                </div>
              </div>

              {/* Foto de la aeronave / sesión (placeholder funcional) */}
              <div className="bg-[#00172e]/85 border border-[#3B7EB2]/40 rounded-[5px] p-4 flex flex-col items-center justify-center gap-3 min-h-[180px] text-center">
                {photoUrl ? (
                  <img src={photoUrl} alt="Foto del vuelo" className="max-h-40 rounded object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-white/40">
                    <Camera className="w-10 h-10" />
                    <span className="text-[11px] font-mono uppercase tracking-wider">Sin foto de la sesión</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white px-3 py-1.5 rounded-[5px] font-mono text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
                  title="La subida a la nube estará disponible próximamente"
                >
                  <Upload className="w-3.5 h-3.5 text-[#45AFFF]" />
                  {photoUrl ? "Cambiar foto" : "Subir foto"}
                </button>
              </div>
            </div>
          </div>

          {/* Panel de ruta */}
          <div id="flight-route-panel" className="bg-[#00172e]/75 border border-[#3B7EB2]/45 rounded-[5px] p-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-white relative">
            <div className="flex flex-col text-center sm:text-left space-y-1 w-full sm:w-auto">
              <span className="font-sans font-black text-5xl sm:text-6xl tracking-wide uppercase leading-none drop-shadow-md text-white">
                {originIcao}
              </span>
              <span className="text-[10px] text-[#45AFFF]/80 tracking-widest font-mono font-bold block">ORIGEN</span>
              <span className="text-xs text-white/70 font-sans max-w-[220px] leading-snug">{originName}</span>
              <span className="text-xl font-mono font-black text-[#43E600] mt-1 pt-1 block">{depTime}</span>
              <span className="text-[10px] font-mono text-white/40 uppercase">Hora de partida</span>
            </div>

            <div className="flex flex-col items-center justify-center flex-1 px-2 max-w-[200px] w-full">
              <span className="text-[11px] font-mono font-extrabold text-white/50 tracking-wider uppercase pb-1">{duration}</span>
              <div className="flex items-center w-full gap-2 text-[#45AFFF]/70 my-1">
                <div className="h-[2px] flex-1 bg-white/20"></div>
                <Plane className="w-4 h-4 rotate-90 text-[#45AFFF] drop-shadow-lg scale-110" />
                <div className="h-[2px] flex-1 bg-white/20"></div>
              </div>
              <span className="text-[11px] font-mono font-bold text-[#45AFFF] tracking-wider pt-1 uppercase">
                {distanceNm !== null ? `${Math.round(distanceNm)} NM` : "—"}
              </span>
            </div>

            <div className="flex flex-col text-center sm:text-right sm:items-end space-y-1 w-full sm:w-auto">
              <span className="font-sans font-black text-5xl sm:text-6xl tracking-wide uppercase leading-none drop-shadow-md text-white">
                {destIcao}
              </span>
              <span className="text-[10px] text-[#45AFFF]/80 tracking-widest font-mono font-bold block">DESTINO</span>
              <span className="text-xs text-white/70 font-sans max-w-[220px] leading-snug block">{destName}</span>
              <span className="text-xl font-mono font-black text-[#43E600] mt-1 pt-1 block">{arrTime}</span>
              <span className="text-[10px] font-mono text-white/40 uppercase">Hora de arribo</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="space-y-4">
            <div className="flex items-center justify-start border-b border-white/10 gap-2 pb-[1px]" id="flight-report-tabs">
              <button
                onClick={() => setTab("overview")}
                className={`px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider transition-all relative cursor-pointer ${
                  tab === "overview"
                    ? "text-[#45AFFF] border-[#45AFFF] bg-[#00345C]/20 border-b-2"
                    : "text-white/60 hover:text-white/90 hover:bg-[#2C6591]/30"
                }`}
              >
                VISTA GENERAL
              </button>
              <button
                onClick={() => setTab("telemetry")}
                className={`px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider transition-all relative cursor-pointer ${
                  tab === "telemetry"
                    ? "text-[#45AFFF] border-[#45AFFF] bg-[#00345C]/20 border-b-2"
                    : "text-white/60 hover:text-white/90 hover:bg-[#2C6591]/30"
                }`}
              >
                TELEMETRÍA AVANZADA
              </button>
            </div>

            {tab === "overview" ? (
              <FlightTrackMap
                coordinates={coordinates}
                originLabel={`${originIcao} · ${originName}`}
                destLabel={`${destIcao} · ${destName}`}
              />
            ) : (
              <FlightTelemetryChart
                coordinates={coordinates}
                startedAt={startedAt}
                endedAt={endedAt}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
