/**
 * FlightTrackMap — mapa interactivo del recorrido (Leaflet).
 *
 * Dibuja el GeoJSON LineString `[lon, lat, alt, spd]` guardado en
 * `public.flight_paths`, con marcadores de origen/destino y ajuste
 * automático de encuadre. Sin recorrido muestra un estado vacío.
 *
 * Incluye switch de capa base: estándar (OpenStreetMap) y topográfico
 * (OpenTopoMap, máx. zoom 17).
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FlightPathPoint } from "../../services/FlightPathRecorder";

interface FlightTrackMapProps {
  coordinates: FlightPathPoint[];
  originLabel: string;
  destLabel: string;
}

type BaseMap = "std" | "topo";

/** Color del recorrido por capa: magenta en topo (ausente en topografía). */
const TRACK_COLORS: Record<BaseMap, string> = {
  std: "#45AFFF",
  topo: "#FF00FF",
};

const BASE_LAYERS: Record<BaseMap, { url: string; attribution: string; maxZoom: number }> = {
  std: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
      '<a href="http://viewfinderpanoramas.org">SRTM</a> | style: &copy; ' +
      '<a href="https://opentopomap.org">OpenTopoMap</a> ' +
      '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 17,
  },
};

export default function FlightTrackMap({ coordinates, originLabel, destLabel }: FlightTrackMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const trackRef = useRef<L.Polyline | null>(null);
  const appliedBaseRef = useRef<BaseMap>("std");
  const [base, setBase] = useState<BaseMap>("std");

  useEffect(() => {
    if (!containerRef.current || coordinates.length === 0) return;

    const latLngs = coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
      attributionControl: true,
    });
    mapRef.current = map;

    const layer = L.tileLayer(BASE_LAYERS.std.url, {
      attribution: BASE_LAYERS.std.attribution,
      maxZoom: BASE_LAYERS.std.maxZoom,
    }).addTo(map);
    tileRef.current = layer;
    appliedBaseRef.current = "std";
    setBase("std");
    // Celeste en estándar; magenta en topo (contraste sobre océano/relieve).
    const track = L.polyline(latLngs, { color: TRACK_COLORS.std, weight: 3, opacity: 0.9 }).addTo(map);
    trackRef.current = track;

    const dot = (label: string, color: string) =>
      L.divIcon({
        className: "",
        html: `<div title="${label}" style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

    L.marker(latLngs[0], { icon: dot(originLabel, "#43E600") })
      .addTo(map)
      .bindTooltip(`Origen · ${originLabel}`);
    L.marker(latLngs[latLngs.length - 1], { icon: dot(destLabel, "#E600D2") })
      .addTo(map)
      .bindTooltip(`Destino · ${destLabel}`);

    map.fitBounds(L.latLngBounds(latLngs).pad(0.15));

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      trackRef.current = null;
    };
  }, [coordinates, originLabel, destLabel]);

  // Cambio de capa base sin reconstruir el mapa (conserva zoom/encuadre).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBaseRef.current === base) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
    }
    const def = BASE_LAYERS[base];
    const layer = L.tileLayer(def.url, { attribution: def.attribution, maxZoom: def.maxZoom });
    layer.addTo(map);
    // OpenTopoMap llega a zoom 17: si se estaba más cerca, retroceder.
    if (map.getZoom() > def.maxZoom) map.setZoom(def.maxZoom);
    tileRef.current = layer;
    appliedBaseRef.current = base;
    // Repintar el recorrido según la capa (sin reconstruir el mapa).
    trackRef.current?.setStyle({ color: TRACK_COLORS[base] });
  }, [base]);

  if (coordinates.length === 0) {
    return (
      <div
        id="flight-track-empty"
        className="h-[420px] bg-[#00172e]/60 border border-white/10 rounded-[5px] flex flex-col items-center justify-center gap-2 text-center p-6"
      >
        <span className="text-4xl">🗺️</span>
        <p className="text-sm font-bold text-white/80">Sin recorrido registrado</p>
        <p className="text-[11px] font-mono text-white/50 max-w-md">
          Este vuelo aún no tiene track guardado en <span className="text-[#45AFFF]/80">flight_paths</span>.
          El recorrido se persiste automáticamente al llegar a puerta o al finalizar el vuelo.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] overflow-hidden">
      <div ref={containerRef} id="flight-track-map" className="h-[420px] w-full z-0" />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-1.5 text-[10px] font-mono text-white/50">
        <span>{coordinates.length} puntos · arrastra para mover, rueda para zoom</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center rounded-[4px] border border-white/10 overflow-hidden" role="group" aria-label="Tipo de mapa">
            <button
              type="button"
              onClick={() => setBase("std")}
              aria-pressed={base === "std"}
              className={`px-2 py-0.5 font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                base === "std" ? "bg-[#45AFFF]/25 text-[#45AFFF]" : "text-white/45 hover:text-white/80"
              }`}
            >
              Estándar
            </button>
            <button
              type="button"
              onClick={() => setBase("topo")}
              aria-pressed={base === "topo"}
              className={`px-2 py-0.5 font-bold uppercase tracking-wider transition-colors cursor-pointer border-l border-white/10 ${
                base === "topo" ? "bg-[#43E600]/20 text-[#43E600]" : "text-white/45 hover:text-white/80"
              }`}
            >
              Topográfico
            </button>
          </span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#43E600]" /> Origen</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#E600D2]" /> Destino</span>
        </span>
      </div>
    </div>
  );
}
