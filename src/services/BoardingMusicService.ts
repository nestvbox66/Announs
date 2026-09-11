/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Servicio para el catálogo `boarding_music` y la persistencia de la música
 * ambiental de un vuelo en `flight_setting_announcements`
 * (`boarding_music_enabled`, `boarding_music_id`).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, okVoid, fail } from "./ServiceResult";

/** Pista de música ambiental disponible (fila de `boarding_music` activa). */
export interface BoardingMusicTrack {
  id: string;
  name: string;
  /** Versión limpia (sin efectos de cabina) — usada en el preview. */
  cleanUrl: string | null;
  /** Versión procesada (con efectos de cabina) — usada en vuelo. */
  processedUrl: string | null;
  previewUrl: string | null;
  mood: string | null;
}

/** Configuración de música ambiental persistida para un vuelo. */
export interface FlightBoardingMusicSettings {
  /** `flight_setting_announcements.boarding_music_enabled`. */
  enabled: boolean;
  /** `flight_setting_announcements.boarding_music_id` (null = "Sin música"). */
  musicId: string | null;
}

export class BoardingMusicService {
  /**
   * Carga las pistas activas del catálogo `boarding_music` (`is_active = true`).
   * El catálogo es público (sin filtro por usuario), igual que `languages`.
   */
  static async listActiveTracks(): Promise<ServiceResult<BoardingMusicTrack[]>> {
    try {
      const { data, error } = await supabase
        .from("boarding_music")
        .select("id, name, clean_url, processed_url, preview_url, mood")
        .eq("is_active", true)
        .order("name");

      if (error) return fail(error.message);

      const tracks: BoardingMusicTrack[] = (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        cleanUrl: row.clean_url ?? null,
        processedUrl: row.processed_url ?? null,
        previewUrl: row.preview_url ?? null,
        mood: row.mood ?? null,
      }));
      return ok(tracks);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** Carga la configuración de música ambiental persistida para un vuelo. */
  static async loadForFlight(
    flightId: string
  ): Promise<ServiceResult<FlightBoardingMusicSettings>> {
    try {
      const { data, error } = await supabase
        .from("flight_setting_announcements")
        .select("boarding_music_enabled, boarding_music_id")
        .eq("flight_id", flightId)
        .maybeSingle();

      if (error) return fail(error.message);

      if (!data) return ok({ enabled: true, musicId: null });

      return ok({
        enabled: (data as any).boarding_music_enabled ?? true,
        musicId: (data as any).boarding_music_id ?? null,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Persiste la configuración de música ambiental de un vuelo en
   * `flight_setting_announcements` (upsert por `flight_id`).
   */
  static async saveForFlight(
    flightId: string,
    settings: FlightBoardingMusicSettings
  ): Promise<ServiceResult<void>> {
    try {
      const { error } = await supabase
        .from("flight_setting_announcements")
        .upsert(
          {
            flight_id: flightId,
            boarding_music_enabled: settings.enabled,
            boarding_music_id: settings.musicId || null,
          },
          { onConflict: "flight_id" }
        );

      if (error) return fail(error.message);
      return okVoid();
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}
