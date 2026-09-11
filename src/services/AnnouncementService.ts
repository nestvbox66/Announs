import { supabase } from "../lib/supabase";
import { AnnouncementInfo } from "../types";
import { AnnouncementParams, AnnouncementEvent } from "../types/announcement";
import { fileLogger } from "./FileLogger";

export type { AnnouncementParams, AnnouncementEvent };

/**
 * Lee el body de un error HTTP de supabase Edge Function.
 * `supabase.functions.invoke` ante una respuesta no-2xx devuelve un
 * `FunctionsHttpError` cuyo `.context` es la `Response` original. Acá se extrae
 * el status y el JSON/texto real que devolvió la Edge Function (la causa raíz).
 */
async function readEdgeErrorContext(error: any): Promise<{ status?: number; statusText?: string; body?: string }> {
  try {
    const context = error?.context;
    if (!context || typeof context.clone !== "function") {
      return { body: undefined };
    }
    const resp = context.clone();
    const text = await resp.text().catch(() => "");
    return {
      status: typeof resp.status === "number" ? resp.status : undefined,
      statusText: typeof resp.statusText === "string" ? resp.statusText : undefined,
      body: text,
    };
  } catch {
    return {};
  }
}

/**
 * Formatea el body de error de la Edge Function a un mensaje legible.
 * Suele ser JSON {error: "...", details: "..."} → se usa `details` o `error`.
 */
function formatEdgeErrorBody(body: string | null | undefined, fallback: string): string {
  if (!body || body === "") return fallback;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const details = parsed.details ?? parsed.message ?? parsed.error;
      if (typeof details === "string" && details !== "") return details;
    }
  } catch {
    // body no-JSON: usarlo tal cual (recortado)
  }
  return body.length > 400 ? `${body.slice(0, 400)}…` : body;
}

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
    console.log("[SERVICE]");
    console.log("Generating / Loading Audio");
    console.log("Event: " + eventKey);

    const payload = {
      event_key: eventKey,
      flight_id: flightId,
      language_id: languageId,
      ...(eventData ? { event_data: eventData } : {}),
    };
    console.log("[AnnouncementService] Llamando a audio-get con payload:", payload);
    fileLogger.log('[AnnouncementService] audio-get request', payload);

    const { data, error, response } = await supabase.functions.invoke("audio-get", {
      method: "POST",
      body: payload,
    });

    if (this.aborted) throw new Error("Cancelled");

    if (error) {
      const edgeCtx = await readEdgeErrorContext(error);
      const detailBody = edgeCtx.body && edgeCtx.body !== "" ? edgeCtx.body : null;
      // El mensaje "Edge Function returned a non-2xx status code" es genérico.
      // El body real de la Edge Function suele ser JSON: {error, details}.
      console.error("[AnnouncementService] Respuesta de audio-get (ERROR):", {
        status: edgeCtx.status,
        statusText: edgeCtx.statusText,
        body: detailBody,
        errorMessage: error?.message ?? "(sin mensaje)",
        eventKey,
        flightId,
        languageId,
      });
      fileLogger.error('[AnnouncementService] audio-get error', {
        status: edgeCtx.status,
        statusText: edgeCtx.statusText,
        body: detailBody,
        errorMessage: error?.message ?? null,
        eventKey,
        flightId,
        languageId,
      });
      this.emit("generating", false);
      const userMsg = formatEdgeErrorBody(
        detailBody,
        error.message || "Error al invocar la Edge Function"
      );
      // Mostrar el detalle real si lo hay; si no, el mensaje del SDK.
      this.emit("error", userMsg);
      throw error;
    }

    console.log("[AnnouncementService] Respuesta de audio-get:", {
      status: response?.status,
      statusText: response?.statusText,
      success: (data as any)?.success,
      hasAudioUrl: !!((data as any)?.announcement?.audio_url),
      eventKey,
    });
    fileLogger.log('[AnnouncementService] audio-get response OK', {
      status: response?.status,
      success: (data as any)?.success,
      hasAudioUrl: !!((data as any)?.announcement?.audio_url),
      eventKey,
    });

    if (!data?.success || !data?.announcement?.audio_url) {
      const msg = data?.error ?? "Respuesta inválida de la Edge Function";
      console.error("[AnnouncementService] Respuesta inválida (2xx pero sin audio):", {
        data,
        eventKey,
        flightId,
        languageId,
      });
      fileLogger.error('[AnnouncementService] audio-get 2xx sin audio', { data, eventKey });
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
          console.log("[SERVICE]");
          console.log("Audio Started");
          console.log(`[AnnouncementPlayer] 🔊 Audio iniciado para: ${eventKey}`);
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
          this.emit("completed", eventKey);
          console.log(`[AnnouncementPlayer] ✅ Audio completado para: ${eventKey}`);
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
