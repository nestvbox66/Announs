/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pestaña Special Cabin del Flight Setup: réplica funcional de las secciones
 * "Eventos Especiales de Cabina" e "Identificaciones" de la experiencia
 * original, vestida con el lenguaje visual del sistema (marco 1pt, fondo
 * `#001626`, padding 16, tipografías Bahnschrift, radio 0).
 *
 * - Especiales: switch de activación + cuadro de 500 caracteres con
 *   contador (aviso a partir de 450) + ejemplo + nota informativa.
 * - Identificaciones: aerolínea + ciudad origen/destino editables, con
 *   resolución contra la base (mensaje "no encontrada" si no hay match).
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT_BAHN } from "./tokens";
import { DuoToggle } from "./ImmersionTab";
import { getAirlineName } from "../../utils/airlineMapping";
import { getAirportName } from "../../utils/airportMapping";
import { resolveOfAirportCity } from "../../utils/ofResolvers";
import type { SimBriefData } from "../../types";

export interface SpecialCabinTabProps {
  /** Telemetría real del vuelo activo (inicializa aerolínea y ciudades). */
  simBriefData?: SimBriefData;
}

const CARD_STYLE: CSSProperties = {
  border: `1px solid ${C.sky}`,
  background: C.navyDeep,
  borderRadius: 0,
  padding: 16,
};

const TITLE_STYLE: CSSProperties = {
  fontFamily: FONT_BAHN,
  fontWeight: 700,
  fontStretch: "semi-condensed",
  fontSize: 16,
  color: C.white,
  lineHeight: 1.25,
  margin: 0,
};

const FIELD_LABEL_STYLE: CSSProperties = {
  display: "block",
  fontFamily: FONT_BAHN,
  fontWeight: 700,
  fontStretch: "semi-condensed",
  textTransform: "uppercase",
  fontSize: 12,
  letterSpacing: "0.08em",
  color: C.white,
  lineHeight: 1.3,
  marginBottom: 4,
};

const TEXT_INPUT_STYLE: CSSProperties = {
  appearance: "none",
  height: 36,
  width: "100%",
  background: C.selectFill,
  border: `1px solid ${C.sky}`,
  borderRadius: 0,
  color: C.white,
  fontFamily: FONT_BAHN,
  fontWeight: 400,
  fontStretch: "condensed",
  fontSize: 14,
  paddingLeft: 12,
  paddingRight: 12,
  outline: "none",
};

const SPECIAL_TEXT_MAX = 500;
const SPECIAL_TEXT_WARN_AT = 450;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Almacenamiento no disponible: la selección sigue en memoria.
  }
}

