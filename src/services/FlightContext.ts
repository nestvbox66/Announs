import { FlightState, AnnouncementInfo } from "../types";

// ── Section interfaces ───────────────────────────────────────────

export interface FlightInfo {
  airline: string;
  flightNumber: string;
  originICAO: string;
  destICAO: string;
  originCity: string;
  destCity: string;
  gate: string;
  departureTime: string;
  captainPrimaryLang: string;
  captainSecondaryLang: string;
  flightId: string | null;
}

export interface VoicesInfo {
  captain: string;
  crew: string;
  gateAgent: string;
}

export interface SettingsInfo {
  eventConfig: Record<string, "off" | "pack" | "IA">;
  immersionConfig: Record<string, boolean>;
}

export interface TelemetryInfo {
  [key: string]: unknown;
}

export interface FsmInfo {
  currentState: FlightState;
}

export interface AnnouncementState {
  currentAnnouncement: AnnouncementInfo | null;
  isGenerating: boolean;
  isAudioPlaying: boolean;
  generatingError: string | null;
  queueLength: number;
}

export interface SimbriefInfo {
  data: Record<string, unknown>;
}

// ── Root state ────────────────────────────────────────────────────

export interface FlightContextState {
  flight: FlightInfo;
  voices: VoicesInfo;
  settings: SettingsInfo;
  telemetry: TelemetryInfo;
  fsm: FsmInfo;
  announcement: AnnouncementState;
  simbrief: SimbriefInfo;
}

type ContextSection = keyof FlightContextState;

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULT_FLIGHT: FlightInfo = {
  airline: "",
  flightNumber: "",
  originICAO: "",
  destICAO: "",
  originCity: "",
  destCity: "",
  gate: "A01",
  departureTime: "",
  captainPrimaryLang: "",
  captainSecondaryLang: "",
  flightId: null,
};

const DEFAULT_VOICES: VoicesInfo = {
  captain: "",
  crew: "",
  gateAgent: "",
};

const DEFAULT_SETTINGS: SettingsInfo = {
  eventConfig: {},
  immersionConfig: {},
};

const DEFAULT_TELEMETRY: TelemetryInfo = {};

const DEFAULT_FSM: FsmInfo = {
  currentState: FlightState.NoIniciado,
};

const DEFAULT_ANNOUNCEMENT: AnnouncementState = {
  currentAnnouncement: null,
  isGenerating: false,
  isAudioPlaying: false,
  generatingError: null,
  queueLength: 0,
};

const DEFAULT_SIMBRIEF: SimbriefInfo = {
  data: {},
};

const DEFAULT_STATE: FlightContextState = {
  flight: DEFAULT_FLIGHT,
  voices: DEFAULT_VOICES,
  settings: DEFAULT_SETTINGS,
  telemetry: DEFAULT_TELEMETRY,
  fsm: DEFAULT_FSM,
  announcement: DEFAULT_ANNOUNCEMENT,
  simbrief: DEFAULT_SIMBRIEF,
};

// ── Service ───────────────────────────────────────────────────────

export class FlightContext {
  private state: FlightContextState;
  private listeners = new Map<string, Set<() => void>>();

  constructor(initial?: Partial<FlightContextState>) {
    this.state = {
      ...DEFAULT_STATE,
      ...(initial
        ? {
            flight: { ...DEFAULT_FLIGHT, ...initial.flight },
            voices: { ...DEFAULT_VOICES, ...initial.voices },
            settings: { ...DEFAULT_SETTINGS, ...initial.settings },
            telemetry: { ...DEFAULT_TELEMETRY, ...initial.telemetry },
            fsm: { ...DEFAULT_FSM, ...initial.fsm },
            announcement: { ...DEFAULT_ANNOUNCEMENT, ...initial.announcement },
            simbrief: { ...DEFAULT_SIMBRIEF, ...initial.simbrief },
          }
        : {}),
    };
  }

  // ── Event system ────────────────────────────────────────────────

  on(section: ContextSection, callback: () => void): () => void {
    const key = `change:${section}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  private emit(section: ContextSection): void {
    const key = `change:${section}`;
    this.listeners.get(key)?.forEach((cb) => cb());
  }

  // ── Flight ──────────────────────────────────────────────────────

  getFlight(): FlightInfo {
    return this.state.flight;
  }

  updateFlight(partial: Partial<FlightInfo>): void {
    this.state.flight = { ...this.state.flight, ...partial };
    this.emit("flight");
  }

  // ── Voices ──────────────────────────────────────────────────────

  getVoices(): VoicesInfo {
    return this.state.voices;
  }

  updateVoices(partial: Partial<VoicesInfo>): void {
    this.state.voices = { ...this.state.voices, ...partial };
    this.emit("voices");
  }

  // ── Settings ────────────────────────────────────────────────────

  getSettings(): SettingsInfo {
    return this.state.settings;
  }

  updateSettings(partial: Partial<SettingsInfo>): void {
    this.state.settings = {
      ...this.state.settings,
      ...partial,
      eventConfig: partial.eventConfig ?? this.state.settings.eventConfig,
      immersionConfig: partial.immersionConfig ?? this.state.settings.immersionConfig,
    };
    this.emit("settings");
  }

  // ── Telemetry ───────────────────────────────────────────────────

  getTelemetry(): TelemetryInfo {
    return this.state.telemetry;
  }

  updateTelemetry(partial: Partial<TelemetryInfo>): void {
    this.state.telemetry = { ...this.state.telemetry, ...partial };
    this.emit("telemetry");
  }

  // ── FSM ─────────────────────────────────────────────────────────

  getFSM(): FsmInfo {
    return this.state.fsm;
  }

  updateFSM(partial: Partial<FsmInfo>): void {
    this.state.fsm = { ...this.state.fsm, ...partial };
    this.emit("fsm");
  }

  // ── Announcement ────────────────────────────────────────────────

  getAnnouncement(): AnnouncementState {
    return this.state.announcement;
  }

  updateAnnouncement(partial: Partial<AnnouncementState>): void {
    this.state.announcement = {
      ...this.state.announcement,
      ...partial,
      currentAnnouncement:
        partial.currentAnnouncement !== undefined
          ? partial.currentAnnouncement
          : this.state.announcement.currentAnnouncement,
    };
    this.emit("announcement");
  }

  // ── Simbrief ────────────────────────────────────────────────────

  getSimbrief(): SimbriefInfo {
    return this.state.simbrief;
  }

  updateSimbrief(partial: Partial<SimbriefInfo>): void {
    this.state.simbrief = {
      ...this.state.simbrief,
      ...partial,
    };
    this.emit("simbrief");
  }
}
