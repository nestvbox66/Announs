import { FlightState, AnnouncementInfo } from "../types";
import { NORMAL_SCENARIO_KEY } from "./eventConfigConstants";
import type { EventSwitchValue } from "./eventConfigConstants";
import type { TelemetrySnapshot } from "../types/telemetry";

export type FlightStartInitialState = 'cold_and_dark' | 'gate_engines_on' | 'runway';

export interface FlightStartPreferences {
  initialState: FlightStartInitialState;
  includeBoarding: boolean;
}

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
  /** Hora local del aeropuerto de origen (HH:MM), derivada de sched_out UTC para mostrar en UI. */
  departureTimeLocal?: string;
  /**
   * Hora programada de despegue para delay_detection.
   * Segundos del día UTC (0-86400), normalizado desde SimBrief sched_out (epoch s).
   * Se compara contra telemetry.zuluTime (segundos desde medianoche UTC).
   */
  scheduledTakeoffTime?: number;
  captainPrimaryLang: string;
  captainSecondaryLang: string;
  flightId: string | null;
  specialEvent?: string;
  specialEventEnabled?: boolean;
  /** Tiempo de crucero en segundos (de SimBrief `times.cruise_time`). */
  cruiseTimeSeconds?: number;
  /** Timestamp Zulu (segundos) de entrada en fase CRUISE. */
  cruiseEntryTime?: number;
  /** Calculado al importar SimBrief (origen vs destino). */
  isInternational?: boolean;
  /** Código ICAO del avión (de SimBrief `aircraft.icaocode`). */
  aircraftType?: string;
  /** Si es widebody (desde tabla `aircraft_types` al importar SimBrief). */
  aircraftIsWidebody?: boolean;
  /** Duración estimada del vuelo en minutos (de SimBrief `times`). */
  durationMinutes?: number;
  /** Altitud de crucero en pies (de SimBrief `general.route_altitude`). */
  cruiseAltitude?: number;
}

export interface VoicesInfo {
  captain: string;
  crew: string;
  gateAgent: string;
}

export interface SettingsInfo {
  /** Escenario activo de la configuración (p. ej. `standard_commercial_flight`). */
  scenarioKey?: string;
  eventConfig: Record<string, EventSwitchValue>;
  immersionConfig: Record<string, boolean>;
  /** Overrides de delay por evento (en memoria, solo para el vuelo actual). ms. */
  delayOverrides?: Record<string, number>;
}

export interface FlightStartState {
  preferences: FlightStartPreferences | null;
}

/**
 * TelemetryInfo tipado: contrato canónico (`TelemetrySnapshot`) + extensible
 * con claves adicionales del provider. `Partial` para compatibilidad con el
 * estado vacío inicial y con providers que reportan subconjuntos.
 */
export type TelemetryInfo = Partial<TelemetrySnapshot> & Record<string, unknown>;

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

export interface UserSettingsInfo {
  captain: string;
  crew: string;
  gateAgent: string;
  eventConfig: Record<string, EventSwitchValue>;
  immersionConfig: Record<string, boolean>;
}

export interface ContextInfo {
  fsm: FsmInfo;
  announcement: AnnouncementState;
  isTestMode: boolean;
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
  flightStart: FlightStartState;
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
  gate: "",
  departureTime: "",
  departureTimeLocal: "",
  captainPrimaryLang: "",
  captainSecondaryLang: "",
  flightId: null,
  specialEvent: "",
  specialEventEnabled: false,
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

const DEFAULT_FLIGHT_START: FlightStartState = {
  preferences: null,
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
  flightStart: DEFAULT_FLIGHT_START,
};

// ── Service ───────────────────────────────────────────────────────

export class FlightContext {
  private state: FlightContextState;
  private listeners = new Map<string, Set<() => void>>();
  private testMode = false;

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
            flightStart: { ...DEFAULT_FLIGHT_START, ...initial.flightStart },
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

  /**
   * Escenario activo de la configuración/vuelo. Si no hay uno explícito,
   * devuelve `standard_commercial_flight`.
   */
  getScenarioKey(): string {
    return this.state.settings.scenarioKey || NORMAL_SCENARIO_KEY;
  }

