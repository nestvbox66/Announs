/**
 * FlightTrackMap — mapa interactivo del recorrido (Leaflet).
 *
 * Dibuja el GeoJSON LineString `[lon, lat, alt, spd]` guardado en
 * `public.flight_paths`, con marcadores de origen/destino y ajuste
 * automático de encuadre. Sin recorrido muestra un estado vacío.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FlightPathPoint } from "../../services/FlightPathRecorder";

interface FlightTrackMapProps {
  coordinates: FlightPathPoint[];
  originLabel: string;
  destLabel: string;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export default function FlightTrackMap({ coordinates, originLabel, destLabel }: FlightTrackMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || coordinates.length === 0) return;

    const latLngs = coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
      attributionControl: true,
    });
    mapRef.current = map;

    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);
    L.polyline(latLngs, { color: "#45AFFF", weight: 3, opacity: 0.9 }).addTo(map);

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
    };
  }, [coordinates, originLabel, destLabel]);

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
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-mono text-white/50">
        <span>{coordinates.length} puntos · arrastra para mover, rueda para zoom</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#43E600]" /> Origen</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#E600D2]" /> Destino</span>
        </span>
      </div>
    </div>
  );
}
