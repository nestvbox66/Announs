/**
 * FlightDetailView — pantalla de Detalle de Vuelo (User HUB).
 *
 * Estructura:
 *  - Cabecera: N° de vuelo, aerolínea, aeronave + foto de la sesión (real,
 *    vía Supabase Storage `flight-photos` y `flights.photo_url`).
 *  - Panel de ruta: origen (ICAO + nombre), destino, hora de partida/arribo.
 *  - Tabs: "Vista General" (mapa interactivo del GeoJSON de `flight_paths`) y
 *    "Telemetría Avanzada" (gráfico Velocidad + Altitud).
 *
 * Carga `flights` + `flight_paths` por `flight_id`. Sin `flight_id` (filas
 * legacy/mock) usa los campos de la fila y muestra estados vacíos.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Plane, Camera, Upload, Trophy, Loader2, X, Maximize2, Users, Heart, Play, Pause, Mic, Globe } from "lucide-react";
import type { VueloReciente } from "../../types";
import { FlightHistoryService, FlightDetailData, loadFlightPassengerReport, loadFlightCrewReport, loadFlightAudioDeliveries, type FlightPassengerReport, type FlightCrewReport, type FlightVoiceInfo, type FlightAudioDelivery } from "../../services/FlightHistoryService";
import { languageFlag } from "../../services/voiceService";
import { FlightPhotoService } from "../../services/FlightPhotoService";
import { FlightPathService } from "../../services/FlightPathService";
import { ProgressionService, FlightXpBreakdown } from "../../services/ProgressionService";
import { formatMultiplier } from "../../services/CampaignService";
import { explainXpBreakdown, type XpBonusExplanation } from "../../services/XpBonusExplanations";
import type { FlightPathFeature } from "../../services/FlightPathRecorder";
import { haversineNm, formatDurationLong } from "../../services/flightHistoryFormat";
import { getAirlineLogo, getGenericAirlineLogo, getAirlineIcaoByName } from "../../utils/airlineLogos";
import { getAircraftSilhouette } from "../../utils/aircraftSilhouettes";
import FlightTrackMap from "./FlightTrackMap";
import FlightTelemetryChart from "./FlightTelemetryChart";

interface FlightDetailViewProps {
  flight: VueloReciente;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
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

/** `2026-10-03T18:13:31.423Z` → "18:13 UTC" (siempre UTC, como el resto del reporte). */
function formatDeliveryTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return (
      d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) +
      " UTC"
    );
  } catch {
    return "—";
  }
}

/** Cuadro de voz del personal (foto destacada + nombre debajo, best-effort). */
function VoiceBox({ title, voice }: { title: string; voice: FlightVoiceInfo | null }) {
  const [imgBroken, setImgBroken] = useState(false);
  return (
    <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] p-3 flex flex-col items-center gap-2">
      <span className="text-[10px] font-mono font-bold text-[#45AFFF] uppercase tracking-wider">
        {title}
      </span>
      {voice ? (
        <>
          <span className="w-20 h-20 rounded-full bg-[#00345C] border border-white/20 flex items-center justify-center shrink-0 overflow-hidden">
            {voice.avatarUrl && !imgBroken ? (
              <img
                src={voice.avatarUrl}
                alt={voice.name}
                className="w-full h-full object-cover"
                onError={() => setImgBroken(true)}
              />
            ) : (
              <Users className="w-8 h-8 text-[#45AFFF]" />
            )}
          </span>
          <span className="text-[11px] font-sans font-bold text-white text-center leading-snug">
            {voice.name}
          </span>
        </>
      ) : (
        <span className="text-xs font-mono text-white/50">—</span>
      )}
    </div>
  );
}

