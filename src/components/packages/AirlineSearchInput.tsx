/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Input con buscador de aerolíneas (tabla `of_airlines` por ICAO o nombre).
 * Deshabilitado cuando el tipo de paquete es `airport_chime` (global).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plane, Search } from "lucide-react";
import { searchAirlines, type AirlineOption } from "../../services/PackagesService";

interface AirlineSearchInputProps {
  value: string;
  onChange: (icao: string) => void;
  disabled?: boolean;
}

export default function AirlineSearchInput({
  value,
  onChange,
  disabled = false,
}: AirlineSearchInputProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AirlineOption[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (disabled || value.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const { data } = await searchAirlines(value);
      setResults(data);
      setSearching(false);
      setOpen(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [value, disabled]);

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Plane className="absolute left-3 top-2.5 h-4 w-4 text-white/45" />
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
          onFocus={() => {
            if (!disabled && results.length > 0) setOpen(true);
          }}
          placeholder={disabled ? t("config.packages.airline_ph_disabled") : t("config.packages.airline_ph")}
          maxLength={4}
          className="w-full bg-[#00213d] border border-[#3B7EB2]/50 rounded-[4px] py-2 pl-10 pr-9 text-xs font-mono font-black tracking-widest text-white uppercase placeholder:normal-case placeholder:font-normal placeholder:text-white/30 focus:outline-none focus:border-[#43E600] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <Search className="absolute right-3 top-2.5 h-4 w-4 text-white/30" />
      </div>

      {open && !disabled && (results.length > 0 || searching) && (
        <ul className="absolute z-20 mt-1 w-full max-h-44 overflow-y-auto bg-[#0b2844] border border-[#3B7EB2]/50 rounded-[4px] shadow-[0_8px_30px_rgba(0,0,0,0.6)] text-xs font-mono">
          {searching && (
            <li className="px-3 py-2 text-white/50">{t("config.packages.airline_searching")}</li>
          )}
          {!searching &&
            results.map((a) => (
              <li key={a.icao}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(a.icao);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#45AFFF]/15 transition-colors cursor-pointer flex items-center justify-between gap-2"
                >
                  <span>
                    <span className="text-[#43E600] font-black">{a.icao}</span>
                    <span className="text-white/85"> — {a.name}</span>
                  </span>
                  {a.country && (
                    <span className="text-white/40 text-[10px] shrink-0">{a.country}</span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
