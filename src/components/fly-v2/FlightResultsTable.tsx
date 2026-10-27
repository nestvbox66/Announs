/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tabla de resultados de Flight Lookup: marco exterior, columnas
 * Aerolínea / Origen / Destino / Equipo / Distancia (ordenable), divisores
 * verticales, franjas alternadas, fila seleccionada en verde positivo y
 * estados (vacío inicial / buscando / sin resultados).
 * Fuente de verdad: `docs/ui-spec-fly.md` (Flight Lookup, §3).
 */

import type React from "react";
import { useTranslation } from "react-i18next";
import { SearchX } from "lucide-react";
import { C, FONT_BAHN } from "./tokens";
import type { RealRouteResult } from "../../services/RealRoutesService";

export interface FlightResultsTableProps {
  /** null = aún sin buscar (empty state); [] = sin coincidencias. */
  results: RealRouteResult[] | null;
  pageRows: RealRouteResult[];
  /** Índice absoluto de la primera fila de la página. */
  pageOffset: number;
  isSearching: boolean;
  selectedIdx: number | null;
  onSelect: (absoluteIdx: number) => void;
  distanceSort: "asc" | "desc" | null;
  onToggleDistanceSort: () => void;
  formatDistance: (km: number | null) => string;
}

const GRID_COLUMNS = "2fr 3fr 3fr 1.6fr 1.2fr";
const VERTICAL_DIVIDER = "1px solid rgba(69, 175, 255, 0.4)";

function formatRoutePoint(
  code: string,
  name: string,
  city: string,
): string {
  const label = name && name !== "—" ? name : code;
  return city ? `${code} (${label} — ${city})` : `${code} (${label})`;
}

