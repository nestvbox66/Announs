/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Flight Lookup (`/fly/lookup`) — sandbox V2.
 * Arquitectura: breadcrumb + bajada en una línea, split 2/10 (stack de
 * filtros + tabla de resultados). Seleccionar una fila desbloquea el CTA
 * SEND TO SIMBRIEF. Fuente de verdad: `docs/ui-spec-fly.md` (Flight Lookup).
 *
 * Datos reales: buscador de "Rutas Reales" (`of_routes`/`of_airports`/
 * `of_airlines`, vía `searchRealRoutes`), con el mismo comportamiento que la
 * experiencia original (filtros combinables, autocompletado de aerolíneas y
 * equipos, orden por distancia, paginación y envío a SimBrief).
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon } from "lucide-react";
import { C, FONT_BAHN } from "./tokens";
import { LookupField } from "./LookupField";
import { FlightResultsTable } from "./FlightResultsTable";
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
import { openExternalUrl } from "../../utils/openExternal";
import { resolveSimbriefPilotId, fetchLatestSimBriefPlan } from "../../services/simbriefImport";
import type { SimBriefData } from "../../types";

interface LookupFilters {
  originCity: string;
  originAirport: string;
  originIcao: string;
  destCity: string;
  destAirport: string;
  destIcao: string;
  airline: string;
  aircraft: string;
}

const EMPTY_FILTERS: LookupFilters = {
  originCity: "",
  originAirport: "",
  originIcao: "",
  destCity: "",
  destAirport: "",
  destIcao: "",
  airline: "",
  aircraft: "",
};

/** Filas por página de la grilla (pedido: 12). */
const RESULTS_PER_PAGE = 12;

export interface FlyLookupViewProps {
  /** Navegación del sandbox: regreso al Home (`/fly`). */
  onNavigateHome?: () => void;
  /** Importación SimBrief (igual que el tile de la home): recibe plan + OFP crudo. */
  onImportSimbrief?: (plan: SimBriefData, raw: unknown) => void;
  /** Destino del botón Configurar Pilot ID (userhub/account). */
  onNavigateToAccount?: () => void;
}

