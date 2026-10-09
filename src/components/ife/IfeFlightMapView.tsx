/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IfeFlightMapView — mapa en vivo del IFE (fase 1: maquetado + datos).
 *
 * Reutiliza leaflet puro (mismo patrón que `flight/FlightTrackMap.tsx`) y
 * los helpers ya existentes (`haversineNm`). Muestra:
 *   - Ruta planada (origen→destino) punteada.
 *   - Recorrido volado (magenta Oryx) desde el historial de telemetría.
 *   - Avión rotado por rumbo con glow magenta.
 *   - Overlays Oryx: barra superior, estadísticas inferiores y zoom propio.
 *
 * Fuente de datos: getTelemetry (telemetría real del simulador) y
 * getFlownPath (buffer de FlightPathRecorder). Si no hay telemetría
 * válida, usa un mock que interpola LTAF→LTAC.
 * TODO: reemplazar el mock por la conexión definitiva al simulador cuando
 * el hook de telemetría esté siempre disponible en el IFE.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Crosshair, Minus, Plus } from "lucide-react";
import { haversineNm } from "../../services/flightHistoryFormat";
import { IFE_BRAND } from "./IfeChrome";

const MAGENTA = "#C92C5D";
const LIVE_GREEN = "#43E600";
const MAP_BG = "#0B101F";

/** Telemetría mínima consumida por el mapa. */
export interface IfeTelemetry {
  latitude: number;
  longitude: number;
  altitude: number;
  groundspeed: number;
  heading: number;
  verticalSpeed?: number;
}

interface IfeFlightMapViewProps {
  flightNumber: string;
  originIcao: string;
  destIcao: string;
  originCoords?: [number, number] | null;
  destCoords?: [number, number] | null;
  getTelemetry?: () => IfeTelemetry | null;
  /** Historial [lat, lon] del recorrido volado. */
  getFlownPath?: () => Array<[number, number]>;
  onClose: () => void;
}

interface MapStats {
  altitude: number;
  groundspeed: number;
  distance: number;
  eta: string;
  heading: number;
}

/** Coordenadas de respaldo para el vuelo de prueba LTAF→LTAC. */
const KNOWN_COORDS: Record<string, [number, number]> = {
  LTAF: [36.9822, 35.2803],
  LTAC: [40.1281, 32.9951],
  SABE: [-34.5592, -58.4156],
  SAEZ: [-34.8222, -58.5358],
};
const DEFAULT_ORIGIN: [number, number] = KNOWN_COORDS.LTAF;
const DEFAULT_DEST: [number, number] = KNOWN_COORDS.LTAC;

function resolveCoords(
  provided: [number, number] | null | undefined,
  icao: string,
  fallback: [number, number]
): [number, number] {
  if (
    provided &&
    Number.isFinite(provided[0]) &&
    Number.isFinite(provided[1]) &&
    !(provided[0] === 0 && provided[1] === 0)
  ) {
    return provided;
  }
  return KNOWN_COORDS[icao?.toUpperCase()] ?? fallback;
}

function isValidTelemetry(t: IfeTelemetry | null): t is IfeTelemetry {
  return (
    !!t &&
    Number.isFinite(t.latitude) &&
    Number.isFinite(t.longitude) &&
    !(t.latitude === 0 && t.longitude === 0)
  );
}

function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Mock: interpola LTAF→LTAC en un ciclo de 180 s para probar sin simulador. */
function mockTelemetry(origin: [number, number], dest: [number, number]): IfeTelemetry {
  const period = 180;
  const frac = ((Date.now() / 1000) % period) / period;
  const latitude = origin[0] + (dest[0] - origin[0]) * frac;
  const longitude = origin[1] + (dest[1] - origin[1]) * frac;
  return {
    latitude,
    longitude,
    altitude: Math.round(30000 * Math.sin(Math.PI * frac)),
    groundspeed: Math.round(150 + Math.sin(Math.PI * frac) * 290),
    heading: bearingDeg(origin, dest),
    verticalSpeed: 0,
  };
}

