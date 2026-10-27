/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tarjeta de etapa de campaña (flight leg): banner de aerolínea,
 * telemetría de ruta, barra de estado y CTA de ejecución.
 * Fuente de verdad: `docs/ui-spec-fly.md` (Campaign Overview, §4).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT_BAHN } from "./tokens";
import { formatMultiplier } from "../../services/CampaignService";

export type LegStatus =
  | { kind: "bonus"; xp: number }
  | { kind: "completed" }
  /** Bonus real por multiplicador de campaña (sin XP absoluto conocido). */
  | { kind: "multiplier"; mult: number };

export interface CampaignLegCardProps {
  airline: string;
  /** URL del logo de la aerolínea (null = sin logo: se muestra el código). */
  airlineLogoUrl?: string | null;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  aircraft: string;
  description: string;
  status: LegStatus;
  testId?: string;
  /** Acción del CTA "Send to SimBrief" (opcional, sandbox). */
  onSendToSimbrief?: () => void;
}

export function CampaignLegCard({
  airline,
  airlineLogoUrl,
  originCode,
  originName,
  destinationCode,
  destinationName,
  aircraft,
  description,
  status,
  testId,
  onSendToSimbrief,
}: CampaignLegCardProps) {
  const { t } = useTranslation();
  const [logoBroken, setLogoBroken] = useState(false);
  const showLogo = !!airlineLogoUrl && !logoBroken;
  const completed = status.kind === "completed";
  let statusText: string;
  if (status.kind === "completed") {
    statusText = t("fly.campaign.completed");
  } else if (status.kind === "multiplier") {
    statusText = t("fly.campaign.bonus_mult", {
      mult: formatMultiplier(status.mult),
    });
  } else {
    statusText = t("fly.campaign.bonus_xp", { xp: status.xp });
  }

  return (
    <article
      data-testid={testId}
      data-status={completed ? "completed" : "bonus"}
      className="flex h-full flex-col"
      style={{
        background: C.navyDeep,
        border: `1px solid ${C.sky}`,
        borderRadius: 0,
        padding: 16,
      }}
    >
      {/* Caja del banner de la aerolínea: logo si se encuentra (como en la
          experiencia original), código como respaldo. Fondo blanco para que
          los logos (que ya traen fondo blanco) no contrasten con el gris. */}
      <div
        className="flex w-full items-center justify-center"
        style={{ height: 68, background: C.white, borderRadius: 0 }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            background: C.white,
            borderRadius: 0,
            width: 110,
            height: 44,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          {showLogo ? (
            <img
              src={airlineLogoUrl as string}
              alt={airline}
              loading="lazy"
              onError={() => setLogoBroken(true)}
              className="block"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : (
            <span
              style={{
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.12em",
                color: "#00345C",
                lineHeight: 1,
              }}
            >
              {airline}
            </span>
          )}
        </div>
      </div>

      {/* Fila principal de ruta: origen — destino */}
      <div
        className="flex items-baseline justify-between"
        style={{ marginTop: 16 }}
      >
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            fontSize: 28,
            color: C.white,
            lineHeight: 1,
          }}
        >
          {originCode}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            fontSize: 28,
            color: C.white,
            lineHeight: 1,
          }}
        >
          {destinationCode}
        </span>
      </div>

      {/* Sub-etiquetas de aeropuertos */}
      <div className="flex items-start justify-between">
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            textTransform: "uppercase",
            fontSize: 10,
            color: C.ice,
            lineHeight: 1.4,
          }}
        >
          {originName}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            textTransform: "uppercase",
            fontSize: 10,
            color: C.ice,
            lineHeight: 1.4,
            textAlign: "right",
          }}
        >
          {destinationName}
        </span>
      </div>

      {/* Equipamiento de aeronave */}
      <div
        style={{
          marginTop: 8,
          fontFamily: FONT_BAHN,
          fontWeight: 700,
          fontStretch: "semi-condensed",
          textTransform: "uppercase",
          fontSize: 13,
          color: C.white,
          lineHeight: 1.3,
        }}
      >
        {aircraft}
      </div>

      {/* Descripción del tramo (empuja el stack inferior a la base) */}
      <p
        style={{
          marginTop: 12,
          marginBottom: 0,
          flexGrow: 1,
          fontFamily: FONT_BAHN,
          fontWeight: 400,
          fontStretch: "condensed",
          fontSize: 13,
          color: C.ice,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>

      {/* Barra de estado / recompensa */}
      <div
        className="flex w-full items-center justify-center"
        style={{
          height: 24,
          marginBottom: 8,
          background: completed ? C.orangeDark : C.magentaDark,
          border: `1px solid ${completed ? C.orange : C.magenta}`,
          borderRadius: 0,
          fontFamily: FONT_BAHN,
          fontWeight: 400,
          fontStretch: "condensed",
          textTransform: "uppercase",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: C.white,
          lineHeight: 1,
        }}
      >
        {statusText}
      </div>

      {/* CTA principal de ejecución */}
      <button
        type="button"
        disabled={completed}
        onClick={onSendToSimbrief}
        className={completed ? undefined : "cursor-pointer hover:brightness-110"}
        style={{
          width: "100%",
          height: 40,
          borderRadius: 0,
          background: completed ? C.greenDark : C.green,
          color: completed ? C.greenDisabledInk : C.greenInk,
          border: completed ? `1px solid ${C.greenBase}` : 0,
          fontFamily: FONT_BAHN,
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: 15,
          letterSpacing: "0.05em",
          cursor: completed ? "not-allowed" : "pointer",
        }}
      >
        {t("volar.campaign_send_btn")}
      </button>
    </article>
  );
}