export default function FlightDetailView({
  flight,
  onBack,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: FlightDetailViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"overview" | "telemetry" | "xp" | "pax" | "announcements">("overview");
  const [detail, setDetail] = useState<FlightDetailData | null>(null);
  const [path, setPath] = useState<FlightPathFeature | null>(null);
  const [flightXp, setFlightXp] = useState<FlightXpBreakdown | null>(null);
  const [xpLoading, setXpLoading] = useState(false);
  const [paxReport, setPaxReport] = useState<FlightPassengerReport | null>(null);
  const [crewReport, setCrewReport] = useState<FlightCrewReport | null>(null);
  const [deliveries, setDeliveries] = useState<FlightAudioDelivery[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);
  const deliveryAudioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState<boolean>(!!flight.flightId);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Foto de la sesión: URL persistida (`flights.photo_url`).
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Vista previa local inmediata mientras se sube el archivo.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // La URL remota falló al cargar (red o archivo corrupto): se muestra aviso.
  const [photoImgBroken, setPhotoImgBroken] = useState(false);
  // Lightbox de ampliación de la foto de la sesión.
  const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Limpia la vista previa anterior al cambiar de vuelo.
  useEffect(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPhotoError(null);
    setPhotoImgBroken(false);
    setIsPhotoLightboxOpen(false);
    deliveryAudioRef.current?.pause();
    deliveryAudioRef.current = null;
    setPlayingId(null);
    setExpandedDeliveryId(null);
  }, [flight.flightId]);

  // Cierre del lightbox con la tecla ESC.
  useEffect(() => {
    if (!isPhotoLightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPhotoLightboxOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPhotoLightboxOpen]);

  useEffect(() => {
    if (!flight.flightId) {
      setDetail(null);
      setPath(null);
      setFlightXp(null);
      setPaxReport(null);
      setCrewReport(null);
      setDeliveries(null);
      setPlayingId(null);
      setExpandedDeliveryId(null);
      deliveryAudioRef.current?.pause();
      deliveryAudioRef.current = null;
      setPhotoUrl(null);
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
        setPhotoUrl(detailRes.data.photoUrl ?? null);
        setPhotoImgBroken(false);
      } else if (!detailRes.success) {
        setLoadError(detailRes.error ?? "No se pudo cargar el vuelo.");
      }
      if (pathRes.success && pathRes.data) {
        setPath(pathRes.data);
      }
      setLoading(false);
      // XP del vuelo (usa los minutos del detalle recién cargado).
      const minutes = detailRes.success ? detailRes.data?.durationMinutes ?? null : null;
      setXpLoading(true);
      const xpRes = await ProgressionService.loadFlightXp(flight.flightId as string, minutes);
      if (cancelled) return;
      setFlightXp(xpRes.success ? xpRes.data ?? null : null);
      setXpLoading(false);
      // Satisfacción de pasajeros (best-effort: sin dato muestra "—").
      try {
        const pax = await loadFlightPassengerReport(flight.flightId as string);
        if (!cancelled) setPaxReport(pax);
      } catch {
        if (!cancelled) setPaxReport(null);
      }
      // Personal e idioma de los anuncios (best-effort).
      try {
        const crew = await loadFlightCrewReport(flight.flightId as string);
        if (!cancelled) setCrewReport(crew);
      } catch {
        if (!cancelled) setCrewReport(null);
      }
      // Historial de anuncios entregados (línea de tiempo, best-effort).
      // Carga inicial: primera tarjeta seleccionada (desplegada).
      try {
        const timeline = await loadFlightAudioDeliveries(flight.flightId as string);
        if (!cancelled) {
          setDeliveries(timeline);
          setExpandedDeliveryId(timeline.length > 0 ? timeline[0].id : null);
        }
      } catch {
        if (!cancelled) {
          setDeliveries([]);
          setExpandedDeliveryId(null);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [flight.flightId]);

  /**
   * Reproducción de un anuncio entregado (línea de tiempo): una sola
   * instancia; al elegir otro se detiene el anterior. Sin URL no hace nada.
   */
  const toggleDeliveryPlay = (delivery: FlightAudioDelivery) => {
    if (!delivery.audioUrl) return;
    const current = deliveryAudioRef.current;
    if (playingId === delivery.id && current) {
      current.pause();
      setPlayingId(null);
      return;
    }
    if (current) current.pause();
    try {
      const audio = new Audio(delivery.audioUrl);
      deliveryAudioRef.current = audio;
      setPlayingId(delivery.id);
      audio.addEventListener("ended", () => {
        setPlayingId((prev) => (prev === delivery.id ? null : prev));
      });
      audio.addEventListener("error", () => {
        setPlayingId((prev) => (prev === delivery.id ? null : prev));
      });
      audio.play().catch(() => setPlayingId(null));
    } catch {
      setPlayingId(null);
    }
  };

  /**
   * Subida real de la "Foto de la Sesión":
   *  - Vista previa local inmediata + estado de carga.
   *  - Sube a `flight-photos/{userId}/{flightId}_session_photo.jpg`.
   *  - Persiste la URL pública en `flights.photo_url` y la renderiza.
   *  - Ante un fallo de red/validación se revierte a la foto guardada y se
   *    muestra el error sin romper el reporte.
   */
  const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Permite re-seleccionar el mismo archivo tras un error.
    e.target.value = "";
    if (!file) return;
    if (!flight.flightId) {
      setPhotoError(t("flight_detail.photo_err_no_flight"));
      return;
    }
    const validationError = FlightPhotoService.validateSessionPhoto(file);
    if (validationError) {
      setPhotoError(validationError);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setPhotoImgBroken(false);
    setPhotoError(null);
    setIsUploadingPhoto(true);
    try {
      const res = await FlightPhotoService.uploadSessionPhoto(flight.flightId, file);
      if (res.success && res.data) {
        URL.revokeObjectURL(localPreview);
        setPreviewUrl(null);
        setPhotoUrl(res.data);
        setDetail((prev) => (prev ? { ...prev, photoUrl: res.data as string } : prev));
      } else {
        URL.revokeObjectURL(localPreview);
        setPreviewUrl(null);
        setPhotoError(res.error ?? t("flight_detail.photo_err_generic"));
      }
    } catch (err) {
      URL.revokeObjectURL(localPreview);
      setPreviewUrl(null);
      setPhotoError(err instanceof Error ? err.message : t("flight_detail.photo_err_generic"));
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // Imagen a mostrar: vista previa local (subiendo) o URL persistida.
  const displayPhotoUrl = previewUrl ?? photoUrl;

  // Datos presentados: detalle real o fallback de la fila.
  const flightNumber = detail?.flightNumber ?? flight.codigo;
  const airline = detail?.airline ?? flight.aerolinea;
  const airlineIcao = detail?.airlineIcao ?? getAirlineIcaoByName(flight.aerolinea);
  const airlineLogo = getAirlineLogo(airlineIcao) ?? getGenericAirlineLogo();
  const aircraftCategory = detail?.aircraftCategory ?? null;
  const aircraftSilhouette = getAircraftSilhouette(aircraftCategory);
  const aircraft = detail && detail.aircraft !== "—"
    ? `${detail.aircraft}${detail.aircraftReg !== "—" ? ` · ${detail.aircraftReg}` : ""}`
    : getAircraftByFlight(flight.codigo, flight.aerolinea);
  const originIcao = detail?.originIcao ?? flight.origen;
  const originName = detail?.originName ?? flight.origenCiudad;
  const destIcao = detail?.destIcao ?? flight.destino;
  const destName = detail?.destName ?? flight.destinoCiudad;
  const depTime = detail?.departTime ?? "—";
  const arrTime = detail?.arriveTime ?? "—";
  const durationLong = detail ? formatDurationLong(detail.durationMinutes) : flight.duracion;
  const createdLabel = detail?.createdLabel ?? flight.fecha;
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
          <div className="flex items-center gap-2">
            <button
              id="details-back-button"
              onClick={onBack}
              className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white p-2 rounded-[5px] transition-all cursor-pointer flex items-center justify-center"
              title={t("flight_detail.back")}
            >
              <ArrowLeft className="w-5 h-5 text-[#45AFFF]" />
            </button>
            <button
              id="details-prev-flight"
              onClick={onPrev}
              disabled={!hasPrev}
              className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white p-2 rounded-[5px] transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("flight_detail.prev")}
            >
              <ChevronLeft className="w-5 h-5 text-[#45AFFF]" />
            </button>
            <button
              id="details-next-flight"
              onClick={onNext}
              disabled={!hasNext}
              className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white p-2 rounded-[5px] transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("flight_detail.next")}
            >
              <ChevronRight className="w-5 h-5 text-[#45AFFF]" />
            </button>
          <div>
            <div className="text-xs text-[#45AFFF]/60 font-mono tracking-widest uppercase mb-0.5">{t("flight_detail.subtitle")}</div>
            <h1 className="font-display font-extrabold text-2xl tracking-tight text-[#45AFFF] uppercase flex items-center gap-2">
              {t("flight_detail.title", { flight: flightNumber })}
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
          {t("flight_detail.loading")}
        </div>
      ) : (
        <>
          {loadError && (
            <div className="bg-red-900/30 border border-red-500/40 rounded px-3 py-2 text-[11px] font-mono text-red-300">
              {loadError} {t("flight_detail.basic_data_note")}
            </div>
          )}

          {/* Cabecera: metadatos + foto */}
          <div id="flight-detail-header" className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-6 shadow-md">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
              {/* Columna 1: número de vuelo */}
              <div className="flex flex-col justify-start gap-2">
                <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">{t("flight_detail.col_flight")}</div>
                <div className="w-full max-w-[320px] aspect-[960/530] rounded-[4px] border border-white/20 bg-transparent flex flex-col items-center justify-center px-3 py-2">
                  <div className="font-sans font-black text-4xl text-white tracking-wide text-center">{flightNumber}</div>
                  <div className="text-[11px] font-mono text-white/50 mt-1">{createdLabel}</div>
                </div>
                <div
                  className="inline-flex items-center gap-1.5 bg-[#43E600]/10 border border-[#43E600]/40 rounded-[4px] px-2.5 py-1 font-mono font-extrabold text-sm text-[#43E600] w-full max-w-[320px] justify-center"
                  title={t("flight_detail.xp_tooltip")}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  {xpLoading ? "…" : `${(flightXp?.totalXp ?? 0).toLocaleString("en-US")} XP`}
                </div>
              </div>
              {/* Columna 2: aerolínea (nombre + banner) */}
              <div className="flex flex-col justify-start gap-2">
                <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">{t("flight_detail.col_airline")}</div>
                <div className="flex flex-col items-start gap-1.5">
                  <div className="w-full max-w-[320px] aspect-[960/530] rounded-[4px] border border-black/10 bg-white p-3 flex items-center justify-center">
                    <img
                      src={airlineLogo}
                      alt={t("flight_detail.airline_banner_alt", { airline })}
                      className="max-h-[75%] max-w-[75%] object-contain"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.src !== getGenericAirlineLogo()) img.src = getGenericAirlineLogo();
                      }}
                    />
                  </div>
                  <span className="font-semibold text-white/95">{airline}</span>
                </div>
              </div>
              {/* Columna 3: aeronave (silueta + descripción) */}
              <div className="flex flex-col justify-start gap-2">
                <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">{t("flight_detail.col_aircraft")}</div>
                <img
                  src={aircraftSilhouette}
                  alt={t("flight_detail.aircraft_silhouette_alt", { value: aircraftCategory ?? t("flight_detail.aircraft_silhouette_default") })}
                  className="w-full max-w-[320px] aspect-[960/530] rounded-[4px] border border-black/10 bg-white object-contain p-3"
                />
                <div className="text-sm font-bold text-white">{aircraft}</div>
              </div>

              {/* Columna 4: foto de la sesión (real: Storage `flight-photos` + `flights.photo_url`) */}
              {/* Misma geometría que las tarjetas adyacentes (etiqueta + caja
                  aspect-[960/530]) para igualar alturas; el botón de acción va
                  fuera de la caja, debajo, a la altura de la zona de XP. */}
              <div className="flex flex-col justify-start gap-2">
                <div className="text-[10px] font-mono text-[#45AFFF]/70 tracking-widest uppercase">{t("flight_detail.col_photo")}</div>
                <div className="group relative w-full max-w-[320px] aspect-[960/530] rounded-[4px] border border-[#3B7EB2]/40 bg-[#00172e]/85 overflow-hidden flex items-center justify-center">
                  {displayPhotoUrl && !photoImgBroken ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          // Solo se amplía con foto cargada y fuera de subida.
                          if (!displayPhotoUrl || photoImgBroken || isUploadingPhoto) return;
                          setIsPhotoLightboxOpen(true);
                        }}
                        disabled={isUploadingPhoto}
                        className="h-full w-full cursor-zoom-in disabled:cursor-wait"
                        title={t("flight_detail.photo_zoom_tooltip")}
                      >
                        <img
                          src={displayPhotoUrl}
                          alt={t("flight_detail.photo_alt")}
                          className="h-full w-full object-cover"
                          onError={() => {
                            // Solo cuenta para la URL remota (la previa local siempre carga).
                            if (!previewUrl) setPhotoImgBroken(true);
                          }}
                        />
                      </button>
                      {/* Indicador hover: velo sutil + icono de expansión. */}
                      {!isUploadingPhoto && (
                        <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/35 flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Maximize2 className="w-7 h-7 text-white drop-shadow-lg" />
                        </div>
                      )}
                      {isUploadingPhoto && (
                        <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1.5">
                          <Loader2 className="w-6 h-6 text-[#45AFFF] animate-spin" />
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/85">
                            {t("flight_detail.photo_uploading")}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-white/40">
                      {isUploadingPhoto ? (
                        <Loader2 className="w-10 h-10 text-[#45AFFF] animate-spin" />
                      ) : (
                        <Camera className="w-10 h-10" />
                      )}
                      <span className="text-[11px] font-mono uppercase tracking-wider">
                        {isUploadingPhoto
                          ? t("flight_detail.photo_uploading")
                          : photoImgBroken
                            ? t("flight_detail.photo_load_failed")
                            : t("flight_detail.photo_none")}
                      </span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingPhoto || !flight.flightId}
                  className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white px-3 py-1.5 rounded-[5px] font-mono text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 w-full max-w-[320px] justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  title={flight.flightId ? t("flight_detail.photo_upload_tooltip") : t("flight_detail.photo_no_flight")}
                >
                  {isUploadingPhoto ? (
                    <Loader2 className="w-3.5 h-3.5 text-[#45AFFF] animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-[#45AFFF]" />
                  )}
                  {isUploadingPhoto ? t("flight_detail.photo_uploading_btn") : photoUrl || previewUrl ? t("flight_detail.photo_change") : t("flight_detail.photo_upload")}
                </button>
                {photoError && (
                  <div className="w-full max-w-[320px] bg-red-900/30 border border-red-500/40 rounded px-2.5 py-1.5 text-[10px] font-mono text-red-300 leading-snug">
                    {photoError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Panel de ruta */}
          <div id="flight-route-panel" className="bg-[#00172e]/75 border border-[#3B7EB2]/45 rounded-[5px] p-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-white relative">
            <div className="flex flex-col text-center sm:text-left space-y-1 w-full sm:w-auto">
              <span className="font-sans font-black text-5xl sm:text-6xl tracking-wide uppercase leading-none drop-shadow-md text-white">
                {originIcao}
              </span>
              <span className="text-[10px] text-[#45AFFF]/80 tracking-widest font-mono font-bold block">{t("flight_detail.route_origin")}</span>
              <span className="text-xs text-white/70 font-sans max-w-[220px] leading-snug">{originName}</span>
              <span className="text-xl font-mono font-black text-[#43E600] mt-1 pt-1 block">{depTime}</span>
              <span className="text-[10px] font-mono text-white/40 uppercase">{t("flight_detail.route_depart_time")}</span>
            </div>

            <div className="flex flex-col items-center justify-center flex-1 px-2 max-w-[260px] w-full">
              <span className="text-base font-mono font-extrabold text-white/80 tracking-wider pb-1">{durationLong}</span>
              <div className="flex items-center w-full gap-2 text-[#45AFFF]/70 my-1">
                <div className="h-[2px] flex-1 bg-white/20"></div>
                <Plane className="w-4 h-4 rotate-90 text-[#45AFFF] drop-shadow-lg scale-110" />
                <div className="h-[2px] flex-1 bg-white/20"></div>
              </div>
              <span className="text-base font-mono font-extrabold text-[#45AFFF] tracking-wider pt-1">
                {distanceNm !== null ? `${Math.round(distanceNm)} ${t("flight_detail.nm")}` : "—"}
              </span>
            </div>

            <div className="flex flex-col text-center sm:text-right sm:items-end space-y-1 w-full sm:w-auto">
              <span className="font-sans font-black text-5xl sm:text-6xl tracking-wide uppercase leading-none drop-shadow-md text-white">
                {destIcao}
              </span>
              <span className="text-[10px] text-[#45AFFF]/80 tracking-widest font-mono font-bold block">{t("flight_detail.route_destination")}</span>
              <span className="text-xs text-white/70 font-sans max-w-[220px] leading-snug block">{destName}</span>
              <span className="text-xl font-mono font-black text-[#43E600] mt-1 pt-1 block">{arrTime}</span>
              <span className="text-[10px] font-mono text-white/40 uppercase">{t("flight_detail.route_arrive_time")}</span>
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
                {t("flight_detail.tab_overview")}
              </button>
              <button
                onClick={() => setTab("telemetry")}
                className={`px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider transition-all relative cursor-pointer ${
                  tab === "telemetry"
                    ? "text-[#45AFFF] border-[#45AFFF] bg-[#00345C]/20 border-b-2"
                    : "text-white/60 hover:text-white/90 hover:bg-[#2C6591]/30"
                }`}
              >
                {t("flight_detail.tab_telemetry")}
              </button>
              <button
                onClick={() => setTab("xp")}
                className={`px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider transition-all relative cursor-pointer ${
                  tab === "xp"
                    ? "text-[#45AFFF] border-[#45AFFF] bg-[#00345C]/20 border-b-2"
                    : "text-white/60 hover:text-white/90 hover:bg-[#2C6591]/30"
                }`}
              >
                {t("flight_detail.tab_xp")}
              </button>
              <button
                onClick={() => setTab("pax")}
                className={`px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider transition-all relative cursor-pointer ${
                  tab === "pax"
                    ? "text-[#45AFFF] border-[#45AFFF] bg-[#00345C]/20 border-b-2"
                    : "text-white/60 hover:text-white/90 hover:bg-[#2C6591]/30"
                }`}
              >
                {t("flight_detail.tab_pax")}
              </button>
              <button
                onClick={() => setTab("announcements")}
                className={`px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider transition-all relative cursor-pointer ${
                  tab === "announcements"
                    ? "text-[#45AFFF] border-[#45AFFF] bg-[#00345C]/20 border-b-2"
                    : "text-white/60 hover:text-white/90 hover:bg-[#2C6591]/30"
                }`}
              >
                {t("flight_detail.tab_announcements")}
              </button>
            </div>

            {tab === "overview" ? (
              <FlightTrackMap
                coordinates={coordinates}
                originLabel={`${originIcao} · ${originName}`}
                destLabel={`${destIcao} · ${destName}`}
              />
            ) : tab === "telemetry" ? (
              <FlightTelemetryChart
                coordinates={coordinates}
                startedAt={startedAt}
                endedAt={endedAt}
              />
            ) : tab === "xp" ? (
              <div id="xp-breakdown-panel" className="space-y-4 animate-fadeIn">
                {/* XP Total destacado */}
                <div className="bg-[#00345C]/30 border border-[#43E600]/40 rounded-[5px] p-5 text-center">
                  <div className="text-4xl font-mono font-extrabold text-[#43E600]">
                    {xpLoading ? "…" : `${(flightXp?.totalXp ?? 0).toLocaleString("en-US")} XP`}
                  </div>
                  <div className="text-[11px] font-mono text-white/55 mt-1">
                    {t("flight_detail.xp_total_sub")}
                  </div>
                </div>

                {/* Experiencia ganada: desglose con motivo por bonus */}
                {xpLoading ? (
                  <div className="text-xs font-mono text-white/50 text-center py-4">{t("flight_detail.xp_calculating")}</div>
                ) : flightXp ? (
                  <>
                    {/* Base por tiempo de vuelo efectivo (sin detalle) */}
                    <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                          {t("flight_detail.xp_base_title")}
                          {flightXp.baseMinutes !== null && (
                            <span className="text-white/40 normal-case font-medium">
                              {" "}({flightXp.baseMinutes} min × 10 XP/min)
                            </span>
                          )}
                        </span>
                        <span className="text-lg font-mono font-extrabold text-white whitespace-nowrap">
                          → {(flightXp.baseXp).toLocaleString("en-US")} XP
                        </span>
                      </div>
                    </div>

                    {/* Bonus de campaña vigente (multiplicador reservado al importar) */}
                    {flightXp.campaign && (flightXp.campaign.xp > 0 || flightXp.campaign.multiplier > 1) && (
                      <div className="bg-[#E68B00]/10 border border-[#E68B00]/40 rounded-[5px] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono font-bold text-[#E68B00] uppercase tracking-wider">
                            {t("flight_detail.xp_campaign", { mult: formatMultiplier(flightXp.campaign.multiplier) })}
                          </span>
                          <span className="text-lg font-mono font-extrabold text-[#E68B00] whitespace-nowrap">
                            → +{flightXp.campaign.xp.toLocaleString("en-US")} XP
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Bonus por satisfacción de pasajeros (flights.passenger_xp_awarded) */}
                    {flightXp.passenger && (flightXp.passenger.xp > 0 || flightXp.passenger.score !== null) && (
                      <div className="bg-[#E600D2]/10 border border-[#E600D2]/40 rounded-[5px] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono font-bold text-[#E600D2] uppercase tracking-wider">
                            {t("flight_detail.xp_passenger_title")}
                            {flightXp.passenger.score !== null && (
                              <span className="text-white/50 normal-case font-medium">
                                {" "}{t("flight_detail.xp_passenger_global", { score: flightXp.passenger.score })}
                              </span>
                            )}
                          </span>
                          <span className="text-lg font-mono font-extrabold text-[#E600D2] whitespace-nowrap">
                            → +{flightXp.passenger.xp.toLocaleString("en-US")} XP
                          </span>
                        </div>
                      </div>
                    )}

                    {[
                      { title: t("flight_detail.xp_group_discipline"), items: flightXp.discipline },
                      { title: t("flight_detail.xp_group_environment"), items: flightXp.environment },
                    ].map((group) => {
                      const subtotal = group.items.reduce((sum, item) => sum + item.xp, 0);
                      const explained: XpBonusExplanation[] = explainXpBreakdown(group.items);
                      return (
                        <div key={group.title} className="bg-[#00172e]/60 border border-white/10 rounded-[5px] p-4">
                          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 mb-2">
                            <span className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider">
                              {group.title}
                            </span>
                            <span className="text-lg font-mono font-extrabold text-white whitespace-nowrap">
                              → {subtotal.toLocaleString("en-US")} XP
                            </span>
                          </div>
                          <ul className="space-y-2">
                            {explained.map((bonus) => (
                              <li key={bonus.key} className="flex items-start justify-between gap-2 text-xs font-mono pl-3">
                                <span className="flex flex-col gap-0.5">
                                  <span className="text-white/75">{bonus.label}</span>
                                  <span className={`text-[10px] leading-snug ${
                                    bonus.state === "earned"
                                      ? "text-[#43E600]/80"
                                      : bonus.state === "partial"
                                        ? "text-amber-400/80"
                                        : "text-white/35"
                                  }`}>
                                    {bonus.reason}
                                  </span>
                                </span>
                                <span className={`font-extrabold whitespace-nowrap pt-0.5 ${bonus.xp > 0 ? "text-[#43E600]" : "text-white/35"}`}>
                                  → {bonus.xp.toLocaleString("en-US")} XP
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="text-xs font-mono text-white/50 text-center py-4">
                    {t("flight_detail.xp_no_breakdown")}
                  </div>
                )}
              </div>
            ) : tab === "pax" ? (
              <div id="pax-satisfaction-panel" className="space-y-4 animate-fadeIn">
                {/* Satisfacción global destacada */}
                <div className="bg-[#00345C]/30 border border-[#E600D2]/40 rounded-[5px] p-5 text-center">
                  <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-white/55 uppercase tracking-wider">
                    <Heart className="w-3.5 h-3.5 text-[#E600D2]" />
                    {t("flight_detail.pax_global_title")}
                  </div>
                  <div className="text-4xl font-mono font-extrabold text-white mt-1">
                    {paxReport?.globalSatisfaction === null || paxReport?.globalSatisfaction === undefined
                      ? "—"
                      : `${Math.round(paxReport.globalSatisfaction)}%`}
                  </div>
                  <div className="text-[11px] font-mono text-white/55 mt-1">
                    {paxReport?.passengerXpAwarded === null || paxReport?.passengerXpAwarded === undefined
                      ? t("flight_detail.pax_no_xp")
                      : t("flight_detail.pax_bonus", { xp: paxReport.passengerXpAwarded.toLocaleString("en-US") })}
                  </div>
                </div>

                {/* Desglose por necesidad (0-100, bajo = bien) */}
                {!paxReport?.attributesSummary ? (
                  <div className="text-xs font-mono text-white/50 text-center py-4">
                    {t("flight_detail.pax_no_breakdown")}
                  </div>
                ) : (
                  <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] p-4">
                    <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-3">
                      <Users className="w-3.5 h-3.5 text-[#45AFFF]" />
                      <span className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider">
                        {t("flight_detail.pax_needs_title")}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {[
                        { key: "hunger", label: t("flight_detail.pax_need_hunger"), value: paxReport.attributesSummary.hunger },
                        { key: "bladder", label: t("flight_detail.pax_need_bladder"), value: paxReport.attributesSummary.bladder },
                        { key: "fear", label: t("flight_detail.pax_need_fear"), value: paxReport.attributesSummary.fear },
                        { key: "boredom", label: t("flight_detail.pax_need_boredom"), value: paxReport.attributesSummary.boredom },
                      ].map((need) => {
                        const tone = need.value <= 25
                          ? "bg-[#43E600]"
                          : need.value <= 50
                            ? "bg-[#E68B00]"
                            : "bg-[#E600D2]";
                        const state = need.value <= 25 ? t("flight_detail.pax_state_optimal") : need.value <= 50 ? t("flight_detail.pax_state_acceptable") : t("flight_detail.pax_state_critical");
                        return (
                          <div key={need.key}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-xs font-mono text-white/75">{need.label}</span>
                              <span className="font-mono text-[11px] text-white/85">
                                {need.value}% <span className="text-white/40">· {state}</span>
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                              <div className={`h-full rounded-full ${tone}`} style={{ width: `${need.value}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[10px] font-mono text-white/35 mt-3">
                      {t("flight_detail.pax_needs_note")}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div id="flight-announcements-panel" className="space-y-4 animate-fadeIn">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Izquierda: personal e idioma (operativo) */}
                  <div className="space-y-4">
                    <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] px-4 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-[#45AFFF]" />
                        {t("flight_detail.ann_language")}
                      </span>
                      {crewReport?.language ? (
                        <span className="flex items-center gap-2">
                          {crewReport.language.flagUrl ? (
                            <img
                              src={crewReport.language.flagUrl}
                              alt={crewReport.language.name}
                              className="w-6 h-6 rounded-full object-cover border border-white/20"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <span className="text-lg leading-none" aria-hidden="true">
                              {languageFlag(crewReport.language.name)}
                            </span>
                          )}
                          <span className="text-xs font-sans font-bold text-white">
                            {crewReport.language.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs font-mono text-white/50">—</span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <VoiceBox title="Captain" voice={crewReport?.captain ?? null} />
                      <VoiceBox title="Boarding" voice={crewReport?.boarding ?? null} />
                      <VoiceBox title="Crew" voice={crewReport?.crew ?? null} />
                    </div>
                  </div>

                  {/* Derecha: historial de anuncios entregados (línea de tiempo) */}
                  <div className="space-y-2">
                    {deliveries === null ? (
                      <div className="text-xs font-mono text-white/50 text-center py-4">
                        {t("flight_detail.ann_loading")}
                      </div>
                    ) : deliveries.length === 0 ? (
                      <div className="text-xs font-mono text-white/50 text-center py-4">
                        {t("flight_detail.ann_empty")}
                      </div>
                    ) : (
                      <div className="relative pl-4">
                        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-white/15" aria-hidden="true" />
                        <div className="space-y-2">
                          {deliveries.map((item) => {
                            const isPlaying = playingId === item.id;
                            const isExpanded = expandedDeliveryId === item.id;
                            return (
                              <div
                                key={item.id}
                                className="relative bg-black/25 border border-white/10 rounded-[5px] p-3"
                              >
                                <span
                                  className={`absolute left-[-13px] top-4 w-2 h-2 rounded-full border ${
                                    isPlaying
                                      ? "bg-[#43E600] border-[#43E600]"
                                      : "bg-[#00345C] border-[#45AFFF]/60"
                                  }`}
                                  aria-hidden="true"
                                />
                                <div className="flex items-start justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedDeliveryId(isExpanded ? null : item.id)}
                                    aria-expanded={isExpanded}
                                    title={isExpanded ? t("flight_detail.ann_collapse") : t("flight_detail.ann_expand")}
                                    className="flex items-center gap-1 min-w-0 text-left cursor-pointer group"
                                  >
                                    <span className="flex flex-col gap-1 min-w-0">
                                      <span className="font-mono text-[10px] text-white/40">
                                        {formatDeliveryTime(item.deliveredAt)}
                                      </span>
                                      <span className="text-xs font-sans font-bold text-white group-hover:text-[#45AFFF] transition-colors">
                                        {item.title}
                                      </span>
                                      {item.narrator && (
                                        <span className="font-mono text-[10px] text-white/55 flex items-center gap-1">
                                          <Mic className="w-3 h-3" />
                                          {item.narrator}
                                        </span>
                                      )}
                                    </span>
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 text-white/40 shrink-0 transition-transform duration-200 ${
                                        isExpanded ? "rotate-180" : ""
                                      }`}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!item.audioUrl}
                                    onClick={() => toggleDeliveryPlay(item)}
                                    title={item.audioUrl ? (isPlaying ? t("flight_detail.ann_pause") : t("flight_detail.ann_play")) : t("flight_detail.ann_no_audio")}
                                    aria-label={isPlaying ? t("flight_detail.ann_pause_aria") : t("flight_detail.ann_play_aria")}
                                    className={`shrink-0 p-2 rounded-[5px] border flex items-center justify-center transition-all ${
                                      !item.audioUrl
                                        ? "bg-[#2C6591]/40 border-white/10 text-white/40 cursor-not-allowed"
                                        : isPlaying
                                          ? "bg-[#43E600]/20 border-[#43E600]/60 text-[#43E600] hover:bg-[#43E600]/30 cursor-pointer"
                                          : "bg-[#45AFFF]/15 border-[#45AFFF]/40 text-[#45AFFF] hover:bg-[#45AFFF]/30 cursor-pointer"
                                    }`}
                                  >
                                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                {isExpanded && item.messageText && (
                                  <div className="font-mono text-[11px] text-white/60 leading-relaxed pt-2 mt-2 border-t border-white/10 animate-fadeIn">
                                    {item.messageText}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Lightbox de la foto de la sesión (solo con foto cargada). */}
          {isPhotoLightboxOpen && displayPhotoUrl && !photoImgBroken && (
            <div
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-8 animate-fadeIn"
              onClick={() => setIsPhotoLightboxOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label={t("flight_detail.lightbox_aria")}
            >
              <button
                type="button"
                onClick={() => setIsPhotoLightboxOpen(false)}
                className="absolute top-4 right-4 bg-[#2C6591]/60 border border-white/20 hover:bg-[#45AFFF]/25 text-white p-2 rounded-[5px] transition-all cursor-pointer flex items-center justify-center"
                title={t("flight_detail.lightbox_close")}
                aria-label={t("flight_detail.lightbox_close_aria")}
              >
                <X className="w-5 h-5 text-white" />
              </button>
              <img
                src={displayPhotoUrl}
                alt={t("flight_detail.lightbox_img_alt", { flight: flightNumber })}
                className="max-h-[85vh] max-w-[90vw] rounded-[5px] border border-white/15 object-contain shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