export function SpecialCabinTab({ simBriefData }: SpecialCabinTabProps) {
  const { t } = useTranslation();

  // ── Eventos Especiales de Cabina (Block 2 del original) ──
  const [specialEnabled, setSpecialEnabled] = useState<boolean>(
    () => readStored("flyv2_special_event_enabled") === "true",
  );
  const [specialText, setSpecialText] = useState<string>(
    () => readStored("flyv2_special_event_text") ?? "",
  );

  // ── Identificaciones (aerolínea + ciudades, editables) ──
  const [airline, setAirline] = useState<string>(
    () =>
      readStored("flyv2_ident_airline") ?? simBriefData?.aerolinea.trim() ?? "",
  );
  const [originCity, setOriginCity] = useState<string>(
    () =>
      readStored("flyv2_ident_origin_city") ??
      (simBriefData
        ? getAirportName(simBriefData.origen) || simBriefData.origen
        : ""),
  );
  const [destCity, setDestCity] = useState<string>(
    () =>
      readStored("flyv2_ident_dest_city") ??
      (simBriefData
        ? getAirportName(simBriefData.destino) || simBriefData.destino
        : ""),
  );

  const handleSpecialToggle = (enabled: boolean) => {
    setSpecialEnabled(enabled);
    writeStored("flyv2_special_event_enabled", String(enabled));
  };

  const handleSpecialText = (value: string) => {
    setSpecialText(value);
    writeStored("flyv2_special_event_text", value);
  };

  const handleAirline = (value: string) => {
    setAirline(value);
    writeStored("flyv2_ident_airline", value);
  };

  const handleOriginCity = (value: string) => {
    setOriginCity(value);
    writeStored("flyv2_ident_origin_city", value);
  };

  const handleDestCity = (value: string) => {
    setDestCity(value);
    writeStored("flyv2_ident_dest_city", value);
  };

  // Re-sembrado al cambiar de vuelo: los campos se inicializan una vez por
  // montaje, pero `localStorage` conserva el vuelo anterior y tapaba los
  // datos del nuevo import (aerolínea/código y ciudades quedaban obsoletas).
  // Al detectar otro origen/destino/aerolínea se re-siembran y las ciudades
  // se resuelven contra `of_airports` (p. ej. KBNA → Nashville) con fallback
  // al mapa local y al código. Nunca pisa mientras se edita a mano: solo
  // corre cuando cambia la fuente SimBrief.
  const identSourceKey = `${simBriefData?.aerolinea ?? ""}|${simBriefData?.origen ?? ""}|${simBriefData?.destino ?? ""}`;
  const identSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (identSourceRef.current === identSourceKey) return;
    identSourceRef.current = identSourceKey;
    const aero = (simBriefData?.aerolinea ?? "").trim();
    const orig = (simBriefData?.origen ?? "").trim();
    const dest = (simBriefData?.destino ?? "").trim();
    if (!aero && !orig && !dest) return;
    let cancelled = false;
    if (aero) handleAirline(aero);
    (async () => {
      const [dbOrigin, dbDest] = await Promise.all([
        orig ? resolveOfAirportCity(orig) : Promise.resolve(null),
        dest ? resolveOfAirportCity(dest) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (orig) {
        const city = dbOrigin || getAirportName(orig) || orig;
        setOriginCity(city);
        writeStored("flyv2_ident_origin_city", city);
      }
      if (dest) {
        const city = dbDest || getAirportName(dest) || dest;
        setDestCity(city);
        writeStored("flyv2_ident_dest_city", city);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identSourceKey]);

  const resolvedAirline = getAirlineName(airline);
  const airlineFound =
    airline.trim() !== "" && resolvedAirline !== airline.trim().toUpperCase();

  return (
    <>
      {/* 1) Eventos Especiales de Cabina */}
      <article
        data-testid="special-cabin-events-card"
        className="flex h-full flex-col"
        style={{ ...CARD_STYLE, gridColumn: "span 2" }}
      >
        <h3 style={TITLE_STYLE}>{t("flight_view.special_events_title")}</h3>

        <div style={{ marginTop: 12, maxWidth: 220 }}>
          <DuoToggle
            ariaLabel={t("flight_view.special_event_enable")}
            value={specialEnabled ? "yes" : "no"}
            onChange={(v) => handleSpecialToggle(v === "yes")}
            options={[
              {
                value: "yes",
                label: t("current_flight.not_started.immersion.yes"),
                activeFill: C.greenBase,
                activeBorder: C.green,
              },
              {
                value: "no",
                label: t("current_flight.not_started.immersion.no"),
                activeFill: C.offActiveFill,
                activeBorder: C.offActiveBorder,
              },
            ]}
          />
        </div>

        <div
          className="flex items-center justify-between"
          style={{ marginTop: 12 }}
        >
          <span
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 400,
              fontStretch: "condensed",
              textTransform: "uppercase",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: C.ice,
            }}
          >
            {t("flight_view.special_event_detail")}
          </span>
          <span
            role="status"
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: specialText.length >= SPECIAL_TEXT_WARN_AT ? 700 : 400,
              fontStretch: "condensed",
              fontSize: 11,
              color:
                specialText.length >= SPECIAL_TEXT_WARN_AT ? C.orange : C.ice,
              opacity: specialText.length >= SPECIAL_TEXT_WARN_AT ? 1 : 0.6,
            }}
          >
            {t("fly.setup.special_chars", { count: specialText.length })}
          </span>
        </div>

        <textarea
          rows={3}
          maxLength={SPECIAL_TEXT_MAX}
          value={specialText}
          onChange={(event) => handleSpecialText(event.target.value)}
          disabled={!specialEnabled}
          placeholder={t("flight_view.special_event_placeholder")}
          aria-label={t("flight_view.special_event_detail")}
          className="w-full disabled:cursor-not-allowed"
          style={{
            background: specialEnabled ? "#002440" : C.mutedSurface,
            border: `1px solid ${specialEnabled ? C.sky : C.divider}`,
            borderRadius: 0,
            color: specialEnabled ? C.white : C.grey,
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 13,
            lineHeight: 1.45,
            padding: 12,
            marginTop: 8,
            outline: "none",
            resize: "none",
          }}
        />

        <p
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontStyle: "italic",
            fontSize: 12,
            color: C.ice,
            opacity: 0.7,
            lineHeight: 1.45,
            marginTop: 8,
            marginBottom: 0,
          }}
        >
          {t("flight_view.special_event_example")}
        </p>
        <p
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontStyle: "italic",
            fontSize: 12,
            color: C.sky,
            opacity: 0.85,
            lineHeight: 1.45,
            background: "rgba(0,0,0,0.2)",
            border: `1px solid ${C.divider}`,
            borderRadius: 0,
            padding: 8,
            marginTop: 8,
            marginBottom: 0,
          }}
        >
          ℹ️ {t("flight_view.special_event_note")}
        </p>
      </article>

      {/* 2) Identificaciones */}
      <article
        data-testid="special-cabin-identifications-card"
        className="flex h-full flex-col"
        style={CARD_STYLE}
      >
        <h3 style={TITLE_STYLE}>
          {t("current_flight.not_started.identifications.title")}
        </h3>

        <div className="flex flex-col" style={{ gap: 12, marginTop: 12 }}>
          <div>
            <label
              htmlFor="fly-v2-ident-airline"
              style={FIELD_LABEL_STYLE}
            >
              {t("current_flight.not_started.identifications.airline")}
            </label>
            <input
              id="fly-v2-ident-airline"
              type="text"
              value={airline}
              onChange={(event) => handleAirline(event.target.value)}
              placeholder={t(
                "current_flight.not_started.identifications.airline_placeholder",
              )}
              className="w-full"
              style={TEXT_INPUT_STYLE}
            />
            {airline.trim() !== "" && (
              <span
                role="status"
                style={{
                  display: "block",
                  fontFamily: FONT_BAHN,
                  fontWeight: 400,
                  fontStretch: "condensed",
                  fontSize: 11,
                  color: airlineFound ? C.ice : C.orange,
                  marginTop: 6,
                  lineHeight: 1.4,
                }}
              >
                {airlineFound
                  ? t("fly.setup.ident_airline_found", {
                      name: resolvedAirline,
                    })
                  : t("fly.setup.ident_airline_not_found")}
              </span>
            )}
          </div>

          <div>
            <label
              htmlFor="fly-v2-ident-origin-city"
              style={FIELD_LABEL_STYLE}
            >
              {t("current_flight.not_started.identifications.origin_city")}
            </label>
            <input
              id="fly-v2-ident-origin-city"
              type="text"
              value={originCity}
              onChange={(event) => handleOriginCity(event.target.value)}
              placeholder={t(
                "current_flight.not_started.identifications.city_placeholder",
              )}
              className="w-full"
              style={TEXT_INPUT_STYLE}
            />
          </div>

          <div>
            <label
              htmlFor="fly-v2-ident-dest-city"
              style={FIELD_LABEL_STYLE}
            >
              {t("current_flight.not_started.identifications.dest_city")}
            </label>
            <input
              id="fly-v2-ident-dest-city"
              type="text"
              value={destCity}
              onChange={(event) => handleDestCity(event.target.value)}
              placeholder={t(
                "current_flight.not_started.identifications.city_placeholder",
              )}
              className="w-full"
              style={TEXT_INPUT_STYLE}
            />
          </div>
        </div>
      </article>
    </>
  );
}
