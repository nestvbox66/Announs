/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Selector desplegable (dropdown) genérico de Packages de la comunidad
 * (`safety_video`, `boarding_audio`, ...).
 *
 * El padre provee el `load` del catálogo (ya filtrado por aerolínea +
 * genéricos) y el prefijo i18n (`safety_pack`, `boarding_pack`, ...).
 * Selecciona automáticamente el primero por defecto cuando el valor actual no
 * está en la lista (aunque haya varios disponibles) y reporta el registro
 * completo para que el padre tenga el package activo.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDuration, type PackageRecord } from "../../services/PackagesService";

export interface CommunityPackSelectorProps {
  /** Consulta del catálogo para la aerolínea (null = todas). */
  load: (airlineIcao: string | null) => Promise<{ data: PackageRecord[]; error: string | null }>;
  /** Prefijo de claves i18n (`safety_pack`, `boarding_pack`, ...). */
  tPrefix: string;
  /** ¿El package es genérico? (etiqueta del dropdown). */
  isGeneric: (pkg: Pick<PackageRecord, "airline_icao">) => boolean;
  /** Normaliza un ICAO para mostrarlo como etiqueta. */
  normalizeIcao: (value: string | null | undefined) => string;
  /** ICAO de la aerolínea del vuelo (null = todos, pantalla de preferencias). */
  airlineIcao: string | null;
  /** Id del package seleccionado (null = ninguno). */
  value: string | null;
  /** Se invoca al (auto)seleccionar un package, o con null si no hay. */
  onChange: (pkg: PackageRecord | null) => void;
  /** Deshabilita el selector (p. ej. vuelo en curso). */
  disabled?: boolean;
  /** Prefijo para los ids del DOM (evita duplicados entre pantallas). */
  idPrefix?: string;
  /** Título opcional sobre el selector (p. ej. "Audio ... - [Nombre]"). */
  title?: string | null;
}

export default function CommunityPackSelector({
  load,
  tPrefix,
  isGeneric,
  normalizeIcao,
  airlineIcao,
  value,
  onChange,
  disabled = false,
  idPrefix = "community-pack",
  title = null,
}: CommunityPackSelectorProps) {
  const { t } = useTranslation();
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const wanted = normalizeIcao(airlineIcao);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const result = await loadRef.current(wanted || null);
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setPackages([]);
      } else {
        setPackages(result.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  // Auto-selección por defecto: si no hay valor o el actual ya no está entre
  // los disponibles (aunque haya varios), se elige el primero
  // automáticamente. Si el valor coincide, se reporta el registro completo
  // para que el padre (que solo guardaba el id) tenga el package activo.
  const lastReportedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (loading) return;
    if (packages.length === 0) {
      if (value != null && lastReportedRef.current !== null) {
        lastReportedRef.current = null;
        onChangeRef.current(null);
      }
      return;
    }
    const matched =
      value != null ? (packages.find((pkg) => pkg.id === value) ?? null) : null;
    const target = matched ?? packages[0];
    if (lastReportedRef.current !== target.id) {
      lastReportedRef.current = target.id;
      onChangeRef.current(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, packages, value]);

  const selectId = `${idPrefix}-select`;

  return (
    <div className="border-t border-white/10 pt-3 mt-1 space-y-2">
      <label
        htmlFor={selectId}
        className="block text-[10px] font-mono text-white/70 uppercase tracking-wider font-bold"
      >
        {title ??
          `${t(`${tPrefix}.selector_label`)} · ${
            wanted
              ? t(`${tPrefix}.selector_for_airline`, { icao: wanted })
              : t(`${tPrefix}.selector_all`)
          }`}
      </label>
      {loading ? (
        <p className="text-[11px] font-mono text-[#45AFFF] animate-pulse">
          {t(`${tPrefix}.loading`)}
        </p>
      ) : error ? (
        <p className="text-[11px] font-mono text-red-300">
          {t(`${tPrefix}.load_error`, { error })}
        </p>
      ) : packages.length === 0 ? (
        <p className="text-[11px] font-mono text-amber-300">
          {wanted
            ? t(`${tPrefix}.empty_for_airline`, { icao: wanted })
            : t(`${tPrefix}.empty`)}
        </p>
      ) : (
        <select
          id={selectId}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const found = packages.find((pkg) => pkg.id === e.target.value) ?? null;
            onChange(found);
          }}
          className="w-full bg-[#00172e] border border-[#3B7EB2]/50 text-white rounded-[4px] px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#45AFFF] disabled:opacity-50"
        >
          {packages.map((pkg) => {
            const tag = isGeneric(pkg)
              ? t(`${tPrefix}.generic_tag`)
              : normalizeIcao(pkg.airline_icao);
            const duration = formatDuration(pkg.duration_seconds);
            return (
              <option key={pkg.id} value={pkg.id}>
                {pkg.package_name} · {tag} · {duration}
              </option>
            );
          })}
        </select>
      )}
      {!loading && !error && packages.length > 0 && (
        <p className="text-[10px] font-mono text-white/40">
          {t(`${tPrefix}.hint_cached`)}
        </p>
      )}
    </div>
  );
}