function aircraftIcon(heading: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;transform:rotate(${heading}deg);filter:drop-shadow(0 0 5px ${MAGENTA})">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="#ffffff"><path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function endpointIcon(label: string) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:9px;height:9px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(0,0,0,.75)"></div>
      <span style="margin-top:3px;font:600 10px Inter,Arial,sans-serif;letter-spacing:.08em;color:#fff;text-shadow:0 1px 3px #000">${label}</span>
    </div>`,
    iconSize: [9, 9],
    iconAnchor: [4.5, 4.5],
  });
}

export default function IfeFlightMapView({
  flightNumber,
  originIcao,
  destIcao,
  originCoords,
  destCoords,
  getTelemetry,
  getFlownPath,
  onClose,
}: IfeFlightMapViewProps) {
  const { t } = useTranslation();
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const aircraftRef = useRef<L.Marker | null>(null);
  const flownRef = useRef<L.Polyline | null>(null);
  const flownPtsRef = useRef<Array<[number, number]>>([]);
  const didCenterRef = useRef(false);

  const [stats, setStats] = useState<MapStats>({
    altitude: 0,
    groundspeed: 0,
    distance: 0,
    eta: "—",
    heading: 0,
  });

  const origin = useMemo(
    () => resolveCoords(originCoords, originIcao, DEFAULT_ORIGIN),
    [originCoords?.[0], originCoords?.[1], originIcao]
  );
  const dest = useMemo(
    () => resolveCoords(destCoords, destIcao, DEFAULT_DEST),
    [destCoords?.[0], destCoords?.[1], destIcao]
  );

  // Getters en refs para no reconstruir el mapa en cada render.
  const getTelemetryRef = useRef(getTelemetry);
  getTelemetryRef.current = getTelemetry;
  const getFlownPathRef = useRef(getFlownPath);
  getFlownPathRef.current = getFlownPath;

  useEffect(() => {
    const el = mapElRef.current;
    if (!el || mapRef.current) return;

    didCenterRef.current = false;

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      worldCopyJump: true,
    }).setView(origin, 5);
    mapRef.current = map;

    // Tiles gratuitos de OpenStreetMap (mismo proveedor que FlightTrackMap,
    // sin API key). El look oscuro Oryx se logra con el filtro CSS de
    // `.leaflet-tile-pane` (ver <style> más abajo), que NO afecta la ruta
    // magenta ni el avión (viven en otras panes de Leaflet).
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    // Ruta planada (punteada).
    L.polyline([origin, dest], {
      color: "rgba(255,255,255,0.25)",
      dashArray: "6 8",
      weight: 2,
    }).addTo(map);

    // Extremos.
    L.marker(origin, { icon: endpointIcon(originIcao), interactive: false }).addTo(map);
    L.marker(dest, { icon: endpointIcon(destIcao), interactive: false }).addTo(map);

    // Recorrido volado (magenta).
    flownRef.current = L.polyline([], { color: MAGENTA, weight: 3, opacity: 0.95 }).addTo(map);

    // Avión.
    aircraftRef.current = L.marker(origin, {
      icon: aircraftIcon(0),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(map);

    const tick = () => {
      // TODO: cuando el IFE tenga siempre telemetría, quitar el fallback mock.
      const live = getTelemetryRef.current?.() ?? null;
      const tel = isValidTelemetry(live) ? live : mockTelemetry(origin, dest);
      const pos: [number, number] = [tel.latitude, tel.longitude];

      // Centrar en la posición real del avión una sola vez (luego respeta
      // el paneo/zoom del usuario).
      if (!didCenterRef.current) {
        map.setView(pos, 5);
        didCenterRef.current = true;
      }

      aircraftRef.current?.setLatLng(pos);
      aircraftRef.current?.setIcon(aircraftIcon(tel.heading || 0));

      const history = getFlownPathRef.current?.();
      let pts: Array<[number, number]>;
      if (history && history.length > 0) {
        pts = history;
      } else {
        const last = flownPtsRef.current[flownPtsRef.current.length - 1];
        const moved =
          !last ||
          (haversineNm(last[0], last[1], pos[0], pos[1]) ?? 0) > 0.3 ||
          flownPtsRef.current.length === 0;
        if (moved) flownPtsRef.current.push(pos);
        pts = flownPtsRef.current;
      }
      flownRef.current?.setLatLngs(pts);

      const dist = haversineNm(pos[0], pos[1], dest[0], dest[1]) ?? 0;
      const gs = Math.max(0, tel.groundspeed || 0);
      const etaMin = gs > 0 ? (dist / gs) * 60 : NaN;
      setStats({
        altitude: Math.round(tel.altitude || 0),
        groundspeed: Math.round(gs),
        distance: Math.round(dist),
        eta: Number.isFinite(etaMin) ? formatClock(Date.now() + etaMin * 60000) : "—",
        heading: Math.round((tel.heading || 0) % 360),
      });
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    const sizeTimer = window.setTimeout(() => map.invalidateSize(), 60);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(sizeTimer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      aircraftRef.current = null;
      flownRef.current = null;
      flownPtsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, dest, originIcao, destIcao]);

  const fitRoute = () => {
    mapRef.current?.fitBounds(L.latLngBounds([origin, dest]), { padding: [80, 80] });
  };

  const statCells: Array<{ key: string; label: string; value: string }> = [
    { key: "alt", label: t("ife.map.altitude"), value: `${stats.altitude.toLocaleString("en-US")} ft` },
    { key: "gs", label: t("ife.map.ground_speed"), value: `${stats.groundspeed} kts` },
    { key: "dist", label: t("ife.map.distance"), value: `${stats.distance} nm` },
    { key: "eta", label: t("ife.map.eta"), value: stats.eta },
  ];

  return (
    <div
      id="ife-flight-map"
      className="relative w-full aspect-video overflow-hidden animate-fadeIn"
      style={{ backgroundColor: MAP_BG, fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }}
    >
      <div ref={mapElRef} className="absolute inset-0 z-0" />

      {/* Filtro oscuro Oryx solo sobre los tiles base (OSM claro → oscuro).
          Escopado por id para no afectar otros mapas (p. ej. FlightTrackMap). */}
      <style>{`
        #ife-flight-map .leaflet-container { background: ${MAP_BG}; }
        #ife-flight-map .leaflet-tile-pane { filter: brightness(0.6) contrast(1.1) grayscale(0.3); }
      `}</style>

      {/* Token de marca (top-right, discreto) */}
      <span
        className="absolute top-2 right-3 z-[1000] uppercase select-none pointer-events-none"
        style={{ fontSize: 10, letterSpacing: "0.22em", color: "rgba(255,255,255,0.35)" }}
      >
        {IFE_BRAND}
      </span>

      {/* Overlay superior */}
      <div
        className="absolute top-0 left-0 right-0 z-[1000] h-14 flex items-center justify-between px-4"
        style={{ background: "linear-gradient(to bottom, rgba(11,16,31,0.95), rgba(11,16,31,0.45))" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            title={t("ife.menu.back")}
            aria-label={t("ife.menu.back")}
            className="p-2 -ml-2 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <p className="text-white leading-tight" style={{ fontSize: 14, fontWeight: 400 }}>
              {originIcao} <span style={{ color: MAGENTA }}>→</span> {destIcao}
            </p>
            <p
              className="uppercase truncate"
              style={{ fontSize: 10, letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)", fontWeight: 400 }}
            >
              {flightNumber}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="uppercase px-2 py-1 border border-white/15 text-white/80"
            style={{ fontSize: 10, letterSpacing: "0.12em", borderRadius: 2 }}
            title={t("ife.map.heading")}
          >
            {stats.heading}°
          </span>
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 border border-white/15 uppercase"
            style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.85)", borderRadius: 2 }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: LIVE_GREEN }}
            />
            {t("ife.map.live")}
          </span>
        </div>
      </div>

      {/* Zoom propio (Oryx) */}
      <div className="absolute right-4 bottom-[76px] z-[1000] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          aria-label="Zoom +"
          className="w-9 h-9 flex items-center justify-center text-white border border-white/15 hover:bg-white/10 transition-colors cursor-pointer"
          style={{ backgroundColor: "rgba(15,20,35,0.9)", borderRadius: 2 }}
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          aria-label="Zoom −"
          className="w-9 h-9 flex items-center justify-center text-white border border-white/15 hover:bg-white/10 transition-colors cursor-pointer"
          style={{ backgroundColor: "rgba(15,20,35,0.9)", borderRadius: 2 }}
        >
          <Minus className="w-4 h-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={fitRoute}
          aria-label={t("ife.map.fit_route")}
          title={t("ife.map.fit_route")}
          className="w-9 h-9 flex items-center justify-center text-white border border-white/15 hover:bg-white/10 transition-colors cursor-pointer"
          style={{ backgroundColor: "rgba(15,20,35,0.9)", borderRadius: 2 }}
        >
          <Crosshair className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Crédito de tiles (requerido por OSM/CARTO) */}
      <span
        className="absolute left-2 bottom-[70px] z-[1000] pointer-events-none"
        style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}
      >
        © OpenStreetMap
      </span>

      {/* Barra de estadísticas inferior */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[1000] h-16 grid grid-cols-4"
        style={{ backgroundColor: "rgba(15,20,35,0.9)", borderTop: "1px solid rgba(255,255,255,0.1)" }}
      >
        {statCells.map((cell) => (
          <div key={cell.key} className="px-4 flex flex-col justify-center min-w-0">
            <span
              className="uppercase truncate"
              style={{ fontSize: 9, letterSpacing: "0.18em", color: "rgba(255,255,255,0.5)", fontWeight: 400 }}
            >
              {cell.label}
            </span>
            <span className="text-white truncate" style={{ fontSize: 14, fontWeight: 400 }}>
              {cell.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
