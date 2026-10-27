/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tarjeta de evento de vuelo con sus 4 estados reactivos:
 * AI (magenta), PACKAGE (naranja), OFF (tenue) y Disabled/Locked (bloqueada).
 * Fuente de verdad: `docs/ui-spec-fly.md` (§4 Flight Event Card Component).
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT_BAHN } from "./tokens";
import { SegmentedControl } from "./SegmentedControl";

export type EventMode = "OFF" | "PACKAGE" | "AI";

const MODE_OPTIONS: readonly EventMode[] = ["OFF", "PACKAGE", "AI"];

export interface FlightEventCardProps {
  title: string;
  description: string;
  /** Rol del voiceover, p. ej. "Captain". */
  voiceRole: string;
  initialMode?: EventMode;
  /** Modo controlado: si se provee, la tarjeta no usa estado interno. */
  mode?: EventMode;
  /** Callback del modo controlado (junto a `mode`). */
  onModeChange?: (mode: EventMode) => void;
  /** Estado bloqueado: controles inertes + aviso de membresía. */
  locked?: boolean;
  testId?: string;
  /** Contenido extra DENTRO de la caja (sliders de demora, package de
      video): se renderiza entre el voiceover y el selector de modo. */
  children?: ReactNode;
}

interface ModeStyle {
  border: string;
  fill: string;
  activeFill: string;
  activeBorder: string;
  dimmed: boolean;
}

const MODE_STYLES: Record<EventMode, ModeStyle> = {
  AI: {
    border: C.magenta,
    fill: C.navyDeep,
    activeFill: C.magentaDark,
    activeBorder: C.magenta,
    dimmed: false,
  },
  PACKAGE: {
    border: C.orange,
    fill: C.navyDeep,
    activeFill: C.orangeDark,
    activeBorder: C.orange,
    dimmed: false,
  },
  OFF: {
    border: C.offBorder,
    fill: C.mutedSurface,
    activeFill: C.offActiveFill,
    activeBorder: C.offActiveBorder,
    dimmed: true,
  },
};

const LOCKED_STYLE: ModeStyle = {
  border: C.divider,
  fill: C.mutedSurface,
  activeFill: C.mutedSurface,
  activeBorder: C.divider,
  dimmed: true,
};

export function FlightEventCard({
  title,
  description,
  voiceRole,
  initialMode = "OFF",
  mode: controlledMode,
  onModeChange,
  locked = false,
  testId,
  children,
}: FlightEventCardProps) {
  const { t } = useTranslation();
  const [internalMode, setInternalMode] = useState<EventMode>(initialMode);
  // Modo controlado (escenario real) o interno (estado local simple).
  const mode: EventMode = controlledMode ?? internalMode;
  const handleModeChange = (next: EventMode) => {
    if (onModeChange) {
      onModeChange(next);
    } else {
      setInternalMode(next);
    }
  };

  const style: ModeStyle = locked ? LOCKED_STYLE : MODE_STYLES[mode];
  const dimmed = style.dimmed;

  const titleColor = dimmed ? C.grey : C.white;
  const bodyColor = dimmed ? C.grey : C.ice;
  const voiceLabelColor = dimmed ? C.grey : C.white;
  const voiceRoleColor = dimmed ? C.grey : C.sky;

  return (
    <article
      data-testid={testId}
      data-mode={locked ? "LOCKED" : mode}
      className="flex h-full flex-col"
      style={{
        border: `1px solid ${style.border}`,
        background: style.fill,
        borderRadius: 0,
        padding: 16,
        minHeight: 212,
      }}
    >
      {/* Título del evento */}
      <h3
        style={{
          fontFamily: FONT_BAHN,
          fontWeight: 700,
          fontStretch: "semi-condensed",
          fontSize: 16,
          color: titleColor,
          lineHeight: 1.25,
          margin: 0,
        }}
      >
        {title}
      </h3>

      {/* Descripción operativa */}
      <p
        style={{
          fontFamily: FONT_BAHN,
          fontWeight: 400,
          fontStretch: "condensed",
          fontSize: 13,
          color: bodyColor,
          lineHeight: 1.45,
          marginTop: 8,
          marginBottom: 0,
          flexGrow: 1,
        }}
      >
        {description}
      </p>

      {/* Aviso de membresía (solo estado bloqueado, sobre la línea de voiceover) */}
      {locked && (
        <p
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 12,
            color: C.white,
            lineHeight: 1.4,
            marginTop: 8,
            marginBottom: 0,
          }}
        >
          {t("fly.setup.locked_prefix")}{" "}
          <span style={{ color: C.magenta }}>{t("fly.setup.locked_suffix")}</span>
        </p>
      )}

      {/* Etiqueta de voiceover */}
      <p
        style={{
          fontFamily: FONT_BAHN,
          fontWeight: 400,
          fontStretch: "condensed",
          fontSize: 14,
          lineHeight: 1.4,
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        <span style={{ color: voiceLabelColor }}>
          {t("fly.setup.voiceover_label")}{" "}
        </span>
        <span style={{ color: voiceRoleColor }}>{voiceRole}</span>
      </p>

      {/* Contenido extra dentro de la caja (sliders, safety pack) */}
      {children}

      {/* Selector de modo de 3 vías, anclado al fondo */}
      <div style={{ marginTop: 12 }}>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={(next) => handleModeChange(next as EventMode)}
          activeFill={style.activeFill}
          activeBorder={style.activeBorder}
          inactiveColor={dimmed ? C.grey : C.ice}
          ariaLabel={`${title}: event mode`}
          height={24}
          fontSize={11}
          disabled={locked}
        />
      </div>
    </article>
  );
}
