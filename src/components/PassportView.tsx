/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PassportView — Pasaporte real del piloto.
 *
 * Datos desde Supabase (vuelos finalizados del usuario autenticado):
 *  - Contadores: países conquistados X/195 y total de aeropuertos visitados.
 *  - Mapa Mundi de Conquista (react-simple-maps + world-atlas 110m):
 *    visitados en verde radar/azul aeronáutico, resto en gris oscuro.
 *  - Grilla de países conquistados con sello de pasaporte.
 * Nombres en español vía `i18n-iso-countries`; banderas por indicador regional.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import countries, { type LocaleData } from "i18n-iso-countries";
import esLocale from "i18n-iso-countries/langs/es.json";
import { ArrowLeft, Globe, MapPin, PlaneTakeoff } from "lucide-react";
import { PilotStatsService, PilotAtlas } from "../services/PilotStatsService";
import topoUrl from "world-atlas/countries-110m.json?url";

countries.registerLocale(esLocale as unknown as LocaleData);

interface PassportViewProps {
  onBack: () => void;
}

const TOTAL_COUNTRIES = 195;

/** Emoji de bandera a partir del ISO alpha-2 (fallback sin red). */
function flagEmoji(iso: string): string {
  const code = (iso ?? "").toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(...code.split("").map((c) => 127397 + c.charCodeAt(0)));
}

/**
 * Bandera como imagen (flagcdn, se ve en todos los SO incl. Windows, donde los
 * emoji de bandera no se renderizan). Con fallback a emoji si falla la red.
 */
