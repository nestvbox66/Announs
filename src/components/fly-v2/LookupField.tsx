/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Caja de texto del filtro de Flight Lookup con desplegable de
 * autocompletado anclado al borde inferior del campo activo.
 * Fuente de verdad: `docs/ui-spec-fly.md` (Flight Lookup, §2.1).
 */

import { useState } from "react";
import { C, FONT_BAHN } from "./tokens";

export interface LookupFieldProps {
  id: string;
  label: string;
  /** Tier-1 (16px) para campos principales, Tier-2 (11px) para sub-campos. */
  variant: "primary" | "sub";
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
  /** Máximo de sugerencias mostradas (por defecto 5). */
  maxSuggestions?: number;
}

export function LookupField({
  id,
  label,
  variant,
  value,
  onChange,
  suggestions,
  placeholder = "",
  maxSuggestions = 5,
}: LookupFieldProps) {
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  const active = focused || value.trim() !== "";
  const query = value.trim().toLowerCase();
  const matches =
    query === ""
      ? []
      : suggestions
          .filter(
            (item) =>
              item.toLowerCase().includes(query) &&
              item.toLowerCase() !== query,
          )
          .slice(0, maxSuggestions);

  const showDropdown = open && matches.length > 0;

  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontFamily: FONT_BAHN,
          fontWeight: 700,
          fontStretch: "semi-condensed",
          textTransform: "uppercase",
          fontSize: variant === "primary" ? 16 : 11,
          color: C.white,
          marginBottom: 4,
          lineHeight: 1.2,
        }}
      >
        {label}
      </label>
      <div className="relative w-full">
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          className="w-full"
          style={{
            height: 34,
            background: active ? C.selectActiveFill : C.selectFill,
            border: `1px solid ${active ? C.skySoft : C.sky}`,
            borderRadius: 0,
            color: C.white,
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            paddingLeft: 12,
            paddingRight: 12,
            outline: "none",
          }}
        />
        {showDropdown && (
          <ul
            aria-label={`${label} suggestions`}
            className="absolute left-0 right-0"
            style={{
              top: "100%",
              zIndex: 10,
              margin: 0,
              padding: 0,
              listStyle: "none",
              background: C.navyDeep,
              border: `1px solid ${C.skySoft}`,
              borderTop: 0,
              borderRadius: 0,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {matches.map((match) => (
              <li key={match} style={{ margin: 0, padding: 0 }}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChange(match);
                    setOpen(false);
                  }}
                  className="block w-full cursor-pointer text-left hover:brightness-125"
                  style={{
                    background: "transparent",
                    border: 0,
                    borderRadius: 0,
                    color: C.ice,
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 14,
                    padding: "8px 12px",
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = C.selectActiveFill;
                    event.currentTarget.style.color = C.white;
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                    event.currentTarget.style.color = C.ice;
                  }}
                >
                  {match}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
