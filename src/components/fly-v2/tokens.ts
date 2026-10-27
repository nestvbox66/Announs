/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tokens compartidos del rediseño FLY.
 * Fuente de verdad: `docs/ui-spec-fly.md`.
 */

import type React from "react";

export const HEADER_GRADIENT =
  "linear-gradient(180deg, #00345C 0%, #00345C 13%, #001626 51%, #00345C 87%, #00345C 100%)";

export const C = {
  sky: "#45AFFF",
  skySoft: "#33A6FF",
  ice: "#DBF0FF",
  white: "#FFFFFF",
  navyDeep: "#001626",
  navy: "#002540",
  navyHeader: "#002C4D",
  tabActive: "#2C6591",
  tabInactive: "#0F4066",
  selectFill: "#00345C",
  selectActiveFill: "#005699",
  greenBase: "#1A5C00",
  green: "#43E600",
  greenDark: "#113B00",
  greenInk: "#0B2600",
  greenDisabledInk: "#0A2400",
  magenta: "#E600D2",
  magentaDark: "#5C0053",
  orange: "#E68B00",
  orangeDark: "#5C3800",
  mutedSurface: "#1E2C38",
  divider: "#2C3E4D",
  grey: "#757575",
  offBorder: "#7A0000",
  offActiveFill: "#5C0000",
  offActiveBorder: "#CC0000",
} as const;

export const FONT_BAHN: React.CSSProperties["fontFamily"] =
  "'Bahnschrift', 'DIN Alternate', 'Franklin Gothic Medium', 'Segoe UI', sans-serif";
