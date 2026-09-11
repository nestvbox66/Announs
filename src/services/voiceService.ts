/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Servicio de voces: catálogo `voices_stock` + habilitación por usuario `voices`.
 * También resuelve idiomas desde `voice_languages` + `languages`.
 */

import { supabase } from "../lib/supabase";

export interface VoiceStock {
  id: string;
  voice_id: string | null;
  voice_name: string;
  voice_gender: string | null;
  voice_type: string | null;
  voice_provider: string | null;
  voice_role: string | null;
  avatar_url: string | null;
  audio_sample_url: string | null;
  user_public: boolean | null;
  only_gate_agent: boolean | null;
}

export interface VoiceLanguage {
  voice_id: string;
  language_id: string;
  language_name?: string | null;
  flag?: string | null;
}

export interface LanguageInfo {
  id: string;
  language_name: string;
  flag_URL: string | null;
  code?: string | null;
}

export interface VoiceWithStatus extends VoiceStock {
  voice_enabled: boolean;
  languages: LanguageInfo[];
}

export interface VoiceSetting {
  voicestock_id: string;
  voice_enabled: boolean;
}

/**
 * Mapea nombres de idioma a emoji de bandera. Fallback: muestra código genérico.
 */
export function languageFlag(languageName: string): string {
  const n = (languageName || "").toLowerCase();
  if (n.includes("español") && n.includes("ar")) return "🇦🇷";
  if (n.includes("español") && n.includes("es")) return "🇪🇸";
  if (n.includes("español")) return "🇪🇸";
  if (n.includes("english") && n.includes("us")) return "🇺🇸";
  if (n.includes("inglés") && n.includes("us")) return "🇺🇸";
  if (n.includes("english") && n.includes("uk")) return "🇬🇧";
  if (n.includes("inglés") && n.includes("uk")) return "🇬🇧";
  if (n.includes("english")) return "🇬🇧";
  if (n.includes("inglés")) return "🇬🇧";
  if (n.includes("portugués") || n.includes("portuguese") || n.includes("portugues")) return "🇧🇷";
  if (n.includes("francés") || n.includes("french") || n.includes("frances")) return "🇫🇷";
  if (n.includes("alemán") || n.includes("german")) return "🇩🇪";
  if (n.includes("italiano") || n.includes("italian")) return "🇮🇹";
  return "🏳️";
}

export function roleBadge(role: string | null | undefined): { label: string; color: string; dot: string } {
  const r = (role || "").toLowerCase();
  if (r === "captain") return { label: "Captain", color: "bg-[#45AFFF]/20 text-[#45AFFF] border-[#45AFFF]/30", dot: "🔵" };
  if (r === "crew") return { label: "Crew", color: "bg-[#43E600]/20 text-[#43E600] border-[#43E600]/30", dot: "🟢" };
  if (r === "gate") return { label: "Gate", color: "bg-[#ff8c00]/20 text-[#ffb340] border-[#ff8c00]/30", dot: "🟠" };
  return { label: role || "—", color: "bg-white/10 text-white/60 border-white/10", dot: "⚪" };
}

export const voiceService = {
  /**
   * Obtiene todas las voces de `voices_stock` con su estado de habilitación
   * para el usuario. Si no hay registro en `voices`, voice_enabled = false.
   * También resuelve idiomas via voice_languages + languages.
   */
  async getVoicesWithStatus(userId: string): Promise<VoiceWithStatus[]> {
    // 1. Catálogo
    const { data: stock, error: stockError } = await supabase
      .from("voices_stock")
      .select("id, voice_id, voice_name, voice_gender, voice_type, voice_provider, voice_role, avatar_url, audio_sample_url, user_public, only_gate_agent")
      .order("voice_name", { ascending: true });

    if (stockError) throw new Error(stockError.message);
    const stockRows: VoiceStock[] = (stock || []) as VoiceStock[];
    if (stockRows.length === 0) return [];

    // 2. Habilitación por usuario
    const { data: userVoices, error: voicesError } = await supabase
      .from("voices")
      .select("voicestock_id, voice_enabled")
      .eq("user_id", userId);

    if (voicesError) throw new Error(voicesError.message);
    const enabledMap = new Map<string, boolean>();
    for (const row of (userVoices || []) as any[]) {
      enabledMap.set(row.voicestock_id, !!row.voice_enabled);
    }

    // 3. Idiomas: voice_languages
    let voiceLangRows: any[] = [];
    try {
      const ids = stockRows.map((s) => s.id);
      const { data: vl, error: vlErr } = await supabase
        .from("voice_languages")
        .select("voice_id, language_id")
        .in("voice_id", ids);
      if (!vlErr) voiceLangRows = vl || [];
    } catch {
      // tabla opcional
    }

    // 4. Languages catálogo (mismo SELECT que Backoffice: id, language_name, flag_URL)
    let langMap = new Map<string, LanguageInfo>();
    if (voiceLangRows.length > 0) {
      const langIds = [...new Set(voiceLangRows.map((r) => r.language_id))];
      const { data: langs, error: langsError } = await supabase
        .from("languages")
        .select("id, language_name, flag_URL")
        .in("id", langIds);
      // Fallback si la columna flag_URL aún no existe en algún entorno
      if (langsError) {
        const { data: langsFallback } = await supabase
          .from("languages")
          .select("id, language_name")
          .in("id", langIds);
        for (const l of (langsFallback || []) as any[]) {
          langMap.set(l.id, { id: l.id, language_name: l.language_name, flag_URL: null });
        }
      } else {
        for (const l of (langs || []) as any[]) {
          langMap.set(l.id, { id: l.id, language_name: l.language_name, flag_URL: l.flag_URL ?? null });
        }
      }
    } else {
      // Fallback: si voice_languages vacío, intentar leer voices_stock.languages si existiera
      try {
        const { data: fallback } = await supabase
          .from("voices_stock")
          .select("id, languages")
          .in("id", stockRows.map((s) => s.id));
        // si trae languages como array, lo usamos como hint pero seguimos con langMap vacío
        void fallback;
      } catch {}
    }

    // 5. Merge
    return stockRows.map((s) => {
      const vls = voiceLangRows.filter((r) => r.voice_id === s.id);
      const langs: LanguageInfo[] = vls
        .map((r) => langMap.get(r.language_id))
        .filter((x): x is LanguageInfo => !!x);
      return {
        ...s,
        voice_enabled: enabledMap.get(s.id) ?? false,
        languages: langs,
      };
    });
  },

  /**
   * Guarda configuración de voces (UPSERT por user_id + voicestock_id).
   */
  async saveVoiceSettings(userId: string, voiceSettings: VoiceSetting[]): Promise<void> {
    if (!voiceSettings || voiceSettings.length === 0) return;

    const rows = voiceSettings.map((v) => ({
      user_id: userId,
      voicestock_id: v.voicestock_id,
      voice_enabled: v.voice_enabled,
    }));

    const { error } = await supabase
      .from("voices")
      .upsert(rows, { onConflict: "user_id,voicestock_id" });

    if (error) throw new Error(error.message);
  },
};

// Named exports para compatibilidad con spec del task
export async function getVoicesWithStatus(userId: string): Promise<VoiceWithStatus[]> {
  return voiceService.getVoicesWithStatus(userId);
}
export async function saveVoiceSettings(userId: string, voiceSettings: VoiceSetting[]): Promise<void> {
  return voiceService.saveVoiceSettings(userId, voiceSettings);
}
