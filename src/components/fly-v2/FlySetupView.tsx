/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Flight Setup (`/fly/setup`) — sandbox V2.
 * Arquitectura: grilla de 12 columnas (márgenes 64px, gutters 24px).
 * Zona izquierda (3 col): Flight Summary + Voice. Zona derecha (9 col):
 * sección de inicio (simulador / opción de inicio / acción) en 3 columnas
 * arriba, y debajo el tabber de doble orden con su workspace de eventos.
 * Fuente de verdad: `docs/ui-spec-fly.md` (Flight Setup, §1–§5).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Wifi } from "lucide-react";
import { C, FONT_BAHN } from "./tokens";
import { FlightEventCard } from "./FlightEventCard";
import type { EventMode } from "./FlightEventCard";
import { ImmersionTab } from "./ImmersionTab";
import { SpecialCabinTab } from "./SpecialCabinTab";
import { supabase } from "../../lib/supabase";
import { getEnabledStockIds } from "../../services/voiceService";
import { SettingGeneralService } from "../../services/SettingGeneralService";
import type { FlightCrewPreferences } from "../../services/SettingGeneralService";
import type { SandboxStartPreferences } from "../flight-v2/sandboxStartPreferences";
import { toUuidOrNull } from "../flight-v2/sandboxStartPreferences";
import { ScenarioConfigService } from "../../services/ScenarioConfigService";
import type {
  ScenarioConfigSnapshot,
  ScenarioEventConfig,
  ScenarioOption,
} from "../../services/ScenarioConfigService";
import { UserEventDefaultsService } from "../../services/UserEventDefaultsService";
import {
  EVENT_CONFIG_DEFAULT_VALUE,
  NORMAL_SCENARIO_KEY,
  SAFETY_VIDEO_EVENT_KEY,
  SAFETY_VIDEO_PACKAGE_STORAGE_KEY,
  isConfigurableEvent,
  isEventSwitchValue,
  toUiSwitchValue,
  type EventSwitchValue,
} from "../../services/eventConfigConstants";
import SafetyVideoPackSelector from "../packages/SafetyVideoPackSelector";
import { safetyVideoPackService } from "../../services/SafetyVideoPackService";
import type { PackageRecord } from "../../services/PackagesService";
import { getAirportName, getAirportTimezone } from "../../utils/airportMapping";
import { resolveOfAirportCity } from "../../utils/ofResolvers";
import {
  createFlightController,
  getEffectiveSimProvider,
  isRealSimProvider,
  setEffectiveSimProvider,
  type SimProvider,
} from "../../services/FlightControllerFactory";
import { resolveSimProvider } from "../../utils/flightSimulator";
import { connectionStatusService } from "../../services/ConnectionStatusService";
import type { FlightController } from "../../services/FlightController";
import { config } from "../../config";
import type { SimBriefData } from "../../types";

/* ------------------------------ Datos ---------------------------------- */

export interface FlySetupSummary {
  callsign: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  aircraft: string;
  passengers: string;
}

const DEFAULT_SUMMARY: FlySetupSummary = {
  callsign: "UNITED AIRLINES 155",
  originCode: "GUM",
  originName: "ANTONIO B. WON PAT INTL",
  destinationCode: "TKK",
  destinationName: "CHUUK INTL",
  aircraft: "BOEING 737 MAX 8",
  passengers: "234 PASSENGERS",
};

const FIRST_ORDER_TABS = [
  "IMMERSION",
  "FLIGHT EVENTS",
  "SPECIAL CABIN EVENTS",
] as const;

type FirstOrderTab = (typeof FIRST_ORDER_TABS)[number];

/** Etiquetas i18n de los selectores de primer orden (`fly.setup.tabs`). */
const FIRST_ORDER_TAB_LABEL_KEYS: Record<FirstOrderTab, string> = {
  IMMERSION: "fly.setup.tabs.immersion",
  "FLIGHT EVENTS": "fly.setup.tabs.flight_events",
  "SPECIAL CABIN EVENTS": "fly.setup.tabs.special_cabin_events",
};

/**
 * Rol del locutor del escenario → clave i18n de la etiqueta (las mismas del
 * original). `null` = sin rol (se muestra "—", neutro en ambos idiomas).
 */
function speakerRoleKey(role: string | null | undefined): string | null {
  if (role === "captain")
    return "current_flight.not_started.events.narrator_captain";
  if (role === "crew") return "current_flight.not_started.events.narrator_crew";
  if (role === "gate") return "current_flight.not_started.events.narrator_gate";
  return null;
}

/** Switch de la config (OFF | PACK | IA) → modo de la tarjeta (OFF | PACKAGE | AI). */
function switchToCardMode(value: EventSwitchValue): EventMode {
  if (value === "PACK") return "PACKAGE";
  if (value === "OFF") return "OFF";
  return "AI";
}

/** Modo de la tarjeta → switch de la config. */
function cardModeToSwitch(mode: EventMode): EventSwitchValue {
  if (mode === "PACKAGE") return "PACK";
  if (mode === "OFF") return "OFF";
  return "IA";
}

function slugifyEventKey(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? "event" : slug;
}

/**
 * Situaciones de inicio del vuelo (réplica del `FlightStartPreferences` del
 * original). Los rótulos se muestran SIEMPRE en inglés (no se traducen); los
 * hints sí están internacionalizados.
 */
const START_SITUATIONS = [
  {
    value: "cold_and_dark",
    label: "Cold & Dark",
    hintKey: "fly.setup.situation_cold_hint",
  },
  {
    value: "gate_engines_on",
    label: "Hot & Powered",
    hintKey: "fly.setup.situation_hot_hint",
  },
  {
    value: "runway",
    label: "Runway Ready",
    hintKey: "fly.setup.situation_runway_hint",
  },
] as const;

type SituationValue = (typeof START_SITUATIONS)[number]["value"];
const DEFAULT_SITUATION: SituationValue = "gate_engines_on";
const START_PREFS_STORAGE_KEY = "flyv2_start_preferences";

const SIM_PROVIDER_OPTIONS: readonly {
  key: SimProvider;
  labelKey: string;
}[] = [
  { key: "msfs", labelKey: "flight.settings.sim_msfs" },
  { key: "xplane", labelKey: "flight.settings.sim_xplane" },
  { key: "mock", labelKey: "flight.settings.sim_mock" },
];

/* -------- Sliders de demora (réplica de la experiencia original) -------- */
// `gate_crew_started`: demora entre anuncios de puerta (segundos).
const GATE_STARTED_DELAY_KEY = "gate_crew_started";
const GATE_STARTED_DELAY_MIN = 15;
const GATE_STARTED_DELAY_MAX = 180;
const GATE_STARTED_DELAY_DEFAULT = 15;
const GATE_STARTED_DELAY_STORAGE_KEY = "flyv2_gate_started_delay_sec";

// Eventos de demora reparametrizables (minutos): el umbral publicado en
// `events.default_delay_ms` es el valor inicial del slider.
const DELAY_SLIDER_EVENT_KEYS: readonly string[] = [
  "preflight_capt_delay_parked",
  "preflight_capt_delay_taxi",
  "preflight_capt_delay_takeoff",
];
const DELAY_SLIDER_MIN_MIN = 5;
const DELAY_SLIDER_MAX_MIN = 60;
const DELAY_SLIDER_DEFAULT_MIN: Record<string, number> = {
  preflight_capt_delay_parked: 10,
  preflight_capt_delay_taxi: 15,
  preflight_capt_delay_takeoff: 15,
};
const DELAY_SLIDER_STORAGE_KEY = "flyv2_delay_minutes";

const clampDelayMinutes = (value: number): number =>
  Math.min(
    DELAY_SLIDER_MAX_MIN,
    Math.max(DELAY_SLIDER_MIN_MIN, Math.round(value)),
  );

const clampGateDelaySec = (value: number): number =>
  Math.min(
    GATE_STARTED_DELAY_MAX,
    Math.max(GATE_STARTED_DELAY_MIN, Math.round(value)),
  );






interface CrewOption {
  id: string;
  name: string;
}

type CrewSelectorKey = "language" | "gate" | "crew" | "captain";

interface VoiceSelectorDef {
  key: CrewSelectorKey;
  /** Clave i18n de la etiqueta (las mismas del original). */
  labelKey: string;
  prefKey: keyof FlightCrewPreferences;
  storageKey: string;
  /** Rol en `voices_stock`; `null` = catálogo de idiomas. */
  role: "gate" | "crew" | "captain" | null;
}