export function FlyLookupView({ onNavigateHome, onImportSimbrief, onNavigateToAccount }: FlyLookupViewProps) {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<LookupFilters>(EMPTY_FILTERS);
  // Resultados: null = aún sin buscar (o tras limpiar); [] = sin coincidencias.
  const [results, setResults] = useState<RealRouteResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  const [resolvedIcao, setResolvedIcao] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Importar queda habilitado solo después de Enviar a SimBrief.
  const [hasSentToSimbrief, setHasSentToSimbrief] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [needsPilotId, setNeedsPilotId] = useState(false);
  const [page, setPage] = useState(1);
  // Orden por distancia: null = orden de la DB; "asc"/"desc" = por km.
  const [distanceSort, setDistanceSort] = useState<"asc" | "desc" | null>(null);
  const [airlineOptions, setAirlineOptions] = useState<string[]>([]);
  const [equipmentOptions, setEquipmentOptions] = useState<string[]>([]);

  // Opciones de autocompletado (misma fuente que la experiencia original).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [airlinesRes, equipmentRes] = await Promise.all([
        loadAirlineOptions(),
        loadEquipmentOptions(),
      ]);
      if (cancelled) return;
      if (airlinesRes.success && airlinesRes.data)
        setAirlineOptions(airlinesRes.data);
      if (equipmentRes.success && equipmentRes.data)
        setEquipmentOptions(equipmentRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedResults = useMemo(() => {
    if (!results || !distanceSort) return results;
    const dir = distanceSort === "asc" ? 1 : -1;
    return [...results].sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return (a.distanceKm - b.distanceKm) * dir;
    });
  }, [results, distanceSort]);

  const totalPages = sortedResults
    ? Math.max(1, Math.ceil(sortedResults.length / RESULTS_PER_PAGE))
    : 1;
  const safePage = Math.min(page, totalPages);
  const pageOffset = (safePage - 1) * RESULTS_PER_PAGE;
  const pageRows = sortedResults
    ? sortedResults.slice(pageOffset, pageOffset + RESULTS_PER_PAGE)
    : [];

  const setField = (field: keyof LookupFilters) => (value: string) =>
    setFilters((prev) => ({ ...prev, [field]: value }));

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setPage(1);
    setSelectedIdx(null);
    setSendWarning(null);
    setResolvedIcao(null);
    try {
      const res = await searchRealRoutes(filters as RealRouteFilters);
      if (res.success) {
        setResults(res.data ?? []);
      } else {
        setResults([]);
        setSearchError(res.error ?? t("volar.search_error"));
      }
    } catch (err) {
      setResults([]);
      setSearchError(
        err instanceof Error ? err.message : t("volar.search_error"),
      );
    } finally {
      setIsSearching(false);
    }
  };

  // Importa el último OFP generado (igual que el tile SimBrief Import
  // de la home): requiere Pilot ID y un envío previo a SimBrief.
  const handleImportSimbrief = async () => {
    if (isImporting || !hasSentToSimbrief) return;
    setIsImporting(true);
    setImportError(null);
    setNeedsPilotId(false);
    try {
      const pilotId = await resolveSimbriefPilotId();
      if (!pilotId) {
        setImportError(t("fly.home.import_error_no_pilot"));
        setNeedsPilotId(true);
        return;
      }
      const { plan, raw } = await fetchLatestSimBriefPlan(pilotId);
      onImportSimbrief?.(plan, raw);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setImportError(
        code === "simbrief_no_plan"
          ? t("fly.home.import_error_no_plan")
          : t("fly.home.import_error_generic"),
      );
    } finally {
      setIsImporting(false);
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

  const handleToggleDistanceSort = () => {
    setDistanceSort((prev) => (prev === "asc" ? "desc" : "asc"));
    setPage(1);
    setSelectedIdx(null);
    setSendWarning(null);
  };

  const handleSelect = (absoluteIdx: number) => {
    setSelectedIdx((prev) => (prev === absoluteIdx ? null : absoluteIdx));
    setSendWarning(null);
    setResolvedIcao(null);
  };

  // Km enteros con separador de miles según idioma ("1.139 km" / "1,139 km").
  const formatDistance = (km: number | null): string => {
    if (km == null || !Number.isFinite(km)) return "—";
    const locale = i18n.language === "en" ? "en-US" : "es-ES";
    return `${Math.round(km).toLocaleString(locale)} km`;
  };

  const handleSendToSimbrief = async () => {
    const selected =
      selectedIdx !== null ? (sortedResults?.[selectedIdx] ?? null) : null;
    if (!selected) {
      setSendWarning(t("volar.no_selection"));
      return;
    }
    setSendWarning(null);
    setIsSending(true);
    try {
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
      setHasSentToSimbrief(true);
    } catch {
      setSendWarning(t("volar.send_error"));
    } finally {
      setIsSending(false);
    }
  };

  const hasSelection = selectedIdx !== null;

  const breadcrumbFont = {
    fontFamily: FONT_BAHN,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    fontSize: 30,
    letterSpacing: "0.04em",
    lineHeight: 1.1,
  };

  return (
    <main
      data-testid="fly-lookup"
      className="mx-auto w-full"
      style={{
        paddingLeft: 64,
        paddingRight: 64,
        paddingTop: 40,
        paddingBottom: 64,
      }}
    >
      {/* Encabezado en una sola línea: breadcrumb + bajada (sobre la
          columna de resultados). */}
      <div
        className="flex flex-wrap items-baseline"
        style={{ gap: 24, whiteSpace: "nowrap" }}
      >
        <h1
          data-testid="fly-lookup-breadcrumb"
          style={{ ...breadcrumbFont, margin: 0, flexShrink: 0 }}
        >
          {onNavigateHome ? (
            <button
              type="button"
              onClick={onNavigateHome}
              aria-label={t("fly.lookup.back_home")}
              className="cursor-pointer hover:underline"
              style={{
                ...breadcrumbFont,
                background: "transparent",
                border: 0,
                borderRadius: 0,
                padding: 0,
                color: C.sky,
              }}
            >
              {"FLY >"}
            </button>
          ) : (
            <span style={{ color: C.sky }}>{"FLY >"}</span>
          )}{" "}
          <span style={{ color: C.white }}>{t("fly.lookup.breadcrumb")}</span>
        </h1>
        <p
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.ice,
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          {t("volar.real_subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-12" style={{ gap: 24, marginTop: 24 }}>
        {/* Zona izquierda (2 columnas): stack de filtros */}
        <div className="col-span-2">
          {/* Sección 1 — SALIDA */}
          <section aria-label={t("volar.filter_origin_title")} style={{ marginBottom: 16 }}>
            <LookupField
              id="lookup-origin-city"
              label={t("volar.filter_origin_title")}
              variant="primary"
              value={filters.originCity}
              onChange={setField("originCity")}
              suggestions={[]}
              placeholder="Buenos Aires"
            />
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 8 }}
            >
              <LookupField
                id="lookup-origin-airport"
                label={t("volar.f_airport")}
                variant="sub"
                value={filters.originAirport}
                onChange={setField("originAirport")}
                suggestions={[]}
                placeholder="Aeroparque"
              />
              <LookupField
                id="lookup-origin-icao"
                label={t("volar.f_icao")}
                variant="sub"
                value={filters.originIcao}
                onChange={setField("originIcao")}
                suggestions={[]}
                placeholder="SABE"
              />
            </div>
          </section>

          {/* Sección 2 — LLEGADA */}
          <section aria-label={t("volar.filter_dest_title")} style={{ marginBottom: 16 }}>
            <LookupField
              id="lookup-destination-city"
              label={t("volar.filter_dest_title")}
              variant="primary"
              value={filters.destCity}
              onChange={setField("destCity")}
              suggestions={[]}
              placeholder="Santiago"
            />
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 8 }}
            >
              <LookupField
                id="lookup-destination-airport"
                label={t("volar.f_airport")}
                variant="sub"
                value={filters.destAirport}
                onChange={setField("destAirport")}
                suggestions={[]}
                placeholder="Arturo Merino"
              />
              <LookupField
                id="lookup-destination-icao"
                label={t("volar.f_icao")}
                variant="sub"
                value={filters.destIcao}
                onChange={setField("destIcao")}
                suggestions={[]}
                placeholder="SCEL"
              />
            </div>
          </section>

          {/* Sección 3 — TIPO DE AVIÓN */}
          <section aria-label={t("volar.f_aircraft")} style={{ marginBottom: 16 }}>
            <LookupField
              id="lookup-aircraft"
              label={t("volar.f_aircraft")}
              variant="primary"
              value={filters.aircraft}
              onChange={setField("aircraft")}
              suggestions={equipmentOptions}
              maxSuggestions={8}
              placeholder="738"
            />
          </section>

          {/* Sección 4 — AEROLÍNEA */}
          <section aria-label={t("volar.f_airline")} style={{ marginBottom: 16 }}>
            <LookupField
              id="lookup-airline"
              label={t("volar.f_airline")}
              variant="primary"
              value={filters.airline}
              onChange={setField("airline")}
              suggestions={airlineOptions}
              maxSuggestions={8}
              placeholder="LATAM"
            />
          </section>

          <p
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 400,
              fontStretch: "condensed",
              fontStyle: "italic",
              fontSize: 11,
              color: C.ice,
              opacity: 0.55,
              lineHeight: 1.4,
              marginTop: 0,
              marginBottom: 16,
            }}
          >
            {t("volar.english_hint")}
          </p>

          {/* Botones de acción (ancho completo de la zona) */}
          <button
            type="button"
            data-testid="lookup-search"
            onClick={handleSearch}
            disabled={isSearching}
            className="flex w-full items-center justify-center cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              height: 40,
              marginBottom: 12,
              gap: 8,
              background: C.tabActive,
              color: C.white,
              border: 0,
              borderRadius: 0,
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              fontStretch: "semi-condensed",
              textTransform: "uppercase",
              fontSize: 15,
              letterSpacing: "0.06em",
            }}
          >
            <SearchIcon
              className={isSearching ? "animate-pulse" : undefined}
              style={{ width: 15, height: 15 }}
            />
            {isSearching ? t("volar.searching") : t("volar.search_btn")}
          </button>
          <button
            type="button"
            data-testid="lookup-clear"
            onClick={handleClear}
            disabled={isSearching}
            className="w-full cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              height: 40,
              marginBottom: 12,
              background: C.tabInactive,
              color: C.ice,
              border: 0,
              borderRadius: 0,
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              fontStretch: "semi-condensed",
              textTransform: "uppercase",
              fontSize: 15,
              letterSpacing: "0.06em",
            }}
          >
            {t("volar.clear_btn")}
          </button>
          <button
            type="button"
            data-testid="lookup-send-simbrief"
            disabled={!hasSelection || isSending}
            onClick={handleSendToSimbrief}
            className={hasSelection ? "w-full cursor-pointer hover:brightness-110" : "w-full"}
            style={{
              height: 40,
              background: hasSelection ? C.green : C.greenDark,
              color: hasSelection ? C.greenInk : C.greenDisabledInk,
              border: 0,
              borderRadius: 0,
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              textTransform: "uppercase",
              fontSize: 15,
              letterSpacing: "0.05em",
              pointerEvents: hasSelection ? undefined : "none",
            }}
          >
            {t("volar.import_btn")}
          </button>

          <button
            type="button"
            data-testid="lookup-import-simbrief"
            disabled={!hasSentToSimbrief || isImporting}
            onClick={handleImportSimbrief}
            title={!hasSentToSimbrief ? t("fly.lookup.import_requires_send") : undefined}
            className={hasSentToSimbrief ? "w-full cursor-pointer hover:brightness-110" : "w-full"}
            style={{
              height: 40,
              marginTop: 8,
              background: hasSentToSimbrief ? C.tabActive : C.tabInactive,
              color: hasSentToSimbrief ? C.white : C.ice,
              border: 0,
              borderRadius: 0,
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              textTransform: "uppercase",
              fontSize: 15,
              letterSpacing: "0.05em",
              pointerEvents: hasSentToSimbrief ? undefined : "none",
            }}
          >
            {isImporting ? t("fly.home.import_loading") : t("fly.lookup.import_button")}
          </button>
        </div>

        {/* Zona derecha (10 columnas): tabla de resultados */}
        <div className="col-span-10">
          {(importError || needsPilotId) && (
            <div
              role="status"
              style={{
                marginBottom: 12,
                background: C.navyDeep,
                border: `1px solid ${C.sky}`,
                padding: "8px 12px",
                fontFamily: FONT_BAHN,
                fontSize: 12,
                color: C.white,
              }}
            >
              {importError}
              {needsPilotId && onNavigateToAccount && (
                <button
                  type="button"
                  onClick={onNavigateToAccount}
                  className="cursor-pointer hover:underline"
                  style={{
                    marginLeft: 12,
                    background: C.tabActive,
                    color: C.white,
                    border: 0,
                    borderRadius: 0,
                    fontFamily: FONT_BAHN,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    padding: "6px 12px",
                  }}
                >
                  {t("fly.home.import_config_pilot")}
                </button>
              )}
            </div>
          )}
          {searchError && (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: C.offActiveFill,
                border: `1px solid ${C.offActiveBorder}`,
                color: C.ice,
                fontFamily: FONT_BAHN,
                fontWeight: 400,
                fontStretch: "condensed",
                fontSize: 13,
              }}
            >
              {searchError}
            </div>
          )}

          <FlightResultsTable
            results={results}
            pageRows={pageRows}
            pageOffset={pageOffset}
            isSearching={isSearching}
            selectedIdx={selectedIdx}
            onSelect={handleSelect}
            distanceSort={distanceSort}
            onToggleDistanceSort={handleToggleDistanceSort}
            formatDistance={formatDistance}
          />

          {/* Paginación (12 filas por página) */}
          {results !== null && !isSearching && totalPages > 1 && (
            <div
              className="flex items-center justify-between"
              style={{ gap: 8, marginTop: 12 }}
            >
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  padding: "6px 12px",
                  background: C.navy,
                  color: C.ice,
                  border: `1px solid ${C.divider}`,
                  borderRadius: 0,
                  fontFamily: FONT_BAHN,
                  fontWeight: 700,
                  fontStretch: "semi-condensed",
                  textTransform: "uppercase",
                  fontSize: 13,
                  letterSpacing: "0.06em",
                }}
              >
                ← {t("volar.page_prev")}
              </button>
              <span
                style={{
                  fontFamily: FONT_BAHN,
                  fontWeight: 400,
                  fontStretch: "condensed",
                  fontSize: 13,
                  color: C.ice,
                }}
              >
                {t("volar.page_of", { page: safePage, pages: totalPages })}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  padding: "6px 12px",
                  background: C.navy,
                  color: C.ice,
                  border: `1px solid ${C.divider}`,
                  borderRadius: 0,
                  fontFamily: FONT_BAHN,
                  fontWeight: 700,
                  fontStretch: "semi-condensed",
                  textTransform: "uppercase",
                  fontSize: 13,
                  letterSpacing: "0.06em",
                }}
              >
                {t("volar.page_next")} →
              </button>
            </div>
          )}

          {results !== null && !isSearching && (
            <p
              style={{
                marginTop: 8,
                marginBottom: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 400,
                fontStretch: "condensed",
                fontSize: 12,
                color: C.ice,
                opacity: 0.5,
              }}
            >
              {t("volar.results_count", {
                count: results.length,
                limit: REAL_ROUTES_PAGE_SIZE,
              })}
            </p>
          )}

          {hasSelection && (
            <p
              style={{
                marginTop: 8,
                marginBottom: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 400,
                fontStretch: "condensed",
                fontSize: 13,
                color: C.sky,
              }}
            >
              {t("volar.select_hint")}
            </p>
          )}
          {sendWarning && (
            <p
              role="alert"
              style={{
                marginTop: 8,
                marginBottom: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontStretch: "condensed",
                fontSize: 13,
                color: C.orange,
              }}
            >
              {sendWarning}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
