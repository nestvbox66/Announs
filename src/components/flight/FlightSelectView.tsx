/**
 * FlightSelectView — pantalla de selección "Volar" (previa a la configuración).
 *
 * Tres secciones apiladas en vertical:
 *  - Arriba (100%): bloque dedicado "Importar desde SimBrief".
 *  - Medio (100%): "Vuelos de la Semana" con las ofertas en una sola línea
 *    (3 columnas seleccionables) y un único botón "Enviar a SimBrief" en
 *    la fila del título, habilitado solo si hay una oferta seleccionada.
 *  - Abajo (100%): "Rutas Reales" con botones de acción en la fila del
 *    título, boxes de filtros (Salida / Llegada / Aerolínea-Avión) y grilla
 *    de resultados por debajo.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Download,
  Eraser,
  Loader2,
  Plane,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  buildSimbriefDispatchUrl,
  loadAirlineOptions,
  loadEquipmentOptions,
  resolveAircraftIcao,
  searchRealRoutes,
  REAL_ROUTES_PAGE_SIZE,
  type RealRouteFilters,
  type RealRouteResult,
} from "../../services/RealRoutesService";
import { openExternalUrl } from "../../utils/openExternal";

export interface FlightSelectViewProps {
  hasSimbriefId: boolean;
  isFetchingSimbrief: boolean;
  simbriefError: string | null;
  onImportSimbrief: () => void;
  onNavigateToAccount: () => void;
}

interface WeekCard {
  id: string;
  titleKey: string;
  routeKey: string;
  descKey: string;
  bonusKey: string;
}

const WEEK_CARDS: WeekCard[] = [
  { id: "week-1", titleKey: "week_card_1_title", routeKey: "week_card_1_route", descKey: "week_card_1_desc", bonusKey: "week_card_1_bonus" },
  { id: "week-2", titleKey: "week_card_2_title", routeKey: "week_card_2_route", descKey: "week_card_2_desc", bonusKey: "week_card_2_bonus" },
  { id: "week-3", titleKey: "week_card_3_title", routeKey: "week_card_3_route", descKey: "week_card_3_desc", bonusKey: "week_card_3_bonus" },
];

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
          {options.slice(0, 400).map((opt) => (
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
  // Oferta de la semana seleccionada (la tarjeta es seleccionable y el
  // botón único del encabezado solo se habilita con selección).
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [weekWarning, setWeekWarning] = useState<string | null>(null);
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

  // Envía la ruta seleccionada al despacho de SimBrief (solo Rutas Reales).
  // El equipo de of_routes viene en formato IATA (ej. "738") y se traduce
  // al código ICAO (ej. "B738") vía of_planes antes de construir la URL,
  // junto con origen, destino y aerolínea. Sin selección no se envía nada:
  // se muestra el aviso de validación.
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
        equipment,
      });
      await openExternalUrl(url);
    } catch {
      setSendWarning(t("volar.send_error"));
    } finally {
      setIsSending(false);
    }
  };
  const selectedRoute = selectedIdx !== null ? results?.[selectedIdx] ?? null : null;
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
        {/* Primero (100%): Vuelos de la Semana en horizontal */}
        <section className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#E68B00]" />
              <div>
                <h3 className="font-display font-bold text-base text-[#E68B00]">
                  {t("volar.week_title")}
                </h3>
                <p className="text-[10px] font-mono text-white/40">{t("volar.week_subtitle")}</p>
              </div>
            </div>
            <div className="shrink-0 flex md:justify-end">
              {!hasSimbriefId ? (
                <button
                  key="btn-week-send"
                  type="button"
                  onClick={() => {
                    if (!selectedWeekId) {
                      setWeekWarning(t("volar.week_no_selection"));
                      return;
                    }
                    setWeekWarning(null);
                    onNavigateToAccount();
                  }}
                  className="px-6 py-3 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedWeekId}
                  title={!selectedWeekId ? t("volar.week_no_selection") : t("volar.week_import_btn")}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t("volar.no_id_btn")}
                </button>
              ) : (
                <button
                  key="btn-week-send"
                  id="btn-week-send-simbrief"
                  type="button"
                  onClick={() => {
                    if (!selectedWeekId) {
                      setWeekWarning(t("volar.week_no_selection"));
                      return;
                    }
                    setWeekWarning(null);
                    onImportSimbrief();
                  }}
                  disabled={!selectedWeekId || isFetchingSimbrief}
                  title={!selectedWeekId ? t("volar.week_no_selection") : t("volar.week_import_btn")}
                  className="px-6 py-3 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-[#45AFFF]/15 hover:bg-[#45AFFF]/30 text-[#45AFFF] border border-[#45AFFF]/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isFetchingSimbrief ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  {isFetchingSimbrief ? t("volar.importing") : t("volar.week_import_btn")}
                </button>
              )}
            </div>
          </div>
          {weekWarning && (
            <p className="text-[11px] font-mono text-amber-400 font-bold">{weekWarning}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {WEEK_CARDS.map((card) => {
              const isSelected = selectedWeekId === card.id;
              return (
              <div
                key={card.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                title={t("volar.week_no_selection")}
                onClick={() => {
                  setSelectedWeekId(isSelected ? null : card.id);
                  setWeekWarning(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedWeekId(isSelected ? null : card.id);
                    setWeekWarning(null);
                  }
                }}
                className={`bg-black/25 rounded-[5px] p-4 transition-all flex flex-col justify-between gap-3 cursor-pointer border ${
                  isSelected
                    ? "border-[#E68B00] ring-1 ring-[#E68B00]/60 shadow-[0_0_15px_rgba(230,139,0,0.25)]"
                    : "border-white/10 hover:border-[#E68B00]/45"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-sans font-black text-white uppercase">
                      {t(`volar.${card.titleKey}`)}
                    </div>
                    <div className="text-[11px] font-mono font-bold text-[#45AFFF] mt-0.5">
                      {t(`volar.${card.routeKey}`)}
                    </div>
                    <p className="text-[11px] font-sans text-white/60 leading-relaxed mt-1.5">
                      {t(`volar.${card.descKey}`)}
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 bg-[#43E600]/10 border border-[#43E600]/40 rounded-[4px] px-2 py-1 font-mono font-extrabold text-[11px] text-[#43E600] whitespace-nowrap">
                    <Sparkles className="w-3 h-3" />
                    {t(`volar.${card.bonusKey}`)}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
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
                    {" · "}{selectedRoute.airlineName} · {selectedRoute.equipment}
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
