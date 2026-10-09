import type { SpeakerRole } from "../services/speakerResolver";

export interface AnnouncementParams {
  eventKey: string;
  flightId: string | null;
  languageId: string;
  eventData?: Record<string, string>;
  /** Locutor seleccionado por el usuario (solo eventos con pinning, p. ej. gate_*). */
  voiceId?: string | null;
  /** Rol del locutor según el catálogo (solo eventos con pinning). */
  speakerRole?: SpeakerRole | null;
  /** Posición del avión al disparar (para historial `flight_audio_deliveries`). */
  latitude?: number | null;
  /** Posición del avión al disparar (para historial `flight_audio_deliveries`). */
  longitude?: number | null;
  /** Altitud ft al disparar (contexto del historial, opcional). */
  altitude?: number | null;
}

export type AnnouncementEvent =
  | "generating"
  | "announcement"
  | "playing"
  | "error"
  | "completed"
  | "announcement:started"
  | "announcement:completed"
  | "announcement:enqueued";
