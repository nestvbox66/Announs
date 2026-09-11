/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Página de configuración de Voces: muestra voices_stock como tarjetas,
 * con avatar, rol, idiomas (banderas), switch habilitado y botón Escuchar.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Volume2, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../components/Toast";
import { voiceService, VoiceWithStatus, roleBadge } from "../../services/voiceService";
import { musicCacheService } from "../../services/MusicCacheService";
import LanguageFlag from "../../components/LanguageFlag";

function mimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return "audio/mpeg";
}

function genderIcon(gender: string | null | undefined): string {
  const g = (gender || "").toLowerCase().trim();
  if (!g) return "⚧";
  if (g.startsWith("f") || g.includes("fem") || g.includes("mujer") || g === "♀" || g === "female" || g === "woman") return "♀️";
  if (g.startsWith("m") || g.includes("mas") || g.includes("hombre") || g === "♂" || g === "male" || g === "man") return "♂️";
  // fallback: check exact values from DB like "femenino"/"masculino"
  if (g.includes("femen")) return "♀️";
  if (g.includes("mascul")) return "♂️";
  return "⚧";
}

export default function VoicesPage() {
  const { showToast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Cargar usuario y voces
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setUserId(user.id);
        const list = await voiceService.getVoicesWithStatus(user.id);
        if (cancelled) return;
        setVoices(list);
      } catch (e: any) {
        if (!cancelled) showToast(e?.message || "Error al cargar voces", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  // Cleanup audio on unmount
  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter((v) =>
      v.voice_name.toLowerCase().includes(q) ||
      (v.voice_role || "").toLowerCase().includes(q)
    );
  }, [voices, search]);

  const toggleVoice = (id: string, enabled: boolean) => {
    setVoices((prev) => prev.map((v) => (v.id === id ? { ...v, voice_enabled: enabled } : v)));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!userId) {
      showToast("Usuario no autenticado", "error");
      return;
    }
    setSaving(true);
    try {
      const settings = voices.map((v) => ({ voicestock_id: v.id, voice_enabled: v.voice_enabled }));
      await voiceService.saveVoiceSettings(userId, settings);
      setDirty(false);
      showToast("¡Ajustes de voces guardados!", "success");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar voces", "error");
    } finally {
      setSaving(false);
    }
  };

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.src = "";
    }
    audioRef.current = null;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPlayingId(null);
  };

  const playSample = async (voice: VoiceWithStatus) => {
    // Toggle stop if already playing this voice
    if (playingId === voice.id) {
      stopPlayback();
      return;
    }

    // Sin audio de muestra: no reproducir
    if (!voice.audio_sample_url) {
      showToast("Audio no disponible para esta voz", "error");
      return;
    }

    // Detener la reproducción de cualquier otra tarjeta
    stopPlayback();

    setLoadingId(voice.id);
    setPlayingId(voice.id);
    try {
      // Caché compartido: evita descargas repetidas del mismo audio de muestra
      const buffer = await musicCacheService.getMusic(voice.audio_sample_url);
      const blob = new Blob([buffer], { type: mimeTypeFromUrl(voice.audio_sample_url) });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl);
      audioRef.current = audio;

      audio.onended = () => stopPlayback();
      audio.onerror = () => {
        stopPlayback();
        showToast("No se pudo reproducir la muestra", "error");
      };

      try {
        await audio.play();
      } catch {
        stopPlayback();
        showToast("No se pudo reproducir la muestra", "error");
      }
    } catch (e: any) {
      stopPlayback();
      if (/404|no encontrado|not found/i.test(e?.message || "")) {
        showToast("Archivo de audio de muestra no encontrado (404)", "error");
      } else {
        showToast(e?.message || "No se pudo reproducir la muestra", "error");
      }
    } finally {
      setLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-8 flex items-center justify-center gap-2 text-white/70 font-mono text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando voces...
      </div>
    );
  }

  return (
    <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-5 shadow-lg space-y-4 w-full animate-fadeIn">
      <div className="border-b border-white/10 pb-3 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-display font-black text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
            🗣️ Control y Registro de Voces Naturales
          </h3>
          <p className="text-xs text-white/60 font-mono mt-1">
            Configure los perfiles sintéticos de cabina o registre grabaciones de voz de tripulantes reales.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              placeholder="Buscar por nombre o rol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#00172e] border border-[#3B7EB2]/40 rounded-[4px] pl-7 pr-3 py-1.5 text-xs font-mono text-white placeholder:text-white/40 focus:outline-none focus:border-[#45AFFF] w-[220px]"
            />
          </div>
        </div>
      </div>

      {/* Guardar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className={`px-4 py-2 rounded-[5px] text-xs font-mono font-black transition-all inline-flex items-center gap-2 ${
            saving || !dirty
              ? "bg-white/10 text-white/40 border border-white/10 cursor-not-allowed"
              : "bg-[#43E600] text-black hover:bg-[#3bcc00] shadow-[0_0_12px_rgba(67,230,0,0.25)] cursor-pointer"
          }`}
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Guardar ajustes
        </button>
      </div>

      {/* Grilla */}
      {filtered.length === 0 ? (
        <div className="text-center text-white/60 font-mono text-xs py-10 border border-dashed border-white/15 rounded-[6px] bg-black/15">
          {voices.length === 0 ? "No hay voces disponibles en voices_stock." : "Sin resultados para la búsqueda."}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((voice) => {
            const isPlaying = playingId === voice.id;
            const isLoading = loadingId === voice.id;
            const badge = roleBadge(voice.voice_role);
            const sexoIcon = genderIcon(voice.voice_gender);
            return (
              <div
                key={voice.id}
                className={`rounded-[8px] border transition-all flex gap-4 p-4 min-h-[150px] ${
                  voice.voice_enabled
                    ? "bg-[#002440]/70 border-[#3B7EB2]/55 shadow-md"
                    : "bg-black/25 border-white/10 opacity-75 hover:opacity-90"
                }`}
              >
                {/* Avatar 1/3 - cuadrado grande */}
                <div className="w-[32%] max-w-[140px] shrink-0">
                  <div className="aspect-square w-full rounded-[8px] overflow-hidden border border-white/15 bg-[#00172e] shadow-inner flex items-center justify-center">
                    {voice.avatar_url ? (
                      <img
                        src={voice.avatar_url}
                        alt={voice.voice_name}
                        className="w-full h-full object-cover"
                        onError={(e) => ((e.currentTarget.style.display = "none"))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#0b2844] to-[#00172e] text-white/80 font-black text-2xl">
                        {(voice.voice_name || "?").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Contenido 2/3 */}
                <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                  <div className="space-y-2 min-w-0">
                    {/* Nombre destacado */}
                    <h4 className="font-sans font-black text-[15px] leading-tight text-white truncate">
                      {voice.voice_name}
                    </h4>

                    {/* Rol + Sexo + Idiomas en fila */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase tracking-wider border ${badge.color}`}>
                        <span>{badge.dot}</span> {badge.label}
                      </span>
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 border border-white/15 text-[18px] leading-none"
                        title={voice.voice_gender || "—"}
                        aria-label={`sexo ${voice.voice_gender}`}
                      >
                        {sexoIcon}
                      </span>
                      {/* Idiomas solo banderas - mismo sistema que Backoffice / VoiceStockPage */}
                      <span className="inline-flex items-center gap-1.5 ml-1">
                        {voice.languages.length > 0 ? (
                          voice.languages.map((l) => (
                            <span key={l.id} title={l.language_name} aria-label={l.language_name}>
                              <LanguageFlag src={l.flag_URL} name={l.language_name} size="sm" />
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] font-mono text-white/35">—</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-2 pt-1">
                    {voice.audio_sample_url ? (
                      <button
                        type="button"
                        onClick={() => playSample(voice)}
                        disabled={isLoading}
                        title={isLoading ? "Cargando audio..." : undefined}
                        className={`flex-1 font-mono text-[11px] font-bold py-2 px-2 rounded-[4px] border transition-all flex items-center justify-center gap-1.5 ${
                          isPlaying
                            ? "bg-red-500/25 text-red-300 border-red-500/40 animate-pulse cursor-pointer"
                            : isLoading
                              ? "bg-black/35 border-white/20 text-white/60 cursor-wait opacity-70"
                              : "bg-black/35 hover:bg-black/60 border-white/20 hover:border-white/40 text-white cursor-pointer"
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                        ) : (
                          <Volume2 className={`w-3.5 h-3.5 shrink-0 ${isPlaying ? "animate-bounce" : ""}`} />
                        )}
                        <span className="truncate">
                          {isLoading ? "Cargando..." : isPlaying ? "Reproduciendo..." : "▶️ Escuchar"}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Audio no disponible"
                        className="flex-1 font-mono text-[11px] font-bold py-2 px-2 rounded-[4px] border bg-white/5 text-white/30 border-white/10 cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        <span className="text-[13px] leading-none">🔇</span>
                        <span className="truncate">Audio no disponible</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleVoice(voice.id, !voice.voice_enabled)}
                      aria-pressed={voice.voice_enabled}
                      className={`flex-1 font-mono text-[11px] font-black py-2 px-2 rounded-[4px] border cursor-pointer transition-all flex items-center justify-center gap-1 ${
                        voice.voice_enabled
                          ? "bg-[#43E600]/20 text-[#43E600] border-[#43E600]/40 hover:bg-[#43E600]/30"
                          : "bg-white/10 text-white/70 border-white/15 hover:bg-white/15 hover:text-white"
                      }`}
                    >
                      <span className="text-[13px] leading-none">{voice.voice_enabled ? "🔊" : "🔇"}</span>
                      <span className="truncate">{voice.voice_enabled ? "Activado" : "Activar"}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
