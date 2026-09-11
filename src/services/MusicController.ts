/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlador de la música ambiental de cabina.
 *
 * Reproduce la pista seleccionada (o aleatoria) durante el embarque y el
 * desembarque, atenúa la música durante los anuncios (ducking) y la detiene
 * con fade out al cerrar puertas o al finalizar el desembarque.
 *
 * - Volumen normal: 0.3 (bajo, para no interferir con los anuncios).
 * - Durante anuncios: 0.0 (silenciado).
 * - Fade de atenuación/restauración por anuncio: 1 s.
 * - Fade out al detener la música: 2 s.
 */
import { BoardingMusicTrack } from "./BoardingMusicService";
import { AnnouncementQueue } from "./AnnouncementQueue";
import { musicCacheService } from "./MusicCacheService";

/** Identificador especial para "música al azar" en los selectores. */
export const RANDOM_MUSIC_ID = "random";

export type MusicState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "error";

/** Comportamiento de la música durante un anuncio. */
export type MusicAnnouncementBehavior =
  | { mode: "fade" }
  | { mode: "pause"; fadeOutMs?: number };

/** Volumen normal de la música (bajo, para no tapar los anuncios). */
export const MUSIC_NORMAL_VOLUME = 0.3;
/** Volumen durante los anuncios (silenciado). */
export const MUSIC_DUCK_VOLUME = 0.0;
/** Duración del fade de atenuación/restauración durante anuncios (1 s). */
export const MUSIC_ANNOUNCEMENT_FADE_MS = 1000;
/** Duración del fade out al detener la música (2 s). */
export const MUSIC_STOP_FADE_MS = 2000;

function mimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  return "audio/mpeg";
}

export class MusicController {
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private state: MusicState = "idle";
  private volume = 0;
  private fadeHandle: number | null = null;
  private loadToken = 0;

  private tracks: BoardingMusicTrack[] = [];
  private selectedTrackId: string | null = null;
  private enabled = true;
  private currentTrackId: string | null = null;

  /** true mientras un anuncio está en reproducción (música silenciada). */
  private ducking = false;
  private behavior: MusicAnnouncementBehavior = { mode: "fade" };

  private listeners = new Set<(state: MusicState) => void>();

  // ── Configuración ──────────────────────────────────────────────────

  /** Provee las pistas disponibles y la selección del usuario. */
  configure(options: {
    tracks?: BoardingMusicTrack[];
    selectedTrackId?: string | null;
    enabled?: boolean;
  }): void {
    if (options.tracks !== undefined) this.tracks = options.tracks;
    if (options.selectedTrackId !== undefined) this.selectedTrackId = options.selectedTrackId;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    // Si se deshabilitó la música mientras sonaba, detenerla (fade out).
    if (
      !this.enabled &&
      (this.state === "playing" || this.state === "loading" || this.state === "paused")
    ) {
      this.stopMusic();
    }
  }

  /** Define cómo reaccionar ante los anuncios (fade o pausa). */
  setAnnouncementBehavior(behavior: MusicAnnouncementBehavior): void {
    this.behavior = behavior;
  }

  /** Escucha los anuncios de la cola para atenuar/restaurar la música. */
  bindQueue(queue: AnnouncementQueue): () => void {
    const offStarted = queue.on("announcement:started", () => this.handleAnnouncementStarted());
    const offCompleted = queue.on("announcement:completed", () => this.handleAnnouncementCompleted());
    return () => {
      offStarted();
      offCompleted();
    };
  }