/** Mismo orden y etiquetas que la spec (§2.2): Language + 3 voces. */
const VOICE_SELECTORS: readonly VoiceSelectorDef[] = [
  {
    key: "language",
    labelKey: "current_flight.not_started.crew.language",
    prefKey: "language_id",
    storageKey: "cfg_selected_language_id",
    role: null,
  },
  {
    key: "gate",
    labelKey: "current_flight.not_started.crew.gate_voice",
    prefKey: "gate_agent_voice_id",
    storageKey: "cfg_gate_agent_voice_id",
    role: "gate",
  },
  {
    key: "crew",
    labelKey: "current_flight.not_started.crew.cabin_voice",
    prefKey: "crew_voice_id",
    storageKey: "cfg_selected_crew_voice_id",
    role: "crew",
  },
  {
    key: "captain",
    labelKey: "current_flight.not_started.crew.captain_voice",
    prefKey: "captain_voice_id",
    storageKey: "cfg_selected_captain_voice_id",
    role: "captain",
  },
];

/** Opciones de reserva si el catálogo remoto no está disponible. */
const FALLBACK_LANGUAGES: readonly CrewOption[] = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
];

const FALLBACK_VOICES: Record<string, readonly CrewOption[]> = {
  gate: [
    { id: "gate-aria", name: "Aria (F)" },
    { id: "gate-marcus", name: "Marcus (M)" },
    { id: "gate-sofia", name: "Sofia (F)" },
  ],
  crew: [
    { id: "crew-elena", name: "Elena (F)" },
    { id: "crew-david", name: "David (M)" },
    { id: "crew-priya", name: "Priya (F)" },
  ],
  captain: [
    { id: "captain-james", name: "James (M)" },
    { id: "captain-laura", name: "Laura (F)" },
    { id: "captain-chen", name: "Chen (M)" },
  ],
};

/** Voz del catálogo con sus idiomas etiquetados. */
interface StockVoice {
  id: string;
  name: string;
  role: string;
  languages: string[];
}

/** Voces de reserva sin etiquetar: valen para cualquier idioma (como en el original). */
const FALLBACK_STOCK: readonly StockVoice[] = (
  ["gate", "crew", "captain"] as const
).flatMap((role) =>
  FALLBACK_VOICES[role].map((v) => ({
    id: v.id,
    name: v.name,
    role,
    languages: [] as string[],
  })),
);

// Una voz sin `languages` se considera disponible para cualquier idioma.
const voiceMatchesLanguage = (voice: StockVoice, langId: string): boolean =>
  !voice.languages ||
  voice.languages.length === 0 ||
  voice.languages.includes(langId);

const firstVoiceForRole = (
  voices: readonly StockVoice[],
  role: string,
  langId: string,
): string =>
  voices.find((v) => v.role === role && voiceMatchesLanguage(v, langId))?.id ??
  "";

const isVoiceValidForLanguage = (
  voices: readonly StockVoice[],
  role: string,
  voiceId: string,
  langId: string,
): boolean => {
  if (!voiceId) return false;
  const v = voices.find((item) => item.id === voiceId);
  return !!v && v.role === role && voiceMatchesLanguage(v, langId);
};

/* --------------------------- Subcomponentes ---------------------------- */

function VoiceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly CrewOption[];
  onChange: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const id = `fly-setup-voice-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontFamily: FONT_BAHN,
          fontWeight: 700,
          fontStretch: "semi-condensed",
          fontSize: 13,
          color: C.white,
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <div className="relative w-full">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full"
          style={{
            appearance: "none",
            height: 36,
            background: focused ? C.selectActiveFill : C.selectFill,
            border: `1px solid ${focused ? C.skySoft : C.sky}`,
            borderRadius: 0,
            color: C.white,
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 14,
            paddingLeft: 12,
            paddingRight: 32,
            outline: "none",
            cursor: "pointer",
          }}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {/* Chevron decorativo a la derecha */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 -translate-y-1/2"
          style={{
            right: 12,
            width: 0,
            height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: `6px solid ${C.sky}`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Slider de demora dentro de la caja del evento (nuevo estilo, misma
 * semántica que el original): etiqueta + valor, range y captions de
 * mínimo/máximo. Se atenúa y deshabilita cuando el evento está en OFF.
 */
function EventDelaySlider({
  label,
  valueText,
  minCaption,
  maxCaption,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
  ariaLabel,
  testId,
}: {
  label: string;
  valueText: string;
  minCaption: string;
  maxCaption: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        borderTop: `1px solid ${C.divider}`,
        paddingTop: 8,
        marginTop: 8,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            textTransform: "uppercase",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: C.ice,
            lineHeight: 1.3,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "condensed",
            fontSize: 12,
            color: C.sky,
            whiteSpace: "nowrap",
          }}
        >
          {valueText}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer disabled:cursor-not-allowed"
        style={{ accentColor: C.sky, marginTop: 6 }}
        aria-label={ariaLabel}
      />
      <div className="flex justify-between">
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 10,
            color: C.ice,
            opacity: 0.6,
          }}
        >
          {minCaption}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 10,
            color: C.ice,
            opacity: 0.6,
          }}
        >
          {maxCaption}
        </span>
      </div>
    </div>
  );
}

function FlightSummaryBox({ summary }: { summary: FlySetupSummary }) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="flight-summary"
      aria-label={t("fly.setup.a11y_summary")}
      style={{
        border: `1px solid ${C.sky}`,
        background: C.navyDeep,
        borderRadius: 0,
        padding: 16,
      }}
    >
      {/* Fila superior: FROM · callsign · TO */}
      <div className="flex items-baseline justify-between">
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            fontSize: 11,
            color: C.sky,
          }}
        >
          {t("fly.setup.summary_from")}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            fontSize: 13,
            color: C.white,
          }}
        >
          {summary.callsign}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            fontSize: 11,
            color: C.sky,
          }}
        >
          {t("fly.setup.summary_to")}
        </span>
      </div>

      {/* Telemetría principal: códigos IATA/ICAO.
          Ajuste UX: 36px en lugar de los 40-44px de la spec para que ambos
          códigos no se lean como una sola palabra en la columna de 3. */}
      <div
        className="flex items-baseline justify-between"
        style={{ marginTop: 8 }}
      >
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontSize: 36,
            color: C.white,
            lineHeight: 1,
          }}
        >
          {summary.originCode}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontSize: 36,
            color: C.white,
            lineHeight: 1,
          }}
        >
          {summary.destinationCode}
        </span>
      </div>

      {/* Nombres completos de aeropuertos */}
      <div className="flex items-start justify-between" style={{ marginTop: 4 }}>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 11,
            color: C.ice,
          }}
        >
          {summary.originName}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 11,
            color: C.ice,
            textAlign: "right",
          }}
        >
          {summary.destinationName}
        </span>
      </div>

      {/* Aeronave + pasajeros */}
      <div className="flex items-baseline justify-between" style={{ marginTop: 8 }}>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "condensed",
            fontSize: 11,
            color: C.white,
          }}
        >
          {summary.aircraft}
        </span>
        <span
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 11,
            color: C.ice,
          }}
        >
          {summary.passengers}
        </span>
      </div>
    </section>
  );
}

/* -------------------------------- Vista ---------------------------------- */

/** Unix seconds robusto (número, string numérica o fecha ISO). */
function toUnixSecondsOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.round(value / 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n > 1e12 ? Math.round(n / 1000) : Math.round(n);
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return Math.round(d.getTime() / 1000);
  }
  return null;
}

/** "HH:MM" UTC de un timestamp unix. */
function formatUtcHHMM(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/** "YYYY-MM-DD" (UTC) de un timestamp unix. */
function formatUtcDate(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** "HH:MM" en el huso del aeropuerto (IANA con DST, fallback UTC). */
function formatAirportLocalHHMM(ts: number, icao: string): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: getAirportTimezone(icao),
    });
  } catch {
    return formatUtcHHMM(ts);
  }
}

export interface FlySetupViewProps {
  /** Resumen explícito (solo sandbox/tests): prima sobre los datos reales. */
  summary?: FlySetupSummary;
  /** OFP crudo compartido (App): horarios programados UTC/local. */
  simbriefRawData?: any;
  /** Navegación del sandbox: regreso al Home (`/fly`) desde el breadcrumb. */
  onNavigateHome?: () => void;
  /** Telemetría real del vuelo activo: al traer origen/destino sustituye al mock. */
  simBriefData?: SimBriefData;
  /** Pasajeros del manifiesto activo (si es 0 se usa el pax_count del OFP). */
  manifestCount?: number;
  /** Inicia el vuelo con la situación elegida (réplica de FlightStartPreferences). */
  onStartFlight?: (prefs: SandboxStartPreferences) => void;
}

/**
 * Construye el Flight Summary desde la telemetría real.
 * Devuelve `null` si no hay vuelo activo (origen/destino vacíos).
 */
function buildLiveSummary(
  sim: SimBriefData,
  manifestCount: number | undefined,
  formatPassengers: (count: number) => string,
  dbCities?: { origin?: string | null; dest?: string | null },
): FlySetupSummary | null {
  if (sim.origen.trim() === "" || sim.destino.trim() === "") return null;
  const count =
    manifestCount && manifestCount > 0 ? manifestCount : sim.pasajerosCount;
  return {
    callsign:
      [sim.aerolinea, sim.vueloCodigo]
        .filter((part) => part.trim() !== "")
        .join(" ") || "—",
    originCode: sim.origen.toUpperCase(),
    originName: (dbCities?.origin || getAirportName(sim.origen) || sim.origen).toUpperCase(),
    destinationCode: sim.destino.toUpperCase(),
    destinationName: (
      dbCities?.dest || getAirportName(sim.destino) || sim.destino
    ).toUpperCase(),
    aircraft: (sim.avion || "—").toUpperCase(),
    passengers: formatPassengers(count),
  };
}

export function FlySetupView({
  summary: summaryOverride,
  simBriefData,
  simbriefRawData,
  onNavigateHome,
  manifestCount,
  onStartFlight,
}: FlySetupViewProps) {
  const { t } = useTranslation();

  // ── Inicio de vuelo: situación + simulador + conexión ────────────────
  const [situation, setSituation] = useState<SituationValue>(() => {
    try {
      const raw = localStorage.getItem(START_PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { initialState?: string };
        const found = START_SITUATIONS.find(
          (s) => s.value === parsed.initialState,
        );
        if (found) return found.value;
      }
    } catch {
      // localStorage corrupto o no disponible → default.
    }
    return DEFAULT_SITUATION;
  });
  const [hoveredSituation, setHoveredSituation] =
    useState<SituationValue | null>(null);
  // Preferencia guardada en ajustes (setting_general.simulator + espejo en
  // localStorage): se preselecciona al abrir el setup; el cambio manual
  // posterior del usuario siempre prevalece (manualSimPickRef).
  const manualSimPickRef = useRef(false);
  const [simProvider, setSimProvider] = useState<SimProvider>(() => {
    try {
      const stored =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('cfg_preferred_simulator')
          : null;
      return resolveSimProvider(stored) ?? getEffectiveSimProvider();
    } catch {
      return getEffectiveSimProvider();
    }
  });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTestMode, setIsTestMode] = useState<boolean>(false);
  const [isStartingFlight, setIsStartingFlight] = useState<boolean>(false);
  const flightControllerRef = useRef<FlightController | null>(null);
  // Reintento periódico de conexión (punto 4): si el simulador se enciende
  // después de abrir el setup, el estado se recupera solo cada 10 s.
  const simConnectedRef = useRef(false);
  const simRetryingRef = useRef(false);

  // Crea el controlador del proveedor efectivo, lo publica en
  // ConnectionStatusService y, siembra la conexión (real o mock). Réplica del
  // control de conexión de la vista original, acotada a este setup.
  useEffect(() => {
    let mounted = true;
    const provider = simProvider;
    setEffectiveSimProvider(provider);

    const controller = createFlightController(provider, {
      speedMultiplier: config.mock.speedMultiplier,
      autoTransition: config.mock.autoTransition,
      autoStart: false,
    });
    flightControllerRef.current = controller;
    connectionStatusService.setActiveController(controller);
    connectionStatusService.start();

    const unsub = connectionStatusService.onStatusChange((status) => {
      simConnectedRef.current = status.connected;
      setIsConnected(status.connected);
    });

    (async () => {
      try {
        await controller.connect();
        if (!mounted) return;
        connectionStatusService.setActiveController(controller);
        connectionStatusService.refresh();
      } catch {
        if (!mounted) return;
        // Simulador real apagado: se conserva la selección en desconectado
        // (el banner ofrece modo pruebas). Sin fallback silencioso a Mock.
        try {
          controller.disconnect();
        } catch {
          // ignorar
        }
        connectionStatusService.refresh();
      }
    })();

    return () => {
      mounted = false;
      unsub();
      // Este setup es dueño de su controlador (se crea en el efecto): se
      // desconecta al desmontar para no dejar timers del Mock/real vivos.
      const ctrl = flightControllerRef.current;
      if (ctrl) {
        try {
          ctrl.disconnect();
        } catch {
          // ignorar
        }
      }
    };
  }, []);

  // Reintento periódico de conexión: solo actúa en desconectado y sin
  // intento en curso. Vale para el controlador inicial y para el creado
  // por cambio manual de proveedor (se lee siempre el ref actual).
  useEffect(() => {
    const retryTimer = setInterval(() => {
      const active = flightControllerRef.current;
      if (!active || simConnectedRef.current || simRetryingRef.current) return;
      simRetryingRef.current = true;
      void active
        .connect()
        .then(() => {
          simRetryingRef.current = false;
          connectionStatusService.setActiveController(active);
          connectionStatusService.refresh();
        })
        .catch(() => {
          simRetryingRef.current = false;
          connectionStatusService.refresh();
        });
    }, 10000);
    return () => clearInterval(retryTimer);
  }, []);

  // Cambio manual de simulador. En esta pantalla de setup siempre se permite
  // (desconecta el controlador actual y crea el nuevo); el original lo bloqueaba
  // solo con vuelo activo, que aquí no aplica.
  const handleSimProviderChange = (provider: SimProvider) => {
    manualSimPickRef.current = true;
    const current = flightControllerRef.current;
    try {
      current?.disconnect();
    } catch {
      // ignorar
    }
    setEffectiveSimProvider(provider);
    setSimProvider(provider);
    const next = createFlightController(provider, {
      speedMultiplier: config.mock.speedMultiplier,
      autoTransition: config.mock.autoTransition,
      autoStart: false,
    });
    flightControllerRef.current = next;
    connectionStatusService.setActiveController(next);
    connectionStatusService.refresh();
    void next
      .connect()
      .then(() => {
        connectionStatusService.setActiveController(next);
        connectionStatusService.refresh();
      })
      .catch(() => {
        connectionStatusService.refresh();
      });
  };

  const handleSituationChange = (value: SituationValue) => {
    setSituation(value);
    try {
      localStorage.setItem(
        START_PREFS_STORAGE_KEY,
        JSON.stringify({ initialState: value, includeBoarding: true }),
      );
    } catch {
      // almacenamiento no disponible: queda en memoria
    }
  };

  /**
   * Valor efectivo de un selector = el que la UI muestra (`valueFor`).
   * El estado crudo puede conservar un placeholder del fallback
   * (p. ej. `gate-aria`, no-UUID) que `toUuidOrNull` descarta: enviar el
   * estado crudo dejaba la voz de puerta en `null` y la sesión caía a la
   * voz `crew` para los eventos `gate_*`. En el flujo original el selector
   * y el inicio viven en la misma vista, por lo que el valor enviado es
   * siempre el mostrado.
   */
  const effectiveCrewValue = (key: CrewSelectorKey): string => {
    const def = VOICE_SELECTORS.find((d) => d.key === key);
    return def ? valueFor(def) : crewPrefs[key];
  };

  const handleStart = (mode: "normal" | "test") => {
    if (mode === "normal" && !isConnected && !isTestMode) return;
    if (mode === "test") setIsTestMode(true);
    setIsStartingFlight(true);
    try {
      const prefs: SandboxStartPreferences = {
        initialState: situation,
        includeBoarding: true,
        languageId: toUuidOrNull(effectiveCrewValue("language")),
        captainVoiceId: toUuidOrNull(effectiveCrewValue("captain")),
        crewVoiceId: toUuidOrNull(effectiveCrewValue("crew")),
        gateAgentVoiceId: toUuidOrNull(effectiveCrewValue("gate")),
      };
      try {
        localStorage.setItem(START_PREFS_STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // ignorar
      }
      onStartFlight?.(prefs);
    } finally {
      setIsStartingFlight(false);
    }
  };
  // Telemetría real del vuelo activo (con fallback al mock de la spec).
  const formatPassengers = (count: number): string =>
    t("fly.setup.summary_passengers", { count });
  // Ciudades desde `of_airports` (p. ej. KBNA → Nashville) para el resumen.
  // Con fallback al mapa local y al código dentro de `buildLiveSummary`.
  const [dbCities, setDbCities] = useState<{ origin: string | null; dest: string | null }>({ origin: null, dest: null });
  useEffect(() => {
    const o = (simBriefData?.origen ?? "").trim();
    const d = (simBriefData?.destino ?? "").trim();
    if (!o && !d) {
      setDbCities({ origin: null, dest: null });
      return;
    }
    let cancelled = false;
    (async () => {
      const [origin, dest] = await Promise.all([
        o ? resolveOfAirportCity(o) : Promise.resolve(null),
        d ? resolveOfAirportCity(d) : Promise.resolve(null),
      ]);
      if (!cancelled) setDbCities({ origin, dest });
    })();
    return () => {
      cancelled = true;
    };
  }, [simBriefData?.origen, simBriefData?.destino]);
  // Horarios programados (fecha + UTC + local de salida/llegada).
  // Fuente: OFP crudo (`general.sched_out/sched_in`, fallback a `times`).
  // Horario programado de salida (fecha + UTC y local) + hora sugerida de
  // inicio en el SIM (salida UTC menos 30 minutos).
  const schedOut = useMemo(() => {
    const raw: any = simbriefRawData;
    if (!raw) return null;
    const outTs = toUnixSecondsOrNull(raw?.general?.sched_out ?? raw?.times?.sched_out);
    if (outTs == null) return null;
    const o = (simBriefData?.origen ?? "").trim();
    return {
      date: formatUtcDate(outTs),
      utc: formatUtcHHMM(outTs),
      local: formatAirportLocalHHMM(outTs, o),
      simStartUtc: formatUtcHHMM(outTs - 30 * 60),
    };
  }, [simbriefRawData, simBriefData?.origen]);
  const liveSummary = simBriefData
    ? buildLiveSummary(simBriefData, manifestCount, formatPassengers, dbCities)
    : null;
  const summary = summaryOverride ?? liveSummary ?? {
    ...DEFAULT_SUMMARY,
    passengers: formatPassengers(234),
  };

  const [firstTab, setFirstTab] = useState<FirstOrderTab>("IMMERSION");

  // ── Escenario + fases + eventos (réplica de la experiencia original) ──
  // El desplegable vive en la zona izquierda, debajo de las voces; las fases
  // del snapshot alimentan las pestañas de segundo orden y los eventos de la
  // fase activa alimentan las tarjetas (antes mockeadas).
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<string>(() => {
    try {
      return localStorage.getItem("cfg_selected_scenario") || NORMAL_SCENARIO_KEY;
    } catch {
      return NORMAL_SCENARIO_KEY;
    }
  });
  const [scenarioSnapshot, setScenarioSnapshot] =
    useState<ScenarioConfigSnapshot | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState<boolean>(false);
  const [phase, setPhase] = useState<string>("");
  const [eventConfig, setEventConfig] = useState<
    Record<string, EventSwitchValue>
  >(() => {
    try {
      const raw = localStorage.getItem("cfg_event_config");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, EventSwitchValue> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") {
            normalized[key] = toUiSwitchValue(value);
          }
        }
        if (Object.keys(normalized).length > 0) return normalized;
      }
    } catch {
      // localStorage corrupto o no disponible → defaults.
    }
    return {};
  });
  // Video de seguridad por defecto (modo PACK de `taxi_crew_safety_brief`).
  const [safetyPackage, setSafetyPackage] = useState<PackageRecord | null>(null);
  const [storedSafetyPackageId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // ── Demoras configurables (réplica del original, estado de setup) ──
  const [gateStartedDelaySec, setGateStartedDelaySec] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(GATE_STARTED_DELAY_STORAGE_KEY);
      return raw != null ? clampGateDelaySec(Number(raw)) : GATE_STARTED_DELAY_DEFAULT;
    } catch {
      return GATE_STARTED_DELAY_DEFAULT;
    }
  });
  const [delaySliderMinutes, setDelaySliderMinutes] = useState<
    Record<string, number>
  >(() => {
    try {
      const raw = localStorage.getItem(DELAY_SLIDER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "number" && !Number.isNaN(value)) {
            normalized[key] = clampDelayMinutes(value);
          }
        }
        return normalized;
      }
    } catch {
      // localStorage corrupto o no disponible → sin overrides.
    }
    return {};
  });
  // Umbrales publicados (`events.default_delay_ms`): valor inicial de los
  // sliders de demora cuando el usuario aún no eligió uno.
  const [delayThresholdsMs, setDelayThresholdsMs] = useState<
    Record<string, number>
  >({});

  // Preferencias de Personal de Vuelo del perfil (`setting_general`).
  // Réplica la lógica de la vista original (VueloActualView, Block 1):
  // catálogo de idiomas, voces habilitadas del usuario con tags de idioma,
  // filtrado por rol e idioma, y re-sincronización automática idioma ↔ voces.
  const [userId, setUserId] = useState<string | null>(null);
  const [languageOptions, setLanguageOptions] =
    useState<readonly CrewOption[]>(FALLBACK_LANGUAGES);
  const [availableVoices, setAvailableVoices] =
    useState<readonly StockVoice[]>(FALLBACK_STOCK);
  const [crewPrefs, setCrewPrefs] = useState<Record<CrewSelectorKey, string>>({
    language: FALLBACK_LANGUAGES[0].id,
    gate: FALLBACK_VOICES.gate[0].id,
    crew: FALLBACK_VOICES.crew[0].id,
    captain: FALLBACK_VOICES.captain[0].id,
  });
  // La carga async de preferencias solo pre-selecciona: si llega tarde no
  // debe pisar una elección ya hecha en esta pantalla.
  const userPickedRef = useRef<Record<CrewSelectorKey, boolean>>({
    language: false,
    gate: false,
    crew: false,
    captain: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) setUserId(user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Preferencia de simulador del perfil (`setting_general.simulator`): si el
  // usuario aún no eligió manualmente en esta pantalla, se preselecciona.
  useEffect(() => {
    if (!userId || manualSimPickRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("setting_general")
          .select("simulator")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled || manualSimPickRef.current) return;
        const preferred = resolveSimProvider(
          (data as { simulator?: unknown } | null)?.simulator as string | null,
        );
        if (preferred && preferred !== simProvider) {
          handleSimProviderChange(preferred);
        }
      } catch {
        // Sin perfil: se conserva la selección inicial.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Catálogo de idiomas (`languages`).
      try {
        const { data, error } = await supabase
          .from("languages")
          .select("id, language_name");
        if (!error && Array.isArray(data) && data.length > 0) {
          if (!cancelled) {
            setLanguageOptions(
              (data as { id: string; language_name: string }[]).map((l) => ({
                id: String(l.id),
                name: l.language_name,
              })),
            );
          }
        }
      } catch {
        // Se conserva el fallback estático.
      }
      // Catálogo de voces en dos pasos (`voices` → `voices_stock` +
      // tags de `voice_languages`), igual que la vista original. Solo se
      // sustituye el reserva si llegan voces reales.
      try {
        if (userId) {
          // Solo voces habilitadas por el usuario; sin registros, alta
          // inicial con todas las públicas.
          const stockIds = Array.from(
            new Set(
              (await getEnabledStockIds(userId))
                .map((id) => (id ?? "").trim())
                .filter((id) => id !== ""),
            ),
          );
          if (cancelled) return;
          if (stockIds.length > 0) {
            let stockResult: any = await supabase
              .from("voices_stock")
              .select("id, voice_name, voice_role, languages")
              .in("id", stockIds);
            if (stockResult.error) {
              // Schema sin columna `languages`: reintentar sin ella.
              stockResult = await supabase
                .from("voices_stock")
                .select("id, voice_name, voice_role")
                .in("id", stockIds);
            }
            if (stockResult.error) throw stockResult.error;
            if (cancelled) return;
            let langTags = new Map<string, string[]>();
            try {
              const { data: vl, error: vlErr } = await supabase
                .from("voice_languages")
                .select("voice_id, language_id")
                .in("voice_id", stockIds);
              if (!vlErr && Array.isArray(vl)) {
                for (const row of vl as any[]) {
                  if (!row?.voice_id || !row?.language_id) continue;
                  const list = langTags.get(row.voice_id) ?? [];
                  if (!list.includes(row.language_id))
                    list.push(row.language_id);
                  langTags.set(row.voice_id, list);
                }
              }
            } catch {
              // Tabla opcional: se sigue con los tags de la columna si existen.
            }
            if (cancelled) return;
            const mapped: StockVoice[] = (
              (stockResult.data ?? []) as any[]
            ).map((vs) => {
              const colTags: string[] = Array.isArray(vs.languages)
                ? vs.languages
                : vs.languages
                  ? [vs.languages]
                  : [];
              const joinTags = langTags.get(vs.id) ?? [];
              const merged = [...colTags];
              for (const t of joinTags)
                if (!merged.includes(t)) merged.push(t);
              return {
                id: String(vs.id),
                name: vs.voice_name,
                role: vs.voice_role,
                languages: merged,
              };
            });
            if (!cancelled && mapped.length > 0) setAvailableVoices(mapped);
          }
        }
      } catch {
        // Se conserva la reserva estática.
      }
      // Preferencias del perfil (solo con sesión iniciada y sin pisar
      // elecciones manuales pendientes).
      if (userId) {
        const prefs =
          await SettingGeneralService.loadFlightCrewPreferences(userId);
        if (!cancelled && prefs) {
          const picked = userPickedRef.current;
          setCrewPrefs((prev) => ({
            language:
              !picked.language && prefs.language_id
                ? prefs.language_id
                : prev.language,
            gate:
              !picked.gate && prefs.gate_agent_voice_id
                ? prefs.gate_agent_voice_id
                : prev.gate,
            crew:
              !picked.crew && prefs.crew_voice_id
                ? prefs.crew_voice_id
                : prev.crew,
            captain:
              !picked.captain && prefs.captain_voice_id
                ? prefs.captain_voice_id
                : prev.captain,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Consistencia idioma ↔ voces (réplica de la vista original): toda voz
  // seleccionada no válida para el idioma se reemplaza por la primera válida
  // del rol. Idempotente: sin cambios no toca estado ni persiste (sin loops).
  const voicesLangRef = useRef<Record<CrewSelectorKey, string> | null>(null);
  useEffect(() => {
    const lang = crewPrefs.language;
    const resolve = (
      role: "gate" | "crew" | "captain",
      current: string,
    ): string => {
      if (!current) return current;
      if (isVoiceValidForLanguage(availableVoices, role, current, lang))
        return current;
      return firstVoiceForRole(availableVoices, role, lang);
    };
    const next: Record<CrewSelectorKey, string> = {
      language: lang,
      gate: resolve("gate", crewPrefs.gate),
      crew: resolve("crew", crewPrefs.crew),
      captain: resolve("captain", crewPrefs.captain),
    };
    const prev = voicesLangRef.current;
    voicesLangRef.current = next;
    if (!prev) return;
    const changed =
      next.gate !== prev.gate ||
      next.crew !== prev.crew ||
      next.captain !== prev.captain;
    if (!changed) return;
    setCrewPrefs((prevPrefs) => {
      if (
        prevPrefs.gate === next.gate &&
        prevPrefs.crew === next.crew &&
        prevPrefs.captain === next.captain
      ) {
        return prevPrefs;
      }
      return {
        ...prevPrefs,
        gate: next.gate,
        crew: next.crew,
        captain: next.captain,
      };
    });
    if (userId) {
      const payload: Partial<FlightCrewPreferences> = {};
      if (next.gate !== prev.gate) payload.gate_agent_voice_id = next.gate;
      if (next.crew !== prev.crew) payload.crew_voice_id = next.crew;
      if (next.captain !== prev.captain)
        payload.captain_voice_id = next.captain;
      void SettingGeneralService.saveFlightCrewPreferences(userId, payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewPrefs, availableVoices, userId]);

  // ── Lista de escenarios activos (mismo origen que la experiencia original).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await ScenarioConfigService.listActiveScenarios();
      if (cancelled || !result.success) return;
      const list = result.data ?? [];
      setScenarios(list);
      if (list.length > 0) {
        setSelectedScenarioKey((prev) =>
          list.some((entry) => entry.key === prev) ? prev : list[0].key,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Snapshot del escenario + config efectiva del usuario por escenario ──
  // (catálogo `events.enabled_switch` como base, filas de `user_event_defaults`
  // como override; fallback a localStorage sin sesión). Al cambiar de
  // escenario se resetea la fase activa a la primera fase con eventos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setScenarioLoading(true);
      const snapshotResult = await ScenarioConfigService.loadPublishedSnapshot(
        selectedScenarioKey,
      );
      if (cancelled) return;
      if (snapshotResult.success && snapshotResult.data) {
        setScenarioSnapshot(snapshotResult.data);
        const firstPhase =
          snapshotResult.data.phases.find((p) => p.events.length > 0) ??
          snapshotResult.data.phases[0];
        setPhase((prev) =>
          snapshotResult.data!.phases.some((p) => p.key === prev)
            ? prev
            : (firstPhase?.key ?? ""),
        );
      } else {
        setScenarioSnapshot(null);
        setPhase("");
      }

      if (userId) {
        const configResult =
          await UserEventDefaultsService.loadEffectiveUserConfig(
            userId,
            selectedScenarioKey,
          );
        if (cancelled) return;
        if (configResult.success) {
          const switchMap: Record<string, EventSwitchValue> = {};
          for (const [key, value] of Object.entries(configResult.data ?? {})) {
            if (isEventSwitchValue(value) && isConfigurableEvent(key)) {
              switchMap[key] = value;
            }
          }
          if (Object.keys(switchMap).length > 0) {
            setEventConfig(switchMap);
            try {
              localStorage.setItem(
                "cfg_event_config",
                JSON.stringify(switchMap),
              );
            } catch {
              // almacenamiento no disponible: queda en memoria
            }
          }
        }
      }
      if (!cancelled) setScenarioLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedScenarioKey, userId]);

  // Carga los umbrales por defecto (`events.default_delay_ms`) de los eventos
  // de demora para inicializar sus sliders (igual que el original).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const thresholds = await ScenarioConfigService.loadDelayThresholds([
        ...DELAY_SLIDER_EVENT_KEYS,
      ]);
      if (!cancelled && Object.keys(thresholds).length > 0) {
        setDelayThresholdsMs((prev) => ({ ...prev, ...thresholds }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedScenarioKey]);

  const optionsFor = (def: VoiceSelectorDef): readonly CrewOption[] => {
    if (def.role === null) return languageOptions;
    return availableVoices
      .filter(
        (v) => v.role === def.role && voiceMatchesLanguage(v, crewPrefs.language),
      )
      .map((v) => ({ id: v.id, name: v.name }));
  };

  /** Reconcilia el valor actual con el catálogo vigente. */
  const valueFor = (def: VoiceSelectorDef): string => {
    const options = optionsFor(def);
    const current = crewPrefs[def.key];
    return options.some((o) => o.id === current)
      ? current
      : (options[0]?.id ?? "");
  };

  const handleCrewChange = (def: VoiceSelectorDef, id: string) => {
    userPickedRef.current[def.key] = true;
    setCrewPrefs((prev) => ({ ...prev, [def.key]: id }));
    try {
      localStorage.setItem(def.storageKey, id);
    } catch {
      // Almacenamiento no disponible: se conserva el estado en memoria.
    }
    if (userId) {
      const payload: Partial<FlightCrewPreferences> = {};
      payload[def.prefKey] = id;
      void SettingGeneralService.saveFlightCrewPreferences(userId, payload);
    }
  };

  // Fases del escenario (hasta diez): alimentan las pestañas de segundo orden.
  const scenarioPhases = scenarioSnapshot?.phases ?? [];
  const activePhaseEvents: readonly ScenarioEventConfig[] =
    scenarioSnapshot?.phases.find((entry) => entry.key === phase)?.events ?? [];

  // ── Navegación secuencial Anterior/Siguiente ─────────────────────────
  // Secuencia: Inmersión → (fases de Eventos de Vuelo…) → Eventos especiales.
  const firstScenarioPhase =
    scenarioPhases.find((p) => p.events.length > 0) ?? scenarioPhases[0];
  const phaseIndex = scenarioPhases.findIndex((p) => p.key === phase);
  const canGoNext = firstTab !== "SPECIAL CABIN EVENTS";
  const canGoPrev = firstTab !== "IMMERSION";

  const goNext = () => {
    if (firstTab === "IMMERSION") {
      setFirstTab("FLIGHT EVENTS");
      // Foco inicial en la primera fase (Gate).
      setPhase((prev) =>
        scenarioPhases.some((p) => p.key === prev)
          ? prev
          : (firstScenarioPhase?.key ?? ""),
      );
    } else if (firstTab === "FLIGHT EVENTS") {
      if (
        phaseIndex >= 0 &&
        phaseIndex < scenarioPhases.length - 1
      ) {
        setPhase(scenarioPhases[phaseIndex + 1].key);
      } else {
        setFirstTab("SPECIAL CABIN EVENTS");
      }
    }
  };

  const goPrev = () => {
    if (firstTab === "SPECIAL CABIN EVENTS") {
      setFirstTab("FLIGHT EVENTS");
      const last = scenarioPhases[scenarioPhases.length - 1];
      if (last) setPhase(last.key);
    } else if (firstTab === "FLIGHT EVENTS") {
      if (phaseIndex > 0) {
        setPhase(scenarioPhases[phaseIndex - 1].key);
      } else {
        setFirstTab("IMMERSION");
      }
    }
  };

  const handleScenarioChange = (key: string) => {
    setSelectedScenarioKey(key);
    try {
      localStorage.setItem("cfg_selected_scenario", key);
    } catch {
      // almacenamiento no disponible: queda en memoria
    }
  };

  // Cambio de modo OFF | PACKAGE | AI con la misma semántica que el original:
  // estado local + localStorage + defaults por escenario del usuario.
  const handleScenarioEventModeChange = (eventKey: string, mode: EventMode) => {
    const next = cardModeToSwitch(mode);
    setEventConfig((prev) => {
      const updated = { ...prev, [eventKey]: next };
      try {
        localStorage.setItem("cfg_event_config", JSON.stringify(updated));
      } catch {
        // almacenamiento no disponible: queda en memoria
      }
      return updated;
    });
    if (userId) {
      void UserEventDefaultsService.saveForUser(
        userId,
        { [eventKey]: next },
        { scenarioKey: selectedScenarioKey },
      );
    }
  };

  const handleGateStartedDelayChange = (value: number) => {
    const clamped = clampGateDelaySec(value);
    setGateStartedDelaySec(clamped);
    try {
      localStorage.setItem(GATE_STARTED_DELAY_STORAGE_KEY, String(clamped));
    } catch {
      // almacenamiento no disponible: queda en memoria
    }
  };

  const handleDelaySliderChange = (eventKey: string, value: number) => {
    const clamped = clampDelayMinutes(value);
    setDelaySliderMinutes((prev) => {
      const updated = { ...prev, [eventKey]: clamped };
      try {
        localStorage.setItem(DELAY_SLIDER_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // almacenamiento no disponible: queda en memoria
      }
      return updated;
    });
  };

  /** Minutos efectivos del slider: elección del usuario → umbral publicado
      en DB → default por evento (igual que el original). */
  const getDelaySliderMinutes = (eventKey: string): number => {
    if (delaySliderMinutes[eventKey] !== undefined) {
      return delaySliderMinutes[eventKey];
    }
    const thresholdMs = delayThresholdsMs[eventKey];
    if (typeof thresholdMs === "number" && thresholdMs > 0) {
      return clampDelayMinutes(Math.round(thresholdMs / 60000));
    }
    return DELAY_SLIDER_DEFAULT_MIN[eventKey] ?? DELAY_SLIDER_MIN_MIN;
  };

  const handleSafetyPackageChange = (pkg: PackageRecord | null) => {
    setSafetyPackage(pkg);
    if (pkg) {
      try {
        localStorage.setItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY, pkg.id);
      } catch {
        // almacenamiento no disponible: la selección sigue en memoria
      }
      safetyVideoPackService.setActivePackage(pkg);
    } else {
      try {
        localStorage.removeItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY);
      } catch {
        // ignorar
      }
    }
  };

  // Datos para la pestaña Immersion (manifiesto + aerolínea del vuelo).
  const immersionPax =
    manifestCount && manifestCount > 0
      ? manifestCount
      : (simBriefData?.pasajerosCount ?? 0);
  const immersionAirline =
    simBriefData?.aerolinea.trim() !== "" && simBriefData?.aerolinea
      ? simBriefData.aerolinea.toUpperCase().trim()
      : null;

  // Estilos unificados de los selectores de la sección de inicio
  // (simulador + opción de inicio): mismo alto, tipografía y ancho.
  const selectorRowStyle: CSSProperties = {
    width: "100%",
    height: 36,
    border: `1px solid ${C.divider}`,
    borderRadius: 0,
    overflow: "hidden",
  };
  const selectorButtonStyle = (
    active: boolean,
    first: boolean,
  ): CSSProperties => ({
    flex: 1,
    fontFamily: FONT_BAHN,
    fontWeight: 400,
    fontStretch: "condensed",
    textTransform: "uppercase",
    fontSize: 13,
    letterSpacing: "0.06em",
    lineHeight: 1,
    color: active ? C.white : C.ice,
    background: active ? C.selectActiveFill : "transparent",
    boxShadow: active ? `inset 0 0 0 1px ${C.skySoft}` : undefined,
    borderLeft: first ? undefined : `1px solid ${C.divider}`,
    borderRadius: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });
  const selectorLabelStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    fontFamily: FONT_BAHN,
    fontWeight: 700,
    fontStretch: "semi-condensed",
    textTransform: "uppercase",
    fontSize: 13,
    letterSpacing: "0.08em",
    color: C.white,
  };

  return (
    <main
      data-testid="fly-setup"
      className="mx-auto w-full"
      style={{
        paddingLeft: 64,
        paddingRight: 64,
        paddingTop: 40,
        paddingBottom: 64,
      }}
    >
      <style>{`.flyv2-noscroll::-webkit-scrollbar{display:none}`}</style>

      <div className="grid grid-cols-12" style={{ gap: 24 }}>
        {/* Breadcrumb FLY > (estilo Campaign/Lookup): una sola línea. */}
        <div className="col-span-12">
          <h1
            data-testid="fly-setup-breadcrumb"
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              textTransform: "uppercase",
              fontSize: 30,
              letterSpacing: "0.04em",
              lineHeight: 1.1,
              margin: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={`FLY / ${t("fly.setup.title")}`}
          >
            {onNavigateHome ? (
              <button
                type="button"
                onClick={onNavigateHome}
                aria-label={t("fly.setup.back_home")}
                className="cursor-pointer hover:underline"
                style={{
                  background: "transparent",
                  border: 0,
                  borderRadius: 0,
                  padding: 0,
                  fontFamily: FONT_BAHN,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  fontSize: 30,
                  letterSpacing: "0.04em",
                  lineHeight: 1.1,
                  color: C.sky,
                }}
              >
                {"FLY >"}
              </button>
            ) : (
              <span style={{ color: C.sky }}>{"FLY >"}</span>
            )}{" "}
            <span style={{ color: C.white }}>{t("fly.setup.title")}</span>
          </h1>
        </div>

        {/* Zona izquierda (3 columnas) */}
        <div className="col-span-3">
          <FlightSummaryBox summary={summary} />

          {/* Salida programada (SimBrief): fecha + UTC y local + tip SIM. */}
          {schedOut && (
            <section
              aria-label={t("fly.setup.sched_departure")}
              style={{
                border: `1px solid ${C.sky}`,
                background: C.navyDeep,
                borderRadius: 0,
                padding: 16,
                marginTop: 16,
              }}
            >
              <div className="flex flex-col" style={{ gap: 8 }}>
                <div className="font-mono" style={{ fontSize: 11, color: C.ice, lineHeight: 1.5 }}>
                  <span style={{ color: C.sky, fontWeight: 700 }}>{t("fly.setup.sched_departure")}: </span>
                  {schedOut.date} · UTC {schedOut.utc} · {t("fly.setup.sched_local")} {schedOut.local}
                </div>
                <div className="font-mono" style={{ fontSize: 11, color: C.ice, lineHeight: 1.5, opacity: 0.85 }}>
                  {t("fly.setup.sched_tip", { time: schedOut.simStartUtc })}
                </div>
              </div>
            </section>
          )}

          <h2
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              fontStretch: "semi-condensed",
              textTransform: "uppercase",
              fontSize: 18,
              color: C.white,
              letterSpacing: "0.1em",
              marginTop: 24,
              marginBottom: 0,
            }}
          >
            {t("current_flight.not_started.crew.title")}
          </h2>
          <div
            className="flex flex-col"
            style={{ gap: 16, marginTop: 12 }}
          >
            {VOICE_SELECTORS.map((def) => (
              <VoiceSelect
                key={def.key}
                label={t(def.labelKey)}
                value={valueFor(def)}
                options={optionsFor(def)}
                onChange={(id) => handleCrewChange(def, id)}
              />
            ))}
          </div>

          {/* Escenario: mismo concepto que el desplegable general de la
              configuración de eventos del original, con el estilo nuevo de
              esta vista y debajo de la selección de voces. */}
          <h2
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              fontStretch: "semi-condensed",
              textTransform: "uppercase",
              fontSize: 18,
              color: C.white,
              letterSpacing: "0.1em",
              marginTop: 24,
              marginBottom: 0,
            }}
          >
            {t("fly.setup.scenario_title")}
          </h2>
          <div className="flex flex-col" style={{ gap: 16, marginTop: 12 }}>
            <VoiceSelect
              label={t("fly.setup.scenario_label")}
              value={
                scenarios.some((s) => s.key === selectedScenarioKey)
                  ? selectedScenarioKey
                  : (scenarios[0]?.key ?? selectedScenarioKey)
              }
              options={
                scenarios.length > 0
                  ? scenarios.map((s) => ({ id: s.key, name: s.name }))
                  : [{ id: selectedScenarioKey, name: selectedScenarioKey }]
              }
              onChange={handleScenarioChange}
            />
            {scenarioLoading && (
              <span
                role="status"
                style={{
                  fontFamily: FONT_BAHN,
                  fontWeight: 400,
                  fontStretch: "condensed",
                  fontSize: 13,
                  color: C.sky,
                }}
              >
                {t("fly.setup.scenario_loading")}
              </span>
            )}
          </div>
        </div>

        {/* Zona derecha (9 columnas) */}
        <div className="col-span-9">
          {/* Sección de inicio del vuelo (zona superior): simulador,
              opción de inicio y acción de inicio, en 3 columnas. */}
          <div
            data-testid="start-flight-box"
            style={{
              border: `1px solid ${C.sky}`,
              background: C.navyDeep,
              borderRadius: 0,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {/* Aviso de conexión (solo real sin conexión y sin modo pruebas) */}
            {!isConnected && !isTestMode && simProvider !== "mock" && (
              <div
                className="flex flex-wrap items-center justify-between"
                style={{
                  gap: 12,
                  border: `1px solid ${C.orange}`,
                  background: C.orangeDark,
                  padding: "8px 12px",
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 13,
                    color: C.white,
                  }}
                >
                  ⚠️ {t("connection.banner")}
                </span>
                <button
                  type="button"
                  onClick={() => setIsTestMode(true)}
                  className="cursor-pointer hover:brightness-110"
                  style={{
                    background: C.orange,
                    color: C.greenInk,
                    border: 0,
                    borderRadius: 0,
                    fontFamily: FONT_BAHN,
                    fontWeight: 700,
                    fontStretch: "semi-condensed",
                    textTransform: "uppercase",
                    fontSize: 12,
                    letterSpacing: "0.06em",
                    padding: "6px 12px",
                  }}
                >
                  {t("connection.banner_cta")}
                </button>
              </div>
            )}

            <div
              className="grid grid-cols-3"
              style={{ gap: 24, alignItems: "start" }}
            >
              {/* Columna 1 — selección del simulador */}
              <div className="flex flex-col">
                <span style={selectorLabelStyle}>
                  <Wifi style={{ width: 16, height: 16, color: C.sky }} />
                  {t("flight.settings.sim_title")}
                </span>
                <div
                  role="group"
                  aria-label={t("flight.settings.sim_title")}
                  className="flex w-full"
                  style={selectorRowStyle}
                >
                  {SIM_PROVIDER_OPTIONS.map((opt, index) => {
                    const selected = simProvider === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          if (!selected) handleSimProviderChange(opt.key);
                        }}
                        style={selectorButtonStyle(selected, index === 0)}
                      >
                        {t(opt.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Columna 2 — opción de inicio (situación inicial) */}
              <div className="flex flex-col">
                <span style={selectorLabelStyle}>
                  {t("fly.setup.situation_label")}
                </span>
                <div
                  role="group"
                  aria-label={t("fly.setup.situation_label")}
                  className="flex w-full"
                  style={selectorRowStyle}
                >
                  {START_SITUATIONS.map((opt, index) => {
                    const active = opt.value === situation;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleSituationChange(opt.value)}
                        onMouseEnter={() => setHoveredSituation(opt.value)}
                        onMouseLeave={() => setHoveredSituation(null)}
                        onFocus={() => setHoveredSituation(opt.value)}
                        onBlur={() => setHoveredSituation(null)}
                        style={selectorButtonStyle(active, index === 0)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {/* Hint de la opción en hover (o de la seleccionada) */}
                <p
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 12,
                    color: C.ice,
                    lineHeight: 1.4,
                  }}
                >
                  {t(
                    START_SITUATIONS.find(
                      (s) => s.value === (hoveredSituation ?? situation),
                    )?.hintKey ?? "",
                  )}
                </p>
              </div>

              {/* Columna 3 — acción de inicio */}
              <div className="flex flex-col items-stretch" style={{ gap: 6 }}>
                <button
                  type="button"
                  data-testid="start-flight-cta"
                  onClick={() => handleStart("normal")}
                  disabled={isStartingFlight || (!isConnected && !isTestMode)}
                  title={
                    !isConnected && !isTestMode
                      ? t("volar.connection_required")
                      : undefined
                  }
                  className="inline-flex cursor-pointer items-center justify-center hover:brightness-110 disabled:cursor-not-allowed"
                  style={{
                    height: 44,
                    gap: 8,
                    background:
                      !isConnected && !isTestMode ? C.greenDark : C.green,
                    color:
                      !isConnected && !isTestMode
                        ? C.greenDisabledInk
                        : C.greenInk,
                    border: 0,
                    borderRadius: 0,
                    fontFamily: FONT_BAHN,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    fontSize: 16,
                    letterSpacing: "0.06em",
                  }}
                >
                  {isStartingFlight ? (
                    <Loader2
                      className="animate-spin"
                      style={{ width: 16, height: 16 }}
                    />
                  ) : (
                    <Play
                      style={{ width: 16, height: 16 }}
                      strokeWidth={3}
                    />
                  )}
                  {isStartingFlight
                    ? t("current_flight.not_started.starting_flight_btn")
                    : t("flight.settings.start_flight_btn")}
                </button>
                <button
                  type="button"
                  data-testid="start-tests-link"
                  onClick={() => handleStart("test")}
                  disabled={isStartingFlight}
                  className="cursor-pointer text-center hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 12,
                    color: C.ice,
                    opacity: 0.7,
                    textDecoration: "underline",
                    textUnderlineOffset: 2,
                  }}
                >
                  {t("flight.settings.start_test_btn")}
                </button>
              </div>
              <p
                className="font-mono"
                style={{ fontSize: 11, color: C.ice, lineHeight: 1.5, marginTop: 12, marginBottom: 0 }}
              >
                {t("fly.setup.start_hint")}
              </p>
            </div>
          </div>

          {/* Sección de configuraciones actuales, debajo de la sección de
              inicio. Contorno celeste que agrupa desde las pestañas superiores
              de selección (con la navegación secuencial << / >>) hasta los
              cuadros de selección de cada parámetro. */}
          <div
            style={{
              marginTop: 24,
              border: `1px solid ${C.sky}`,
              padding: 16,
            }}
          >
            <div className="flex w-full" style={{ gap: 8 }}>
            <button
              type="button"
              data-testid="setup-nav-prev"
              onClick={goPrev}
              disabled={!canGoPrev}
              aria-label={t("fly.setup.nav_prev")}
              className="inline-flex cursor-pointer items-center justify-center hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                flex: "0 0 auto",
                width: 40,
                height: 44,
                background: C.tabInactive,
                color: C.ice,
                border: 0,
                borderRadius: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                textTransform: "uppercase",
                fontSize: 15,
                letterSpacing: "0.06em",
              }}
            >
              {"<<"}
            </button>

            {/* Pestañas de primer orden */}
            <div
              data-testid="first-order-tabs"
              role="tablist"
              aria-label={t("fly.setup.a11y_config_mode")}
              className="flex"
              style={{ flex: "1 1 0", minWidth: 0, gap: 8 }}
            >
              {FIRST_ORDER_TABS.map((tab) => {
                const isActive = tab === firstTab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setFirstTab(tab)}
                    className="cursor-pointer"
                    style={{
                      flex: "1 1 0",
                      minWidth: 0,
                      height: 44,
                      background: isActive ? C.tabActive : C.tabInactive,
                      color: isActive ? C.white : C.ice,
                      border: 0,
                      borderRadius: 0,
                      fontFamily: FONT_BAHN,
                      fontWeight: 700,
                      fontStretch: "semi-condensed",
                      textTransform: "uppercase",
                      fontSize: 15,
                      letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {t(FIRST_ORDER_TAB_LABEL_KEYS[tab])}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              data-testid="setup-nav-next"
              onClick={goNext}
              disabled={!canGoNext}
              aria-label={t("fly.setup.nav_next")}
              className="inline-flex cursor-pointer items-center justify-center hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                flex: "0 0 auto",
                width: 40,
                height: 44,
                background: C.tabInactive,
                color: C.ice,
                border: 0,
                borderRadius: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                textTransform: "uppercase",
                fontSize: 15,
                letterSpacing: "0.06em",
              }}
            >
              {">>"}
            </button>
          </div>

          {/* Pestañas de segundo orden (solo FLIGHT EVENTS): fases del escenario.
              Hasta diez fases: tipografía y ancho compactos cuando hay muchas,
              con scroll horizontal sin barra (ver spec §3.2). */}
          {firstTab === "FLIGHT EVENTS" && (
            <div
              data-testid="phase-tabs"
              role="tablist"
              aria-label={t("fly.setup.a11y_phases")}
              className="flyv2-noscroll flex w-full"
              style={{
                gap: scenarioPhases.length > 6 ? 6 : 8,
                marginTop: 8,
                overflowX: "auto",
                scrollbarWidth: "none",
              }}
            >
              {scenarioPhases.map((item) => {
                const isActive = item.key === phase;
                const compact = scenarioPhases.length > 6;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={`${item.name} (${item.events.length})`}
                    onClick={() => setPhase(item.key)}
                    className="cursor-pointer"
                    style={{
                      flex: "1 0 auto",
                      minWidth: compact ? 84 : 96,
                      maxWidth: compact ? 160 : undefined,
                      height: 34,
                      background: isActive ? C.tabActive : C.navy,
                      color: isActive ? C.white : C.ice,
                      border: 0,
                      borderRadius: 0,
                      fontFamily: FONT_BAHN,
                      fontWeight: 700,
                      fontStretch: "semi-condensed",
                      textTransform: "uppercase",
                      fontSize: compact ? 11 : 13,
                      letterSpacing: "0.06em",
                      paddingLeft: compact ? 10 : 14,
                      paddingRight: compact ? 10 : 14,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.name} ({item.events.length})
                  </button>
                );
              })}
            </div>
          )}

          {/* Contenedor principal del workspace */}
          <section
            data-testid="tab-workspace"
            aria-label={`${firstTab}${firstTab === "FLIGHT EVENTS" ? ` — ${phase}` : ""}`}
            style={{
              border: `1px solid ${C.sky}`,
              background: C.navyDeep,
              borderRadius: 0,
              padding: 24,
              marginTop: 12,
            }}
          >
            <div
              data-testid="event-grid"
              className="grid"
              style={{
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
            >
              {firstTab === "IMMERSION" ? (
                <ImmersionTab
                  passengerCount={immersionPax}
                  airlineIcao={immersionAirline}
                />
              ) : firstTab === "SPECIAL CABIN EVENTS" ? (
                <SpecialCabinTab simBriefData={simBriefData} />
              ) : scenarioLoading && !scenarioSnapshot ? (
                <p
                  role="status"
                  className="col-span-3"
                  style={{
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 13,
                    color: C.sky,
                    margin: 0,
                  }}
                >
                  {t("fly.setup.scenario_loading")}
                </p>
              ) : scenarioPhases.length === 0 ? (
                <p
                  className="col-span-3"
                  style={{
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 13,
                    color: C.ice,
                    margin: 0,
                  }}
                >
                  {t("fly.setup.scenario_no_events")}
                </p>
              ) : activePhaseEvents.length === 0 ? (
                <p
                  className="col-span-3"
                  style={{
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 13,
                    color: C.ice,
                    margin: 0,
                  }}
                >
                  {t("fly.setup.scenario_no_events")}
                </p>
              ) : (
                activePhaseEvents.map((item) => {
                  const switchValue: EventSwitchValue =
                    eventConfig[item.eventKey] ?? EVENT_CONFIG_DEFAULT_VALUE;
                  const cardMode = switchToCardMode(switchValue);
                  const voiceKey = speakerRoleKey(item.speakerRole);
                  const isEventEnabled = switchValue !== "OFF";
                  const isGateDelayEvent =
                    item.eventKey === GATE_STARTED_DELAY_KEY;
                  const isDelaySliderEvent = DELAY_SLIDER_EVENT_KEYS.includes(
                    item.eventKey,
                  );
                  const delayMinutes = isDelaySliderEvent
                    ? getDelaySliderMinutes(item.eventKey)
                    : DELAY_SLIDER_MIN_MIN;
                  return (
                    <FlightEventCard
                      key={item.eventKey}
                      title={item.displayName || item.eventKey}
                      description={
                        item.description ?? t("fly.setup.event_no_description")
                      }
                      voiceRole={voiceKey ? t(voiceKey) : "—"}
                      mode={cardMode}
                      onModeChange={(next) =>
                        handleScenarioEventModeChange(item.eventKey, next)
                      }
                      testId={`event-card-${slugifyEventKey(item.eventKey)}`}
                    >
                      {/* Slider de demora entre anuncios de puerta (solo
                          `gate_crew_started`), igual que el original. */}
                      {isGateDelayEvent && (
                        <EventDelaySlider
                          label={t("fly.setup.gate_delay_label")}
                          valueText={t("fly.setup.gate_delay_value", {
                            count: gateStartedDelaySec,
                          })}
                          minCaption={t("fly.setup.gate_delay_min", {
                            count: GATE_STARTED_DELAY_MIN,
                          })}
                          maxCaption={t("fly.setup.gate_delay_max", {
                            count: GATE_STARTED_DELAY_MAX,
                          })}
                          min={GATE_STARTED_DELAY_MIN}
                          max={GATE_STARTED_DELAY_MAX}
                          step={1}
                          value={gateStartedDelaySec}
                          disabled={!isEventEnabled}
                          onChange={handleGateStartedDelayChange}
                          ariaLabel={t("fly.setup.gate_delay_label")}
                          testId={`event-delay-${slugifyEventKey(item.eventKey)}`}
                        />
                      )}
                      {/* Slider de demora detectada (minutos) para los eventos
                          de demora, igual que el original. */}
                      {isDelaySliderEvent && (
                        <EventDelaySlider
                          label={t("fly.setup.delay_detected_label")}
                          valueText={t("fly.setup.delay_detected_value", {
                            count: delayMinutes,
                          })}
                          minCaption={t("fly.setup.delay_min_label", {
                            count: DELAY_SLIDER_MIN_MIN,
                          })}
                          maxCaption={t("fly.setup.delay_max_label", {
                            count: DELAY_SLIDER_MAX_MIN,
                          })}
                          min={DELAY_SLIDER_MIN_MIN}
                          max={DELAY_SLIDER_MAX_MIN}
                          step={1}
                          value={delayMinutes}
                          disabled={!isEventEnabled}
                          onChange={(value) =>
                            handleDelaySliderChange(item.eventKey, value)
                          }
                          ariaLabel={t("fly.setup.delay_detected_label")}
                          testId={`event-delay-${slugifyEventKey(item.eventKey)}`}
                        />
                      )}
                      {/* Selector del video de seguridad (modo PACKAGE),
                          DENTRO de la caja del evento igual que en la
                          experiencia original; solo para
                          `taxi_crew_safety_brief`. */}
                      {item.eventKey === SAFETY_VIDEO_EVENT_KEY &&
                        switchValue === "PACK" && (
                          <div style={{ marginTop: 8 }}>
                            <SafetyVideoPackSelector
                              airlineIcao={null}
                              value={safetyPackage?.id ?? storedSafetyPackageId}
                              onChange={handleSafetyPackageChange}
                              idPrefix="fly-v2-safety-pack"
                            />
                          </div>
                        )}
                    </FlightEventCard>
                  );
                })
              )}
            </div>
          </section>
          </div>
        </div>
      </div>
    </main>
  );
}
