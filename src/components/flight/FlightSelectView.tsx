/**
 * FlightSelectView — pantalla de selección "Volar" (previa a la configuración).
 *
 * Tres secciones apiladas en vertical:
 *  - Arriba (100%): bloque dedicado "Importar desde SimBrief".
 *  - Medio (100%): "Campaña Activa" con datos reales de `weekly_campaigns` /
 *    `weekly_campaign_flights`: una fila por campaña (resumen + sus vuelos
 *    seleccionables), botón único de export en el título y lupa para
 *    maximizar cada tarjeta en un popup de lectura.
 *  - Abajo (100%): "Rutas Reales" con botones de acción en la fila del
 *    título, boxes de filtros (Salida / Llegada / Aerolínea-Avión) y grilla
 *    de resultados por debajo.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Download,
  Eraser,
  Loader2,
  Maximize2,
  Plane,
  Search,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import {
  buildSimbriefDispatchUrl,
  loadAirlineOptions,
  loadEquipmentOptions,
  randomFlightNumber,
  resolveAircraftIcao,
  searchRealRoutes,
  REAL_ROUTES_PAGE_SIZE,
  type RealRouteFilters,
  type RealRouteResult,
} from "../../services/RealRoutesService";
import {
  formatMultiplier,
  loadActiveCampaigns,
  toSimbriefDateTime,
  type Campaign,
  type CampaignFlight,
} from "../../services/CampaignService";
import { getAirlineLogo, getGenericAirlineLogo } from "../../utils/airlineLogos";
import { getAircraftSilhouette } from "../../utils/aircraftSilhouettes";
import { openExternalUrl } from "../../utils/openExternal";

export interface FlightSelectViewProps {
  hasSimbriefId: boolean;
  isFetchingSimbrief: boolean;
  simbriefError: string | null;
  onImportSimbrief: () => void;
  onNavigateToAccount: () => void;
}

interface RouteFilters {
  originCity: string;
  originAirport: string;
  originIcao: string;
  destCity: string;
  destAirport: string;
  destIcao: string;
  airline: string;
  aircraft: string;
}

const EMPTY_FILTERS: RouteFilters = {
  originCity: "",
  originAirport: "",
  originIcao: "",
  destCity: "",
  destAirport: "",
  destIcao: "",
  airline: "",
  aircraft: "",
};

function FilterInput({
  label,
  value,
  placeholder,
  onChange,
  listId,
  options,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  listId?: string;
  options?: string[];
}) {
  // Sugerencias dinámicas: la lista completa (~6k aerolíneas) no entra en el
  // DOM (tope 400), así que al tipear se filtra por subcadena — si no, solo
  // aparecen las primeras 400 alfabéticas y el resto "no existe" en la UI.
  const shownOptions = useMemo(() => {
    const all = options ?? [];
    const needle = value.trim().toLowerCase();
    if (!needle) return all.slice(0, 400);
    return all.filter((o) => o.toLowerCase().includes(needle)).slice(0, 400);
  }, [options, value]);
  return (
    <label className="block">
      <span className="block text-[10px] font-mono font-bold text-white/55 uppercase tracking-wider mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        autoComplete="off"
        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20"
      />
      {listId && options && (
        <datalist id={listId}>
          {shownOptions.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      )}
    </label>
  );
}

export default function FlightSelectView({
  hasSimbriefId,
  isFetchingSimbrief,
  simbriefError,
  onImportSimbrief,
  onNavigateToAccount,
}: FlightSelectViewProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<RouteFilters>(EMPTY_FILTERS);
  // Resultados: null = sin búsqueda (o tras limpiar); [] = sin coincidencias.
  const [results, setResults] = useState<RealRouteResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Ruta seleccionada de la grilla para enviar a SimBrief (índice en results).
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  // Código ICAO de la aeronave seleccionada (traducido desde el formato
  // IATA de of_routes vía of_planes; null = sin resolver aún).
  const [resolvedIcao, setResolvedIcao] = useState<string | null>(null);
  const [isResolvingIcao, setIsResolvingIcao] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // Paginación de la grilla (5 filas por página).
  const [page, setPage] = useState(1);
  const RESULTS_PER_PAGE = 5;
  const totalPages = results ? Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE)) : 1;
  const safePage = Math.min(page, totalPages);
  const pageRows = results
    ? results.slice((safePage - 1) * RESULTS_PER_PAGE, safePage * RESULTS_PER_PAGE)
    : [];
  const [airlineOptions, setAirlineOptions] = useState<string[]>([]);
  const [equipmentOptions, setEquipmentOptions] = useState<string[]>([]);
  // Campañas vigentes (null = aún cargando; [] = sin vigentes).
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  // Vuelo de campaña seleccionado (el botón único del título exporta este).
  const [selectedCampaignFlightId, setSelectedCampaignFlightId] = useState<string | null>(null);
  // Tarjeta maximizada en popup de lectura (resumen o vuelo de campaña).
  const [zoomed, setZoomed] = useState<
    | { kind: "campaign"; campaign: Campaign }
    | { kind: "flight"; flight: CampaignFlight }
    | null
  >(null);

  // Cerrar el popup con Escape.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);
  const set = (key: keyof RouteFilters) => (v: string) =>
    setFilters((prev) => ({ ...prev, [key]: v }));

  // Opciones de autocompletado desde la DB (una carga por sesión, con caché).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [airlinesRes, equipmentRes] = await Promise.all([
        loadAirlineOptions(),
        loadEquipmentOptions(),
      ]);
      if (cancelled) return;
      if (airlinesRes.success && airlinesRes.data) setAirlineOptions(airlinesRes.data);
      if (equipmentRes.success && equipmentRes.data) setEquipmentOptions(equipmentRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Campañas vigentes (una carga al montar la vista).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadActiveCampaigns();
      if (cancelled) return;
      if (res.success) {
        setCampaigns(res.data ?? []);
        setCampaignError(null);
      } else {
        setCampaigns([]);
        setCampaignError(res.error ?? t("volar.campaign_error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setPage(1);
    setSelectedIdx(null);
    setSendWarning(null);
    setResolvedIcao(null);
    try {
      const res = await searchRealRoutes(filters);
      if (res.success) {
        setResults(res.data ?? []);
      } else {
        setResults([]);
        setSearchError(res.error ?? t("volar.search_error"));
      }
    } catch (err) {
      setResults([]);
      setSearchError(err instanceof Error ? err.message : t("volar.search_error"));
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    setFilters(EMPTY_FILTERS);
    setResults(null);
    setSearchError(null);
    setPage(1);
    setSelectedIdx(null);
    setSendWarning(null);
    setResolvedIcao(null);
  };

  // Exporta un vuelo de campaña al despacho de SimBrief (redirect con
  // origen, destino, aerolínea, ICAO de aeronave y n° vuelo/fecha si hay).
  const handleCampaignExport = async (flight: CampaignFlight) => {
    const dt = toSimbriefDateTime(flight.departureTime);
    const url = buildSimbriefDispatchUrl({
      originCode: flight.originIcao,
      destCode: flight.destinationIcao,
      airlineIcao: flight.airlineCode,
      equipment: flight.aircraftIcao,
      flightNumber: flight.flightNumber,
      date: dt?.date,
      depHour: dt?.deph,
      depMinute: dt?.depm,
    });
    try {
      await openExternalUrl(url);
    } catch {
      setCampaignError(t("volar.send_error"));
    }
  };

  // Envía la ruta seleccionada al despacho de SimBrief (solo Rutas Reales).
  // El equipo de of_routes viene en formato IATA (ej. "738") y se traduce
  // al código ICAO (ej. "B738") vía of_planes antes de construir la URL,
  // junto con origen, destino y aerolínea. Como las rutas reales no traen
  // número de vuelo, se asigna uno al azar de 3-4 dígitos para que el
  // despacho no se genere como "0000" si el usuario no lo modifica.
  // Sin selección no se envía nada: se muestra el aviso de validación.
  // En desktop se abre el navegador por defecto (window.open no funciona en Tauri).
  const handleSendToSimbrief = async () => {
    const selected = selectedIdx !== null ? results?.[selectedIdx] ?? null : null;
    if (!selected) {
      setSendWarning(t("volar.no_selection"));
      return;
    }
    setSendWarning(null);
    setIsSending(true);
    try {
      // Usa el ICAO ya resuelto al seleccionar, o lo resuelve ahora como
      // respaldo (resolveAircraftIcao aplica fallback seguro al original).
      const equipment =
        resolvedIcao ?? (await resolveAircraftIcao(selected.equipment));
      if (resolvedIcao === null) setResolvedIcao(equipment);
      const url = buildSimbriefDispatchUrl({
        originCode: selected.originCode,
        destCode: selected.destCode,
        airlineIcao: selected.airlineIcao,
        airlineIata: selected.airlineIata,
        equipment,
        flightNumber: randomFlightNumber(),
      });
      await openExternalUrl(url);
    } catch {
      setSendWarning(t("volar.send_error"));
    } finally {
      setIsSending(false);
    }
  };
  const selectedRoute = selectedIdx !== null ? results?.[selectedIdx] ?? null : null;
  const selectedCampaignFlight = campaigns
    ?.flatMap((c) => c.flights)
    .find((f) => f.id === selectedCampaignFlightId) ?? null;
  const selectedEquipment = selectedRoute?.equipment ?? "";

  // Al seleccionar una ruta se resuelve el ICAO de la aeronave en segundo
  // plano para mostrarlo y tenerlo listo al enviar.
  useEffect(() => {
    if (!selectedRoute) {
      setResolvedIcao(null);
      setIsResolvingIcao(false);
      return;
    }
    let cancelled = false;
    setResolvedIcao(null);
    setIsResolvingIcao(true);
    (async () => {
      const icao = await resolveAircraftIcao(selectedRoute.equipment);
      if (!cancelled) {
        setResolvedIcao(icao);
        setIsResolvingIcao(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEquipment, selectedIdx]);

  const importButton = (id: string, className: string, label: string) => {
    if (!hasSimbriefId) {
      return (
        <button
          key={id}
          type="button"
          onClick={onNavigateToAccount}
          className="px-4 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/40"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {t("volar.no_id_btn")}
        </button>
      );
    }
    return (
      <button
        key={id}
        id={id}
        type="button"
        onClick={onImportSimbrief}
        disabled={isFetchingSimbrief}
        className={className}
      >
        {isFetchingSimbrief ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        {isFetchingSimbrief ? t("volar.importing") : label}
      </button>
    );
  };

  return (
    <div id="volar-select" className="space-y-6 animate-fadeIn">
      {/* Arriba (100%): bloque dedicado de importación SimBrief */}
      <section className="bg-[#001d35]/75 border border-[#43E600]/40 rounded-[8px] p-6 shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 w-full">
        <div className="flex items-center gap-3">
          <Download className="w-8 h-8 text-[#43E600] shrink-0" />
          <div>
            <h3 className="font-display font-bold text-base text-white uppercase">
              {t("volar.import_title")}
            </h3>
            <p className="text-[11px] font-sans text-white/55 leading-relaxed">
              {t("volar.import_subtitle")}
            </p>
            {simbriefError && (
              <p className="text-red-500 text-xs font-semibold mt-1">
                {t(`current_flight.not_started.errors.${simbriefError}`, { defaultValue: simbriefError })}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 flex md:justify-end">
          {importButton(
            "btn-import-simbrief-main",
            "px-6 py-3 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-[#43E600]/10 hover:bg-[#43E600]/20 text-[#43E600] border border-[#43E600] shadow-[0_0_15px_rgba(67,230,0,0.25)] disabled:opacity-50 disabled:cursor-not-allowed",
            t("volar.import_btn_main")
          )}
        </div>
      </section>

      <div className="space-y-6">
        {/* Campaña Activa (datos reales de weekly_campaigns): una fila por
            campaña con resumen + sus vuelos (4 columnas en horizontal).
            Un único botón en el título exporta el vuelo seleccionado. */}
        <section className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#E68B00]" />
              <div>
                <h3 className="font-display font-bold text-base text-[#E68B00]">
                  {t("volar.campaign_title")}
                </h3>
                <p className="text-[10px] font-mono text-white/40">{t("volar.campaign_subtitle")}</p>
              </div>
            </div>
            <div className="shrink-0 flex md:justify-end">
              <button
                type="button"
                onClick={() => {
                  if (selectedCampaignFlight) void handleCampaignExport(selectedCampaignFlight);
                }}
                disabled={!selectedCampaignFlight}
                title={!selectedCampaignFlight ? t("volar.campaign_no_selection") : t("volar.campaign_send_btn")}
                className="px-4 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-[#45AFFF]/15 hover:bg-[#45AFFF]/30 text-[#45AFFF] border border-[#45AFFF]/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                {t("volar.campaign_send_btn")}
              </button>
            </div>
          </div>

          {campaigns === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 text-[#E68B00] animate-spin" />
            </div>
          ) : campaignError ? (
            <p className="py-4 px-3 text-center text-[11px] font-mono text-red-300">
              {campaignError}
            </p>
          ) : campaigns.length === 0 ? (
            <p className="py-4 px-3 text-center text-[11px] font-mono text-white/40 italic">
              {t("volar.campaign_empty")}
            </p>
          ) : (
            <div className="space-y-4">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Columna 1: resumen de la campaña */}
                  <div className="relative bg-black/25 border border-[#E68B00]/40 rounded-[5px] overflow-hidden flex flex-col">
                    <button
                      type="button"
                      onClick={() => setZoomed({ kind: "campaign", campaign })}
                      title={t("volar.campaign_zoom")}
                      aria-label={t("volar.campaign_zoom")}
                      className="absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 border border-white/15 rounded-[4px] p-1.5 text-white/70 hover:text-white transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    {campaign.imageUrl && (
                      <img
                        src={campaign.imageUrl}
                        alt={campaign.title}
                        loading="lazy"
                        className="w-full h-32 object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div className="p-4 flex flex-col gap-1.5">
                      <div className="text-sm font-sans font-black text-white uppercase">
                        {campaign.title}
                      </div>
                      <p className="text-[11px] font-sans text-white/60 leading-relaxed">
                        {campaign.description}
                      </p>
                    </div>
                  </div>

                  {/* Columnas 2-4: vuelos seleccionables de la campaña */}
                  {campaign.flights.map((flight) => {
                    const isSelected = selectedCampaignFlightId === flight.id;
                    const logo = getAirlineLogo(flight.airlineCode) ?? getGenericAirlineLogo();
                    return (
                    <div
                      key={flight.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      title={flight.originIcao + " → " + flight.destinationIcao}
                      onClick={() => {
                        setSelectedCampaignFlightId(isSelected ? null : flight.id);
                        setCampaignError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedCampaignFlightId(isSelected ? null : flight.id);
                          setCampaignError(null);
                        }
                      }}
                      className={`relative bg-black/25 rounded-[5px] p-4 transition-all flex flex-col justify-between gap-3 cursor-pointer border ${
                        isSelected
                          ? "border-[#E68B00] ring-1 ring-[#E68B00]/60 shadow-[0_0_15px_rgba(230,139,0,0.25)]"
                          : "border-white/10 hover:border-[#E68B00]/45"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomed({ kind: "flight", flight });
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        title={t("volar.campaign_zoom")}
                        aria-label={t("volar.campaign_zoom")}
                        className="absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 border border-white/15 rounded-[4px] p-1.5 text-white/70 hover:text-white transition-colors cursor-pointer"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="space-y-2.5 pr-7">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[13px] font-mono font-extrabold text-[#45AFFF]">
                              {flight.originIcao} → {flight.destinationIcao}
                            </div>
                            {(flight.originName || flight.destinationName) && (
                              <div className="text-[10px] font-sans text-white/45 leading-snug mt-0.5">
                                {flight.originName || flight.originIcao}
                                {" → "}
                                {flight.destinationName || flight.destinationIcao}
                              </div>
                            )}
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1 bg-[#43E600]/10 border border-[#43E600]/40 rounded-[4px] px-2 py-1 font-mono font-extrabold text-[11px] text-[#43E600] whitespace-nowrap">
                            <Sparkles className="w-3 h-3" />
                            {formatMultiplier(flight.xpMultiplier)} XP
                          </span>
                        </div>
                        <div className="flex items-center gap-2 bg-black/20 border border-white/5 rounded-[4px] px-2 py-1.5">
                          <span className="flex items-center justify-center bg-white rounded-[4px] h-12 w-12 p-1 shrink-0">
                            <img
                              src={logo}
                              alt={flight.airlineName || flight.airlineCode}
                              loading="lazy"
                              className="max-h-full max-w-full object-contain block"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                if (img.src !== getGenericAirlineLogo()) img.src = getGenericAirlineLogo();
                              }}
                            />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[11px] font-sans font-bold text-white/90 truncate">
                              {flight.airlineName || flight.airlineCode || "—"}
                            </div>
                            {(flight.airlineCode || flight.flightNumber) && (
                              <div className="text-[10px] font-mono text-white/45">
                                {flight.airlineCode}{flight.flightNumber ? ` ${flight.flightNumber}` : ""}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-black/20 border border-white/5 rounded-[4px] px-2 py-1.5">
                          <span className="flex items-center justify-center bg-white rounded-[4px] h-12 w-12 p-1 shrink-0">
                            <img
                              src={getAircraftSilhouette(flight.aircraftCategory || flight.aircraftIcao)}
                              alt={flight.aircraftName || flight.aircraftIcao}
                              loading="lazy"
                              className="max-h-full max-w-full object-contain block"
                            />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[11px] font-sans font-bold text-white/90 truncate">
                              {flight.aircraftName || flight.aircraftIcao || "—"}
                            </div>
                            {flight.aircraftName && flight.aircraftIcao && (
                              <div className="text-[10px] font-mono text-white/45">
                                {flight.aircraftIcao}
                              </div>
                            )}
                          </div>
                        </div>
                        {flight.description && (
                          <p className="text-[11px] font-sans text-white/60 leading-relaxed">
                            {flight.description}
                          </p>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Popup de lectura: tarjeta maximizada */}
          {zoomed && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fadeIn"
              onClick={() => setZoomed(null)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#00172e] border border-[#3B7EB2]/50 rounded-[8px] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
                  <h4 className="font-display font-bold text-lg text-white uppercase">
                    {zoomed.kind === "campaign"
                      ? zoomed.campaign.title
                      : `${zoomed.flight.originIcao} → ${zoomed.flight.destinationIcao}`}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setZoomed(null)}
                    title={t("volar.campaign_close")}
                    aria-label={t("volar.campaign_close")}
                    className="bg-white/5 hover:bg-white/15 border border-white/10 rounded-[4px] p-2 text-white/70 hover:text-white transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {zoomed.kind === "campaign" ? (
                    <>
                      {zoomed.campaign.imageUrl && (
                        <img
                          src={zoomed.campaign.imageUrl}
                          alt={zoomed.campaign.title}
                          className="w-full h-56 object-cover rounded-[5px]"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      <p className="text-sm font-sans text-white/75 leading-relaxed">
                        {zoomed.campaign.description}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-2xl font-mono font-extrabold text-[#45AFFF]">
                            {zoomed.flight.originIcao} → {zoomed.flight.destinationIcao}
                          </div>
                          {(zoomed.flight.originName || zoomed.flight.destinationName) && (
                            <div className="text-sm font-sans text-white/55 mt-1">
                              {zoomed.flight.originName || zoomed.flight.originIcao}
                              {" → "}
                              {zoomed.flight.destinationName || zoomed.flight.destinationIcao}
                            </div>
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1.5 bg-[#43E600]/10 border border-[#43E600]/40 rounded-[4px] px-3 py-1.5 font-mono font-extrabold text-sm text-[#43E600] whitespace-nowrap">
                          <Sparkles className="w-4 h-4" />
                          {formatMultiplier(zoomed.flight.xpMultiplier)} XP
                        </span>
                      </div>
                      <div className="flex items-center gap-3 bg-black/20 border border-white/5 rounded-[5px] px-3 py-2.5">
                        <span className="flex items-center justify-center bg-white rounded-[4px] h-20 w-20 p-1.5 shrink-0">
                          <img
                            src={getAirlineLogo(zoomed.flight.airlineCode) ?? getGenericAirlineLogo()}
                            alt={zoomed.flight.airlineName || zoomed.flight.airlineCode}
                            className="max-h-full max-w-full object-contain block"
                            onError={(e) => {
                              const img = e.target as HTMLImageElement;
                              if (img.src !== getGenericAirlineLogo()) img.src = getGenericAirlineLogo();
                            }}
                          />
                        </span>
                        <div>
                          <div className="text-base font-sans font-bold text-white">
                            {zoomed.flight.airlineName || zoomed.flight.airlineCode || "—"}
                          </div>
                          {(zoomed.flight.airlineCode || zoomed.flight.flightNumber) && (
                            <div className="text-xs font-mono text-white/50">
                              {zoomed.flight.airlineCode}{zoomed.flight.flightNumber ? ` ${zoomed.flight.flightNumber}` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-black/20 border border-white/5 rounded-[5px] px-3 py-2.5">
                        <span className="flex items-center justify-center bg-white rounded-[4px] h-20 w-20 p-1.5 shrink-0">
                          <img
                            src={getAircraftSilhouette(zoomed.flight.aircraftCategory || zoomed.flight.aircraftIcao)}
                            alt={zoomed.flight.aircraftName || zoomed.flight.aircraftIcao}
                            className="max-h-full max-w-full object-contain block"
                          />
                        </span>
                        <div>
                          <div className="text-base font-sans font-bold text-white">
                            {zoomed.flight.aircraftName || zoomed.flight.aircraftIcao || "—"}
                          </div>
                          {zoomed.flight.aircraftName && zoomed.flight.aircraftIcao && (
                            <div className="text-xs font-mono text-white/50">
                              {zoomed.flight.aircraftIcao}
                            </div>
                          )}
                        </div>
                      </div>
                      {zoomed.flight.description && (
                        <p className="text-sm font-sans text-white/75 leading-relaxed">
                          {zoomed.flight.description}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="flex justify-end border-t border-white/10 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => setZoomed(null)}
                    className="px-6 py-2.5 rounded-[5px] text-xs font-mono font-bold transition-all cursor-pointer bg-white/5 hover:bg-white/15 text-white/80 border border-white/10"
                  >
                    {t("volar.campaign_close")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Segundo (100%): Rutas Reales — acciones en el título, boxes de filtros, grilla debajo */}
        <section className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Plane className="w-5 h-5 text-[#45AFFF]" />
              <div>
                <h3 className="font-display font-bold text-base text-[#45AFFF]">
                  {t("volar.real_title")}
                </h3>
                <p className="text-[10px] font-mono text-white/40">{t("volar.real_subtitle")}</p>
              </div>
            </div>
            <div className="shrink-0 flex flex-wrap gap-2 md:justify-end">
              <button
                type="button"
                onClick={handleSearch}
                disabled={isSearching}
                className="px-4 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer bg-[#43E600] hover:bg-[#3cd000] text-black disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSearching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={3} />
                ) : (
                  <Search className="w-3.5 h-3.5" strokeWidth={3} />
                )}
                {isSearching ? t("volar.searching") : t("volar.search_btn")}
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={isSearching}
                className="px-4 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Eraser className="w-3.5 h-3.5" />
                {t("volar.clear_btn")}
              </button>
              <button
                type="button"
                onClick={handleSendToSimbrief}
                disabled={isSending}
                className="px-4 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-[#45AFFF]/15 hover:bg-[#45AFFF]/30 text-[#45AFFF] border border-[#45AFFF]/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {t("volar.import_btn")}
              </button>
            </div>
          </div>

          {/* Boxes de filtros */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_0.9fr] gap-2.5 items-stretch">
            <div className="bg-black/20 border border-white/5 rounded-[5px] p-3 space-y-2.5">
              <div className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase border-b border-white/5 pb-1">
                {t("volar.filter_origin_title")}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <FilterInput label={`${t("volar.f_city")} *`} value={filters.originCity} placeholder="Buenos Aires" onChange={set("originCity")} />
                <FilterInput label={`${t("volar.f_airport")} *`} value={filters.originAirport} placeholder="Aeroparque" onChange={set("originAirport")} />
                <FilterInput label={t("volar.f_icao")} value={filters.originIcao} placeholder="SABE" onChange={set("originIcao")} />
              </div>
            </div>

            <div className="bg-black/20 border border-white/5 rounded-[5px] p-3 space-y-2.5">
              <div className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase border-b border-white/5 pb-1">
                {t("volar.filter_dest_title")}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <FilterInput label={`${t("volar.f_city")} *`} value={filters.destCity} placeholder="Santiago" onChange={set("destCity")} />
                <FilterInput label={`${t("volar.f_airport")} *`} value={filters.destAirport} placeholder="Arturo Merino" onChange={set("destAirport")} />
                <FilterInput label={t("volar.f_icao")} value={filters.destIcao} placeholder="SCEL" onChange={set("destIcao")} />
              </div>
            </div>

            <div className="bg-black/20 border border-white/5 rounded-[5px] p-3 space-y-2.5">
              <div className="text-[10px] font-mono font-extrabold tracking-widest uppercase border-b border-white/5 pb-1 invisible select-none" aria-hidden="true">
                &nbsp;
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <FilterInput label={t("volar.f_airline")} value={filters.airline} placeholder="LATAM" onChange={set("airline")} listId="volar-airlines" options={airlineOptions} />
                <FilterInput label={t("volar.f_aircraft")} value={filters.aircraft} placeholder="738" onChange={set("aircraft")} listId="volar-equipment" options={equipmentOptions} />
              </div>
            </div>
          </div>

          <p className="text-[10px] font-mono text-white/35 italic">* {t("volar.english_hint")}</p>

          {/* Zona inferior: resultados */}
          <div className="space-y-3 min-w-0">
              {searchError && (
                <div className="bg-red-900/30 border border-red-500/40 rounded px-3 py-2 text-[11px] font-mono text-red-300">
                  {searchError}
                </div>
              )}

              {/* Grilla de resultados */}
              <div className="border border-white/10 rounded-[5px] overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#00345C]/60 text-[10px] font-mono font-bold text-[#45AFFF] uppercase tracking-wider">
                      <th className="py-2 px-3">{t("volar.grid_airline")}</th>
                      <th className="py-2 px-3">{t("volar.grid_origin")}</th>
                      <th className="py-2 px-3">{t("volar.grid_destination")}</th>
                      <th className="py-2 px-3">{t("volar.grid_aircraft")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results === null ? (
                      <tr>
                        <td colSpan={4} className="py-4 px-3 text-center text-[11px] font-mono text-white/40 italic">
                          {t("volar.grid_initial")}
                        </td>
                      </tr>
                    ) : isSearching ? (
                      <tr>
                        <td colSpan={4} className="py-4 px-3 text-center">
                          <Loader2 className="w-5 h-5 text-[#45AFFF] animate-spin inline" />
                        </td>
                      </tr>
                    ) : results.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 px-3 text-center text-[11px] font-mono text-white/40 italic">
                          {t("volar.grid_empty")}
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((r, idx) => {
                        const absoluteIdx = (safePage - 1) * RESULTS_PER_PAGE + idx;
                        const isSelected = selectedIdx === absoluteIdx;
                        return (
                        <tr
                          key={`${r.airlineName}-${r.originCode}-${r.destCode}-${r.equipment}-${absoluteIdx}`}
                          onClick={() => {
                            setSelectedIdx(isSelected ? null : absoluteIdx);
                            setSendWarning(null);
                            setResolvedIcao(null);
                          }}
                          title={t("volar.select_hint")}
                          className={`border-t border-white/5 text-xs cursor-pointer transition-colors ${
                            isSelected ? "bg-[#45AFFF]/15 hover:bg-[#45AFFF]/20" : "hover:bg-white/[0.03]"
                          }`}
                        >
                          <td className="py-2 px-3 font-sans font-bold text-white/90">{r.airlineName}</td>
                          <td className="py-2 px-3 font-mono text-white/75">
                            {r.originCode} <span className="text-white/40">· {r.originName}{r.originCity ? ` (${r.originCity})` : ""}</span>
                          </td>
                          <td className="py-2 px-3 font-mono text-white/75">
                            {r.destCode} <span className="text-white/40">· {r.destName}{r.destCity ? ` (${r.destCity})` : ""}</span>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-[#43E600]">{r.equipment}</td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {(results !== null && !isSearching && results.length > RESULTS_PER_PAGE) && (
                <div className="flex items-center justify-between gap-2 px-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 rounded-[5px] text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← {t("volar.page_prev")}
                  </button>
                  <span className="text-[10px] font-mono text-white/50">
                    {t("volar.page_of", { page: safePage, pages: totalPages })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="px-3 py-1.5 rounded-[5px] text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t("volar.page_next")} →
                  </button>
                </div>
              )}
              {results !== null && !isSearching && (
                <p className="text-[10px] font-mono text-white/30 italic">
                  {t("volar.results_count", { count: results.length, limit: REAL_ROUTES_PAGE_SIZE })}
                </p>
              )}

              <div className="space-y-2">
                <p className="text-[10px] font-mono text-white/40 italic">{t("volar.select_hint")}</p>
                {selectedRoute && (
                  <p className="text-[11px] font-mono text-[#43E600]">
                    {t("volar.selected_route")} {selectedRoute.originCode} → {selectedRoute.destCode}
                    {" · "}{selectedRoute.airlineName}
                    {(selectedRoute.airlineIcao || selectedRoute.airlineIata) && (
                      <span> ({selectedRoute.airlineIcao || selectedRoute.airlineIata})</span>
                    )}
                    {" · "}{selectedRoute.equipment}
                    {isResolvingIcao ? (
                      <span className="text-white/40"> → …</span>
                    ) : (
                      resolvedIcao && resolvedIcao !== selectedRoute.equipment.trim().toUpperCase().split(/\s+/)[0] && (
                        <span> → {resolvedIcao}</span>
                      )
                    )}
                  </p>
                )}
                {sendWarning && (
                  <p className="text-[11px] font-mono text-amber-400 font-bold">{sendWarning}</p>
                )}
              </div>
            </div>
        </section>
      </div>
    </div>
  );
}
