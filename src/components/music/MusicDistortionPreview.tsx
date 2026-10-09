/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preview de música de embarque con/sin efecto (Settings / Generales). El
 * selector de configuración NO aplica ningún efecto en el desktop: solo
 * indica QUÉ versión de la pista reproducir, ambas generadas en el backend —
 * `processed_url` (con efecto) o `clean_url` (limpia). Toma una pista al azar
 * del catálogo (con botón para otra) y la reproduce con audio plano.
 * Usa `musicCacheService` (caché compartido) para no re-descargar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Shuffle, Square } from "lucide-react";
import { musicCacheService } from "../../services/MusicCacheService";
import type { BoardingMusicTrack } from "../../services/BoardingMusicService";

interface MusicDistortionPreviewProps {
  tracks: BoardingMusicTrack[];
}

type PreviewStatus = "idle" | "loading" | "playing-processed" | "playing-clean";

function pickRandomTrack(
  tracks: BoardingMusicTrack[],
  excludeId?: string | null
): BoardingMusicTrack | null {
  const pool = excludeId ? tracks.filter((t) => t.id !== excludeId) : tracks;
  const list = pool.length > 0 ? pool : tracks;
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * URL de la versión elegida, con fallbacks si la pista no la trae.
 * `processed` = efecto del backend; `clean` = limpia.
 */
function versionUrl(
  track: BoardingMusicTrack | null,
  version: "processed" | "clean"
): string | null {
  if (!track) return null;
  if (version === "processed") {
    return track.processedUrl ?? track.previewUrl ?? track.cleanUrl ?? null;
  }
  return track.cleanUrl ?? track.previewUrl ?? track.processedUrl ?? null;
}

function mimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return "audio/mpeg";
}

export default function MusicDistortionPreview({ tracks }: MusicDistortionPreviewProps) {
  const { t } = useTranslation();
  const [track, setTrack] = useState<BoardingMusicTrack | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Pista inicial al azar (y si la lista cambia y la actual ya no existe).
  useEffect(() => {
    if (tracks.length === 0) {
      setTrack(null);
      return;
    }
    setTrack((prev) => {
      if (prev && tracks.some((x) => x.id === prev.id)) return prev;
      return pickRandomTrack(tracks);
    });
  }, [tracks]);

  const cleanup = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      if (audio.src) URL.revokeObjectURL(audio.src);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    cleanup();
    setStatus("idle");
    setMessage(null);
  }, [cleanup]);

  // Limpieza al desmontar (evita audio colgado al cambiar de vista).
  useEffect(() => () => cleanup(), [cleanup]);

  const playPreview = useCallback(
    async (version: "processed" | "clean") => {
      const url = versionUrl(track, version);
      if (!url) {
        setStatus("idle");
        setMessage(t("config.music_distortion_no_tracks"));
        return;
      }
      // Si ya suena, detener (toggle).
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
          setStatus("idle");
        };
        audio.onerror = () => {
          cleanup();
          setStatus("idle");
          setMessage(t("config.music_distortion_error"));
        };
        await audio.play();
        setStatus(version === "processed" ? "playing-processed" : "playing-clean");
      } catch (err) {
        console.error("[MusicDistortionPreview] Error al reproducir:", err);
        cleanup();
        setStatus("idle");
        setMessage(t("config.music_distortion_error"));
      }
    },
    [track, cleanup, stopPlayback, t]
  );

  const reshuffle = useCallback(() => {
    stopPlayback();
    setTrack(pickRandomTrack(tracks, track?.id ?? null));
  }, [stopPlayback, tracks, track]);

  if (tracks.length === 0) {
    return (
      <p className="text-[10px] font-mono text-white/45">
        {t("config.music_distortion_no_tracks")}
      </p>
    );
  }

  const isLoading = status === "loading";
  const isPlaying = status === "playing-processed" || status === "playing-clean";

  return (
    <div className="border-t border-white/5 pt-3 mt-1 space-y-2">
      {/* Fila de pista: altura reservada para que no salte el layout. */}
      <div className="flex items-center justify-between gap-2 min-h-[20px]">
        <span className="text-[10px] font-mono text-white/55 uppercase tracking-wider truncate min-w-0">
          {isPlaying && (
            <>
              {t(
                status === "playing-processed"
                  ? "config.music_distortion_playing_effect"
                  : "config.music_distortion_playing_clean"
              )}{" "}
            </>
          )}
          <strong className="text-white/90 normal-case">{track?.name ?? "—"}</strong>
        </span>
        <button
          type="button"
          onClick={reshuffle}
          disabled={isLoading}
          title={t("config.music_distortion_reshuffle")}
          className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-[#45AFFF] hover:text-[#43E600] transition-colors cursor-pointer disabled:opacity-40 shrink-0"
        >
          <Shuffle className="w-3.5 h-3.5 shrink-0" />
          <span className="whitespace-nowrap">{t("config.music_distortion_reshuffle")}</span>
        </button>
      </div>

      {/* Botones con ancho fijo: el cambio de etiqueta no mueve al vecino. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (isPlaying ? stopPlayback() : void playPreview("processed"))}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-1.5 min-w-[172px] text-[10px] font-mono px-3 py-1.5 rounded cursor-pointer transition-all uppercase font-bold bg-[#002440]/60 text-[#45AFFF] border border-[#3B7EB2]/40 hover:bg-[#45AFFF] hover:text-[#00172e] disabled:opacity-60 disabled:cursor-wait"
        >
          <span className="inline-flex w-3.5 justify-center shrink-0">
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isPlaying ? (
              <Square className="w-3 h-3 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
          </span>
          {isPlaying
            ? t("config.music_distortion_stop")
            : isLoading
              ? t("config.music_distortion_loading")
              : t("config.music_distortion_listen_effect")}
        </button>
        <button
          type="button"
          onClick={() => (isPlaying ? stopPlayback() : void playPreview("clean"))}
          disabled={isLoading || isPlaying}
          className="inline-flex items-center justify-center gap-1.5 min-w-[172px] text-[10px] font-mono px-3 py-1.5 rounded cursor-pointer transition-all uppercase font-bold bg-black/40 text-white/70 border border-white/15 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="inline-flex w-3.5 justify-center shrink-0">
            <Play className="w-3.5 h-3.5 fill-current" />
          </span>
          {t("config.music_distortion_listen_clean")}
        </button>
      </div>

      {/* Línea de mensaje con altura reservada (no empuja el layout). */}
      <span className="text-[9px] font-mono text-amber-300 block min-h-[14px]">
        {message ?? ""}
      </span>
    </div>
  );
}