  updateSettings(partial: Partial<SettingsInfo>): void {
    this.state.settings = {
      ...this.state.settings,
      ...partial,
      scenarioKey: partial.scenarioKey ?? this.state.settings.scenarioKey,
      eventConfig: partial.eventConfig ?? this.state.settings.eventConfig,
      immersionConfig: partial.immersionConfig ?? this.state.settings.immersionConfig,
      delayOverrides: partial.delayOverrides ?? this.state.settings.delayOverrides,
    };
    this.emit("settings");
  }

  /** Lee el override de delay (ms) para un evento, si existe. */
  getDelayOverride(eventKey: string): number | undefined {
    return this.state.settings.delayOverrides?.[eventKey];
  }

  /** Setea el override de delay (ms) para un evento (solo en memoria, vuelo actual). */
  setDelayOverride(eventKey: string, delayMs: number): void {
    this.state.settings = {
      ...this.state.settings,
      delayOverrides: {
        ...(this.state.settings.delayOverrides ?? {}),
        [eventKey]: delayMs,
      },
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

  // ── FlightStart ─────────────────────────────────────────────────

  getFlightStart(): FlightStartState {
    return this.state.flightStart;
  }

  getFlightStartPreferences(): FlightStartPreferences | null {
    return this.state.flightStart.preferences;
  }

  updateFlightStart(partial: Partial<FlightStartState>): void {
    this.state.flightStart = { ...this.state.flightStart, ...partial };
    this.emit("flightStart" as ContextSection);
  }

  setFlightStartPreferences(prefs: FlightStartPreferences): void {
    this.state.flightStart = { preferences: prefs };
    this.emit("flightStart" as ContextSection);
  }

  // ── Simbrief ────────────────────────────────────────────────────

  getSimbrief(): SimbriefInfo {
    return this.state.simbrief;
  }

  // Datos crudos del OFP de SimBrief (objeto completo: general, origin,
  // destination, aircraft, weights, times, etc.). Null si no hay datos.
  getSimBriefData(): Record<string, any> | null {
    const data = this.state.simbrief.data;
    if (!data || Object.keys(data).length === 0) return null;
    return data;
  }

  // Datos de configuración del usuario disponibles en el contexto:
  // voces seleccionadas + configuración de eventos/inmersión.
  getUserSettings(): UserSettingsInfo {
    return {
      ...this.state.voices,
      ...this.state.settings,
    };
  }

  // Datos contextuales del vuelo: estado del FSM, estado de anuncios y modo
  // de ejecución (normal / pruebas).
  getContext(): ContextInfo {
    return {
      fsm: this.state.fsm,
      announcement: this.state.announcement,
      isTestMode: this.testMode,
    };
  }

  setTestMode(enabled: boolean): void {
    this.testMode = enabled;
  }

  updateSimbrief(partial: Partial<SimbriefInfo>): void {
    this.state.simbrief = {
      ...this.state.simbrief,
      ...partial,
    };
    this.emit("simbrief");
  }

  // ── Debug helpers (para Monitor de variables) ─────────────────

  /** Snapshot completo del contexto (clonado). Útil para debugging. */
  getState(): FlightContextState {
    return {
      flight: { ...this.state.flight },
      voices: { ...this.state.voices },
      settings: { ...this.state.settings },
      telemetry: { ...this.state.telemetry },
      fsm: { ...this.state.fsm },
      announcement: { ...this.state.announcement },
      simbrief: { ...this.state.simbrief },
      flightStart: { ...this.state.flightStart },
    };
  }

  /** Datos agrupados para el monitor de variables (serializables). */
  getDebugSnapshot(): {
    flight: FlightInfo;
    voices: VoicesInfo;
    settings: SettingsInfo;
    telemetry: TelemetryInfo;
    fsm: FsmInfo;
    announcement: AnnouncementState;
    simbrief: Record<string, unknown> | null;
    context: ContextInfo;
    isTestMode: boolean;
  } {
    return {
      flight: this.getFlight(),
      voices: this.getVoices(),
      settings: this.getSettings(),
      telemetry: this.getTelemetry(),
      fsm: this.getFSM(),
      announcement: this.getAnnouncement(),
      simbrief: this.getSimBriefData(),
      context: this.getContext(),
      isTestMode: this.testMode,
    };
  }

  isTestModeEnabled(): boolean {
    return this.testMode;
  }
}
