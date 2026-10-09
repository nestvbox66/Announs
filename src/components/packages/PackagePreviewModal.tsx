/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modal rápido de verificación del contenido (audio o video) antes de
 * usar el paquete en vuelo.
 */

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatDuration,
  packageTypeKey,
  type PackageRecord,
} from "../../services/PackagesService";

interface PackagePreviewModalProps {
  pkg: PackageRecord;
  onClose: () => void;
}

export default function PackagePreviewModal({ pkg, onClose }: PackagePreviewModalProps) {
  const { t } = useTranslation();
  const isVideo = pkg.package_type === "safety_video";

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0b2844] border-2 border-[#3b7eb2]/50 rounded-xl max-w-lg w-full shadow-[0_0_40px_rgba(0,0,0,0.85)] p-5 space-y-4 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
          <div>
            <h3 className="font-display font-black text-sm text-[#45AFFF] uppercase tracking-wider">
              {t("config.packages.preview_title", { name: pkg.package_name })}
            </h3>
            <p className="text-[10px] font-mono text-white/50 mt-0.5">
              {t(`config.packages.${packageTypeKey(pkg.package_type)}`)} · {formatDuration(pkg.duration_seconds)}
              {pkg.airline_icao ? ` · ${pkg.airline_icao}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white font-mono text-xs cursor-pointer p-1"
            aria-label={t("config.packages.preview_close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {pkg.package_url ? (
          isVideo ? (
            <video
              src={pkg.package_url}
              controls
              preload="metadata"
              className="w-full rounded-[5px] border border-white/10 bg-black max-h-[320px]"
            />
          ) : (
            <div className="bg-black/40 border border-white/10 rounded-[5px] p-4">
              {pkg.cover_image_url && (
                <img
                  src={pkg.cover_image_url}
                  alt={t("config.packages.card_cover_alt", { name: pkg.package_name })}
                  className="w-full h-40 object-cover rounded-[4px] mb-3 border border-white/10"
                />
              )}
              <audio src={pkg.package_url} controls preload="metadata" className="w-full" />
            </div>
          )
        ) : (
          <p className="text-xs font-mono text-white/50 bg-black/30 border border-white/10 rounded-[5px] p-4">
            {t("config.packages.preview_no_media")}
          </p>
        )}

        {pkg.package_desc && (
          <p className="text-xs text-white/70 font-mono leading-relaxed">{pkg.package_desc}</p>
        )}
      </div>
    </div>
  );
}
