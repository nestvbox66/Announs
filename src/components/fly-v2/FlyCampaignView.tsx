/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Campaign Overview (`/fly/campaign`) — sandbox V2.
 * Arquitectura: breadcrumb, hero banner de 12 columnas y split
 * inferior 3/9 (briefing de campaña + tarjetas de etapas).
 * Fuente de verdad: `docs/ui-spec-fly.md` (Campaign Overview, §1–§4).
 *
 * Datos reales: oferta de campañas vigente (`weekly_campaigns` /
 * `weekly_campaign_flights`, vía `loadActiveCampaigns`, igual que la
 * página original de Vuelo). Se muestra la primera campaña activa:
 * título + descripción + imagen en el hero y sus vuelos como etapas.
 * El porcentaje de completado sigue mockeado (33%) porque no hay fuente
 * de completado por campaña en la funcionalidad actual.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT_BAHN } from "./tokens";
import { CampaignLegCard } from "./CampaignLegCard";
import {
  getAirlineLogo,
} from "../../utils/airlineLogos";
import {
  loadActiveCampaigns,
  type Campaign,
} from "../../services/CampaignService";

/** Completado mockeado: sin fuente real de progreso por campaña. */
const MOCK_COMPLETION_PCT = 33;

/**
 * Alto mínimo del bloque inferior (briefing + tarjetas de vuelos).
 * Se estira hasta que las tarjetas quedan a la misma distancia del menú
 * inferior (~32px, igual que el margen superior del propio bloque) que separa
 * el banner del título de la campaña del inicio de las tarjetas.
 * Desglose del offset superior desde el borde de la ventana:
 * barra de navegación 64 + padding superior 40 + breadcrumb ~33
 * + margen del hero 16 + alto del hero 170 + margen del bloque 32 = 355px,
 * más ~81px de reserva inferior (menú fijo a 16px + ~33px de alto + 32px de
 * separación) = 436px.
 */
const LEG_GRID_MIN_HEIGHT = "calc(100vh - 436px)";

export interface FlyCampaignViewProps {
  /** Navegación del sandbox: regreso al Home (`/fly`). */
  onNavigateHome?: () => void;
}

