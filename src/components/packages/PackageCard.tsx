/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tarjeta del catálogo: portada (o placeholder), nombre, descripción,
 * aerolínea ICAO, duración formateada, switch de habilitación (con
 * autoguardado de la preferencia personal) y preview multimedia.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff, Loader2, Plane, Play, Timer } from "lucide-react";
import {
  formatDuration,
  packageStatusKey,
  packageTypeKey,
  type PackageRecord,
} from "../../services/PackagesService";
import { getAirlineName } from "../../utils/airlineMapping";

interface PackageCardProps {
  pkg: PackageRecord;
  /** Valor del switch (fila en `user_package_preferences`; sin fila = off). */
  enabled: boolean;
  /** Alterna el switch (el padre autogarda con upsert). */
  onToggleEnabled: (next: boolean) => void;
  /** Guardado en curso (deshabilita el switch temporalmente). */
  toggling: boolean;
  onPreview: () => void;
}

function statusStyle(status: string): string {
  switch (status) {
    case "approved":
      return "bg-[#43E600]/15 text-[#43E600] border-[#43E600]/40";
    case "rejected":
      return "bg-red-500/15 text-red-400 border-red-500/40";
    default:
      return "bg-amber-400/15 text-amber-300 border-amber-400/40";
  }
}

export default function PackageCard({
  pkg,
  enabled,
  onToggleEnabled,
  toggling,
  onPreview,
}: PackageCardProps) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const showCover = pkg.cover_image_url && !imgError;
  const airlineName = pkg.airline_icao ? getAirlineName(pkg.airline_icao) : null;

  return (
    <article
      className={`rounded-[6px] border transition-all flex flex-col overflow-hidden ${
        enabled
          ? "bg-[#002440]/65 border-[#3B7EB2]/55 shadow-md shadow-[#2C6591]/10"
          : "bg-black/25 border-white/10 opacity-75 hover:opacity-95"
      }`}
    >
      {/* Portada */}
      <div className="relative h-32 bg-white">
        {showCover ? (
          <img
            src={pkg.cover_image_url as string}
            alt={t("config.packages.card_cover_alt", { name: pkg.package_name })}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-slate-400">
            <ImageOff className="w-8 h-8" />
            <span className="text-[9px] font-mono uppercase tracking-widest">{t("config.packages.card_no_cover")}</span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className="text-[9px] font-mono font-black uppercase tracking-wide bg-black/70 text-[#45AFFF] border border-[#45AFFF]/40 rounded-[3px] px-2 py-0.5">
            {t(`config.packages.${packageTypeKey(pkg.package_type)}`)}
          </span>
        </div>
        <span
          className={`absolute top-2 right-2 text-[9px] font-mono font-black uppercase tracking-wide border rounded-[3px] px-2 py-0.5 ${statusStyle(pkg.status)}`}
        >
          {t(`config.packages.${packageStatusKey(pkg.status)}`)}
        </span>
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex justify-between items-start gap-3">
          <h5 className="font-sans font-bold text-sm text-white leading-tight tracking-wide">
            {pkg.package_name}
          </h5>
          <label className="relative inline-flex items-center cursor-pointer select-none shrink-0 mt-0.5" title={t("config.packages.card_toggle")}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={toggling}
              onChange={(e) => onToggleEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-[18px] bg-white/15 rounded-full peer-checked:bg-[#43E600] relative transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-[14px] after:w-[14px] after:transition-all peer-checked:after:translate-x-[14px]">
              {toggling && <Loader2 className="w-3 h-3 animate-spin absolute left-1 top-1 text-white/70" />}
            </div>
          </label>
        </div>

        <p className="text-xs text-white/70 font-mono leading-relaxed line-clamp-3 min-h-[48px]">
          {pkg.package_desc || t("config.packages.card_no_description")}
        </p>

        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono border-t border-white/5 pt-3">
          <div className="flex items-center gap-1.5 text-white/60">
            <Plane className="w-3.5 h-3.5 text-[#45AFFF] shrink-0" />
            <span className="truncate" title={airlineName ?? undefined}>
              {pkg.airline_icao ? (
                <>
                  <span className="text-[#43E600] font-black">{pkg.airline_icao}</span>
                  <span className="text-white/50"> · {airlineName}</span>
                </>
              ) : (
                <span className="text-white/45">{t("config.packages.card_global")}</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-white/60 justify-end">
            <Timer className="w-3.5 h-3.5 text-[#45AFFF] shrink-0" />
            <span className="font-bold text-white/85">{formatDuration(pkg.duration_seconds)}</span>
          </div>
        </div>

        <div className="flex gap-2 mt-auto pt-1">
          <button
            type="button"
            onClick={onPreview}
            disabled={!pkg.package_url}
            className="flex-1 border border-[#45AFFF]/50 hover:bg-[#45AFFF]/15 disabled:opacity-35 disabled:cursor-not-allowed text-[#45AFFF] font-mono font-bold px-3 py-2 rounded-[5px] text-[11px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {t("config.packages.card_preview")}
          </button>
        </div>
      </div>
    </article>
  );
}
