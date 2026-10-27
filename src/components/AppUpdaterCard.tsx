/**
 * Tarjeta de Actualizaciones (Configuración / Generales).
 *
 * Muestra la versión instalada, la nueva versión si la hubiere (o que la app
 * está al día) y un botón de actualización habilitado únicamente cuando hay
 * una versión disponible. Al pulsarlo descarga, instala y reinicia la app.
 */
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppUpdater } from "../services/AppUpdaterService";

export default function AppUpdaterCard() {
  const { t } = useTranslation();
  const {
    phase,
    supported,
    currentVersion,
    availableVersion,
    progress,
    error,
    checkNow,
    install,
  } = useAppUpdater(true);

  const downloading = phase === "downloading";
  const canInstall = phase === "available" && !downloading;
  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <div
      id="cfg-bloque-updater"
      className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md flex flex-col gap-3"
    >
      <div className="border-b border-white/10 pb-2">
        <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
          <Download className="w-4.5 h-4.5 text-[#43E600]" /> {t("config.updater_title")}
        </h3>
        <p className="text-[10px] text-white/50 font-mono mt-1">{t("config.updater_desc")}</p>
      </div>

      <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider">
            {t("config.updater_current")}
          </span>
          <span className="font-mono text-xs text-white font-bold">
            {currentVersion ?? "—"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider">
            {t("config.updater_status")}
          </span>
          {phase === "checking" && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-white/60">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {t("config.updater_checking")}
            </span>
          )}
          {phase === "available" && (
            <span className="font-mono text-xs text-amber-300 font-bold">
              {t("config.updater_available", { version: availableVersion ?? "—" })}
            </span>
          )}
          {(phase === "up-to-date" || phase === "idle") && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#43E600]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t("config.updater_uptodate")}
            </span>
          )}
          {downloading && (
            <span className="font-mono text-[11px] font-bold text-[#45AFFF]">
              {pct === null ? t("config.updater_downloading") : `${pct}%`}
            </span>
          )}
          {phase === "error" && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-red-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t("config.updater_error")}
            </span>
          )}
          {phase === "unsupported" && (
            <span className="font-mono text-[11px] text-white/50">{t("config.updater_unsupported")}</span>
          )}
        </div>

        {downloading && (
          <div className="h-1.5 rounded-full bg-black/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#45AFFF] transition-all duration-300"
              style={{ width: pct === null ? "100%" : `${pct}%` }}
            />
          </div>
        )}

        {phase === "error" && error && (
          <p className="text-[10px] font-mono text-red-300/80 break-words">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => void install()}
            disabled={!canInstall}
            className={`inline-flex items-center gap-1.5 font-mono font-bold px-3 py-2 rounded-[4px] text-xs border transition-all ${
              canInstall
                ? "bg-[#43E600]/20 text-[#43E600] border-[#43E600]/40 hover:bg-[#43E600]/30 cursor-pointer"
                : "bg-white/5 text-white/30 border-white/10 cursor-not-allowed"
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? t("config.updater_downloading") : t("config.updater_update_btn")}
          </button>
          <button
            type="button"
            onClick={checkNow}
            disabled={!supported || phase === "checking" || downloading}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-white/60 border border-white/10 rounded-[4px] px-2.5 py-2 hover:text-white hover:border-white/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title={t("config.updater_recheck")}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${phase === "checking" ? "animate-spin" : ""}`} />
            {t("config.updater_recheck")}
          </button>
        </div>
      </div>
    </div>
  );
}
