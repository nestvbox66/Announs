import { supabase } from "../lib/supabase";
import { AnnouncementInfo } from "../types";
import { AnnouncementParams, AnnouncementEvent } from "../types/announcement";

export type { AnnouncementParams, AnnouncementEvent };

export class AnnouncementService {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private currentAudio: HTMLAudioElement | null = null;
  private cancelResolve: (() => void) | null = null;
  private aborted = false;

  on(event: AnnouncementEvent, callback: (...args: any[]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: AnnouncementEvent, ...args: any[]) {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  cancel(): void {
    this.aborted = true;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio.load();
      this.currentAudio = null;
    }
    if (this.cancelResolve) {
      this.cancelResolve();
      this.cancelResolve = null;
    }
    this.emit("generating", false);
    this.emit("playing", false);
  }

  async play({
    eventKey,
    flightId,
    languageId,
    eventData,
  }: AnnouncementParams): Promise<AnnouncementInfo> {
    this.aborted = false;
    this.emit("generating", true);
    this.emit("error", null);

    const { data, error } = await supabase.functions.invoke("audio-get", {
      method: "POST",
      body: {
        event_key: eventKey,
        flight_id: flightId,
        language_id: languageId,
        ...(eventData ? { event_data: eventData } : {}),
      },
    });

    if (this.aborted) throw new Error("Cancelled");

    if (error) {
      this.emit("generating", false);
      this.emit("error", error.message || "Error al invocar la Edge Function");
      throw error;
    }

    if (!data?.success || !data?.announcement?.audio_url) {
      const msg = data?.error ?? "Respuesta inválida de la Edge Function";
      this.emit("generating", false);
      this.emit("error", msg);
      throw new Error(msg);
    }

    const ann: AnnouncementInfo = data.announcement;
    this.emit("announcement", ann);

    if (this.aborted) throw new Error("Cancelled");

    const url = new URL(ann.audio_url, window.location.origin);
    url.searchParams.set("_t", Date.now().toString());

    const audio = new Audio(url.toString());
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";

    this.currentAudio = audio;

    await new Promise<void>((resolve, reject) => {
      let done = false;

      this.cancelResolve = () => {
        if (!done) {
          done = true;
          this.cancelResolve = null;
          resolve();
        }
      };

      audio.addEventListener("canplaythrough", () => {
        if (!done) {
          this.emit("playing", true);
          audio.play().catch((err) => {
            if (!done) {
              done = true;
              this.emit("playing", false);
              this.emit("generating", false);
              this.emit("error", "Error al reproducir audio");
              reject(err);
            }
          });
        }
      });

      audio.addEventListener("ended", () => {
        if (!done) {
          done = true;
          this.cancelResolve = null;
          this.currentAudio = null;
          this.emit("playing", false);
          this.emit("generating", false);
          resolve();
        }
      });

      audio.addEventListener("error", () => {
        if (!done) {
          done = true;
          this.cancelResolve = null;
          this.currentAudio = null;
          this.emit("playing", false);
          this.emit("generating", false);
          this.emit("error", "Error al reproducir audio");
          reject(new Error("Error al reproducir audio"));
        }
      });

      audio.load();
    });

    return ann;
  }
}
