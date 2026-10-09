/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sección Settings / Packages: banner de acción "Subir Nuevo Paquete" +
 * catálogo en 3 columnas con filtros por tipo (Todos, Audios de Embarque,
 * Videos de Seguridad, Chimes). Reemplaza el mockup anterior.
 */

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  PackageOpen,
  RefreshCw,
  Search,
  UploadCloud,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  listPackages,
  listPreferences,
  upsertPreference,
  type PackageRecord,
  type PackageType,
} from "../../services/PackagesService";
import PackageCard from "./PackageCard";
import PackagePreviewModal from "./PackagePreviewModal";
import UploadPackageModal from "./UploadPackageModal";

type FilterKey = "all" | PackageType;
type StatusFilter = "all" | "enabled" | "disabled";

const PAGE_SIZE = 12;

export default function PackagesTab() {
  const { t } = useTranslation();
  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: t("config.packages.filter_all") },
    { key: "boarding_audio", label: t("config.packages.filter_boarding_audio") },
    { key: "safety_video", label: t("config.packages.filter_safety_video") },
    { key: "airport_chime", label: t("config.packages.filter_airport_chime") },
  ];
  const [userId, setUserId] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [preferences, setPreferences] = useState<Map<string, boolean>>(new Map());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [previewPkg, setPreviewPkg] = useState<PackageRecord | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data, error } = await listPackages();
    if (error) {
      setLoadError(error);
      setLoading(false);
      return;
    }
    setPackages(data);

    if (user) {
      const prefs = await listPreferences(user.id);
      if (prefs.error) {
        console.warn("[PackagesTab] No se pudieron cargar las preferencias:", prefs.error);
        notify(t("config.packages.toast_pref_error", { detail: prefs.error }));
      } else {
        setPreferences(prefs.data);
        console.log("[PackagesTab] Preferencias cargadas:", prefs.data.size, "filas");
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Volver a la primera página al cambiar búsqueda o filtros.
  useEffect(() => {
    setPage(1);
  }, [filter, search, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packages.filter((p) => {
      if (filter !== "all" && p.package_type !== filter) return false;
      if (q && !p.package_name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all") {
        // Solo la tabla manda: sin fila en `user_package_preferences` = off.
        const on = preferences.get(p.id) ?? false;
        if (statusFilter === "enabled" && !on) return false;
        if (statusFilter === "disabled" && on) return false;
      }
      return true;
    });
  }, [packages, filter, search, statusFilter, preferences]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: packages.length,
      boarding_audio: 0,
      safety_video: 0,
      airport_chime: 0,
    };
    for (const p of packages) {
      if (p.package_type in c) c[p.package_type as PackageType] += 1;
    }
    return c;
  }, [packages]);

  /**
   * Estado efectivo del switch: SOLO lo guardado en `user_package_preferences`.
   * Sin fila para el paquete = apagado (aunque el paquete esté aprobado y
   * habilitado a nivel público). Así el switch refleja 1:1 la tabla.
   */
  const effectiveEnabled = (pkg: PackageRecord): boolean => {
    return preferences.get(pkg.id) ?? false;
  };

  /**
   * Switch con autoguardado: alterna la preferencia personal y la persiste de
   * inmediato con UPSERT en `user_package_preferences` (crea la fila si no
   * existe o la actualiza si ya existe). Optimista con reversión ante error.
   */
  const handleToggle = async (pkg: PackageRecord, next: boolean) => {
    if (!userId) {
      notify(t("config.packages.toast_login_preferences"));
      return;
    }
    const previous = effectiveEnabled(pkg);
    // Optimista: reflejar el cambio al instante.
    setPreferences((prev) => new Map(prev).set(pkg.id, next));
    setTogglingIds((prev) => new Set(prev).add(pkg.id));
    const { error } = await upsertPreference(userId, pkg.id, next);
    setTogglingIds((prev) => {
      const copy = new Set(prev);
      copy.delete(pkg.id);
      return copy;
    });
    if (error) {
      // Reversión: volver al valor anterior y avisar.
      setPreferences((prev) => new Map(prev).set(pkg.id, previous));
      notify(t("config.packages.toast_pref_error", { detail: error }));
    }
  };

  // El recién creado queda `pending`: no entra al catálogo (solo aprobados).
  const handleCreated = () => {
    setShowUpload(false);
    setFilter("all");
  };

  return (
    <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-5 shadow-lg space-y-6 w-full animate-fadeIn">
      {/* ── Sección Superior: acción ─────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[6px] border border-[#43E600]/40 bg-gradient-to-r from-[#0b2844] via-[#123a5c] to-[#0b2844] p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-display font-black text-white uppercase tracking-wider flex items-center gap-2">
              <PackageOpen className="w-5 h-5 text-[#43E600]" />
              {t("config.packages.catalog_title")}
            </h3>
            <p className="text-xs text-white/60 font-mono mt-1 max-w-xl">
              {t("config.packages.catalog_desc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="bg-[#43E600] text-black font-mono font-black hover:bg-[#3bcc00] px-5 py-2.5 rounded-[5px] text-xs transition-all shadow-[0_0_12px_rgba(67,230,0,0.25)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer inline-flex items-center gap-1.5 shrink-0"
          >
            <UploadCloud className="w-4 h-4" />
            {t("config.packages.upload_action")}
          </button>
        </div>
      </div>

      {/* ── Filtros + refrescar ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("config.packages.filter_aria")}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wide rounded-[4px] border transition-all cursor-pointer ${
                filter === f.key
                  ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white shadow-md"
                  : "text-white/60 border border-transparent hover:text-white hover:bg-white/5"
              }`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="border border-white/30 hover:bg-white/5 text-white font-mono font-bold px-3 py-1.5 rounded-[4px] text-[11px] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#43E600] ${loading ? "animate-spin" : ""}`} />
          {t("config.packages.refresh")}
        </button>
      </div>

      {/* ── Buscador + filtro de estado ─────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/45" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("config.packages.search_ph")}
            className="w-full bg-[#00213d] border border-[#3B7EB2]/50 rounded-[4px] py-2 pl-10 pr-4 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-[#43E600] transition-colors"
          />
        </div>
        <div className="flex gap-1.5 shrink-0" role="tablist" aria-label={t("config.packages.status_aria")}>
          {(
            [
              { key: "all", label: t("config.packages.status_all") },
              { key: "enabled", label: t("config.packages.status_enabled") },
              { key: "disabled", label: t("config.packages.status_disabled") },
            ] as Array<{ key: StatusFilter; label: string }>
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={statusFilter === s.key}
              onClick={() => setStatusFilter(s.key)}
              className={`px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wide rounded-[4px] border transition-all cursor-pointer ${
                statusFilter === s.key
                  ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white shadow-md"
                  : "text-white/60 border border-transparent hover:text-white hover:bg-white/5"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Sección Principal: catálogo ──────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-white/60 font-mono text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-[#43E600]" />
          {t("config.packages.loading")}
        </div>
      ) : loadError ? (
        <div className="bg-red-500/10 border border-red-500/40 rounded-[5px] p-4 text-xs font-mono text-red-200">
          {t("config.packages.load_error", { detail: loadError })}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-white/50">
          <Inbox className="w-10 h-10" />
          <p className="text-xs font-mono">
            {packages.length === 0
              ? t("config.packages.empty_none")
              : t("config.packages.empty_filter")}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Nota: la `key` va en el Fragment porque el namespace JSX del
                proyecto (sin @types/react) no admite `key` junto a props
                declaradas en componentes locales. */}
            {paged.map((pkg) => (
              <Fragment key={pkg.id}>
                <PackageCard
                  pkg={pkg}
                  enabled={effectiveEnabled(pkg)}
                  onToggleEnabled={(next) => handleToggle(pkg, next)}
                  toggling={togglingIds.has(pkg.id)}
                  onPreview={() => setPreviewPkg(pkg)}
                />
              </Fragment>
            ))}
          </div>

          {/* ── Conteo + paginado ─────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1 text-[11px] font-mono text-white/60">
            <span>{t("config.packages.results_count", { count: filtered.length })}</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="border border-white/20 hover:bg-white/5 disabled:opacity-35 disabled:cursor-not-allowed text-white font-bold px-2.5 py-1.5 rounded-[4px] transition-all flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {t("config.packages.prev")}
                </button>
                <span className="px-1">{t("config.packages.page_of", { current: safePage, total: totalPages })}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="border border-white/20 hover:bg-white/5 disabled:opacity-35 disabled:cursor-not-allowed text-white font-bold px-2.5 py-1.5 rounded-[4px] transition-all flex items-center gap-1 cursor-pointer"
                >
                  {t("config.packages.next")}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Modales ─────────────────────────────────────────────── */}
      {showUpload && userId && (
        <UploadPackageModal
          userId={userId}
          onClose={() => setShowUpload(false)}
          onCreated={handleCreated}
          notify={notify}
        />
      )}
      {showUpload && !userId && (
        <div className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4">
          <div className="bg-[#0b2844] border border-[#3b7eb2]/50 rounded-xl p-5 max-w-sm w-full text-xs font-mono text-white/80 space-y-3">
            <p>{t("config.packages.login_required")}</p>
            <button
              type="button"
              onClick={() => setShowUpload(false)}
              className="w-full bg-black/40 border border-white/15 rounded-[4px] py-2 cursor-pointer hover:bg-black/60"
            >
              {t("config.packages.close")}
            </button>
          </div>
        </div>
      )}
      {previewPkg && (
        <PackagePreviewModal pkg={previewPkg} onClose={() => setPreviewPkg(null)} />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[80] animate-fadeIn text-[11px] font-mono font-black bg-[#43E600] text-[#00172e] px-4 py-3 rounded-[5px] flex items-center gap-2 shadow-[0_4px_30px_rgba(0,0,0,0.6)] max-w-sm">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