function FlagImg({ iso, className }: { iso: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!/^[A-Za-z]{2}$/.test(iso ?? "") || failed) {
    return <span className={className}>{flagEmoji(iso)}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/w80/${iso.toLowerCase()}.png`}
      alt={`Bandera de ${iso.toUpperCase()}`}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Mapa ISO-numérico (TopoJSON) → ISO alpha-2. */
function buildNumericToAlpha2(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    for (const alpha2 of Object.keys(countries.getAlpha2Codes())) {
      const numeric = countries.alpha2ToNumeric(alpha2);
      if (numeric) map.set(String(numeric).padStart(3, "0"), alpha2);
    }
  } catch {
    // sin mapa: ningún país se marca como visitado
  }
  return map;
}

function formatSealDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export default function PassportView({ onBack }: PassportViewProps) {
  const [atlas, setAtlas] = useState<PilotAtlas | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hoverCountry, setHoverCountry] = useState<string | null>(null);
  // react-simple-maps v5: `Geography` vuelca las props directo al <path>, sin
  // máquina de estados `style={{default,hover,pressed}}`. El hover se maneja
  // con estado local y props planas `fill`/`stroke`.
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const result = await PilotStatsService.loadAtlas();
      if (cancelled) return;
      if (result.success) {
        setAtlas(result.data ?? { countries: [], totalAirports: 0 });
      } else {
        setError(result.error ?? "No se pudo cargar el pasaporte.");
        setAtlas(null);
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const numericToAlpha2 = useMemo(buildNumericToAlpha2, []);
  const visitedByIso = useMemo(() => {
    const map = new Map<string, { ops: number; airports: number; lastFlight: string | null }>();
    for (const country of atlas?.countries ?? []) {
      map.set(country.iso, { ops: country.ops, airports: country.airports, lastFlight: country.lastFlight });
    }
    return map;
  }, [atlas]);

  const countryName = (iso: string): string => {
    try {
      return countries.getName(iso, "es") ?? iso;
    } catch {
      return iso;
    }
  };

  return (
    <div id="passport-view" className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3 border-b border-[#3B7EB2]/50 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white p-2 rounded-[5px] transition-all cursor-pointer flex items-center justify-center"
          title="Volver"
        >
          <ArrowLeft className="w-5 h-5 text-[#45AFFF]" />
        </button>
        <div>
          <div className="text-xs text-[#45AFFF]/60 font-mono tracking-widest uppercase mb-0.5">Pasaporte del piloto</div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight text-[#45AFFF] uppercase">
            Mapa Mundi de Conquista
          </h1>
        </div>
      </div>

      {loading ? (
        <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-10 flex items-center justify-center gap-2 text-white/60 font-mono text-xs">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Sellando tu pasaporte…
        </div>
      ) : error || !atlas ? (
        <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-10 text-center space-y-3">
          <p className="text-xs font-mono text-red-300">No se pudo cargar el pasaporte: {error ?? "sin datos"}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white px-3 py-1.5 rounded-[5px] font-mono text-[11px] transition-all cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Contadores superiores */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-sm flex items-center gap-4">
              <span className="text-4xl">🌍</span>
              <div>
                <div className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">Países Conquistados</div>
                <div className="text-2xl font-mono font-extrabold text-white">
                  {atlas.countries.length} <span className="text-sm text-white/50">/ {TOTAL_COUNTRIES}</span>
                </div>
              </div>
            </div>
            <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-sm flex items-center gap-4">
              <span className="text-4xl">🛬</span>
              <div>
                <div className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">Aeropuertos Visitados</div>
                <div className="text-2xl font-mono font-extrabold text-white">{atlas.totalAirports}</div>
              </div>
            </div>
          </div>

          {/* Mapa mundi */}
          <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] p-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                <Globe className="w-4 h-4" /> Conquista global
              </span>
              <span className="text-[10px] font-mono text-white/50 h-4">
                {hoverCountry ?? "Pasá el cursor sobre un país"}
              </span>
            </div>
            <ComposableMap
              projection="geoEquirectangular"
              projectionConfig={{ scale: 110, center: [-10, -15] }}
              style={{ width: "100%", height: "auto" }}
            >
              <Geographies geography={topoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const alpha2 = numericToAlpha2.get(String(geo.id).padStart(3, "0")) ?? "";
                    const visited = alpha2 !== "" && visitedByIso.has(alpha2);
                    const hovered = hoverKey === geo.rsmKey;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={visited ? "#43E600" : "#8a9bb0"}
                        stroke={hovered ? "#ffffff" : visited ? "#b6ff9e" : "#5b6b80"}
                        strokeWidth={hovered ? 0.75 : 0.5}
                        style={{ outline: "none", cursor: "pointer" }}
                        onMouseEnter={() => {
                          setHoverKey(geo.rsmKey);
                          const name = alpha2 ? countryName(alpha2) : geo.properties?.name;
                          setHoverCountry(`${flagEmoji(alpha2)} ${name}${visited ? " · conquistado" : ""}`);
                        }}
                        onMouseLeave={() => {
                          setHoverKey(null);
                          setHoverCountry(null);
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            </ComposableMap>
            <div className="flex items-center gap-4 px-1 pt-1 text-[10px] font-mono text-white/50">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-[#43E600]" /> Conquistado
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-[#8a9bb0] border border-white/20" /> Sin visitar
              </span>
            </div>
          </div>

          {/* Grilla de países */}
          <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-sm space-y-4">
            <h4 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1.5 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Países conquistados ({atlas.countries.length})
            </h4>
            {atlas.countries.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <PlaneTakeoff className="w-8 h-8 text-[#45AFFF]/40 mx-auto" />
                <p className="text-sm font-bold text-white/80">Tu pasaporte está en blanco</p>
                <p className="text-[11px] font-mono text-white/50 max-w-sm mx-auto">
                  Completá tu primer vuelo (estado finalizado) y el primer sello aparecerá aquí.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {atlas.countries.map((country) => (
                  <div
                    key={country.iso}
                    className="relative p-3 rounded-[5px] border border-[#43E600]/60 bg-[#00345C]/40 overflow-hidden"
                  >
                    <div className="absolute right-[-8px] top-[-8px] opacity-10 select-none pointer-events-none">
                      <FlagImg iso={country.iso} className="w-12 h-auto rounded-sm" />
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <FlagImg iso={country.iso} className="w-8 h-auto rounded-[3px] shadow" />
                      <span className="text-[9px] font-mono bg-[#43E600]/20 text-[#43E600] px-1.5 py-0.5 rounded font-bold border border-[#43E600]/40">
                        SELLADO
                      </span>
                    </div>
                    <div className="mt-2">
                      <h5 className="text-xs font-bold text-white leading-tight">{countryName(country.iso)}</h5>
                      <p className="text-[10px] font-mono text-white/50">{country.iso}</p>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-mono mt-2 pt-1.5 border-t border-white/10 text-white/60">
                      <span>{country.ops} {country.ops === 1 ? "operación" : "operaciones"}</span>
                      <span>{country.airports} {country.airports === 1 ? "aeropuerto" : "aeropuertos"}</span>
                      <span>Último: {formatSealDate(country.lastFlight)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
