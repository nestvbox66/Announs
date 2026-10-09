/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Formulario modal de carga de un nuevo paquete: nombre, descripción,
 * portada opcional (jpeg/png), tipo (boarding_audio | safety_video |
 * airport_chime), multimedia dinamizado por tipo y aerolínea ICAO con
 * buscador (deshabilitada para `airport_chime`).
 */

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileAudio,
  FileImage,
  FileVideo,
  ImagePlus,
  Info,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  PACKAGE_LIMITS,
  createPackage,
  packageTypeKey,
  readMediaDuration,
  type CreatePackageErrorCode,
  type PackageType,
} from "../../services/PackagesService";
import AirlineSearchInput from "./AirlineSearchInput";

interface UploadPackageModalProps {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
  notify: (msg: string) => void;
}

const PACKAGE_TYPE_VALUES: PackageType[] = ["boarding_audio", "safety_video", "airport_chime"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPackageModal({
  userId,
  onClose,
  onCreated,
  notify,
}: UploadPackageModalProps) {
  const { t } = useTranslation();
  const [packageName, setPackageName] = useState("");
  const [packageDesc, setPackageDesc] = useState("");
  const [packageType, setPackageType] = useState<PackageType>("boarding_audio");
  const [airlineIcao, setAirlineIcao] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [readingDuration, setReadingDuration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const isVideo = packageType === "safety_video";
  const isChime = packageType === "airport_chime";
  const limits = isVideo ? PACKAGE_LIMITS.video : PACKAGE_LIMITS.audio;
  const mediaKind = isVideo ? "video" : "audio";

  // Al cambiar a chime se limpia la aerolínea (paquete global).
  const handleTypeChange = (next: PackageType) => {
    setPackageType(next);
    if (next === "airport_chime") setAirlineIcao("");
    // El archivo previo puede no corresponder al nuevo tipo → se reinicia.
    setMediaFile(null);
    setDurationSeconds(null);
    setFormError(null);
    if (mediaInputRef.current) mediaInputRef.current.value = "";
  };

  const handleCoverSelect = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setFormError(t("config.packages.upload_err_cover_type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError(t("config.packages.upload_err_cover_size"));
      return;
    }
    setFormError(null);
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleMediaSelect = async (file: File | undefined) => {
    if (!file) return;
    setFormError(null);

    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    const allowedExts = limits.accept.split(",").map((s) => s.trim().toLowerCase());
    if (!allowedExts.includes(ext)) {
      setFormError(
        isVideo
          ? t("config.packages.upload_err_media_ext_video")
          : t("config.packages.upload_err_media_ext_audio")
      );
      return;
    }
    if (file.size > limits.maxSizeMb * 1024 * 1024) {
      setFormError(t("config.packages.upload_err_media_size", { max: limits.maxSizeMb }));
      return;
    }

    setMediaFile(file);
    setReadingDuration(true);
    try {
      const seconds = await readMediaDuration(file, mediaKind);
      setDurationSeconds(seconds);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setFormError(
        code === "MEDIA_INVALID"
          ? t("config.packages.upload_err_invalid")
          : t("config.packages.upload_err_duration")
      );
      setMediaFile(null);
      setDurationSeconds(null);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
    } finally {
      setReadingDuration(false);
    }
  };

  const canSubmit = useMemo(() => {
    return (
      packageName.trim().length > 0 &&
      mediaFile != null &&
      durationSeconds != null &&
      !readingDuration &&
      !submitting
    );
  }, [packageName, mediaFile, durationSeconds, readingDuration, submitting]);

  const mapCreateError = (
    code: CreatePackageErrorCode | null,
    detail: string | null
  ): string => {
    switch (code) {
      case "COVER_UPLOAD_FAILED":
        return t("config.packages.upload_err_cover_upload", { detail: detail ?? "" });
      case "MEDIA_UPLOAD_FAILED":
        return t("config.packages.upload_err_media_upload", { detail: detail ?? "" });
      case "INSERT_FAILED":
        return t("config.packages.upload_err_insert", { detail: detail ?? "" });
      case "NO_RESPONSE":
      default:
        return t("config.packages.upload_err_no_response");
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !mediaFile || durationSeconds == null) return;
    setSubmitting(true);
    setFormError(null);
    const { data, error, detail } = await createPackage(userId, {
      packageName,
      packageDesc,
      packageType,
      airlineIcao: isChime ? null : airlineIcao.trim() || null,
      durationSeconds,
      mediaFile,
      coverFile,
    });
    setSubmitting(false);
    if (error || !data) {
      setFormError(mapCreateError(error, detail));
      return;
    }
    notify(t("config.packages.toast_uploaded", { name: data.package_name }));
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[70] flex items-center justify-center p-4">
      <div className="bg-[#0b2844] border-2 border-[#3b7eb2]/50 rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-[0_0_40px_rgba(0,0,0,0.85)] p-6 space-y-4 animate-fadeIn">
        <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
          <h3 className="font-display font-black text-sm text-[#45AFFF] uppercase tracking-wider flex items-center gap-1.5">
            <UploadCloud className="w-4 h-4 text-[#43E600]" />
            {t("config.packages.upload_title")}
          </h3>
          <button
            type="button"
            className="text-white/40 hover:text-white font-mono text-xs cursor-pointer p-1"
            onClick={onClose}
            aria-label={t("config.packages.upload_close_form")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nombre */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pkg-name" className="text-white/80 font-mono font-bold uppercase text-[10.5px]">
            {t("config.packages.upload_name")}
          </label>
          <input
            id="pkg-name"
            type="text"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder={t("config.packages.upload_name_ph")}
            maxLength={120}
            className="bg-[#00172e] border border-[#3B7EB2]/50 rounded-[4px] px-3 py-2 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-[#43E600]"
          />
        </div>

        {/* Descripción */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pkg-desc" className="text-white/80 font-mono font-bold uppercase text-[10.5px]">
            {t("config.packages.upload_desc")}
          </label>
          <textarea
            id="pkg-desc"
            value={packageDesc}
            onChange={(e) => setPackageDesc(e.target.value)}
            placeholder={t("config.packages.upload_desc_ph")}
            rows={3}
            maxLength={1000}
            className="bg-[#00172e] border border-[#3B7EB2]/50 rounded-[4px] px-3 py-2 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-[#43E600] resize-none"
          />
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pkg-type" className="text-white/80 font-mono font-bold uppercase text-[10.5px]">
            {t("config.packages.upload_type")}
          </label>
          <select
            id="pkg-type"
            value={packageType}
            onChange={(e) => handleTypeChange(e.target.value as PackageType)}
            className="bg-[#00172e] border border-[#3B7EB2]/50 rounded-[4px] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#43E600] cursor-pointer"
          >
            {PACKAGE_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`config.packages.${packageTypeKey(value)}`)} ({value})
              </option>
            ))}
          </select>
        </div>

        {/* Portada */}
        <div className="flex flex-col gap-1.5">
          <span className="text-white/80 font-mono font-bold uppercase text-[10.5px]">
            {t("config.packages.upload_cover")}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="border border-white/30 hover:bg-white/5 text-white font-mono font-bold px-3 py-2 rounded-[4px] text-[11px] flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <ImagePlus className="w-4 h-4 text-[#43E600]" />
              {coverFile ? t("config.packages.upload_cover_change") : t("config.packages.upload_cover_select")}
            </button>
            <span className="text-[10px] font-mono text-white/45 flex items-center gap-1">
              <FileImage className="w-3.5 h-3.5" />
              {coverFile ? `${coverFile.name} (${formatBytes(coverFile.size)})` : t("config.packages.upload_cover_hint")}
            </span>
          </div>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => handleCoverSelect(e.target.files?.[0])}
          />
          {coverPreview && (
            <img
              src={coverPreview}
              alt={t("config.packages.upload_cover_alt")}
              className="w-full h-28 object-cover rounded-[4px] border border-white/10"
            />
          )}
        </div>

        {/* Multimedia dinamizado */}
        <div className="flex flex-col gap-1.5">
          <span className="text-white/80 font-mono font-bold uppercase text-[10.5px]">
            {isVideo ? t("config.packages.upload_media_video") : t("config.packages.upload_media_audio")}
          </span>
          <div className="bg-[#1a3852]/60 border border-white/10 p-3.5 rounded-[5px] space-y-3">
            <p className="text-[11px] text-white/85 font-mono flex items-start gap-1.5">
              <Info className="w-4 h-4 text-[#45AFFF] shrink-0 mt-0.5" />
              {isVideo
                ? t("config.packages.upload_hint_video", { max: limits.maxSizeMb })
                : t("config.packages.upload_hint_audio", { max: limits.maxSizeMb })}
            </p>
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={readingDuration}
              className="w-full bg-[#45AFFF]/15 hover:bg-[#45AFFF]/25 border border-[#45AFFF]/40 text-[#45AFFF] font-mono font-bold py-2 rounded-[4px] text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {readingDuration ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isVideo ? (
                <FileVideo className="w-4 h-4" />
              ) : (
                <FileAudio className="w-4 h-4" />
              )}
              {readingDuration
                ? t("config.packages.upload_reading")
                : mediaFile
                  ? t("config.packages.upload_change_file")
                  : isVideo
                    ? t("config.packages.upload_select_video")
                    : t("config.packages.upload_select_audio")}
            </button>
            <input
              ref={mediaInputRef}
              type="file"
              accept={limits.accept}
              className="hidden"
              onChange={(e) => handleMediaSelect(e.target.files?.[0])}
            />
            {mediaFile && (
              <div className="text-[11px] font-mono text-white/80 bg-black/30 border border-white/10 rounded-[4px] px-3 py-2 flex items-center justify-between gap-2">
                <span className="truncate">{mediaFile.name} ({formatBytes(mediaFile.size)})</span>
                {durationSeconds != null && (
                  <span className="text-[#43E600] font-black shrink-0">
                    {Math.floor(durationSeconds / 60)}:{String(Math.floor(durationSeconds % 60)).padStart(2, "0")}s
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Aerolínea ICAO */}
        <div className="flex flex-col gap-1.5">
          <label className="text-white/80 font-mono font-bold uppercase text-[10.5px]">
            {t("config.packages.upload_airline")} {isChime ? t("config.packages.upload_airline_na") : ""}
          </label>
          <AirlineSearchInput value={airlineIcao} onChange={setAirlineIcao} disabled={isChime} />
          <p className="text-[10px] text-white/45 font-mono">
            {isChime
              ? t("config.packages.upload_airline_hint_chime")
              : t("config.packages.upload_airline_hint")}
          </p>
        </div>

        {formError && (
          <p className="text-[11px] font-mono font-bold text-red-300 bg-red-500/10 border border-red-500/40 rounded-[4px] px-3 py-2">
            {formError}
          </p>
        )}

        <div className="flex gap-2.5 pt-2 border-t border-white/10 font-mono">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 bg-black/40 hover:bg-black/60 border border-white/15 text-white font-bold py-2 rounded-[5px] text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {t("config.packages.upload_cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 bg-[#43E600] hover:bg-[#3bcc00] disabled:opacity-40 disabled:cursor-not-allowed text-[#00172e] font-black py-2 rounded-[5px] text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? t("config.packages.upload_submitting") : t("config.packages.upload_submit")}
          </button>
        </div>
        <p className="text-[10px] font-mono text-white/40">
          {t("config.packages.upload_pending_note")}
        </p>
      </div>
    </div>
  );
}
