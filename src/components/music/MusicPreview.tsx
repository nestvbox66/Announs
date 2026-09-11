/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Botón de previsualización de una pista de música ambiental.
 *
 * Usa `musicCacheService` (caché compartido) para descargar el audio una sola
 * vez y reproducirlo localmente. El preview siempre usa la versión limpia
 * (`cleanUrl`, sin efectos de cabina); si `previewUrl` está disponible se
 * prefiere, según el contrato del catálogo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Square } from "lucide-react";
import { musicCacheService } from "../../services/MusicCacheService";

interface MusicPreviewProps {
  /** Versión limpia (sin efectos) de la pista. */
  cleanUrl: string | null;
  /** Versión de preview dedicada (si el catálogo la provee). */
  previewUrl?: string | null;
  onPlay?: () => void;
  onStop?: () => void;
}

type PreviewStatus = "idle" | "loading" | "playing" | "stopped";

function mimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return "audio/mpeg";
}

export default function MusicPreview({
  cleanUrl,
  previewUrl,
  onPlay,
  onStop,
}: MusicPreviewProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      if (audio.src) URL.revokeObjectURL(audio.src);
    }
    audioRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    cleanup();
    setStatus("stopped");
    setMessage(null);
    onStop?.();
  }, [cleanup, onStop]);

  const playPreview = useCallback(async () => {
    const url = previewUrl || cleanUrl;
    if (!url) {
      setStatus("idle");
      setMessage(t("music.preview.no_audio"));
      return;
    }

    // Si ya se está reproduciendo, detener.
    if (audioRef.current) {
      stopPlayback();
      return;
    }

    setStatus("loading");
    setMessage(null);
    try {
      const buffer = await musicCacheService.getMusic(url);
      const blob = new Blob([buffer], { type: mimeTypeFromUrl(url) });
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audioRef.current = audio;

      audio.onended = () => {
        cleanup();
        setStatus("stopped");
        onStop?.();
      };
      audio.onerror = () => {
        cleanup();
        setStatus("idle");
        setMessage(t("music.preview.error"));
        onStop?.();
      };

      await audio.play();
      setStatus("playing");
      onPlay?.();
    } catch (err) {
      console.error("[MusicPreview] Error al reproducir:", err);
      cleanup();
      setStatus("idle");
      setMessage(t("music.preview.error"));
      onStop?.();
    }
  }, [cleanUrl, previewUrl, cleanup, stopPlayback, onPlay, onStop, t]);

  // Limpieza al desmontar (evita audio colgado al cambiar de vista).
  useEffect(() => () => cleanup(), [cleanup]);

  const isPlaying = status === "playing";

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={playPreview}
        disabled={status === "loading"}
        title={cleanUrl ? undefined : t("music.preview.no_audio")}
        className="inline-flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded cursor-pointer transition-all uppercase font-bold bg-[#002440]/60 text-[#45AFFF] border border-[#3B7EB2]/40 hover:bg-[#45AFFF] hover:text-[#00172e] disabled:opacity-60 disabled:cursor-wait"
      >
        {status === "loading" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isPlaying ? (
          <Square className="w-3 h-3 fill-current" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-current" />
        )}
        {isPlaying
          ? t("music.preview.stop")
          : status === "loading"
            ? t("music.preview.loading")
            : t("music.preview.play")}
      </button>

      {isPlaying && (
        <span className="text-[9px] font-mono text-[#43E600] uppercase tracking-wider">
          {t("music.preview.playing")}
        </span>
      )}
      {!isPlaying && status === "stopped" && (
        <span className="text-[9px] font-mono text-white/50 uppercase tracking-wider">
          {t("music.preview.stopped")}
        </span>
      )}
      {message && (
        <span className="text-[9px] font-mono text-amber-300">{message}</span>
      )}
    </div>
  );
}