  onStateChange(callback: (state: MusicState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // ── Estado ─────────────────────────────────────────────────────────

  getState(): MusicState {
    return this.state;
  }

  getVolume(): number {
    return this.volume;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  private setState(state: MusicState): void {
    this.state = state;
    this.listeners.forEach((cb) => cb(state));
  }

  // ── Reproducción (Scheduler) ───────────────────────────────────────

  /** Inicia la música ambiental (embarque / desembarque). */
  async startMusic(): Promise<void> {
    this.loadToken++;
    const token = this.loadToken;
    this.cancelFade();

    if (!this.enabled || this.tracks.length === 0) {
      this.stopImmediate();
      return;
    }

    const track = this.resolveTrack();
    if (!track) {
      this.stopImmediate();
      return;
    }

    // Misma pista ya sonando o en pausa → restaurar volumen.
    if (
      this.audio &&
      this.currentTrackId === track.id &&
      (this.state === "playing" || this.state === "paused")
    ) {
      if (this.state === "paused" && this.audio.paused) {
        this.audio.play().catch(() => {});
      }
      const target = this.ducking ? MUSIC_DUCK_VOLUME : MUSIC_NORMAL_VOLUME;
      this.fadeTo(target, MUSIC_ANNOUNCEMENT_FADE_MS);
      this.setState("playing");
      return;
    }

    this.cleanupAudio();
    this.setState("loading");

    const url = track.processedUrl ?? track.previewUrl ?? track.cleanUrl;
    if (!url) {
      this.setState("error");
      return;
    }

    try {
      const buffer = await musicCacheService.getMusic(url);
      if (token !== this.loadToken) return;

      const blob = new Blob([buffer], { type: mimeTypeFromUrl(url) });
      const blobUrl = URL.createObjectURL(blob);
      if (token !== this.loadToken) {
        URL.revokeObjectURL(blobUrl);
        return;
      }

      const audio = new Audio(blobUrl);
      audio.loop = true;
      audio.crossOrigin = "anonymous";
      audio.volume = 0;
      audio.addEventListener("error", () => {
        if (token !== this.loadToken) return;
        this.cleanupAudio();
        this.setState("error");
      });

      this.audio = audio;
      this.blobUrl = blobUrl;
      this.currentTrackId = track.id;

      await audio.play();
      if (token !== this.loadToken) return;

      this.setState("playing");
      const target = this.ducking ? MUSIC_DUCK_VOLUME : MUSIC_NORMAL_VOLUME;
      this.fadeTo(target, MUSIC_ANNOUNCEMENT_FADE_MS);
    } catch (err) {
      console.error("[MusicController] Error al reproducir música:", err);
      if (token !== this.loadToken) return;
      this.cleanupAudio();
      this.setState("error");
    }
  }

  /**
   * Detiene la música con fade out (2 s). Se usa al cerrar puertas y al
   * finalizar el desembarque.
   */
  stopMusic(): void {
    this.ducking = false;
    if (!this.audio || this.state === "stopped" || this.state === "idle") {
      this.stopImmediate();
      return;
    }
    this.fadeTo(0, MUSIC_STOP_FADE_MS, () => {
      this.cleanupAudio();
      this.setState("stopped");
    });
  }

  // ── Anuncios (ducking) ─────────────────────────────────────────────

  /** Un anuncio empezó → silenciar la música. */
  handleAnnouncementStarted(): void {
    if (this.state !== "playing" && this.state !== "loading") return;
    this.ducking = true;
    const fadeMs =
      this.behavior.mode === "pause"
        ? (this.behavior.fadeOutMs ?? 300)
        : MUSIC_ANNOUNCEMENT_FADE_MS;
    this.fadeTo(MUSIC_DUCK_VOLUME, fadeMs, () => {
      if (this.behavior.mode === "pause" && this.audio) {
        this.audio.pause();
        this.setState("paused");
      }
    });
  }

  /** El anuncio terminó → restaurar el volumen normal. */
  handleAnnouncementCompleted(): void {
    if (!this.ducking) return;
    this.ducking = false;
    if (this.state === "paused" && this.audio) {
      this.audio.play().catch(() => {});
    }
    if (this.state === "playing" || this.state === "paused") {
      this.setState("playing");
      this.fadeTo(MUSIC_NORMAL_VOLUME, MUSIC_ANNOUNCEMENT_FADE_MS);
    }
  }

  // ── Internos ───────────────────────────────────────────────────────

  private resolveTrack(): BoardingMusicTrack | null {
    if (!this.selectedTrackId) return null;
    if (this.selectedTrackId === RANDOM_MUSIC_ID) {
      if (this.tracks.length === 0) return null;
      const idx = Math.floor(Math.random() * this.tracks.length);
      return this.tracks[idx];
    }
    return this.tracks.find((t) => t.id === this.selectedTrackId) ?? null;
  }

  private setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }

  private cancelFade(): void {
    if (this.fadeHandle !== null) {
      cancelAnimationFrame(this.fadeHandle);
      this.fadeHandle = null;
    }
  }

  private fadeTo(target: number, durationMs: number, onComplete?: () => void): void {
    this.cancelFade();
    const from = this.volume;
    if (durationMs <= 0 || from === target) {
      this.setVolume(target);
      onComplete?.();
      return;
    }
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      this.setVolume(from + (target - from) * t);
      if (t < 1) {
        this.fadeHandle = requestAnimationFrame(step);
      } else {
        this.fadeHandle = null;
        onComplete?.();
      }
    };
    this.fadeHandle = requestAnimationFrame(step);
  }

  private cleanupAudio(): void {
    this.cancelFade();
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.pause();
      audio.loop = false;
      audio.src = "";
      audio.load();
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private stopImmediate(): void {
    this.cancelFade();
    this.cleanupAudio();
    this.currentTrackId = null;
    this.ducking = false;
    this.setState("stopped");
  }
}

/** Instancia única compartida entre el Scheduler y la UI. */
export const musicController = new MusicController();
