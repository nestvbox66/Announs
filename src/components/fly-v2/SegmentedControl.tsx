/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Barra segmentada compacta del sistema FLY (bordes rectangulares, radio 0).
 * Fuente de verdad: `docs/ui-spec-fly.md` (§4 anatomy, §5 micro-adjusters).
 */

import { C, FONT_BAHN } from "./tokens";

export interface SegmentedControlProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  /** Relleno del segmento activo. */
  activeFill: string;
  /** Trazo del segmento activo (inset, sin desplazar layout). */
  activeBorder: string;
  /** Color de texto de los segmentos inactivos. */
  inactiveColor?: string;
  ariaLabel: string;
  height?: number;
  fontSize?: number;
  disabled?: boolean;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  activeFill,
  activeBorder,
  inactiveColor = C.ice,
  ariaLabel,
  height = 24,
  fontSize = 12,
  disabled = false,
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className="flex w-full"
      style={{
        height,
        border: `1px solid ${C.divider}`,
        borderRadius: 0,
        overflow: "hidden",
        pointerEvents: disabled ? "none" : undefined,
      }}
    >
      {options.map((option, index) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => onChange(option)}
            className="flex-1 cursor-pointer"
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 400,
              fontStretch: "condensed",
              textTransform: "uppercase",
              fontSize,
              letterSpacing: "0.08em",
              lineHeight: 1,
              color: isActive ? C.white : inactiveColor,
              background: isActive ? activeFill : "transparent",
              boxShadow: isActive ? `inset 0 0 0 1px ${activeBorder}` : undefined,
              borderLeft: index > 0 ? `1px solid ${C.divider}` : undefined,
              borderRadius: 0,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