export function FlightResultsTable({
  results,
  pageRows,
  pageOffset,
  isSearching,
  selectedIdx,
  onSelect,
  distanceSort,
  onToggleDistanceSort,
  formatDistance,
}: FlightResultsTableProps) {
  const { t } = useTranslation();

  const sortGlyph =
    distanceSort === "asc" ? "▲" : distanceSort === "desc" ? "▼" : "⇅";

  const headers: { key: string; sortable?: boolean; rightBorder?: boolean; leftBorder?: boolean }[] = [
    { key: t("volar.grid_airline"), rightBorder: true },
    { key: t("volar.grid_origin") },
    { key: t("volar.grid_destination") },
    { key: t("volar.grid_aircraft"), leftBorder: true },
    { key: t("volar.grid_distance"), sortable: true },
  ];

  // Estado central (rellena el espacio de la grilla antes de la 1ª búsqueda).
  let stateBlock: React.ReactNode = null;
  if (results === null && !isSearching) {
    stateBlock = (
      <div
        data-testid="lookup-empty-state"
        className="flex w-full flex-col items-center justify-center"
        style={{ minHeight: 360, gap: 12, padding: 24, textAlign: "center" }}
      >
        <SearchX
          aria-hidden="true"
          style={{ width: 40, height: 40, color: C.sky, opacity: 0.6 }}
        />
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            textTransform: "uppercase",
            fontSize: 16,
            letterSpacing: "0.08em",
            color: C.white,
          }}
        >
          {t("fly.lookup.empty_title")}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.ice,
            lineHeight: 1.5,
            maxWidth: 420,
          }}
        >
          {t("volar.grid_initial")}
        </span>
      </div>
    );
  } else if (isSearching) {
    stateBlock = (
      <div
        className="flex w-full items-center justify-center"
        style={{ minHeight: 360 }}
      >
        <span
          role="status"
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.sky,
          }}
        >
          {t("volar.searching")}
        </span>
      </div>
    );
  } else if (results !== null && results.length === 0) {
    stateBlock = (
      <div
        className="flex w-full items-center justify-center"
        style={{ minHeight: 360, padding: 24, textAlign: "center" }}
      >
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.ice,
            lineHeight: 1.5,
            maxWidth: 460,
          }}
        >
          {t("volar.grid_empty")}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="flight-results-table"
      role="table"
      aria-label={t("fly.lookup.breadcrumb")}
      className="w-full"
      style={{
        border: `1px solid ${C.sky}`,
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      {/* Cabecera */}
      <div
        role="row"
        className="grid w-full"
        style={{
          gridTemplateColumns: GRID_COLUMNS,
          background: C.navyHeader,
          borderBottom: `1px solid ${C.sky}`,
        }}
      >
        {headers.map((header) => (
          <div
            key={header.key}
            role="columnheader"
            className="flex items-center"
            style={{
              height: 42,
              paddingLeft: 16,
              paddingRight: 16,
              fontFamily: FONT_BAHN,
              fontWeight: 600,
              fontStretch: "semi-condensed",
              fontSize: 18,
              color: C.white,
              lineHeight: 1.2,
              borderRight: header.rightBorder ? VERTICAL_DIVIDER : undefined,
              borderLeft: header.leftBorder ? VERTICAL_DIVIDER : undefined,
            }}
          >
            {header.sortable ? (
              <button
                type="button"
                onClick={onToggleDistanceSort}
                title={t("volar.grid_distance_sort")}
                aria-label={t("volar.grid_distance_sort")}
                className="inline-flex cursor-pointer items-center hover:text-white"
                style={{
                  gap: 6,
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: C.white,
                  fontFamily: FONT_BAHN,
                  fontWeight: 600,
                  fontStretch: "semi-condensed",
                  fontSize: 18,
                  textTransform: "none",
                }}
              >
                {header.key}
                <span aria-hidden="true" style={{ fontSize: 11 }}>
                  {sortGlyph}
                </span>
              </button>
            ) : (
              header.key
            )}
          </div>
        ))}
      </div>

      {/* Cuerpo */}
      <div role="rowgroup">
        {stateBlock}
        {pageRows.map((route, idx) => {
          const absoluteIdx = pageOffset + idx;
          const isSelected = selectedIdx === absoluteIdx;
          const cellText: React.CSSProperties = {
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: isSelected ? C.greenInk : C.ice,
            lineHeight: 1.3,
          };
          const cellBox: React.CSSProperties = {
            height: 38,
            paddingLeft: 16,
            paddingRight: 16,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          };
          return (
            <div
              key={`${route.airlineName}-${route.originCode}-${route.destCode}-${route.equipment}-${absoluteIdx}`}
              role="row"
              tabIndex={0}
              aria-selected={isSelected}
              onClick={() => onSelect(absoluteIdx)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(absoluteIdx);
                }
              }}
              className="grid w-full cursor-pointer"
              style={{
                gridTemplateColumns: GRID_COLUMNS,
                background: isSelected
                  ? C.green
                  : idx % 2 === 0
                    ? C.navy
                    : C.navyDeep,
                outline: "none",
              }}
              title={t("volar.select_hint")}
            >
              <div
                role="cell"
                className="flex items-center"
                style={{ ...cellBox, ...cellText, borderRight: VERTICAL_DIVIDER }}
              >
                {route.airlineName}
              </div>
              <div role="cell" className="flex items-center" style={{ ...cellBox, ...cellText }}>
                {formatRoutePoint(route.originCode, route.originName, route.originCity)}
              </div>
              <div role="cell" className="flex items-center" style={{ ...cellBox, ...cellText }}>
                {formatRoutePoint(route.destCode, route.destName, route.destCity)}
              </div>
              <div
                role="cell"
                className="flex items-center"
                style={{
                  ...cellBox,
                  ...cellText,
                  color: isSelected ? C.greenInk : C.green,
                  fontWeight: 700,
                  borderLeft: VERTICAL_DIVIDER,
                }}
              >
                {route.equipment}
              </div>
              <div role="cell" className="flex items-center" style={{ ...cellBox, ...cellText }}>
                {formatDistance(route.distanceKm)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
