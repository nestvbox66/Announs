/**
 * Servicio para persistir preferencias de Personal de Vuelo en setting_general
 * (language_id, captain_voice_id, crew_voice_id, gate_agent_voice_id)
 * Persiste entre sesiones por user_id con upsert.
 */
import { supabase } from "../lib/supabase";

export interface FlightCrewPreferences {
  language_id: string | null;
  captain_voice_id: string | null;
  crew_voice_id: string | null;
  gate_agent_voice_id: string | null;
}

export class SettingGeneralService {
  /**
   * Carga preferencias de idioma/voces desde setting_general para un usuario.
   * Usa maybeSingle para no fallar si no existe fila.
   */
  static async loadFlightCrewPreferences(userId: string): Promise<FlightCrewPreferences | null> {
    try {
      const { data, error } = await supabase
        .from("setting_general")
        .select("language_id, captain_voice_id, crew_voice_id, gate_agent_voice_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.warn("[SettingGeneralService] load error:", error.message);
        return null;
      }
      if (!data) return null;
      return {
        language_id: data.language_id ?? null,
        captain_voice_id: data.captain_voice_id ?? null,
        crew_voice_id: data.crew_voice_id ?? null,
        gate_agent_voice_id: data.gate_agent_voice_id ?? null,
      };
    } catch (err) {
      console.warn("[SettingGeneralService] load catch:", err);
      return null;
    }
  }

  /**
   * Guarda preferencias de idioma/voces en setting_general con upsert por user_id.
   */
  static async saveFlightCrewPreferences(
    userId: string,
    prefs: Partial<FlightCrewPreferences>
  ): Promise<boolean> {
    try {
      const payload: Record<string, unknown> = {
        user_id: userId,
        ...(prefs.language_id !== undefined ? { language_id: prefs.language_id } : {}),
        ...(prefs.captain_voice_id !== undefined ? { captain_voice_id: prefs.captain_voice_id } : {}),
        ...(prefs.crew_voice_id !== undefined ? { crew_voice_id: prefs.crew_voice_id } : {}),
        ...(prefs.gate_agent_voice_id !== undefined ? { gate_agent_voice_id: prefs.gate_agent_voice_id } : {}),
      };

      console.log("[SettingGeneralService] saving:", payload);

      const { error } = await supabase
        .from("setting_general")
        .upsert(payload as any, { onConflict: "user_id" });

      if (error) {
        console.error("[SettingGeneralService] save error:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[SettingGeneralService] save catch:", err);
      return false;
    }
  }
}