export function FlyCampaignView({ onNavigateHome }: FlyCampaignViewProps) {
  const { t } = useTranslation();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [imageBroken, setImageBroken] = useState<boolean>(false);

  // Oferta de campañas vigente (misma fuente que la página original).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await loadActiveCampaigns();
      if (cancelled) return;
      if (res.success) {
        // La propuesta muestra una campaña: la primera activa.
        setCampaign(res.data?.[0] ?? null);
      } else {
        setCampaign(null);
        setError(res.error ?? t("volar.campaign_error"));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La descripción puede traer varios párrafos separados por líneas en blanco.
  const paragraphs = (campaign?.description ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

  const flights = campaign?.flights ?? [];
  const legColumns = Math.min(Math.max(flights.length, 1), 3);
  const showImage = !!campaign?.imageUrl && !imageBroken;

  return (
    <main
      data-testid="fly-campaign"
      className="mx-auto w-full"
      style={{
        paddingLeft: 64,
        paddingRight: 64,
        paddingTop: 40,
        paddingBottom: 64,
      }}
    >
      {/* Breadcrumb header */}
      <h1
        data-testid="fly-campaign-breadcrumb"
        style={{
          fontFamily: FONT_BAHN,
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: 30,
          letterSpacing: "0.04em",
          lineHeight: 1.1,
          margin: 0,
        }}
      >
        {onNavigateHome ? (
          <button
            type="button"
            onClick={onNavigateHome}
            aria-label={t("fly.campaign.back_home")}
            className="cursor-pointer hover:underline"
            style={{
              background: "transparent",
              border: 0,
              borderRadius: 0,
              padding: 0,
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              textTransform: "uppercase",
              fontSize: 30,
              letterSpacing: "0.04em",
              lineHeight: 1.1,
              color: C.sky,
            }}
          >
            {"FLY >"}
          </button>
        ) : (
          <span style={{ color: C.sky }}>{"FLY >"}</span>
        )}{" "}
        <span style={{ color: C.white }}>{t("fly.campaign.breadcrumb")}</span>
      </h1>

      {loading ? (
        <p
          role="status"
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.sky,
            marginTop: 32,
          }}
        >
          {t("fly.campaign.loading")}
        </p>
      ) : error ? (
        <p
          role="alert"
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.orange,
            marginTop: 32,
          }}
        >
          {error}
        </p>
      ) : !campaign ? (
        <p
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            color: C.ice,
            marginTop: 32,
          }}
        >
          {t("volar.campaign_empty")}
        </p>
      ) : (
        <>
          {/* Hero banner de campaña (12 columnas) */}
          <div
            data-testid="campaign-hero"
            className="relative w-full overflow-hidden"
            style={{
              marginTop: 16,
              height: 170,
              background: C.navy,
              border: `1px solid ${C.sky}`,
              borderRadius: 0,
            }}
          >
            {/* Imagen asociada a la campaña. `cover` + centro la escala
                manteniendo la proporción original hasta cubrir la caja
                (recorta el excedente, nunca deforma ni deja zonas negras)
                y muestra su centro. Caja: 100% ancho − 128px × 170px de
                alto → conviene subir panoramas de al menos 2048×240. */}
            {showImage && (
              <img
                src={campaign.imageUrl}
                alt={campaign.title}
                loading="lazy"
                onError={() => setImageBroken(true)}
                className="pointer-events-none absolute inset-0"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center",
                }}
              />
            )}
            {/* Gradiente oscuro lateral para legibilidad del título */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, rgba(0, 22, 38, 0.85) 0%, rgba(0, 22, 38, 0.0) 60%)",
              }}
            />
            {/* Título del banner, centrado verticalmente con inset izquierdo */}
            <div
              className="absolute inset-0 flex items-center"
              style={{ paddingLeft: 32 }}
            >
              <span
                style={{
                  fontFamily: FONT_BAHN,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  fontSize: 40,
                  color: C.white,
                  lineHeight: 1.1,
                  letterSpacing: "0.02em",
                }}
              >
                {campaign.title}
              </span>
            </div>
          </div>

          {/* Split inferior 3 / 9 */}
          <div
            className="grid grid-cols-12"
            style={{ gap: 24, marginTop: 32, minHeight: LEG_GRID_MIN_HEIGHT }}
          >
            {/* Zona izquierda: briefing de campaña (3 columnas, sin caja) */}
            <div className="col-span-3 flex flex-col">
              {/* El briefing crece para empujar el estado de completitud hasta
                  la base, alineado con el final de las tarjetas de vuelos. */}
              <div style={{ flexGrow: 1 }}>
                {paragraphs.map((paragraph, index) => (
                  <p
                    key={`${index}-${paragraph.slice(0, 24)}`}
                    style={{
                      fontFamily: FONT_BAHN,
                      fontWeight: 400,
                      fontStretch: "condensed",
                      fontSize: 14,
                      color: C.ice,
                      lineHeight: 1.55,
                      marginTop: index === 0 ? 0 : 16,
                      marginBottom: 0,
                    }}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              {/* Estado de completitud (mock: sin fuente real de progreso) */}
              <div
                data-testid="campaign-completion"
                className="flex w-full items-center justify-center"
                style={{
                  marginTop: 32,
                  height: 40,
                  background: C.magentaDark,
                  border: `1px solid ${C.magenta}`,
                  borderRadius: 0,
                  fontFamily: FONT_BAHN,
                  fontWeight: 400,
                  fontStretch: "condensed",
                  textTransform: "uppercase",
                  fontSize: 15,
                  letterSpacing: "0.06em",
                  color: C.white,
                  lineHeight: 1,
                }}
              >
                {t("fly.campaign.completion", { pct: MOCK_COMPLETION_PCT })}
              </div>
            </div>

            {/* Zona derecha: etapas = vuelos de la campaña (3 por fila) */}
            <div className="col-span-9 flex flex-col">
              {flights.length === 0 ? (
                <p
                  style={{
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 14,
                    color: C.ice,
                    margin: 0,
                  }}
                >
                  {t("volar.campaign_empty")}
                </p>
              ) : (
                <div
                  data-testid="campaign-leg-grid"
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${legColumns}, 1fr)`,
                    gap: 24,
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  {flights.map((flight) => (
                    <CampaignLegCard
                      key={flight.id}
                      airline={
                        flight.airlineCode ||
                        flight.airlineName ||
                        "—"
                      }
                      airlineLogoUrl={getAirlineLogo(flight.airlineCode)}
                      originCode={flight.originIcao || "—"}
                      originName={
                        flight.originName || flight.originIcao || "—"
                      }
                      destinationCode={flight.destinationIcao || "—"}
                      destinationName={
                        flight.destinationName || flight.destinationIcao || "—"
                      }
                      aircraft={
                        flight.aircraftName || flight.aircraftIcao || "—"
                      }
                      description={flight.description}
                      status={{
                        kind: "multiplier",
                        mult: flight.xpMultiplier,
                      }}
                      testId={`leg-card-${flight.originIcao.toLowerCase()}-${flight.destinationIcao.toLowerCase()}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
