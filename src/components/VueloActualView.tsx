/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { generateManifest, getRegionFromICAO } from "../engine/PassengerManifest";
import { getAirportName, parseMETAR, getAirportTimezone, formatLocalHHMM } from "../utils/airportMapping";
import { getAirlineName } from "../utils/airlineMapping";
import { getAirportByIcao, getAirportUtcOffsetHours, type CachedAirport } from "../services/airportService";
import { useToast } from "./Toast";
import { 
  Plane, 
  Download, 
  Play, 
  Volume2, 
  Wifi, 
  Compass, 
  Radio, 
  ArrowRight, 
  Smile, 
  Frown, 
  AlertTriangle, 
  VolumeX, 
  Coffee, 
  Wind, 
  Sparkles,
  Users,
  Utensils,
  Maximize2,
  CalendarCheck,
  Info,
  ShieldAlert,
  ArrowLeft,
  RotateCcw,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  DoorClosed,
  Globe,
  Activity,
  Trophy
} from "lucide-react";
import { FlightState, Pasajero, SimBriefData, ConfigVoces, ConfigAudio, UltimoAnuncio, AnnouncementInfo } from "../types";
import { FlightPhase } from "../engine/FlightEngine";
import { AnnouncementQueue } from "../services/AnnouncementQueue";
import { FlightContext, FlightInfo } from "../services/FlightContext";
import { SimulationController } from "../services/SimulationController";
import { Scheduler } from "../services/Scheduler";
import { MockFlightController } from "../services/MockFlightController";
import { MsfsFlightController } from "../services/MsfsFlightController";
import { FlightPhaseDetector } from "../services/FlightPhaseDetector";
import type { FlightController } from "../services/FlightController";
import { config } from "../config";
import { ScenarioResolver } from "../services/ScenarioResolver";
import { ScenarioLoader } from "../services/ScenarioLoader";
import { FlightFSM } from "../services/FlightFSM";
import { RuleEngine } from "../services/RuleEngine";
import { Clock } from "../services/Clock";
import { TimerManager } from "../services/TimerManager";
import { AnnouncementPlayer } from "../services/AnnouncementPlayer";
import { AnnouncementEventHandler } from "../dispatcher/handlers/AnnouncementEventHandler";
import { DefaultEventDispatcher } from "../dispatcher/DefaultEventDispatcher";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { EventCatalogService } from "../events/EventCatalogService";
import { UserEventDefaultsService } from "../services/UserEventDefaultsService";
import { FlightEventConfigService } from "../services/FlightEventConfigService";
import { ScenarioConfigService } from "../services/ScenarioConfigService";
import { FlightPathRecorder } from "../services/FlightPathRecorder";
import { XpBonusTracker } from "../services/XpBonusTracker";
import { PassengerEngine } from "../passengers/PassengerEngine";
import {
  TURBULENCE_DAMAGE,
  TURBULENCE_FLASH_TEXT,
  TURBULENCE_MITIGATED_FLASH_TEXT,
  TurbulenceDetector,
  type TurbulenceLevel,
} from "../passengers/turbulence";
import type { AttributeState, FlightPassengerSummary } from "../passengers/types";
import { getEventEffects } from "../passengers/effectsMap";
import {
  resolveHardAirportBonus,
  resolveWeatherSeverityBonus,
  resolvePassengerBonus,
  toPassengerAttributesSummary,
} from "../services/FlightCompletionBonuses";
import {
  explainXpBreakdown,
  toColumnBonusItems,
  type CompletionRpcBonuses,
  type XpCompletionSummary,
} from "../services/XpBonusExplanations";
import { FlightPathService } from "../services/FlightPathService";
import {
  findCampaignFlightMatch,
  formatMultiplier,
  loadActiveCampaigns,
  type CampaignMatch,
} from "../services/CampaignService";
import { BoardingMusicService, BoardingMusicTrack } from "../services/BoardingMusicService";
import { musicController, RANDOM_MUSIC_ID } from "../services/MusicController";
import { fileLogger } from "../services/FileLogger";
import { secondsToHHMM } from "../utils/timeUtils";
import { isInternationalFlight, getCountryKey, resolveCruiseTimeSeconds, resolveTotalDistanceNm } from "../utils/flightUtils";
import {
  BOARDING_PACE_DEFAULT_PPM,
  BOARDING_PACE_MAX_PPM,
  BOARDING_PACE_MIN_PPM,
  BOARDING_PACE_STORAGE_KEY,
  boardingPaxPerTick,
  clampBoardingPace,
  estimateBoardingSeconds,
  formatEtaMinSec,
} from "../utils/flightUtils";
import { getAircraftType } from "../services/aircraftService";
import MusicPreview from "./music/MusicPreview";
import PassengerStatusPanel from "./flight/PassengerStatusPanel";
import IfeScreen from "./ife/IfeScreen";
import ManifestAccordion from "./ife/ManifestAccordion";
import SafetyVideoPackSelector from "./packages/SafetyVideoPackSelector";
import BoardingAudioPackSelector from "./packages/BoardingAudioPackSelector";
import { safetyVideoPackService } from "../services/SafetyVideoPackService";
import {
  BOARDING_AUDIO_PACKAGE_STORAGE_KEY,
  BOARDING_AUDIO_SOURCE_STORAGE_KEY,
  boardingAudioPackService,
  toBoardingAudioSource,
  type BoardingAudioSource,
} from "../services/BoardingAudioPackService";
import type { PackageRecord } from "../services/PackagesService";
import { buildIfeFlightInfo, pickIfeGuest } from "./ife/IfeTypes";
import type {
  ScenarioConfigSnapshot,
  ScenarioEventConfig,
  ScenarioOption,
} from "../services/ScenarioConfigService";
import { EVENT_CONFIG_FLAVOR_KEY, EVENT_CONFIG_PACKAGE_KEY, NORMAL_SCENARIO_KEY, SAFETY_VIDEO_EVENT_KEY, SAFETY_VIDEO_PACKAGE_STORAGE_KEY, EventSwitchValue, isConfigurableEvent, isEventSwitchValue } from "../services/eventConfigConstants";
import {
  StepPendingEvent,
  StepExecutedEvent,
  StepSkippedEvent,
} from "../narrative/NarrativeOrchestrator";
import ManualStepControls from "./flight/ManualStepControls";
import StepHistory, { StepHistoryEntry } from "./flight/StepHistory";
import FlightStepper from "./flight/FlightStepper";
import LastAnnouncementBox from "./flight/LastAnnouncementBox";
import VoiceIndicator from "./flight/VoiceIndicator";
import PasajeroSlideOver from "./PasajeroSlideOver";
import DebugMonitor from "./flight/DebugMonitor";
import DebugMonitorButton from "./flight/DebugMonitorButton";
import { connectionStatusService } from "../services/ConnectionStatusService";
import { isTauri } from "@tauri-apps/api/core";
import FlightStartPopup from "./flight/FlightStartPopup";
import FlightSelectView from "./flight/FlightSelectView";
import type { FlightStartPreferences } from "../services/FlightContext";
// @ts-ignore
import siluetaAvion from "./Silueta Avion.png";
// @ts-ignore
import siluetaAvionFill from "./Silueta Avion Fill.png";

// ── Delay configurable de gate_crew_started (slider en Configurar Eventos) ──
const GATE_STARTED_DELAY_KEY = "gate_crew_started";
const GATE_STARTED_DELAY_MIN = 15;
const GATE_STARTED_DELAY_MAX = 180;
const GATE_STARTED_DELAY_DEFAULT = 15;

// ── Sliders de eventos de demora (minutos) en "Configurar Eventos" ──
// El usuario puede reparametrizar el umbral (default_delay_ms) de estos
// eventos de detección de demora con un slider de minutos (5-60).
const DELAY_SLIDER_EVENT_KEYS = [
  "preflight_capt_delay_parked",
  "preflight_capt_delay_taxi",
  "preflight_capt_delay_takeoff",
] as const;
const DELAY_SLIDER_MIN_MIN = 5;
const DELAY_SLIDER_MAX_MIN = 60;
// Fallback (ms) solo si la DB `events.default_delay_ms` no define el evento.
const DELAY_SLIDER_DEFAULT_MS: Record<string, number> = {
  preflight_capt_delay_parked: 600000, // 10 min
  preflight_capt_delay_taxi: 900000, // 15 min
  preflight_capt_delay_takeoff: 900000, // 15 min (mismo que taxi)
};
const MINUTE_MS = 60000;

interface VueloActualViewProps {
  currentState: FlightState;
  onStateChange: (state: FlightState) => void;
  simBriefData: SimBriefData;
  voicesConfig: ConfigVoces;
  audioConfig: ConfigAudio;
  copilotVolume: number;
  onCopilotVolumeChange: (v: number) => void;
  passengers: Pasajero[];
  onPassengerClick: (p: Pasajero) => void;
  lastAnnouncement: UltimoAnuncio | null;
  onTriggerAnnouncement: (tipo: any) => void;
  onSimulateAction: (action: string) => void;
  landingFpm: number;
  onLandingFpmChange: (fpm: number) => void;
  onResetSimulation: () => void;
  onTriggerBriefImport: (realData?: any) => void;
  onNavigateToAccount?: () => void;
}

/** Convierte una clave de fase canónica a la sub-etapa + estado de la UI. */
function phaseToSubStage(phase: string): { subStage: string; state: FlightState } {
  switch (phase) {
    case "GATE":
    case "BOARDING":
      return { subStage: "Embarque", state: FlightState.PreEmbarque };
    case "PRE_FLIGHT":
      return { subStage: "Pre-vuelo", state: FlightState.PreEmbarque };
    case "TAXI":
      return { subStage: "Rodaje", state: FlightState.PreEmbarque };
    case "TAKEOFF":
    case "CLIMB":
    case "CRUISE":
      return { subStage: "Crucero", state: FlightState.EnVuelo };
    case "DESCENT":
    case "LANDING":
      return { subStage: "Descenso", state: FlightState.EnVuelo };
    case "TAXI_TO_GATE":
      return { subStage: "Rodaje a Puerta", state: FlightState.Aterrizado };
    case "AT_GATE":
      return { subStage: "Plataforma", state: FlightState.Aterrizado };
    default:
      return { subStage: "Crucero", state: FlightState.EnVuelo };
  }
}

function ToggleSwitch({ 
  checked, 
  onChange, 
  label 
}: { 
  checked: boolean; 
  onChange: (v: boolean) => void; 
  label: string; 
}) {
  return (
    <label className="flex items-center justify-between gap-3 p-2.5 bg-[#002440]/35 border border-[#3B7EB2]/15 hover:border-[#3B7EB2]/35 rounded-[5px] cursor-pointer hover:bg-[#002440]/55 transition-all w-full select-none">
      <span className="text-white text-[11px] font-sans font-medium line-clamp-2 leading-tight">{label}</span>
      <div className="relative inline-flex items-center shrink-0">
        <input 
          type="checkbox" 
          checked={checked} 
          onChange={(e) => onChange(e.target.checked)} 
          className="sr-only peer" 
        />
        <div className="w-8 h-4.5 bg-[#00172e] border border-[#3B7EB2]/45 rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[3.5px] after:left-[3px] after:bg-white/40 peer-checked:after:bg-[#43E600] after:border-white/10 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-[#43E600]/20 peer-checked:border-[#43E600]/40"></div>
      </div>
    </label>
  );
}

/** Resuelve el escenario de un vuelo: `flights.scenario_key` o el del usuario. */
async function resolveFlightScenario(flightId: string, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("flights")
    .select("scenario_key")
    .eq("id", flightId)
    .maybeSingle();

  if (!error && data?.scenario_key) {
    return data.scenario_key;
  }

  const defaultResult = await ScenarioConfigService.getUserDefaultScenario(userId);
  return defaultResult.data ?? NORMAL_SCENARIO_KEY;
}

/**
 * Lee la pista de música ambiental que el usuario eligió en la configuración
 * previa al vuelo (`setting_general.song_boarding_music`), para heredarla en
 * vuelos que aún no tienen una pista explícita.
 */
async function loadUserMusicDefault(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("setting_general")
      .select("song_boarding_music")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const value = (data as any).song_boarding_music;
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Opciones de cierre del vuelo para flushFlightPath. */
interface FlushFlightPathOptions {
  /** 'ended' en cierre normal, 'saved' en recuperación de emergencia. */
  status?: "ended" | "saved";
  /** Nota de recuperación (va en properties del GeoJSON). */
  recoveryNote?: string | null;
}

/**
 * Fases que justifican guardar el track ante una desconexión (vuelo
 * avanzado). Las fases tempranas en tierra se descartan. TAKEOFF/CLIMB quedan
 * cubiertos por la señal de despegue (takeoffMs) en el handler.
 */
const RECOVERY_PHASE_SET: ReadonlySet<string> = new Set([
  "CRUISE",
  "DESCENT",
  "LANDING",
  "TAXI_TO_GATE",
  "AT_GATE",
]);

export default function VueloActualView({
  currentState,
  onStateChange,
  simBriefData,
  voicesConfig,
  audioConfig,
  copilotVolume,
  onCopilotVolumeChange,
  passengers,
  onPassengerClick,
  lastAnnouncement,
  onTriggerAnnouncement,
  onSimulateAction,
  landingFpm,
  onLandingFpmChange,
  onResetSimulation,
  onTriggerBriefImport,
  onNavigateToAccount
}: VueloActualViewProps) {
  const { t } = useTranslation();
  // Traduce los identificadores internos de sub-etapa (claves de lógica y
  // `stageMockData`) sin renombrarlos, para no romper comparaciones de estado.
  const tStage = (stage: string): string => {
    const map: Record<string, string> = {
      "No iniciado": "no_iniciado",
      "Embarque": "embarque",
      "Pre-vuelo": "pre_vuelo",
      "Pre-Vuelo": "pre_vuelo",
      "Rodaje": "rodaje",
      "Crucero": "crucero",
      "Descenso": "descenso",
      "Rodaje a Puerta": "rodaje_puerta",
      "Plataforma": "plataforma",
    };
    const k = map[stage];
    return k ? t(`flight.stage.${k}`) : stage;
  };
  const [flightCode, setFlightCode] = useState(simBriefData.vueloCodigo);
  const [originICAO, setOriginICAO] = useState(simBriefData.origen);
  const [destICAO, setDestICAO] = useState(simBriefData.destino);
  const [airline, setAirline] = useState(simBriefData.aerolinea);
  const [originCityName, setOriginCityName] = useState<string>(getAirportName(simBriefData.origen) || simBriefData.origen);
  const [destCityName, setDestCityName] = useState<string>(getAirportName(simBriefData.destino) || simBriefData.destino);
  const [gate, setGate] = useState<string>("");

  // Phase 1 Boarding states
  const [boardedCount, setBoardedCount] = useState<number>(0);
  const [isBoardingActive, setIsBoardingActive] = useState<boolean>(false);
  const [boardingStarted, setBoardingStarted] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  const [flightPhase, setFlightPhase] = useState<"GATE" | "BOARDING" | null>(null);
  // Fase actual del stepper dinámico (construido a partir del escenario cargado).
  const [stepperCurrentPhase, setStepperCurrentPhase] = useState<string>("GATE");
  // true cuando el escenario de BOARDING completó todos sus pasos narrativos.
  const [boardingStepsDone, setBoardingStepsDone] = useState<boolean>(false);

  // --- TEST MODE (manual step-by-step) STATES ---
  const [executionMode, setExecutionMode] = useState<"normal" | "test">("normal");
  const [pendingManualStep, setPendingManualStep] = useState<NarrativeStep | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [stepTotal, setStepTotal] = useState<number>(0);
  const [stepHistory, setStepHistory] = useState<StepHistoryEntry[]>([]);
  const isTestModeFlight = executionMode === "test";

  // Phase 7 States
  const [isReportGenerating, setIsReportGenerating] = useState<boolean>(true);
  const [isManifestCollapsed, setIsManifestCollapsed] = useState<boolean>(false);
  // Fase 1 pasajeros: snapshot agregado para el panel (se refresca 1Hz).
  const [paxAverages, setPaxAverages] = useState<AttributeState | null>(null);
  const [paxStarted, setPaxStarted] = useState<boolean>(false);
  // Resumen final conservado al cerrar el vuelo (el engine se resetea).
  const [paxFinal, setPaxFinal] = useState<FlightPassengerSummary | null>(null);

  // Flight Plan Import local state matching the new flow
  const [isBriefImported, setIsBriefImported] = useState<boolean>(false);
  const [canStartFlight, setCanStartFlight] = useState<boolean>(false);
  // Hay un vuelo real cargado (importado desde SimBrief o vuelo guardado).
  // Sin esto no se habilita "Iniciar Vuelo" / "Iniciar Pruebas".
  const hasValidFlight = !!flightCode && !!originICAO && !!destICAO && !!destCityName;
  // Estado de conexión en tiempo real (MSFS / X-Plane / Mock / Sin conexión)
  // y modo pruebas (permite iniciar sin conexión real).
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTestMode, setIsTestMode] = useState<boolean>(false);
  const [showFlightStartPopup, setShowFlightStartPopup] = useState<boolean>(false);
  const [pendingFlightMode, setPendingFlightMode] = useState<"normal" | "test">("normal");
  const [activeGroupTab, setActiveGroupTab] = useState<string>("immersion");
  const [selectedPackage, setSelectedPackage] = useState<string>("aerolineas");
  const [showPackageManager, setShowPackageManager] = useState<boolean>(false);
  // Video de seguridad de la comunidad (modo PACK de `taxi_crew_safety_brief`).
  const [safetyPackage, setSafetyPackage] = useState<PackageRecord | null>(null);
  const [storedSafetyPackageId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [selectedPasajero, setSelectedPasajero] = useState<Pasajero | null>(null);
  
  // --- DEBUG MONITOR ---
  const [isDebugOpen, setIsDebugOpen] = useState<boolean>(false);
  const [lastEventVars, setLastEventVars] = useState<Record<string, unknown> | null>(null);

  // --- FLIGHT SETTINGS SCREEN STATES ---
  const [isFlightSettingsOpen, setIsFlightSettingsOpen] = useState<boolean>(false);
  const [flightId, setFlightId] = useState<string | null>(null);
  const [isStartingFlight, setIsStartingFlight] = useState<boolean>(false);
  const [boardingManifest, setBoardingManifest] = useState<Pasajero[]>([]);

  // Escenario efectivo del vuelo: selector + eventos dinámicos (como ConfigView).
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<string>(NORMAL_SCENARIO_KEY);
  const [scenarioSnapshot, setScenarioSnapshot] = useState<ScenarioConfigSnapshot | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState<boolean>(false);

  // Block 1: Tripulación e Identificación
  const [captainVoice, setCaptainVoice] = useState<string>("93d91fee-541a-46cd-b615-f5d57c05c7d4");
  const [crewVoice, setCrewVoice] = useState<string>("b9c037ca-6ac7-4b80-b231-34afe3efbccf");

  const LANG_NAMES = ["Español (ES)", "Español (AR)", "Inglés (US)", "Inglés (UK)"];
  const LANG_NONE = "none";

  const [captainPrimaryLang, setCaptainPrimaryLang] = useState<string>("300a6cfd-bc1f-43e2-bde6-60a3abdccd0f");
  const [captainSecondaryLang, setCaptainSecondaryLang] = useState<string>(LANG_NONE);
  const [boardingMusicTrackId, setBoardingMusicTrackId] = useState<string>("");
  const [musicTracks, setMusicTracks] = useState<BoardingMusicTrack[]>([]);
  const [musicTracksLoading, setMusicTracksLoading] = useState<boolean>(false);
  // Versión de música en vuelo: procesada del backend (`processed_url`) o
  // limpia (`clean_url`). Default global de Settings (default: procesada).
  const [boardingMusicProcessed, setBoardingMusicProcessed] = useState<boolean>(true);

  // Fuente de música de embarque del vuelo (`ia` = catálogo, `pack` = audio
  // de la comunidad). Override por vuelo (null = default global de Settings).
  const [boardingAudioSourceGlobal, setBoardingAudioSourceGlobal] = useState<BoardingAudioSource>("ia");
  const [boardingAudioSourceOverride, setBoardingAudioSourceOverride] = useState<BoardingAudioSource | null>(null);
  const effectiveBoardingAudioSource = boardingAudioSourceOverride ?? boardingAudioSourceGlobal;
  const [boardingAudioPackage, setBoardingAudioPackage] = useState<PackageRecord | null>(null);
  const [storedBoardingAudioPackageId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  /** URL efectiva del audio del vuelo (cacheada o remota; null = catálogo). */
  const [boardingAudioUrl, setBoardingAudioUrl] = useState<string | null>(null);
  const [showSecondaryLang, setShowSecondaryLang] = useState<boolean>(false);
  // Evita sobrescribir los valores guardados antes de que termine la carga.
  const musicSettingsLoadedRef = useRef(false);
  // Marca qué selectores pre-vuelo tocó el usuario: las cargas async de
  // setting_general (montaje) solo pre-seleccionan; si su respuesta llega
  // tarde (red lenta) no deben pisar una elección ya hecha en "Volar".
  const userPickedRef = useRef({ lang: false, captain: false, crew: false, gate: false });

  // Alternating bilingual display for GateMonitor (15s cycle)
  const [showEnglish, setShowEnglish] = useState<boolean>(true);
  const [labelOpacity, setLabelOpacity] = useState(1);

  // Boarding audio
  const [currentAnnouncement, setCurrentAnnouncement] = useState<AnnouncementInfo | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [generatingError, setGeneratingError] = useState<string | null>(null);
  // Gate agent voice loaded from setting_general
  const [gateAgentVoiceId, setGateAgentVoiceId] = useState<string>("");

  // Voice options loaded from DB (no fallback — block UI on failure)
  interface VoiceOption {
    id: string;
    name: string;
    role: string;
    languages: string[];
  }

  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voicesLoading, setVoicesLoading] = useState(false);

  // Una voz sin `languages` (schema viejo o sin etiquetar) se considera
  // disponible para cualquier idioma (no se filtra).
  const voiceMatchesLanguage = (v: VoiceOption, langId: string): boolean =>
    !v.languages || v.languages.length === 0 || v.languages.includes(langId);

  const getVoiceOptionsForRole = (role: string): VoiceOption[] =>
    availableVoices.filter(
      (v) => v.role === role && voiceMatchesLanguage(v, captainPrimaryLang)
    );

  const captainVoiceOptions = getVoiceOptionsForRole("captain");
  const crewVoiceOptions = getVoiceOptionsForRole("crew");
  const gateVoiceOptions = getVoiceOptionsForRole("gate");

  // ── Consistencia idioma ↔ voces ──────────────────────────────────────
  // Garantiza que las voces seleccionadas pertenezcan al idioma elegido.
  // Si una voz guardada (preferencia del usuario) no es válida para el idioma
  // o ya no está disponible, se reemplaza por la primera voz válida de ese
  // rol para el idioma. Esto evita iniciar el vuelo con una voz que no
  // corresponde al idioma (causa de "audio no encontrado" en la Edge Function).
  const firstVoiceForRole = (role: string, langId: string): string => {
    const v = availableVoices.find(
      (item) => item.role === role && voiceMatchesLanguage(item, langId)
    );
    return v?.id ?? "";
  };

  const isVoiceValidForLanguage = (role: string, voiceId: string, langId: string): boolean => {
    if (!voiceId) return false;
    const v = availableVoices.find((item) => item.id === voiceId);
    return !!v && v.role === role && voiceMatchesLanguage(v, langId);
  };

  // Re-sincroniza automáticamente captain/crew/gate con el idioma actual cada
  // vez que cambia el idioma, se terminan de cargar las voces disponibles o se
  // cargan preferencias (setting_general). Es idempotente: si la voz actual ya
  // es válida para el idioma no hace nada (evita loops); si es vacía no fuerza
  // selección (respeta la elección manual pendiente).
  const voicesLangRef = useRef<{ lang: string; captain: string; crew: string; gate: string }>({
    lang: captainPrimaryLang,
    captain: captainVoice,
    crew: crewVoice,
    gate: gateAgentVoiceId,
  });
  useEffect(() => {
    if (!voicesReady || availableVoices.length === 0) return;
    const prev = voicesLangRef.current;
    const resolve = (role: string, current: string): string => {
      if (!current) return current;
      if (isVoiceValidForLanguage(role, current, captainPrimaryLang)) return current;
      return firstVoiceForRole(role, captainPrimaryLang);
    };
    const next = {
      lang: captainPrimaryLang,
      captain: resolve("captain", captainVoice),
      crew: resolve("crew", crewVoice),
      gate: resolve("gate", gateAgentVoiceId),
    };
    voicesLangRef.current = next;
    if (
      next.lang !== prev.lang ||
      next.captain !== prev.captain ||
      next.crew !== prev.crew ||
      next.gate !== prev.gate
    ) {
      console.log("[VueloActualView] Voces re-sincronizadas al idioma:", {
        lang: next.lang,
        captain: next.captain,
        crew: next.crew,
        gate: next.gate,
        previous: prev,
      });
      setCaptainVoice(next.captain);
      setCrewVoice(next.crew);
      setGateAgentVoiceId(next.gate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captainPrimaryLang, captainVoice, crewVoice, gateAgentVoiceId, availableVoices, voicesReady]);

  const getSpeakerName = (role: string): string => {
    if (role === "captain") {
      const v = availableVoices.find((v) => v.id === captainVoice);
      return v?.name || simBriefData.nombrePiloto || t("narrator.captain");
    }
    if (role === "crew") {
      const v = availableVoices.find((v) => v.id === crewVoice);
      return v?.name || t("narrator.crew");
    }
    if (role === "gate") {
      const v = availableVoices.find((v) => v.id === gateAgentVoiceId);
      return v?.name || t("current_flight.not_started.events.narrator_gate");
    }
    return t("flight_view.role_gate");
  };

  // Auto-clear generating error after 6 seconds
  useEffect(() => {
    if (generatingError) {
      const timer = setTimeout(() => setGeneratingError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [generatingError]);

  // Language options loaded from DB (no fallback — block UI on failure)
  interface LanguageOption {
    id: string;
    name: string;
  }

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [languagesReady, setLanguagesReady] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [languagesLoading, setLanguagesLoading] = useState(false);

  const announcementQueueRef = useRef<AnnouncementQueue | null>(null);
  if (!announcementQueueRef.current) {
    announcementQueueRef.current = new AnnouncementQueue();
  }

  const ruleEngineRef = useRef<RuleEngine | null>(null);
  if (!ruleEngineRef.current) {
    ruleEngineRef.current = new RuleEngine();
  }

  const clockRef = useRef<Clock | null>(null);
  if (!clockRef.current) {
    clockRef.current = new Clock();
  }

  const timerManagerRef = useRef<TimerManager | null>(null);
  if (!timerManagerRef.current) {
    timerManagerRef.current = new TimerManager(clockRef.current, announcementQueueRef.current);
  }

  const announcementPlayerRef = useRef<AnnouncementPlayer | null>(null);
  if (!announcementPlayerRef.current) {
    announcementPlayerRef.current = new AnnouncementPlayer(announcementQueueRef.current);
  }

  const flightContextRef = useRef<FlightContext | null>(null);
  if (!flightContextRef.current) {
    flightContextRef.current = new FlightContext();
  }
  // El TimerManager resuelve idioma/voz contra el contexto vivo al disparar.
  if (timerManagerRef.current) {
    timerManagerRef.current.setFlightContext(flightContextRef.current);
  }

  const announcementEventHandlerRef = useRef<AnnouncementEventHandler | null>(null);
  if (!announcementEventHandlerRef.current) {
    announcementEventHandlerRef.current = new AnnouncementEventHandler(announcementQueueRef.current);
  }

  const eventDispatcherRef = useRef<DefaultEventDispatcher | null>(null);
  if (!eventDispatcherRef.current) {
    eventDispatcherRef.current = new DefaultEventDispatcher([announcementEventHandlerRef.current]);
  }

  const scenarioLoaderRef = useRef<ScenarioLoader | null>(null);
  if (!scenarioLoaderRef.current) {
    scenarioLoaderRef.current = new ScenarioLoader();
  }

  const schedulerRef = useRef<Scheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = new Scheduler(
      ruleEngineRef.current,
      timerManagerRef.current,
      eventDispatcherRef.current,
      flightContextRef.current,
      announcementQueueRef.current,
      new ScenarioResolver(scenarioLoaderRef.current),
      musicController
    );
  }

  const flightFSMRef = useRef<FlightFSM | null>(null);
  if (!flightFSMRef.current) {
    flightFSMRef.current = new FlightFSM(schedulerRef.current);
  }

  const simControllerRef = useRef<SimulationController | null>(null);
  if (!simControllerRef.current) {
    simControllerRef.current = new SimulationController(flightFSMRef.current);
  }

  // Fase 3+4: FlightController — MsfsFlightController (MSFS) con fallback
  // a MockFlightController. El Mock ahora simula vuelo completo GATE→AT_GATE
  // con timeline determinístico. Detector independiente para transiciones.
  // autoStart: false → no conectar automáticamente al montar, solo en handleStartFlight
  const flightControllerRef = useRef<FlightController | null>(null);
  if (!flightControllerRef.current) {
    flightControllerRef.current =
      config.sim.provider === "msfs"
        ? new MsfsFlightController()
        : new MockFlightController({
            speedMultiplier: config.mock.speedMultiplier,
            autoTransition: config.mock.autoTransition,
            autoStart: false,
          });
  }

  // Mantener alias para compatibilidad con código que esperaba mockControllerRef
  const mockControllerRef = flightControllerRef as React.MutableRefObject<FlightController | null>;

  const lastDetectedPhaseRef = useRef<FlightPhase | null>(null);
  const phaseDetectorRef = useRef<FlightPhaseDetector | null>(null);
  if (!phaseDetectorRef.current) phaseDetectorRef.current = new FlightPhaseDetector();
  // Recorrido del vuelo activo (downsampling por delta). El buffer se vacía
  // recién tras un guardado exitoso en `flight_paths`.
  const flightPathRecorderRef = useRef<FlightPathRecorder | null>(null);
  if (!flightPathRecorderRef.current) flightPathRecorderRef.current = new FlightPathRecorder();
  // Tracker de bonos XP de disciplina (se alimenta muestra a muestra junto al recorder)
  const xpBonusTrackerRef = useRef<XpBonusTracker | null>(null);
  if (!xpBonusTrackerRef.current) xpBonusTrackerRef.current = new XpBonusTracker();
  // Motor de pasajeros Fase 1 (muestra de 10, tick por telemetría + efectos
  // al completar anuncios). Mismo patrón de refs que el tracker de XP.
  const passengerEngineRef = useRef<PassengerEngine | null>(null);
  if (!passengerEngineRef.current) passengerEngineRef.current = new PassengerEngine();
  // Timestamp de la última muestra para el dt real del tick de pasajeros.
  const passengerLastTickMsRef = useRef<number | null>(null);
  // Detector de turbulencia (edge-triggered): alimenta applyNegativeEvent.
  const turbulenceRef = useRef<TurbulenceDetector | null>(null);
  if (!turbulenceRef.current) turbulenceRef.current = new TurbulenceDetector();
  // Etiqueta transitoria del panel de cabina (daño o mitigación): se muestra
  // ~3.4s y se desvanece sola, sin interacción.
  const [paxFlash, setPaxFlash] = useState<{
    id: number;
    text: string;
    tone: "neg" | "pos";
    fading: boolean;
  } | null>(null);
  const paxFlashTimerRef = useRef<number | null>(null);
  const flashPax = useCallback((text: string, tone: "neg" | "pos") => {
    if (paxFlashTimerRef.current !== null) {
      window.clearTimeout(paxFlashTimerRef.current);
      paxFlashTimerRef.current = null;
    }
    const id = Date.now();
    setPaxFlash({ id, text, tone, fading: false });
    paxFlashTimerRef.current = window.setTimeout(() => {
      setPaxFlash((prev) => (prev && prev.id === id ? { ...prev, fading: true } : prev));
      paxFlashTimerRef.current = window.setTimeout(() => {
        setPaxFlash((prev) => (prev && prev.id === id ? null : prev));
        paxFlashTimerRef.current = null;
      }, 500);
    }, 2900);
  }, []);

  // Gancho de depuración SOLO en navegador local (mock): permite forzar los
  // 3 niveles de turbulencia y la etiqueta de mitigación sin simular VS real
  // (p. ej. `__announsDebug.forceTurbulence('severa')` en consola).
  // No existe en el build de escritorio (protocolo tauri://, no localhost).
  useEffect(() => {
    try {
      if (typeof window === "undefined" || window.location.hostname !== "localhost") return;
      const w = window as unknown as Record<string, unknown>;
      const prev = (w.__announsDebug ?? {}) as Record<string, unknown>;
      w.__announsDebug = {
        ...prev,
        forceTurbulence: (level: TurbulenceLevel) => {
          const lv: TurbulenceLevel =
            level === "severa" || level === "moderada" ? level : "leve";
          passengerEngineRef.current?.applyNegativeEvent({
            attribute: "calma",
            amount: TURBULENCE_DAMAGE[lv],
          });
          flashPax(TURBULENCE_FLASH_TEXT[lv], "neg");
        },
        forceMitigated: () => flashPax(TURBULENCE_MITIGATED_FLASH_TEXT, "pos"),
      };
    } catch {}
  }, [flashPax]);
  // `flightId` como ref para leerlo desde el bucle de telemetría y los handlers
  // sin depender de closures con estado obsoleto.
  const flightIdRef = useRef<string | null>(null);
  // El detector necesita flight.cruiseAltitude (SimBrief) para detectar CRUISE
  // a la altitud real del vuelo (p. ej. FL170) en vez del umbral fijo 25000.
  // flightContextRef es estable (misma instancia), basta con inyectarlo una vez.
  if (flightContextRef.current) {
    phaseDetectorRef.current.setFlightContext(flightContextRef.current);
  }

  const bindFlightController = useCallback((controller: FlightController) => {
    const ctx = flightContextRef.current!;
    const scheduler = schedulerRef.current!;
    const fsm = flightFSMRef.current!;
    controller.onTelemetry = (snap) => {
      ctx.updateTelemetry(snap);
      scheduler.notifyTelemetry(snap);

      // Registro del recorrido (downsampling por delta): de cada muestra de
      // telemetría solo se persiste en memoria un punto si cambió el rumbo,
      // la altitud o la velocidad, o si pasó el tiempo máximo sin registrar.
      try {
        flightPathRecorderRef.current?.record(
          {
            latitude: snap.latitude,
            longitude: snap.longitude,
            altitude: snap.altitude,
            groundspeed: snap.groundspeed,
            heading: snap.heading,
            simOnGround: snap.simOnGround,
          },
          scheduler.getCurrentPhase()
        );
      } catch (err) {
        console.warn("[VueloActualView] Error registrando punto de recorrido:", err);
      }

      // Acumulación de evidencia para bonos XP de disciplina (luces por fase,
      // límite de velocidad bajo 10k ft, perfil vertical en climb/descent).
      try {
        xpBonusTrackerRef.current?.sample(
          {
            taxiLightsOn: snap.taxiLightsOn,
            landingLightsOn: snap.landingLightsOn,
            strobeLightsOn: snap.strobeLightsOn,
            altitude: snap.altitude,
            indicatedAirspeed: snap.indicated_airspeed,
            groundspeed: snap.groundspeed,
            verticalSpeed: snap.verticalSpeed,
            timeOfDay: snap.timeOfDay,
            beaconLightsOn: snap.beaconLightsOn,
          },
          scheduler.getCurrentPhase()
        );
      } catch (err) {
        console.warn("[VueloActualView] Error acumulando evidencia XP:", err);
      }

      // Tick del motor de pasajeros (deterioro por tiempo según fase).
      // dt real entre muestras: absorbe 10Hz MSFS y 1Hz mock por igual.
      try {
        const nowMs = Date.now();
        const prevMs = passengerLastTickMsRef.current;
        passengerLastTickMsRef.current = nowMs;
        const rawPhase = scheduler.getCurrentPhase();
        const phase = rawPhase !== null && (Object.values(FlightPhase) as string[]).includes(rawPhase)
          ? (rawPhase as FlightPhase)
          : null;
        if (prevMs !== null && phase !== null) {
          const dtSec = (nowMs - prevMs) / 1000;
          passengerEngineRef.current?.tick(dtSec, phase);
          // Detector de turbulencia (edge-triggered): un evento de daño real
          // = una etiqueta de UI, nunca una por tick.
          const outcome = turbulenceRef.current?.sample(snap.verticalSpeed, dtSec, phase) ?? null;
          if (outcome) {
            passengerEngineRef.current?.applyNegativeEvent({
              attribute: "calma",
              amount: outcome.amount,
            });
            console.log("[Pasajeros] turbulencia:", outcome.level, `calma −${outcome.amount}`);
            fileLogger.log("[Pasajeros] turbulencia", {
              level: outcome.level,
              amount: outcome.amount,
              phase,
            });
            flashPax(TURBULENCE_FLASH_TEXT[outcome.level], "neg");
          }
        }
      } catch (err) {
        console.warn("[VueloActualView] Error en tick de pasajeros:", err);
      }

      // Transición automática vía detector con histéresis (evita saltos por ruido)
      // Sincronizar boardingCompleted para PRE_FLIGHT (evita transición temprana)
      if (config.mock.enabled && config.mock.autoTransition) {
        const boardingDone = scheduler.isBoardingStepsCompleted();
        phaseDetectorRef.current!.setBoardingCompleted(boardingDone);
        const ctrl: any = flightControllerRef.current;
        if (ctrl && typeof ctrl.setBoardingCompleted === 'function') {
          ctrl.setBoardingCompleted(boardingDone);
        }
        const detected = phaseDetectorRef.current!.detectPhase(snap);
        if (!detected) return; // aún no estable
        if (detected !== lastDetectedPhaseRef.current) {
          const prev = lastDetectedPhaseRef.current;
          lastDetectedPhaseRef.current = detected;
          // BOARDING manual: no auto-transicionar, esperar "Comenzar Embarque"
          if (detected === FlightPhase.BOARDING) {
            console.log("[VueloActualView] BOARDING detectado pero requiere acción del usuario");
            return;
          }
          const currentFSM = fsm.getCurrentState();
          if (detected !== currentFSM) {
            if (prev !== null) {
              console.log("[VueloActualView] 🔄 Transición de fase (simulator):", { from: prev, to: detected });
            }
            const ok = fsm.transition(detected, 'simulator');
            if (!ok) {
              console.warn(`[VueloActualView] FSM rechazó transición ${currentFSM} → ${detected}`);
            }
          }
        }
      }
    };
  }, []);

  // Sincronizar controlador activo con ConnectionStatusService
  useEffect(() => {
    const ctrl = flightControllerRef.current;
    if (ctrl) {
      connectionStatusService.setActiveController(ctrl);
      connectionStatusService.start();
    }
    return () => {
      // No detener el servicio global; solo limpiar si es el mismo
    };
  }, []);

  // Capturar variables resueltas de eventos para el monitor
  useEffect(() => {
    const q = announcementQueueRef.current!;
    // Cuando se despacha un evento, capturar su EventContext si es posible
    // Por ahora capturamos flight+telemetry como representación de variables resueltas
    const unsub = q.on("announcement", () => {
      try {
        const ctx = flightContextRef.current;
        if (ctx) {
          const snap = ctx.getDebugSnapshot();
          const vars: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(snap.flight as any)) vars[`flight.${k}`] = v;
          for (const [k, v] of Object.entries(snap.telemetry as any)) {
            if (["altitude","groundspeed","heading","verticalSpeed"].includes(k)) vars[`telemetry.${k}`] = v;
          }
          if (snap.simbrief) {
            const sb: any = snap.simbrief;
            if (sb.general) vars["simbrief.general"] = sb.general;
          }
          setLastEventVars(vars);
        }
      } catch {}
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  // Integración FlightController: onTelemetry → FlightContext + Scheduler + auto transición de fase
  // No conecta automáticamente (autoStart: false). La conexión se hace en handleStartFlight.
  useEffect(() => {
    console.log('[VueloActualView] 🔍 Creando FlightController');
    console.log('[VueloActualView] 📡 Configuración:', {
      provider: config.sim.provider,
      autoConnect: config.sim.autoConnect
    });
    fileLogger.log('[VueloActualView] 🔍 Creando FlightController');
    fileLogger.log('[VueloActualView] 📡 Configuración', {
      provider: config.sim.provider,
      autoConnect: config.sim.autoConnect,
      isTauri: isTauri()
    });
    const activeController = flightControllerRef.current!;
    bindFlightController(activeController);
    connectionStatusService.setActiveController(activeController);

    // No auto-connect: el vuelo inicia solo con "Iniciar Vuelo" (autoStart: false)

    return () => {
      // No desconectar si la conexión ya está establecida: en StrictMode el
      // cleanup del doble montaje correría disconnect() y mataría una conexión
      // activa que el segundo montaje reutilizaría. La desconexión real se
      // maneja al desmontar la vista o explícitamente.
      try {
        const ctrl = flightControllerRef.current ?? activeController;
        if (ctrl && !ctrl.isConnected()) ctrl.disconnect();
      } catch {}
    };
  }, [bindFlightController]);

  // Estado de conexión en tiempo real → `isConnected` para la UI (Iniciar Vuelo / banner).
  useEffect(() => {
    const unsub = connectionStatusService.onStatusChange((status) => {
      setIsConnected(status.connected);
      fileLogger.log('[VueloActualView] 📡 Conexión actualizada', {
        type: status.type,
        connected: status.connected,
        label: status.label,
      });
    });
    return unsub;
  }, []);

  // Detección temprana de conexión al entrar a "Vuelo Actual": intenta conectar
  // el controlador real (MSFS); si falla (p. ej. simulador cerrado), hace
  // fallback a Mock. Para provider `mock` no se conecta al montar (autoStart:false
  // conserva el flujo existente de "Iniciar Vuelo").
  //
  // Compatible con React StrictMode (doble montaje en dev): el cleanup del primer
  // montaje NO desconecta una conexión ya establecida, y el segundo montaje
  // reutiliza la conexión (connect es idempotente) en vez de quedar desconectado
  // con objects=0 / emits=0.
  useEffect(() => {
    let isMounted = true;

    const connect = async () => {
      const controller = flightControllerRef.current;
      if (!controller || !isMounted) return;

      console.log('[VueloActualView] 🔍 Montaje', {
        isMounted,
        connected: controller.isConnected(),
      });

      if (config.sim.provider !== "msfs") return;

      // Ya conectado (p. ej. segundo montaje de StrictMode): no reconectar.
      if (controller.isConnected()) {
        fileLogger.log('[VueloActualView] 🔍 Ya conectado, omitiendo reconexión');
        connectionStatusService.setActiveController(controller);
        connectionStatusService.refresh();
        return;
      }

      try {
        await controller.connect();
        if (!isMounted) return;
        console.log('[VueloActualView] ✅ Conectado');
        fileLogger.log('[VueloActualView] ✅ Conexión exitosa');
        connectionStatusService.setActiveController(controller);
        connectionStatusService.refresh();
      } catch (error) {
        console.warn('[VueloActualView] ⚠️ Conexión fallida');
        if (!isMounted) return;
        fileLogger.log('[VueloActualView] ⚠️ Conexión fallida, usando Mock', { error: String(error) });
        // Detener watchdog del controlador real huérfano antes de sustituirlo por Mock
        try { controller.disconnect(); } catch {}
        // Fallback a Mock
        const mock = new MockFlightController({
          speedMultiplier: config.mock.speedMultiplier,
          autoTransition: config.mock.autoTransition,
          autoStart: false,
        });
        flightControllerRef.current = mock;
        bindFlightController(mock);
        connectionStatusService.setActiveController(mock);
        connectionStatusService.refresh();
      }
    };

    connect();

    return () => {
      isMounted = false;
      console.log('[VueloActualView] 🔍 Desmontaje', { isMounted });
      fileLogger.log('[VueloActualView] 🔍 Desmontaje', { isMounted });

      // No desconectar si la conexión ya está establecida: en StrictMode el
      // cleanup del primer montaje correría disconnect() y mataría la conexión
      // que el segundo montaje reutiliza. Solo desconectar estados incompletos.
      const controller = flightControllerRef.current;
      if (controller && !controller.isConnected()) {
        try { controller.disconnect(); } catch {}
      }
    };
  }, [bindFlightController]);

  // El MusicController escucha los anuncios de la cola para atenuar/restaurar
  // la música ambiental (ducking).
  useEffect(() => {
    return musicController.bindQueue(announcementQueueRef.current!);
  }, []);

  // Subscribe to AnnouncementQueue events
  useEffect(() => {
    const q = announcementQueueRef.current!;
    const ctx = flightContextRef.current!;
    const unsubGen = q.on("generating", (v: boolean) => {
      if (v) { setIsGenerating(true); setGeneratingError(null); }
      else { setIsGenerating(false); }
      ctx.updateAnnouncement({ isGenerating: v });
    });
    const unsubAnn = q.on("announcement", (ann: AnnouncementInfo) => {
      setCurrentAnnouncement(ann);
      // FlightContext almacena el último anuncio real para que cualquier vista
      // (p. ej. la pantalla de vuelo) pueda leerlo.
      ctx.updateAnnouncement({ currentAnnouncement: ann, generatingError: null });
    });
    const unsubPlay = q.on("playing", (v: boolean) => {
      setIsAudioPlaying(v);
      ctx.updateAnnouncement({ isAudioPlaying: v });
    });
    const unsubErr = q.on("error", (msg: string | null) => {
      if (msg) { setGeneratingError(msg); setIsGenerating(false); }
      ctx.updateAnnouncement({ generatingError: msg, isGenerating: false });
    });

    // Start the simulation clock so TimerManager timers can fire.
    clockRef.current?.start();

    return () => {
      unsubGen(); unsubAnn(); unsubPlay(); unsubErr();
    };
  }, []);

  // Refs para evitar closures obsoletos en los handlers del Scheduler.
  const currentStateRef = useRef(currentState);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    currentStateRef.current = currentState;
    onStateChangeRef.current = onStateChange;
  });

  // Mantener `flightIdRef` sincronizado con el estado (lo leen el bucle de
  // telemetría y los handlers de guardado del recorrido).
  useEffect(() => {
    flightIdRef.current = flightId;
  }, [flightId]);

  /**
   * Cierre del vuelo: calcula el resumen (air_time despegue→toque, distancia
   * Haversine del historial, horas de salida/llegada), lo persiste con UPDATE
   * en `public.flights` y vuelca el GeoJSON en `public.flight_paths`.
   *
   * Blindaje:
   *  - Toda la operación va en try/catch: ante cualquier fallo se loguea el
   *    error COMPLETO y el buffer NO se limpia (reintentable).
   *  - El buffer en memoria solo se limpia si TODO se guardó exitosamente.
   *  - Los flushes concurrentes (AT_GATE + botón) se serializan en cadena para
   *    que no se pisen entre sí ni dupliquen el INSERT.
   *  - El `flight_id` se captura al inicio (ref + fallback a FlightContext)
   *    para que un desmontaje/limpieza de estado no lo invalide mid-flight.
   */
  const flushChainRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const lastFlushErrorRef = useRef<string | null>(null);
  // Resumen del cierre de XP para la pantalla final (Plataforma): se rellena
  // con los bonus capturados ANTES de liberar el tracker y con la respuesta
  // de la RPC. Sobrevive al reset porque son valores planos, no el tracker.
  const [xpCompletion, setXpCompletion] = useState<XpCompletionSummary | null>(null);
  // Vuelo de campaña vigente asociado al plan importado (match blando por
  // origen + destino). Se reserva al importar y se aplica al cerrar.
  const [campaignMatch, setCampaignMatch] = useState<CampaignMatch | null>(null);

  /** Clave del stash de emergencia en localStorage (cierres abruptos). */
  const FLIGHT_PATH_STASH_KEY = "announs_flightpath_stash_v1";

  const clearFlightPathStash = (): void => {
    try {
      localStorage.removeItem(FLIGHT_PATH_STASH_KEY);
    } catch {
      // almacenamiento no disponible: nada que limpiar
    }
  };

  const flushFlightPath = (reason: string, opts: FlushFlightPathOptions = {}): Promise<boolean> => {
    // Estado de cierre: 'ended' en cierre normal, 'saved' en recuperación.
    // Sin esto los vuelos finalizados quedan en 'started' y no se reflejan
    // en las estadísticas globales.
    const status = opts.status ?? "ended";
    const run = async (): Promise<boolean> => {
      const tag = `[FLUSH_DEBUG:${reason}]`;
      console.log(`${tag} inicio`, { reason, status, at: new Date().toISOString() });
      fileLogger.log(`${tag} inicio`, { reason, status });

      // 1) Resolver flight_id (ref sincronizada con el estado + fallback).
      const recorder = flightPathRecorderRef.current;
      let id = flightIdRef.current;
      let idSource = "flightIdRef";
      if (!id) {
        try {
          id = flightContextRef.current?.getFlight()?.flightId ?? null;
          if (id) idSource = "flightContext.flightId";
        } catch {
          // ignorar: se reporta abajo como faltante
        }
      }
      console.log(`${tag} flight_id`, { flightId: id, source: idSource });
      if (!recorder) {
        const msg = `${tag} ABORTADO: sin recorder en memoria`;
        console.warn(msg);
        fileLogger.warn(msg, { reason });
        return false;
      }
      if (!id || typeof id !== "string" || id.trim() === "") {
        const msg =
          `${tag} ABORTADO: flight_id ausente o inválido. ` +
          `Sin flight_id no hay UPDATE en flights ni INSERT en flight_paths. ` +
          `Causa probable: el vuelo se inició sin despacho importado (sin fila en flights).`;
        console.warn(msg, { flightIdRef: flightIdRef.current });
        fileLogger.warn(msg, { reason, flightIdRef: flightIdRef.current });
        lastFlushErrorRef.current = "missing-flight-id";
        return false;
      }

      // 2) Estado del buffer.
      const pointCount = recorder.getPointCount();
      console.log(`${tag} buffer`, {
        points: pointCount,
        recording: recorder.isRecording(),
        phase: recorder.getPhase(),
        scenario: recorder.getScenarioKey(),
      });
      if (pointCount === 0) {
        console.log(`${tag} sin puntos: nada que persistir, se resetea el recorder`);
        fileLogger.log(`${tag} sin puntos`, { reason });
        recorder.reset();
        xpBonusTrackerRef.current?.reset();
        passengerEngineRef.current?.reset();
        turbulenceRef.current?.reset();
        passengerLastTickMsRef.current = null;
        return true;
      }

      // 3) Resumen calculado desde el recorder. Los tiempos viajan como epoch
      // ms y el servicio los formatea a `time`/`date` (UTC); el log muestra
      // ambos formatos para verificar contra el esquema real.
      const recoveryNote = opts.recoveryNote ?? null;
      const feature = recorder.toGeoJSON(id, {
        recovery: status === "saved",
        recoveryNote,
      });
      const takeoffMs = recorder.getTakeoffMs();
      const touchdownMs = recorder.getTouchdownMs();
      const airMinutes = recorder.getAirMinutes();
      const distanceNm = recorder.getDistanceNm();
      console.log(`${tag} resumen`, {
        flightId: id,
        points: feature.properties.point_count,
        phase: feature.properties.flight_phase,
        airMinutes,
        distanceNm,
        takeoffMs,
        touchdownMs,
        takeoffIso: takeoffMs ? new Date(takeoffMs).toISOString() : null,
        touchdownIso: touchdownMs ? new Date(touchdownMs).toISOString() : null,
      });
      fileLogger.log(`${tag} resumen`, {
        flightId: id,
        points: feature.properties.point_count,
        airMinutes,
        distanceNm,
        takeoffMs,
        touchdownMs,
      });

      try {
        // 4) UPDATE en flights con el payload exacto (incluye flight_status).
        const summaryPayload = {
          airTimeMin: airMinutes,
          distanceNm,
          departureMs: takeoffMs,
          arrivalMs: touchdownMs,
          flightStatus: status,
        };
        console.log(`${tag} UPDATE flights → payload`, { flightId: id, ...summaryPayload });
        fileLogger.log(`${tag} UPDATE flights`, { flightId: id, ...summaryPayload });
        const summaryResult = await FlightPathService.updateFlightSummary(id, summaryPayload);
        console.log(`${tag} UPDATE flights ← resultado`, {
          success: summaryResult.success,
          error: summaryResult.success ? null : summaryResult.error,
        });
        if (!summaryResult.success) {
          throw new Error(`UPDATE flights falló: ${summaryResult.error ?? "error desconocido"}`);
        }

        // 5) INSERT en flight_paths con el payload exacto.
        console.log(`${tag} INSERT flight_paths → payload`, {
          flightId: id,
          path_data: feature,
        });
        fileLogger.log(`${tag} INSERT flight_paths`, {
          flightId: id,
          points: feature.properties.point_count,
          phase: feature.properties.flight_phase,
        });
        const pathResult = await FlightPathService.saveFlightPath(id, feature);
        console.log(`${tag} INSERT flight_paths ← resultado`, {
          success: pathResult.success,
          error: pathResult.success ? null : pathResult.error,
        });
        if (!pathResult.success) {
          throw new Error(`INSERT flight_paths falló: ${pathResult.error ?? "error desconocido"}`);
        }

        // 5b) Capturar bonus ANTES de liberar: el reset del paso 6 pondría
        // todos los contadores en cero y la RPC recibiría 0 en todo (bug
        // reportado: payload en cero antes del envío). Solo en cierre normal.
        let capturedRpc: CompletionRpcBonuses | null = null;
        let capturedSynergy: string[] = [];
        let capturedNightFraction: number | null = null;
        let capturedDayNight = { dayHours: 0, nightHours: 0 };
        let capturedDestIcao = "";
        let capturedMetar: string | null = null;
        // Cierre de pasajeros (resumen + XP), calculado en 5b antes del reset.
        let paxCloseout: {
          summary: FlightPassengerSummary | null;
          baseTimeXp: number;
          bonus: number;
        } | null = null;
        if (status === "ended") {
          // Llamada única a la RPC unificada: disciplina operativa +
          // los 4 bonus de entorno/sinergia. Cada bonus es fail-closed
          // (0 ante cualquier duda) para no bloquear nunca el cierre.
          const tracker = xpBonusTrackerRef.current;
          const aiSynergy = tracker?.getAiSynergyBonus() ?? 0;
          // Noche por telemetría nativa (E:TIME OF DAY muestreado; >30%):
          // reemplaza la heurística de horario programado.
          const nightFlight = tracker?.getNightBonus() ?? 0;
          const dayNightHours = tracker?.getDayNightHours() ?? { dayHours: 0, nightHours: 0 };
          const destIcaoForBonus =
            (destICAO ?? "").toString().trim() ||
            (flightContextRef.current?.getFlight()?.destICAO ?? "").toString().trim();
          const destMetar =
            ((simbriefRawData as any)?.destination?.metar ?? null) as string | null;
          const [hardAirport, weatherSeverity] = await Promise.all([
            resolveHardAirportBonus(destIcaoForBonus).catch(() => 0),
            Promise.resolve(resolveWeatherSeverityBonus(destMetar)),
          ]);
          // Pasajeros: resumen final ANTES del reset del paso 6 (si se
          // calculara después, el engine ya estaría en cero). Bonus
          // proporcional al base con techo + piso (fail-closed → 0).
          try {
            const paxSummary = passengerEngineRef.current?.getSummary(id) ?? null;
            const paxBase = tracker?.getResults()?.base_time_xp ?? 0;
            paxCloseout = {
              summary: paxSummary,
              baseTimeXp: paxBase,
              bonus: resolvePassengerBonus(paxSummary?.overallScore ?? null, paxBase),
            };
          } catch {
            paxCloseout = null;
          }
          capturedRpc = {
            p_disc_taxi: tracker?.getTaxiBonus() ?? 0,
            p_disc_strobe: tracker?.getStrobeBonus() ?? 0,
            p_disc_landing: tracker?.getLandingBonus() ?? 0,
            p_disc_beacon: tracker?.getBeaconBonus() ?? 0,
            p_disc_speed: tracker?.getSpeedBonus() ?? 0,
            p_disc_climb: tracker?.getClimbBonus() ?? 0,
            p_disc_descent: tracker?.getDescentBonus() ?? 0,
            // Bonus de entorno/sinergia calculados en el Desktop.
            p_ai_synergy: aiSynergy,
            p_night_flight: nightFlight,
            p_hard_airport: hardAirport,
            p_weather_severity: weatherSeverity,
            // Multiplicador de campaña reservado al importar (1 = sin campaña).
            p_campaign_multiplier: campaignMatch?.xpMultiplier ?? 1,
            // Bonus de pasajeros (la RPC lo recorta sola si aún no lo acepta).
            p_passenger: paxCloseout?.bonus ?? 0,
          };
          capturedSynergy = tracker?.getSynergyEventKeys() ?? [];
          capturedNightFraction = tracker?.getNightFraction() ?? null;
          capturedDayNight = dayNightHours;
          capturedDestIcao = destIcaoForBonus;
          capturedMetar = destMetar;
          console.log(`${tag} bonus de cierre capturados (pre-reset)`, {
            aiSynergyEvents: capturedSynergy,
            p_ai_synergy: aiSynergy,
            nightFraction: capturedNightFraction,
            dayHours: dayNightHours.dayHours,
            nightHours: dayNightHours.nightHours,
            p_night_flight: nightFlight,
            destIcao: destIcaoForBonus,
            p_hard_airport: hardAirport,
            destMetar: destMetar ?? null,
            p_weather_severity: weatherSeverity,
            paxScore: paxCloseout?.summary?.overallScore ?? null,
            paxBaseTimeXp: paxCloseout?.baseTimeXp ?? 0,
            p_passenger: paxCloseout?.bonus ?? 0,
          });
          fileLogger.log(`${tag} bonus capturados (pre-reset)`, { flightId: id, ...capturedRpc });
          setXpCompletion({
            status: "pending",
            flightId: id,
            bonuses: toColumnBonusItems(capturedRpc),
            baseXpAwarded: null,
            totalFlightXp: null,
            campaignMultiplier: campaignMatch?.xpMultiplier ?? null,
            campaignXp: null,
          });
        }

        // 6) Todo persistido → liberar el buffer en memoria y el stash.
        // Fase 1 pasajeros (Q4: solo log local, nada a Supabase): resumen final
        // al archivo antes de descartar el estado en memoria. Se conserva en
        // estado para la pantalla de cierre (el engine se resetea).
        // En cierre normal además se persisten satisfacción + XP en `flights`
        // (migración de satisfacción; solo vuelos finalizados).
        try {
          const paxSummary = status === "ended" && paxCloseout
            ? paxCloseout.summary
            : passengerEngineRef.current?.getSummary(id) ?? null;
          if (paxSummary) {
            fileLogger.log("[Pasajeros] resumen final del vuelo", paxSummary);
            setPaxFinal(paxSummary);
          } else {
            setPaxFinal(null);
          }
          if (status === "ended" && paxSummary && paxCloseout) {
            try {
              const { error: paxPersistErr } = await supabase.from("flights").update({
                global_satisfaction: Math.round(paxSummary.overallScore),
                passenger_attributes_summary: toPassengerAttributesSummary(paxSummary.globalAttributeAverages),
                passenger_xp_awarded: paxCloseout.bonus,
              }).eq("id", id);
              if (paxPersistErr) {
                console.warn(`${tag} persistencia de satisfacción omitida:`, paxPersistErr.message);
                fileLogger.warn(`${tag} persistencia de satisfacción omitida`, { reason, error: paxPersistErr.message });
              } else {
                fileLogger.log(`${tag} satisfacción persistida`, {
                  flightId: id,
                  global_satisfaction: Math.round(paxSummary.overallScore),
                  passenger_xp_awarded: paxCloseout.bonus,
                });
              }
            } catch (paxPersistExc) {
              console.warn(`${tag} persistencia de satisfacción omitida:`, String(paxPersistExc));
            }
          }
        } catch (err) {
          console.warn(`${tag} resumen de pasajeros no disponible:`, err);
          setPaxFinal(null);
        }
        recorder.reset();
        xpBonusTrackerRef.current?.reset();
        passengerEngineRef.current?.reset();
        turbulenceRef.current?.reset();
        passengerLastTickMsRef.current = null;
        clearFlightPathStash();
        lastFlushErrorRef.current = null;
        console.log(`${tag} ✅ OK: vuelo cerrado (status=${status}) y buffer liberado`);
        fileLogger.log(`${tag} OK`, { reason, status, points: feature.properties.point_count });

        // 7) Progresión post-vuelo: solo en cierre normal ('ended'). Las
        // recuperaciones 'saved' no otorgan XP aquí para evitar doble
        // otorgamiento si el vuelo se finaliza después por la vía normal.
        if (status === "ended") {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            const userId = user?.id ?? null;
            if (!userId) {
              console.warn(`${tag} progresión omitida: sin usuario autenticado`);
              fileLogger.warn(`${tag} progresión omitida (sin usuario)`, { reason });
              setXpCompletion({
                status: "error",
                flightId: id,
                bonuses: capturedRpc ? toColumnBonusItems(capturedRpc) : [],
                baseXpAwarded: null,
                totalFlightXp: null,
                campaignMultiplier: campaignMatch?.xpMultiplier ?? null,
                campaignXp: null,
                error: "Sin usuario autenticado: no se pudo otorgar XP.",
              });
            } else if (!capturedRpc) {
              // No debería ocurrir (se captura en 5b); sin valores no se llama.
              console.warn(`${tag} progresión omitida: sin bonus capturados`);
              fileLogger.warn(`${tag} progresión omitida (sin captura)`, { reason });
              setXpCompletion({
                status: "error",
                flightId: id,
                bonuses: [],
                baseXpAwarded: null,
                totalFlightXp: null,
                campaignMultiplier: campaignMatch?.xpMultiplier ?? null,
                campaignXp: null,
                error: "No se pudieron capturar los bonus antes del cierre.",
              });
            } else {
              console.log(`${tag} RPC process_flight_completion (unificada) → params`, {
                flightId: id,
                ...capturedRpc,
              });
              const rewardResult = await FlightPathService.processFlightCompletion(id, userId, capturedRpc);
              if (rewardResult.success && rewardResult.data) {
                const reward = rewardResult.data;
                console.log(
                  `${tag} 🎖️ XP ganada en el vuelo: +${reward.baseXpAwarded} XP base ` +
                  `(vuelo ${reward.totalFlightXp} XP · total ${reward.newTotalXp} XP` +
                  `${reward.newLevel !== null ? `, nivel ${reward.newLevel}` : ""}` +
                  `${reward.newRank ? `, rango ${reward.newRank}` : ""})`
                );
                fileLogger.log(`${tag} progresión`, { flightId: id, ...reward });
                setXpCompletion({
                  status: "done",
                  flightId: id,
                  bonuses: toColumnBonusItems(capturedRpc),
                  baseXpAwarded: reward.baseXpAwarded,
                  totalFlightXp: reward.totalFlightXp,
                  campaignMultiplier: campaignMatch?.xpMultiplier ?? null,
                  campaignXp: reward.campaignXpAwarded > 0 ? reward.campaignXpAwarded : null,
                });
                showToast(
                  `Vuelo completado: +${reward.totalFlightXp} XP ` +
                  `(${reward.baseXpAwarded} base)` +
                  (reward.campaignXpAwarded > 0 && campaignMatch
                    ? ` · Campaña ${formatMultiplier(campaignMatch.xpMultiplier)} (+${reward.campaignXpAwarded})`
                    : "") +
                  `${reward.newRank ? ` · Rango ${reward.newRank}` : ""}`,
                  "success"
                );
              } else {
                console.warn(`${tag} progresión falló (no bloqueante):`, rewardResult.error);
                fileLogger.warn(`${tag} progresión falló`, { reason, error: rewardResult.error });
                setXpCompletion({
                  status: "error",
                  flightId: id,
                  bonuses: toColumnBonusItems(capturedRpc),
                  baseXpAwarded: null,
                  totalFlightXp: null,
                  campaignMultiplier: campaignMatch?.xpMultiplier ?? null,
                  campaignXp: null,
                  error: rewardResult.error ?? "La RPC no devolvió recompensa.",
                });
              }
            }
          } catch (progErr) {
            // La progresión nunca debe romper el cierre ya persistido.
            console.warn(`${tag} excepción en progresión (no bloqueante):`, progErr);
            fileLogger.warn(`${tag} excepción en progresión`, { reason, error: String(progErr) });
            setXpCompletion({
              status: "error",
              flightId: id,
              bonuses: capturedRpc ? toColumnBonusItems(capturedRpc) : [],
              baseXpAwarded: null,
              totalFlightXp: null,
              campaignMultiplier: campaignMatch?.xpMultiplier ?? null,
              campaignXp: null,
              error: progErr instanceof Error ? progErr.message : String(progErr),
            });
          }
        }
        return true;
      } catch (err) {
        // Blindaje: el buffer se conserva para reintentar; nunca se limpia en fallo.
        const full = err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { value: String(err) };
        console.error(`${tag} ❌ FALLO (buffer conservado, reintentable):`, full);
        fileLogger.warn(`${tag} FALLO (buffer conservado)`, { reason, ...full });
        lastFlushErrorRef.current = full.message ?? String(err);
        if (String(full.message ?? "").includes("row-level security")) {
          const hint =
            `${tag} pista RLS: Supabase rechazó la escritura. ` +
            `Revisá las policies de INSERT/UPDATE en flight_paths y flights para el rol authenticated.`;
          console.warn(hint);
          fileLogger.warn(hint, { reason });
        }
        return false;
      }
    };

    // Serializar: cada disparo espera al anterior sin pisarlo.
    const chained = flushChainRef.current.then(run, run);
    flushChainRef.current = chained.catch(() => false);
    return chained;
  };

  // Botón "Finalizar Vuelo": persiste el recorrido y recién después resetea la
  // UI. El `await` garantiza que onResetSimulation (que puede desmontar /
  // limpiar estado) NUNCA corre antes de que Supabase responda.
  const handleFinalizarVuelo = async (): Promise<void> => {
    console.log("[FLUSH_DEBUG:finalizar-vuelo] botón Finalizar pulsado; esperando flush antes del reset");
    fileLogger.log("[FLUSH_DEBUG:finalizar-vuelo] botón pulsado");
    try {
      await flushFlightPath("finalizar-vuelo");
    } finally {
      console.log("[FLUSH_DEBUG:finalizar-vuelo] flush terminado (ok o fallo); reseteando UI");
      onResetSimulation();
    }
  };

  /**
   * Safety recovery ante desconexión del simulador con vuelo activo.
   * Fases avanzadas (o vuelo que ya despegó) → volcado automático con estado
   * 'saved' + nota de emergencia, y se reanuda un segmento nuevo por si la
   * telemetría vuelve. Fases tempranas en tierra → se descarta sin ensuciar
   * el historial.
   */
  const wasConnectedRef = useRef<boolean>(true);  const handleSimDisconnect = async (): Promise<void> => {
    const tag = "[FLUSH_DEBUG:safety-recovery]";
    const recorder = flightPathRecorderRef.current;
    if (!recorder || !recorder.isRecording() || recorder.getPointCount() === 0) {
      console.log(`${tag} desconexión sin vuelo activo grabando: nada que recuperar`);
      fileLogger.log(`${tag} desconexión sin grabación activa`, {});
      return;
    }
    const phase = recorder.getPhase();
    const advanced = phase !== null && RECOVERY_PHASE_SET.has(phase);
    const airborne = recorder.getTakeoffMs() !== null;
    console.log(`${tag} desconexión con vuelo activo`, {
      points: recorder.getPointCount(),
      phase,
      advanced,
      airborne,
    });
    fileLogger.log(`${tag} desconexión con vuelo activo`, {
      points: recorder.getPointCount(),
      phase,
    });
    if (!advanced && !airborne) {
      console.log(`${tag} fase temprana en tierra: se descarta sin guardar`);
      fileLogger.log(`${tag} descarte en fase temprana`, { phase });
      recorder.reset();
      xpBonusTrackerRef.current?.reset();
      passengerEngineRef.current?.reset();
      turbulenceRef.current?.reset();
      passengerLastTickMsRef.current = null;
      return;
    }
    // Congelar el segmento, volcar como 'saved' y reanudar por si vuelve la señal.
    const scenarioKey = recorder.getScenarioKey();
    recorder.stop();
    const ok = await flushFlightPath("safety-recovery", {
      status: "saved",
      recoveryNote:
        `Guardado por recuperación de emergencia ante desconexión del simulador ` +
        `(fase ${phase ?? "desconocida"}).`,
    });
    if (ok) {
      console.log(`${tag} segmento de emergencia guardado; se reanuda la grabación por si vuelve la señal`);
      fileLogger.log(`${tag} reanudando grabación tras recovery`, { phase });
      recorder.start({ phase, scenarioKey });
      // El reinicio limpia las muestras del segmento, pero la sinergia IA
      // es acumulada del vuelo: se preserva para el cierre 'ended'.
      const synergyKept = xpBonusTrackerRef.current?.getSynergyEventKeys() ?? [];
      xpBonusTrackerRef.current?.start();
      synergyKept.forEach((key) => xpBonusTrackerRef.current?.noteVoiceEvent(key));
      xpBonusTrackerRef.current?.setAirMinutesProvider(
        () => flightPathRecorderRef.current?.getAirMinutes() ?? null
      );
    } else {
      console.warn(`${tag} no se pudo guardar el segmento (buffer conservado para reintento manual)`);
    }
  };

  useEffect(() => {
    const unsub = connectionStatusService.onStatusChange((status) => {
      const was = wasConnectedRef.current;
      wasConnectedRef.current = status.connected;
      if (was && !status.connected) {
        console.log("[FLUSH_DEBUG:safety-recovery] transición connected → disconnected detectada");
        fileLogger.log("[FLUSH_DEBUG:safety-recovery] desconexión detectada", { status });
        void handleSimDisconnect();
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Stash de emergencia ante cierres abruptos de la app: en `beforeunload` se
   * guarda una foto sincrónica del buffer; al montar se intenta volcar una
   * sola vez como recuperación y se limpia el stash (haya éxito o no, para no
   * reintentar en cada arranque).
   */
  useEffect(() => {
    const onBeforeUnload = (): void => {
      try {
        const recorder = flightPathRecorderRef.current;
        const id = flightIdRef.current;
        if (recorder && id && recorder.getPointCount() > 0) {
          localStorage.setItem(
            FLIGHT_PATH_STASH_KEY,
            JSON.stringify({ flightId: id, snapshot: recorder.toSnapshot(), at: new Date().toISOString() })
          );
          console.log("[FLUSH_DEBUG:stash] buffer guardado en stash ante cierre");
        } else {
          localStorage.removeItem(FLIGHT_PATH_STASH_KEY);
        }
      } catch {
        // cierre abrupto: mejor esfuerzo, nunca bloquear
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(FLIGHT_PATH_STASH_KEY);
      } catch {
        return;
      }
      if (!raw) return;
      try {
        const stash = JSON.parse(raw) as {
          flightId?: string;
          snapshot?: {
            points?: unknown[];
            phase?: string | null;
            scenarioKey?: string | null;
            startedAtIso?: string | null;
            endedAtIso?: string | null;
            takeoffMs?: number | null;
            touchdownMs?: number | null;
            lastRecordedAtMs?: number | null;
          };
        };
        const points = stash?.snapshot?.points;
        if (!stash?.flightId || !Array.isArray(points) || points.length === 0) {
          clearFlightPathStash();
          return;
        }
        console.log("[FLUSH_DEBUG:boot-recovery] stash previo encontrado; intentando volcado", {
          flightId: stash.flightId,
          points: points.length,
        });
        fileLogger.log("[FLUSH_DEBUG:boot-recovery] stash encontrado", {
          flightId: stash.flightId,
          points: points.length,
        });
        flightIdRef.current = stash.flightId;
        flightPathRecorderRef.current?.loadSnapshot({
          points: points as import("../services/FlightPathRecorder").FlightPathPoint[],
          phase: stash.snapshot?.phase ?? null,
          scenarioKey: stash.snapshot?.scenarioKey ?? null,
          startedAtIso: stash.snapshot?.startedAtIso ?? null,
          endedAtIso: stash.snapshot?.endedAtIso ?? null,
          takeoffMs: stash.snapshot?.takeoffMs ?? null,
          touchdownMs: stash.snapshot?.touchdownMs ?? null,
          lastRecordedAtMs: stash.snapshot?.lastRecordedAtMs ?? null,
        });
        if (!cancelled) {
          await flushFlightPath("boot-recovery", {
            status: "saved",
            recoveryNote: "Guardado por recuperación de emergencia al reiniciar la app tras un cierre inesperado.",
          });
        }
      } catch (err) {
        console.warn("[FLUSH_DEBUG:boot-recovery] stash ilegible, se descarta:", err);
      } finally {
        if (!cancelled) clearFlightPathStash();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to Scheduler phase events (Fase 0 GATE -> BOARDING flow)
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;

    const unsubGate = scheduler.on("phase:gate:entered", () => {
      console.log("[UI] phase:gate:entered -> mostrando 'Comenzar embarque'");
      setFlightPhase("GATE");
      setStepperCurrentPhase("GATE");
    });
    const unsubBoarding = scheduler.on("phase:boarding:started", () => {
      console.log("[UI] phase:boarding:started -> embarque en curso");
      setFlightPhase("BOARDING");
      setBoardingStarted(true);
      setStepperCurrentPhase("BOARDING");
    });

    // Fase actual gobernada por el Scheduler/FlightFSM (transiciones reales).
    const unsubPhaseChanged = scheduler.on("phase:changed", (payload) => {
      const phase = (payload as { phase?: string })?.phase;
      if (!phase) return;
      // GATE y BOARDING no transicionan el FlightState: el flujo existente
      // (phase:gate:entered / phase:boarding:started) ya las maneja.
      if (phase === "GATE" || phase === "BOARDING") return;
      console.log(`[UI] phase:changed -> ${phase}`);
      setStepperCurrentPhase(phase);
      const mapped = phaseToSubStage(phase);
      setCurrentSubStage(mapped.subStage);
      if (mapped.state !== FlightState.NoIniciado && mapped.state !== currentStateRef.current) {
        onStateChangeRef.current(mapped.state);
      }
      // Gatillo automático: al llegar a AT_GATE se persiste el recorrido.
      // Se loguea el disparo SIEMPRE (aunque el flush decida no-op) para que
      // un trigger que nunca llega sea visible en consola.
      if (phase === "AT_GATE") {
        console.log("[FLUSH_DEBUG:at_gate] trigger AT_GATE detectado; disparando flush");
        fileLogger.log("[FLUSH_DEBUG:at_gate] trigger AT_GATE detectado", { phase });
        void flushFlightPath("at_gate");
      }
    });

    return () => {
      unsubGate(); unsubBoarding(); unsubPhaseChanged();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to NarrativeOrchestrator events (modo pruebas: avance manual)
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    const orchestrator = scheduler.getNarrativeOrchestrator();

    const unsubPending = orchestrator.on("step:pending", (payload) => {
      const data = payload as StepPendingEvent;
      console.log(
        `[UI] step:pending -> ${data.step.eventKey} (${data.index + 1}/${data.total})`
      );
      setPendingManualStep(data.step);
      setStepIndex(data.index);
      setStepTotal(data.total);
    });

    const unsubExecuted = orchestrator.on("step:executed", (payload) => {
      const data = payload as StepExecutedEvent;
      console.log(
        `[UI] step:executed -> ${data.step.eventKey} (modo: ${data.mode})`
      );
      // Contador en memoria para el bonus de sinergia IA (3 XP por evento
      // del conjunto, solo ejecutados — nunca omitidos ni pendientes).
      xpBonusTrackerRef.current?.noteVoiceEvent(data.step.eventKey);
      setPendingManualStep((prev) =>
        prev && prev.eventKey === data.step.eventKey ? null : prev
      );
      setStepHistory((prev) => [
        ...prev,
        {
          step: data.step,
          index: data.index,
          mode: data.mode,
          timestamp: new Date().toLocaleTimeString("es-ES", { hour12: false }),
        },
      ]);
    });

    const unsubSkipped = orchestrator.on("step:skipped", (payload) => {
      const data = payload as StepSkippedEvent;
      console.log(`[UI] step:skipped -> ${data.step.eventKey}`);
      setPendingManualStep((prev) =>
        prev && prev.eventKey === data.step.eventKey ? null : prev
      );
      setStepHistory((prev) => [
        ...prev,
        {
          step: data.step,
          index: data.index,
          mode: "skipped",
          timestamp: new Date().toLocaleTimeString("es-ES", { hour12: false }),
        },
      ]);
    });

    const unsubCompleted = orchestrator.on("scenario:completed", () => {
      console.log("[UI] scenario:completed");
      setPendingManualStep(null);
      setBoardingStepsDone(true);
    });

    const unsubClear = orchestrator.on("step:clear", () => {
      console.log("[UI] step:clear -> escenario cambiado");
      setPendingManualStep(null);
      setStepIndex(0);
      setStepTotal(0);
      setBoardingStepsDone(false);
      // El historial pertenece al escenario actual: al cambiar de escenario
      // (p. ej. GATE -> BOARDING) se resetea para no mezclar pasos.
      setStepHistory([]);
    });

    // Sinergia IA en el punto único de reproducción: la cola acepta TODO el
    // audio (pasos narrativos, phase-rules, fallbacks y disparos manuales),
    // mientras `step:executed` solo cubre la vía narrativa. Deduplicado en el
    // tracker (Set), así ambas suscripciones pueden convivir.
    const unsubEnqueued = announcementQueueRef.current?.on("announcement:enqueued", (eventKey: string) => {
      xpBonusTrackerRef.current?.noteVoiceEvent(eventKey);
    });

    // Fase 1 pasajeros (Q1): el efecto se cobra al COMPLETAR la reproducción,
    // no al encolar. La cola ahora propaga la clave (null si se canceló antes
    // de empezar: se ignora). Cubre todas las vías igual que la sinergia XP.
    const unsubPaxCompleted = announcementQueueRef.current?.on("announcement:completed", (eventKey: string | null) => {
      if (typeof eventKey !== "string" || eventKey === "") return;
      try {
        // Traza anti-doble-cobro: cada aplicación queda con timestamp para
        // auditar en consola si un anuncio se cobra más de una vez.
        console.log("[Pasajeros] aplicando efectos:", eventKey);
        const applied = passengerEngineRef.current?.applyAnnouncementEffects(getEventEffects(eventKey), eventKey);
        fileLogger.log("[Pasajeros] efectos aplicados", { eventKey, mitigated: applied?.mitigated ?? false });
        // Mitigación exitosa dentro de la ventana (p. ej. cinturones tras
        // turbulencia): etiqueta positiva transitoria. Si el evento expiró,
        // el silencio es la señal (sin etiqueta).
        if (applied?.mitigated === true) {
          flashPax(TURBULENCE_MITIGATED_FLASH_TEXT, "pos");
        }
      } catch (err) {
        console.warn("[VueloActualView] Error aplicando efectos de pasajeros:", err);
      }
    });

    return () => {
      unsubPending();
      unsubExecuted();
      unsubSkipped();
      unsubCompleted();
      unsubClear();
      unsubEnqueued?.();
      unsubPaxCompleted?.();
    };
  }, []);

  // Keep TimerManager flight context in sync
  useEffect(() => {
    timerManagerRef.current?.setEventContext(flightId, captainPrimaryLang);
  }, [flightId, captainPrimaryLang]);

  // Fase 1 pasajeros: snapshot agregado 1Hz para el panel (no 10Hz, la UI no
  // necesita más). Lee el engine directo; si no hay muestra, panel apagado.
  useEffect(() => {
    const id = setInterval(() => {
      const engine = passengerEngineRef.current;
      if (engine?.isStarted()) {
        setPaxStarted(true);
        setPaxAverages(engine.getAverages());
      } else {
        setPaxStarted(false);
        setPaxAverages(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // TODO Migration:
  //
  // Legacy boarding announcement flow.
  // Disabled after FlightFSM became the source of truth.
  // Stage 18A.1 (Handover): the narrative is now governed by
  // FlightFSM -> Scheduler -> Scenario -> Narrative -> Dispatcher.
  React.useEffect(() => {
    if (currentState !== FlightState.PreEmbarque) return;

    const player = announcementPlayerRef.current!;

    (async () => {
      const gateSoonMode = eventConfig["gate_crew_start_soon"];
      const gateStartedMode = eventConfig["gate_crew_started"];
      const shouldPlaySoon = gateSoonMode === "IA";
      const shouldPlayStarted = gateStartedMode === "IA";

      if (shouldPlaySoon) {
        // player.play("gate_crew_start_soon").catch(() => {});
        void player;
      }

      // Step 2: Wait 30 seconds
      await new Promise((resolve) => setTimeout(resolve, 30000));

      if (shouldPlayStarted) {
        // player.play("gate_crew_started").catch(() => {});
      }
    })();

    return () => {
      announcementQueueRef.current?.clear();
    };
  }, [currentState]);

  // Sync current FSM state to FlightContext
  useEffect(() => {
    flightContextRef.current?.updateFSM({ currentState });
  }, [currentState]);

  useEffect(() => {
      let cancelled = false;
    (async () => {
      setLanguagesLoading(true);
      try {
        const { data, error } = await supabase.from("languages").select("id, language_name");
        if (error) throw error;
        if (cancelled) return;
        const mapped = (data || []).map((l: any) => ({ id: l.id, name: l.language_name }));
        if (mapped.length > 0) {
          setLanguageOptions(mapped);
          setCaptainPrimaryLang((prev) => (prev === "" || !mapped.find((l) => l.id === prev)) ? mapped[0].id : prev);
          setCaptainSecondaryLang((prev) => (prev === "" || !mapped.find((l) => l.id === prev)) ? LANG_NONE : prev);
        }
        setLanguagesReady(true);
      } catch (e: any) {
        if (!cancelled) {
          setLanguageError(e?.message || "Error al cargar idiomas");
        }
      } finally {
        if (!cancelled) setLanguagesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cargar preferencias de Personal de Vuelo desde setting_general (persistencia entre sesiones)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: settings, error } = await supabase
          .from("setting_general")
          .select("language_id, captain_voice_id, crew_voice_id, gate_agent_voice_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled || error) {
          if (error) console.warn("[VueloActualView] setting_general load error:", error.message);
          return;
        }
        if (!settings) {
          console.log("[VueloActualView] setting_general sin fila, usando valores por defecto");
          return;
        }

        console.log("[VueloActualView] setting_general cargado (Personal de Vuelo):", settings);

        // Pre-seleccionar en los selectores si existen y son válidos.
        // No pisar lo que el usuario ya eligió en "Volar" (la respuesta de
        // setting_general puede llegar después de su selección).
        if (settings.language_id && !userPickedRef.current.lang) {
          setCaptainPrimaryLang(settings.language_id);
          console.log("[VueloActualView] language_id pre-seleccionado:", settings.language_id);
        }
        if (settings.captain_voice_id && !userPickedRef.current.captain) {
          setCaptainVoice(settings.captain_voice_id);
          console.log("[VueloActualView] captain_voice_id pre-seleccionado:", settings.captain_voice_id);
        }
        if (settings.crew_voice_id && !userPickedRef.current.crew) {
          setCrewVoice(settings.crew_voice_id);
          console.log("[VueloActualView] crew_voice_id pre-seleccionado:", settings.crew_voice_id);
        }
        if (settings.gate_agent_voice_id && !userPickedRef.current.gate) {
          setGateAgentVoiceId(settings.gate_agent_voice_id);
          console.log("[VueloActualView] gate_agent_voice_id pre-seleccionado:", settings.gate_agent_voice_id);
        }
      } catch (err) {
        console.warn("[VueloActualView] Error cargando setting_general:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const langOptions = languageOptions;

  function getLangName(id: string): string {
    return langOptions.find((l) => l.id === id)?.name || id;
  }

  // Whether the user's configured primary language is English
  const isLangEnglish = (() => {
    const name = getLangName(captainPrimaryLang).toLowerCase();
    return name.includes("inglés") || name === "english (us)" || name === "english (uk)";
  })();

  useEffect(() => {
    if (currentState !== FlightState.PreEmbarque) {
      setShowSecondaryLang(false);
      return;
    }
    const hasSecondary = captainSecondaryLang !== LANG_NONE && getLangName(captainSecondaryLang) !== getLangName(captainPrimaryLang);
    if (!hasSecondary) {
      setShowSecondaryLang(false);
      return;
    }

    const interval = setInterval(() => {
      setShowSecondaryLang((prev) => !prev);
    }, 30000);

    return () => clearInterval(interval);
  }, [currentState, captainPrimaryLang, captainSecondaryLang]);

  // Alternating bilingual display for GateMonitor (15s cycle with fade)
  React.useEffect(() => {
    let fadeTimeout: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setLabelOpacity(0);
      fadeTimeout = setTimeout(() => {
        setShowEnglish(prev => !prev);
        setLabelOpacity(1);
      }, 500);
    }, 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimeout);
    };
  }, []);

  // Block 2: Eventos Especiales
  const [specialEvents, setSpecialEvents] = useState<string>("");
  const [specialEventEnabled, setSpecialEventEnabled] = useState<boolean>(false);

  // Block 3: Plan de Cabina
  // 1) Gastronomía
  const [foodService, setFoodService] = useState<boolean>(true);
  const [breakfastService, setBreakfastService] = useState<boolean>(false);
  const [snacksService, setSnacksService] = useState<boolean>(true);
  const [cateringType, setCateringType] = useState<"cortesia" | "venta">("cortesia");

  // 2) Ventas y Promociones
  const [dutyFree, setDutyFree] = useState<boolean>(false);
  const [frequentFlyer, setFrequentFlyer] = useState<boolean>(true);

  // 3) Confort y Procedimientos
  const [wifiAnnouncement, setWifiAnnouncement] = useState<boolean>(true);
  const [customsForms, setCustomsForms] = useState<boolean>(false);

  // 4) Estilo de Comunicación
  const [communicationStyle, setCommunicationStyle] = useState<number>(1);
  
  // 7 new Immersion configs with checkbox/toggle variables
  const [immersionConfig, setImmersionConfig] = useState<Record<string, boolean>>({
    play_chime_sound_before_ann: true,
    play_ambient_sound_during_flight: true,
    crew_greeting_passengers_at_gate: true,
    passenger_reaction_to_planes_movement: true,
    play_passenger_reaction_during_landing: true,
    play_boarding_music: true,
    speed_kph: true,
  });

  // Ritmo de embarque (pax/min): default global del piloto (Settings →
  // `setting_general.boarding_pax_per_minute` / localStorage) + override
  // opcional por vuelo (null = usar el global).
  const [boardingPaceGlobal, setBoardingPaceGlobal] = useState<number>(BOARDING_PACE_DEFAULT_PPM);
  const [boardingPaceOverride, setBoardingPaceOverride] = useState<number | null>(null);
  const effectiveBoardingPace = boardingPaceOverride ?? boardingPaceGlobal;
  /** Acumulador fraccionario de pasajeros entre ticks de 1s. */
  const boardingCarryRef = useRef<number>(0);

  interface ImmersionOption {
    key: string;
    briefKey: string;
    deepKey: string;
    defaultVal: boolean;
  }

  // Inmersión pre-vuelo: solo opciones activas (música de embarque + tarjeta
  // de ritmo, esta última render aparte). El resto eran mockups y se
  // eliminaron de la UI (la config conserva sus defaults).
  const immersionOptions: ImmersionOption[] = [
    {
      key: "play_boarding_music",
      briefKey: "current_flight.not_started.immersion.music.brief",
      deepKey: "current_flight.not_started.immersion.music.deep",
      defaultVal: true
    }
  ];

  // 33 Active attributes with user preset values
  const [eventConfig, setEventConfig] = useState<Record<string, EventSwitchValue>>({
    gate_crew_start_soon: "OFF",
    gate_crew_started: "IA",
    common_crew_boarding: "IA",
    preflight_crew_welcome: "IA",
    preflight_capt_welcome: "IA",
    preflight_capt_delay: "IA",
    preflight_capt_basic_info: "IA",
    preflight_crew_basic_info: "OFF",
    taxi_capt_armdoors: "IA",
    taxi_crew_safety_brief: "IA",
    taxi_capt_dimlights: "OFF",
    taxi_crew_dimlights: "OFF",
    takeoff_capt_prepare: "IA",
    climb_crew_upcoming_service: "IA",
    cruise_capt_general_info: "IA",
    cruise_crew_service_info1: "IA",
    cruise_crew_service_info2: "OFF",
    cruise_crew_shopping_info: "OFF",
    cruise_crew_customs_forms: "OFF",
    cruise_crew_service_info3: "OFF",
    descent_capt_close_desc: "IA",
    descent_capt_upcoming_actions: "IA",
    descent_crew_upcoming_actions: "IA",
    descent_capt_10kfeet: "OFF",
    descent_crew_landing_fewmin: "IA",
    final_capt_take_seats: "IA",
    taxitogate_crew_welcome: "IA",
    taxitogate_crew_ramining_seating: "IA",
    taxitogate_crew_delay_apologies: "IA",
    atgate_capt_disarm_doors: "IA",
    atgate_crew_deboarding: "IA",
    common_capt_seatbelt: "IA",
    common_crew_seatbelt: "IA"
  });

  const [userId, setUserId] = useState<string | null>(null);
  const [simbriefId, setSimbriefId] = useState<string | null>(null);
  const [isFetchingSimbrief, setIsFetchingSimbrief] = useState<boolean>(false);
  const [simbriefRawData, setSimbriefRawData] = useState<any>(null);
  const [simbriefError, setSimbriefError] = useState<string | null>(null);
  // Datos de aeronave resueltos contra aircraft_types (una sola vez por importación).
  const [simbriefAircraft, setSimbriefAircraft] = useState<{ icao: string; isWidebody: boolean; displayName: string } | null>(null);
  // Aeropuertos resueltos contra la tabla `airports` de Supabase (caché 7 días).
  // El fallback síncrono sigue siendo `airportMapping.ts` (ver buildFlightDataForContext).
  const [resolvedAirports, setResolvedAirports] = useState<{ origin: CachedAirport | null; dest: CachedAirport | null }>({
    origin: null,
    dest: null,
  });

  // Load voices from DB — two-step query (more robust than FK join)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setVoicesLoading(true);
      if (!userId) return;
      try {
        const { data: userVoices, error: voicesError } = await supabase
          .from('voices')
          .select('voicestock_id')
          .eq('user_id', userId)
          .eq('voice_enabled', true);
        if (voicesError) throw voicesError;
        if (cancelled) return;

        const stockIds = (userVoices || []).map((v: any) => v.voicestock_id);

        let mapped: VoiceOption[] = [];
        if (stockIds.length > 0) {
          let stockResult: any = await supabase
            .from('voices_stock')
            .select('id, voice_name, voice_role, languages')
            .in('id', stockIds);
          if (stockResult.error) {
            // Schema sin columna `languages`: reintentar sin ella.
            stockResult = await supabase
              .from('voices_stock')
              .select('id, voice_name, voice_role')
              .in('id', stockIds);
          }
          if (stockResult.error) throw stockResult.error;
          if (cancelled) return;
          // Tags de idioma por voz: la columna `voices_stock.languages` puede
          // no existir (400 en el log) o venir vacía; la fuente canónica es la
          // tabla `voice_languages` (voice_id → language_id). Sin tags, cada
          // voz vale para cualquier idioma y la re-sincronización conserva una
          // voz española con texto inglés (TTS con acento cruzado) o el
          // servidor resuelve un pregrabado inexistente (404).
          let langTags = new Map<string, string[]>();
          try {
            const { data: vl, error: vlErr } = await supabase
              .from('voice_languages')
              .select('voice_id, language_id')
              .in('voice_id', stockIds);
            if (!vlErr && Array.isArray(vl)) {
              for (const row of vl as any[]) {
                if (!row?.voice_id || !row?.language_id) continue;
                const list = langTags.get(row.voice_id) ?? [];
                if (!list.includes(row.language_id)) list.push(row.language_id);
                langTags.set(row.voice_id, list);
              }
            }
          } catch {
            // Tabla opcional: se sigue con los tags de la columna si existen.
          }
          if (cancelled) return;
          mapped = (stockResult.data || []).map((vs: any) => {
            const colTags: string[] = Array.isArray(vs.languages)
              ? vs.languages
              : vs.languages
                ? [vs.languages]
                : [];
            const joinTags = langTags.get(vs.id) ?? [];
            const merged = [...colTags];
            for (const t of joinTags) if (!merged.includes(t)) merged.push(t);
            if (merged.length === 0) {
              console.warn(
                "[VueloActualView] Voz sin idiomas etiquetados (vale para cualquiera):",
                { id: vs.id, name: vs.voice_name, role: vs.voice_role }
              );
            }
            return {
              id: vs.id,
              name: vs.voice_name,
              role: vs.voice_role,
              languages: merged,
            };
          });
        }
        if (mapped.length > 0) {
          setAvailableVoices(mapped);
        }
        setVoicesReady(true);
      } catch (e: any) {
        if (!cancelled) {
          setVoiceError(e?.message || "Error al cargar voces");
        }
      } finally {
        if (!cancelled) setVoicesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (cancelled || authErr || !user) return;
      setUserId(user.id);

      const { data: userData, error: userErr } = await supabase
        .from("users")
        .select("simbrief_pilot_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled && !userErr && userData?.simbrief_pilot_id) {
        setSimbriefId(userData.simbrief_pilot_id);
      }

      const userDefaultScenario = await ScenarioConfigService.getUserDefaultScenario(user.id);
      const userScenarioKey = userDefaultScenario.data ?? NORMAL_SCENARIO_KEY;
      if (!cancelled) {
        setSelectedScenarioKey(userScenarioKey);
      }

      const scenarioListResult = await ScenarioConfigService.listActiveScenarios();
      if (!cancelled && scenarioListResult.success && scenarioListResult.data.length > 0) {
        setScenarios(scenarioListResult.data);
      }

      const genResult = await supabase.from("setting_general").select("*").eq("user_id", user.id).maybeSingle();
      if (cancelled) return;

      if (genResult.data) {
        const d = genResult.data;
        const immKeys: Record<string, string> = {
          play_chime_sound_before_ann: "play_chime_sound_before_ann",
          play_ambient_sound_during_flight: "play_ambient_sound_during_flight",
          crew_greeting_passengers_at_gate: "crew_greeting_passengers_at_gate",
          passenger_reaction_to_planes_movement: "passenger_reaction_to_planes_movement",
          play_passenger_reaction_during_landing: "play_passenger_reaction_during_landing",
          play_boarding_music: "play_boarding_music",
          speed_kph: "speed_kph",
        };
        const newImm: Record<string, boolean> = {};
        let immChanged = false;
        for (const [stateKey, dbCol] of Object.entries(immKeys)) {
          if ((d as any)[dbCol] != null) {
            newImm[stateKey] = Boolean((d as any)[dbCol]);
            immChanged = true;
          }
        }
        if (immChanged) {
          setImmersionConfig(prev => ({ ...prev, ...newImm }));
        }
        if ((d as any).active_package != null) {
          setSelectedPackage((d as any).active_package);
        }
        // Versión de música en vuelo (columna nueva, migración 20261007) con
        // fallback a localStorage (Settings guarda ahí siempre).
        if ((d as any).boarding_music_distortion != null) {
          setBoardingMusicProcessed(Boolean((d as any).boarding_music_distortion));
        } else {
          try {
            const stored = localStorage.getItem("cfg_boarding_music_distortion");
            if (stored != null) setBoardingMusicProcessed(stored !== "false");
          } catch {
            // almacenamiento no disponible: queda procesada (default)
          }
        }
        // Fuente de música global (`ia` | `pack`; default `ia`).
        if ((d as any).boarding_music_source != null) {
          setBoardingAudioSourceGlobal(toBoardingAudioSource((d as any).boarding_music_source));
        } else {
          try {
            const storedSource = localStorage.getItem(BOARDING_AUDIO_SOURCE_STORAGE_KEY);
            if (storedSource != null) setBoardingAudioSourceGlobal(toBoardingAudioSource(storedSource));
          } catch {
            // almacenamiento no disponible: queda `ia`
          }
        }
        // Ritmo de embarque global: columna nueva (migración 20261007) con
        // fallback a localStorage (Settings guarda ahí siempre).
        if ((d as any).boarding_pax_per_minute != null) {
          setBoardingPaceGlobal(clampBoardingPace((d as any).boarding_pax_per_minute));
        } else {
          try {
            const stored = localStorage.getItem(BOARDING_PACE_STORAGE_KEY);
            if (stored != null) setBoardingPaceGlobal(clampBoardingPace(Number(stored)));
          } catch {
            // almacenamiento no disponible: queda el default (60 pax/min)
          }
        }
        if ((d as any).gate_agent_voice_id != null && !userPickedRef.current.gate) {
          setGateAgentVoiceId((d as any).gate_agent_voice_id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Carga las pistas de música ambiental activas desde `boarding_music`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMusicTracksLoading(true);
      const result = await BoardingMusicService.listActiveTracks();
      if (cancelled) return;
      if (result.success && result.data) {
        setMusicTracks(result.data);
        // Migración retrocompatible: un nombre de pista guardado (esquema
        // anterior) se convierte al id de la pista correspondiente.
        setBoardingMusicTrackId((prev) => {
          if (!prev || prev === RANDOM_MUSIC_ID) return prev;
          if (result.data!.some((track) => track.id === prev)) return prev;
          const byName = result.data!.find((track) => track.name === prev);
          return byName ? byName.id : "";
        });
      } else {
        console.warn("[VueloActualView] No se pudieron cargar las pistas de música:", result.error);
      }
      if (!cancelled) setMusicTracksLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Carga la configuración de música ambiental del vuelo
  // (`flight_setting_announcements.boarding_music_enabled / _id`).
  // Si el vuelo no tiene una pista explícita, se hereda la selección previa
  // al vuelo del usuario (`setting_general.song_boarding_music`).
  useEffect(() => {
    if (!flightId) return;
    let cancelled = false;
    musicSettingsLoadedRef.current = false;
    (async () => {
      const result = await BoardingMusicService.loadForFlight(flightId);
      if (cancelled) return;
      if (result.success && result.data) {
        const { enabled, musicId } = result.data;
        setImmersionConfig((prev) => ({ ...prev, play_boarding_music: enabled }));
        if (musicId) {
          setBoardingMusicTrackId(musicId);
        } else if (userId) {
          const userDefault = await loadUserMusicDefault(userId);
          if (cancelled) return;
          if (userDefault) setBoardingMusicTrackId(userDefault);
        }
      } else {
        console.warn("[VueloActualView] No se pudo cargar la música del vuelo:", result.error);
      }
      musicSettingsLoadedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [flightId, userId]);

  // Persiste la música ambiental en `flight_setting_announcements` cuando el
  // usuario cambia la selección (toggle + pista). Solo después de la carga
  // inicial para no sobrescribir los valores guardados del vuelo.
  useEffect(() => {
    if (!flightId || !musicSettingsLoadedRef.current) return;
    BoardingMusicService.saveForFlight(flightId, {
      enabled: immersionConfig.play_boarding_music ?? true,
      musicId: boardingMusicTrackId || null,
    }).then((result) => {
      if (!result.success) {
        console.warn("[VueloActualView] Error al guardar la música del vuelo:", result.error);
      }
    });
  }, [flightId, boardingMusicTrackId, immersionConfig.play_boarding_music]);

  // Mantiene configurado el MusicController con las pistas y la selección del
  // usuario antes de que el Scheduler inicie/detenga la música ambiental.
  // En fuente `pack` se inyecta la URL del audio de la comunidad (cacheada o
  // remota); en `ia` (o sin audio) suena la pista del catálogo.
  useEffect(() => {
    musicController.configure({
      tracks: musicTracks,
      selectedTrackId: boardingMusicTrackId || null,
      enabled: immersionConfig.play_boarding_music ?? true,
      useProcessedAudio: boardingMusicProcessed,
      packageUrl: effectiveBoardingAudioSource === "pack" ? boardingAudioUrl : null,
    });
  }, [musicTracks, boardingMusicTrackId, immersionConfig.play_boarding_music, boardingMusicProcessed, effectiveBoardingAudioSource, boardingAudioUrl]);

  // Al cargar un vuelo, resuelve su escenario (flights.scenario_key o el del
  // usuario) y lo selecciona en el selector. Al cambiar el selector, el efecto
  // de configuración consolidado recarga el snapshot + la configuración.
  useEffect(() => {
    if (!flightId || !userId) return;
    let cancelled = false;
    (async () => {
      const flightScenario = await resolveFlightScenario(flightId, userId);
      if (cancelled) return;
      setSelectedScenarioKey(flightScenario);
    })();
    return () => { cancelled = true; };
  }, [flightId, userId]);

  // Carga el snapshot del escenario seleccionado + la configuración combinada
  // (sistema → usuario → vuelo) para ese escenario, y alimenta eventConfig.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setScenarioLoading(true);

      const [snapshotResult, userConfigResult] = await Promise.all([
        ScenarioConfigService.loadPublishedSnapshot(selectedScenarioKey),
        UserEventDefaultsService.loadEffectiveUserConfig(userId, selectedScenarioKey),
      ]);
      if (cancelled) return;

      if (snapshotResult.success && snapshotResult.data) {
        setScenarioSnapshot(snapshotResult.data);
      } else {
        console.warn("[VueloActualView] No se pudo cargar el escenario:", snapshotResult.error);
        setScenarioSnapshot(null);
      }

      const merged: Record<string, string> = { ...(userConfigResult.data ?? {}) };
      let flightOverrides: Record<string, string> = {};

      if (flightId) {
        const flightResult = await FlightEventConfigService.loadForFlight(flightId, selectedScenarioKey);
        if (cancelled) return;
        if (flightResult.success) {
          flightOverrides = flightResult.data ?? {};
          Object.assign(merged, flightOverrides);
        }
      }

      const switchMap: Record<string, EventSwitchValue> = {};
      for (const [key, value] of Object.entries(merged)) {
        if (isEventSwitchValue(value) && isConfigurableEvent(key)) {
          switchMap[key] = value;
        }
      }
      if (Object.keys(switchMap).length > 0) {
        setEventConfig(switchMap);
      }

      const packageLocation = flightOverrides[EVENT_CONFIG_PACKAGE_KEY];
      if (packageLocation != null) {
        setSelectedPackage(packageLocation);
      }

      const flavor = merged[EVENT_CONFIG_FLAVOR_KEY];
      if (flavor != null) {
        const flavorMap: Record<string, number> = { operative: 1, cultural: 2, scenic: 3, casual: 4 };
        const mapped = flavorMap[flavor];
        if (mapped != null) setCommunicationStyle(mapped);
      }

      setScenarioLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedScenarioKey, userId, flightId]);

  // Carga los umbrales por defecto (events.default_delay_ms) de los eventos de
  // demora para inicializar sus sliders con el valor publicado en la DB.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const thresholds = await ScenarioConfigService.loadDelayThresholds(
        DELAY_SLIDER_EVENT_KEYS as unknown as string[]
      );
      if (cancelled) return;
      if (Object.keys(thresholds).length > 0) {
        setDelayEventThresholdsMs((prev) => ({ ...prev, ...thresholds }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedScenarioKey]);

  const getRouteDetails = (origen: string, destino: string) => {
    const o = (origen || "SABE").toUpperCase();
    const d = (destino || "SACO").toUpperCase();
    
    const airports: Record<string, { name: string; city: string; country: string }> = {
      SABE: { name: "Aeroparque Jorge Newbery", city: "Buenos Aires", country: "Argentina" },
      SAEZ: { name: "Ezeiza Intl", city: "Buenos Aires", country: "Argentina" },
      SACO: { name: "Ambrosio Taravella Intl", city: "Córdoba", country: "Argentina" },
      SCEL: { name: "Arturo Merino Benítez Intl", city: "Santiago de Chile", country: "Chile" },
      SBGR: { name: "Guarulhos International", city: "São Paulo", country: "Brasil" },
      SASA: { name: "Salta Martín Miguel de Güemes", city: "Salta", country: "Argentina" }
    };

    const orgInfo = airports[o] || { name: "", city: getAirportName(o) || o, country: "" };
    const destInfo = airports[d] || { name: "", city: getAirportName(d) || d, country: "" };

    return {
      orgName: orgInfo.name,
      orgCity: orgInfo.city,
      orgCountry: orgInfo.country,
      destName: destInfo.name,
      destCity: destInfo.city,
      destCountry: destInfo.country,
      depTime: "14:15",
      arrTime: "15:25",
      dist: "348 NM",
      dur: "1H 10M"
    };
  };

  const routeDetails = {
    ...getRouteDetails(originICAO, destICAO),
    orgCity: originCityName || getRouteDetails(originICAO, destICAO).orgCity,
    destCity: destCityName || getRouteDetails(originICAO, destICAO).destCity,
  };

  // Pantalla de selección "Volar": se muestra en NoIniciado mientras no haya
  // vuelo cargado ni ajustes abiertos. Tras importar, sigue el flujo clásico.
  const showFlightSelect =
    currentState === FlightState.NoIniciado && !isFlightSettingsOpen && !canStartFlight;

  // Volver a la pantalla de selección: limpia la importación actual para
  // mostrar de nuevo "Volar" (la próxima importación hace upsert en destino).
  const handleBackToSelection = useCallback(() => {
    setSimbriefRawData(null);
    setSimbriefAircraft(null);
    setSimbriefError(null);
    setIsBriefImported(false);
    setCanStartFlight(false);
    setIsFlightSettingsOpen(false);
    setCampaignMatch(null);
  }, []);

  // ── Vista previa pre-vuelo: ciudad legible inmediata desde `airports` ──
  // El banner superior (NoIniciado / Ajustes Pre-Vuelo) antes usaba solo
  // `getAirportName()` (mapa hardcodeado de ~60 ICAO) y mostraba el código
  // ICAO para el resto. Aquí se replica el criterio del detalle finalizado
  // (`FlightHistoryService.loadFlightDetail`): `municipality` de la tabla
  // `airports` primero, luego fallback hardcodeado / SimBrief / ICAO.
  // `resolvedAirports` solo se usa cuando su `icao_code` coincide con el del
  // plan visible, para no mostrar una ciudad obsoleta durante el cambio.
  const sbOriginIcao = ((simbriefRawData as any)?.origin?.icao_code ?? originICAO ?? "").toString().toUpperCase().trim();
  const sbDestIcao = ((simbriefRawData as any)?.destination?.icao_code ?? destICAO ?? "").toString().toUpperCase().trim();
  const sbOriginMatchesState = !sbOriginIcao || sbOriginIcao === (originICAO ?? "").toString().toUpperCase().trim();
  const sbDestMatchesState = !sbDestIcao || sbDestIcao === (destICAO ?? "").toString().toUpperCase().trim();
  const preFlightOriginCity = useMemo(() => {
    const dbCity = resolvedAirports.origin?.icao_code?.toUpperCase().trim() === sbOriginIcao && sbOriginIcao
      ? resolvedAirports.origin?.municipality
      : "";
    return (
      dbCity ||
      (sbOriginIcao ? getAirportName(sbOriginIcao) : "") ||
      ((simbriefRawData as any)?.origin?.city ?? "") ||
      ((simbriefRawData as any)?.origin?.name ?? "") ||
      (sbOriginMatchesState ? originCityName : "") ||
      sbOriginIcao ||
      ""
    );
  }, [resolvedAirports.origin, sbOriginIcao, simbriefRawData, originCityName, sbOriginMatchesState]);
  const preFlightDestCity = useMemo(() => {
    const dbCity = resolvedAirports.dest?.icao_code?.toUpperCase().trim() === sbDestIcao && sbDestIcao
      ? resolvedAirports.dest?.municipality
      : "";
    return (
      dbCity ||
      (sbDestIcao ? getAirportName(sbDestIcao) : "") ||
      ((simbriefRawData as any)?.destination?.city ?? "") ||
      ((simbriefRawData as any)?.destination?.name ?? "") ||
      (sbDestMatchesState ? destCityName : "") ||
      sbDestIcao ||
      ""
    );
  }, [resolvedAirports.dest, sbDestIcao, simbriefRawData, destCityName, sbDestMatchesState]);

  const prevSimbriefIcaosRef = useRef<{ o: string; d: string }>({ o: "", d: "" });
  React.useEffect(() => {
    setFlightCode(simBriefData.vueloCodigo);
    setOriginICAO(simBriefData.origen);
    setDestICAO(simBriefData.destino);
    setAirline(simBriefData.aerolinea);
    // Solo resetear ciudades si cambiaron los ICAOs: en una re-importación del
    // mismo plan (misma u otra sesión) el fallback getRouteDetails devolvería
    // el código ICAO y pisaría el municipality ya resuelto (bug: 1ª sesión con
    // nombres, 2ª con códigos). El resolver async corrige el caso de ICAOs
    // nuevos; acá simplemente no se destruye lo ya resuelto.
    const o = simBriefData.origen ?? "";
    const d = simBriefData.destino ?? "";
    if (o !== prevSimbriefIcaosRef.current.o || d !== prevSimbriefIcaosRef.current.d) {
      prevSimbriefIcaosRef.current = { o, d };
      const initialRoute = getRouteDetails(o, d);
      setOriginCityName(initialRoute.orgCity);
      setDestCityName(initialRoute.destCity);
    }
  }, [simBriefData]);

  // Generate passenger manifest when simBriefData or PreEmbarque state is ready
  React.useEffect(() => {
    if (simBriefData?.origen && simBriefData?.pasajerosCount > 0) {
      const manifest = generateManifest(simBriefData.pasajerosCount, simBriefData.origen);
      setBoardingManifest(manifest);
    }
  }, [simBriefData]);

  // Resolver aeropuertos contra Supabase cuando cambian los ICAOs por edición
  // manual o por prop simBriefData. El fallback inmediato ya está aplicado
  // arriba (getRouteDetails/getAirportName); aquí se sobrescribe con la DB.
  React.useEffect(() => {
    if (!originICAO && !destICAO) return;
    resolveAirports(originICAO, destICAO).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originICAO, destICAO]);

  // Al cargar un plan (SimBrief u otro origen) se resuelven origen/destino
  // contra `airports` de forma inmediata, sin esperar a ningún guardado
  // previo en `flights`. Cubre el caso en que `simbriefRawData` llega antes
  // de que los estados `originICAO/destICAO` se sincronicen.
  React.useEffect(() => {
    const sbO = ((simbriefRawData as any)?.origin?.icao_code ?? "").toString().trim();
    const sbD = ((simbriefRawData as any)?.destination?.icao_code ?? "").toString().trim();
    if (!sbO && !sbD) return;
    resolveAirports(sbO || originICAO, sbD || destICAO).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simbriefRawData]);

  // Phase 1 boarding simulation timer effect (ritmo configurable en pax/min:
  // override del vuelo o default global; 60 = 1 pax/s, comportamiento clásico).
  // Tick fijo de 1s con acumulador fraccionario para ritmos no divisibles.
  React.useEffect(() => {
    let intervalId: any = null;
    const targetLength = boardingManifest.length > 0 ? boardingManifest.length : passengers.length;
    const paxPerTick = boardingPaxPerTick(effectiveBoardingPace);
    if (isBoardingActive && boardedCount < targetLength) {
      intervalId = setInterval(() => {
        boardingCarryRef.current += paxPerTick;
        const batch = Math.floor(boardingCarryRef.current);
        if (batch <= 0) return;
        boardingCarryRef.current -= batch;
        setBoardedCount(prev => {
          if (prev >= targetLength) {
            setIsBoardingActive(false);
            clearInterval(intervalId);
            return targetLength;
          }
          return Math.min(prev + batch, targetLength);
        });
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isBoardingActive, boardedCount, boardingManifest.length, passengers.length, effectiveBoardingPace]);

  // Check when boarding is complete to deactivate active boarding state.
  // IMPORTANTE: el objetivo es el mismo que el del intervalo (manifiesto si
  // existe, sino pasajeros). Usar solo `passengers.length` cortaba el embarque
  // al tamaño del mock (8 pax) en vez del manifiesto real (142+), dejando el
  // botón en "Reanudar embarque" para siempre e impidiendo "Cerrar puertas".
  React.useEffect(() => {
    const target = boardingManifest.length > 0 ? boardingManifest.length : passengers.length;
    if (target > 0 && boardedCount >= target && isBoardingActive) {
      setIsBoardingActive(false);
    }
  }, [boardedCount, boardingManifest.length, passengers.length, isBoardingActive]);

  // Reset boarding whenever entering PreEmbarque phase
  React.useEffect(() => {
    if (currentState === FlightState.PreEmbarque) {
      setBoardedCount(0);
      boardingCarryRef.current = 0;
      setIsBoardingActive(false);
      setBoardingStarted(false);
      setShowCancelConfirm(false);
    }
  }, [currentState]);

  const handleEventConfigChange = (key: string, value: EventSwitchValue) => {
    setEventConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // ICAO de la aerolínea del vuelo actual (SimBrief o campo editable) para
  // filtrar los videos de seguridad de la comunidad (+ genéricos).
  const safetyAirlineIcao: string | null = useMemo(() => {
    const raw =
      ((simbriefRawData as any)?.general?.icao_airline as unknown) ?? airline ?? "";
    const icao = String(raw).toUpperCase().trim();
    return icao !== "" ? icao : null;
  }, [simbriefRawData, airline]);

  // Selección del video de seguridad (modo PACK): guarda el id por defecto y
  // lo deja activo en el servicio para la pre-descarga al iniciar el vuelo.
  const handleSafetyPackageChange = useCallback((pkg: PackageRecord | null) => {
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
  }, []);

  // Fuente de música del vuelo + package de audio de la comunidad.
  const handleBoardingAudioSourceChange = useCallback((source: BoardingAudioSource) => {
    setBoardingAudioSourceOverride(source);
    try {
      localStorage.setItem(BOARDING_AUDIO_SOURCE_STORAGE_KEY, source);
    } catch {
      // almacenamiento no disponible: la selección sigue en memoria
    }
  }, []);
  const handleBoardingAudioPackageChange = useCallback((pkg: PackageRecord | null) => {
    setBoardingAudioPackage(pkg);
    if (pkg) {
      try {
        localStorage.setItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY, pkg.id);
      } catch {
        // almacenamiento no disponible: la selección sigue en memoria
      }
      boardingAudioPackService.setActivePackage(pkg);
    } else {
      try {
        localStorage.removeItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY);
      } catch {
        // ignorar
      }
    }
  }, []);

  // Delay de gate_crew_started (solo en memoria, para el vuelo actual).
  const [gateStartedDelaySec, setGateStartedDelaySec] = useState<number>(GATE_STARTED_DELAY_DEFAULT);
  const handleGateStartedDelayChange = (value: number) => {
    const clamped = Math.min(GATE_STARTED_DELAY_MAX, Math.max(GATE_STARTED_DELAY_MIN, Math.round(value)));
    setGateStartedDelaySec(clamped);
    flightContextRef.current?.setDelayOverride(GATE_STARTED_DELAY_KEY, clamped * 1000);
    fileLogger.log('[VueloActualView] Delay gate_crew_started', { seconds: clamped });
  };

  // Umbrales de demora (ms) por defecto de los eventos de demora, cargados desde
  // `events.default_delay_ms` (DB). Sobrescribe el fallback local por evento.
  const [delayEventThresholdsMs, setDelayEventThresholdsMs] = useState<Record<string, number>>({});
  // Overrides del usuario (en minutos) para los sliders de eventos de demora.
  const [delaySliderMinutes, setDelaySliderMinutes] = useState<Record<string, number>>({});

  const clampDelayMinutes = (value: number): number =>
    Math.min(DELAY_SLIDER_MAX_MIN, Math.max(DELAY_SLIDER_MIN_MIN, Math.round(value)));

  const handleDelaySliderChange = (eventKey: string, value: number) => {
    const clamped = clampDelayMinutes(value);
    setDelaySliderMinutes((prev) => ({ ...prev, [eventKey]: clamped }));
    flightContextRef.current?.setDelayOverride(eventKey, clamped * MINUTE_MS);
    fileLogger.log('[VueloActualView] Delay evento de demora', { eventKey, minutes: clamped });
  };

  const getDelaySliderMinutes = (eventKey: string): number => {
    if (delaySliderMinutes[eventKey] !== undefined) return delaySliderMinutes[eventKey];
    const overrideMs = flightContextRef.current?.getDelayOverride(eventKey);
    const effectiveMs =
      typeof overrideMs === "number" && overrideMs > 0
        ? overrideMs
        : delayEventThresholdsMs[eventKey] ?? DELAY_SLIDER_DEFAULT_MS[eventKey] ?? MINUTE_MS * DELAY_SLIDER_MIN_MIN;
    return clampDelayMinutes(Math.round(effectiveMs / MINUTE_MS));
  };

  // Re-aplica los delays de eventos de demora elegidos por el usuario al
  // FlightContext. Se invoca tras Scheduler.startFlight porque ahí se
  // resincronizan los umbrales desde la DB (events.default_delay_ms) y podrían
  // pisar lo modificado. gate_crew_started no forma parte de esa sincronización,
  // por lo que no hace falta re-aplicarlo.
  const applyUserDelayOverridesToContext = () => {
    const ctx = flightContextRef.current;
    if (!ctx) return;
    for (const key of DELAY_SLIDER_EVENT_KEYS) {
      if (delaySliderMinutes[key] !== undefined) {
        ctx.setDelayOverride(key, delaySliderMinutes[key] * MINUTE_MS);
      }
    }
  };

  // Pista de música seleccionada actualmente (para preview y etiqueta).
  const selectedMusicTrack = musicTracks.find((track) => track.id === boardingMusicTrackId) ?? null;

  const getNarratorLabel = (role: string | null | undefined): string => {
    if (role === "captain") return t("current_flight.not_started.events.narrator_captain");
    if (role === "crew") return t("current_flight.not_started.events.narrator_crew");
    if (role === "gate") return t("current_flight.not_started.events.narrator_gate") || "Agente de Puerta";
    return "—";
  };

  const { showToast } = useToast();

  // Ejecuta el inicio real del vuelo con las preferencias elegidas en el popup
  const executeFlightStart = async (mode: "normal" | "test", preferences: FlightStartPreferences) => {
    setIsStartingFlight(true);
    try {
      const flavorMapRev: Record<number, string> = { 1: "operative", 2: "cultural", 3: "scenic", 4: "casual" };

      if (flightId) {
        const saveResult = await FlightEventConfigService.saveForFlight(flightId, eventConfig, {
          scenarioKey: selectedScenarioKey,
          flavor: flavorMapRev[communicationStyle] || "operative",
          packageLocation: selectedPackage || "aerolineas",
        });
        if (!saveResult.success) throw new Error(saveResult.error ?? "Error al guardar la configuración del vuelo");
      }

      const flightUpdatePayload: Record<string, any> = {
        flight_status: "started",
        scenario_key: selectedScenarioKey,
        lang_primary_id: captainPrimaryLang,
        lang_secondary_id: captainSecondaryLang === LANG_NONE || captainSecondaryLang === "" ? null : captainSecondaryLang,
        voice_captain_id: captainVoice,
        voice_crew_id: crewVoice,
        voice_gate_id: gateAgentVoiceId || null,
      };
      console.log("[handleStartFlight] flights.update payload:", JSON.stringify(flightUpdatePayload, null, 2));

      const { error: flightError } = await supabase
        .from("flights")
        .update(flightUpdatePayload)
        .eq("id", flightId);
      if (flightError) throw new Error(flightError.message);

      setIsFlightSettingsOpen(false);
      setExecutionMode(mode);
      if (mode === "test") {
        setIsTestMode(true);
      }
      // ── Safety Video PACK: caché local en segundo plano ──────────
      // Si el evento `taxi_crew_safety_brief` está en modo PACK y hay un
      // package elegido, se deja activo en el servicio y se pre-descarga su
      // `package_url` de forma silenciosa (sin bloquear el inicio del vuelo)
      // para una reproducción instantánea en el IFE.
      // OJO: el dropdown solo vive montado en su pestaña; si el usuario
      // configuró PACK en Settings (o el catálogo aún cargaba), el estado
      // local puede venir null: se resuelve aquí el package por defecto (id
      // guardado → primero disponible) y NUNCA se pisa con null.
      const safetyMode = eventConfig[SAFETY_VIDEO_EVENT_KEY];
      let activeSafetyPack = safetyPackage;
      if (safetyMode === "PACK" && !activeSafetyPack) {
        try {
          activeSafetyPack = await safetyVideoPackService.resolveActivePackage(
            safetyAirlineIcao,
            safetyVideoPackService.getStoredPackageId()
          );
          if (activeSafetyPack) setSafetyPackage(activeSafetyPack);
        } catch (err) {
          console.warn("[SafetyVideo] resolve al iniciar vuelo falló:", err);
        }
      }
      if (activeSafetyPack) {
        safetyVideoPackService.setActivePackage(activeSafetyPack);
      }
      console.log("[SafetyVideo] Estado al iniciar vuelo:", {
        mode: safetyMode,
        airlineIcao: safetyAirlineIcao,
        packageId: activeSafetyPack?.id ?? null,
        packageName: activeSafetyPack?.package_name ?? null,
      });
      fileLogger.log("[SafetyVideo] Estado al iniciar vuelo", {
        mode: safetyMode,
        airlineIcao: safetyAirlineIcao,
        packageId: activeSafetyPack?.id ?? null,
        packageName: activeSafetyPack?.package_name ?? null,
      });
      if (safetyMode === "PACK" && activeSafetyPack?.package_url) {
        const packToCache = activeSafetyPack;
        void safetyVideoPackService.precacheSafetyVideo(packToCache).then((cached) => {
          if (cached.error) {
            showToast(`Video de seguridad: se usará streaming (${cached.error}).`, "info");
          }
        });
      } else if (safetyMode === "PACK") {
        console.warn("[SafetyVideo] PACK sin package disponible: el evento usará audio IA.");
        fileLogger.warn("[SafetyVideo] PACK sin package: fallback a audio IA", {
          airlineIcao: safetyAirlineIcao,
        });
        showToast("Sin video de seguridad para esta aerolínea: se usará audio IA.", "info");
      }
      // ── Boarding audio PACK: caché local en segundo plano ─────────
      // Si la fuente de música es `pack` y hay un audio elegido, se deja
      // activo en el servicio y se pre-descarga (igual que el safety video).
      // Sin package disponible, la música del vuelo usa el catálogo (IA).
      // Igual que arriba: nunca se pisa con null una selección previa.
      const audioSource = effectiveBoardingAudioSource;
      let activeAudioPack = boardingAudioPackage;
      if (audioSource === "pack" && !activeAudioPack) {
        try {
          activeAudioPack = await boardingAudioPackService.resolveActivePackage(
            safetyAirlineIcao,
            boardingAudioPackService.getStoredPackageId()
          );
          if (activeAudioPack) setBoardingAudioPackage(activeAudioPack);
        } catch (err) {
          console.warn("[BoardingAudio] resolve al iniciar vuelo falló:", err);
        }
      }
      if (activeAudioPack) {
        boardingAudioPackService.setActivePackage(activeAudioPack);
      }
      console.log("[BoardingAudio] Estado al iniciar vuelo:", {
        source: audioSource,
        airlineIcao: safetyAirlineIcao,
        packageId: activeAudioPack?.id ?? null,
        packageName: activeAudioPack?.package_name ?? null,
      });
      fileLogger.log("[BoardingAudio] Estado al iniciar vuelo", {
        source: audioSource,
        airlineIcao: safetyAirlineIcao,
        packageId: activeAudioPack?.id ?? null,
        packageName: activeAudioPack?.package_name ?? null,
      });
      if (audioSource === "pack" && activeAudioPack?.package_url) {
        // URL remota de inmediato (streaming) y se reemplaza por la cacheada
        // en cuanto termina la pre-descarga (antes del embarque).
        setBoardingAudioUrl(activeAudioPack.package_url);
        const packToCache = activeAudioPack;
        void boardingAudioPackService.precacheBoardingAudio(packToCache).then((cached) => {
          if (cached.objectUrl) {
            setBoardingAudioUrl(cached.objectUrl);
          } else if (cached.error) {
            showToast(`Audio de embarque: se usará streaming (${cached.error}).`, "info");
          }
        });
      } else {
        setBoardingAudioUrl(null);
        if (audioSource === "pack") {
          console.warn("[BoardingAudio] pack sin package disponible: la música usará el catálogo.");
          fileLogger.warn("[BoardingAudio] pack sin package: fallback a catálogo", {
            airlineIcao: safetyAirlineIcao,
          });
          showToast("Sin audio de embarque para esta aerolínea: se usará música del catálogo.", "info");
        }
      }
      // Almacenar preferencias de inicio en FlightContext
      flightContextRef.current?.setFlightStartPreferences(preferences);
      fileLogger.log('[VueloActualView] ✈️ Preferencias de inicio', preferences);
      onStateChange(FlightState.PreEmbarque);
      // Forzar la sincronización completa de FlightContext con los datos de la
      // UI ANTES de entrar a GATE: así los anuncios (gate_crew_start_soon, etc.)
      // usan los datos del vuelo recién importado y no los del vuelo anterior.
      // (El useEffect de sync corre recién después del render, por lo que sin
      // esta llamada explícita había una condición de carrera al iniciar vuelo.)
      syncFlightContext("handleStartFlight");
      console.log("[DEBUG] Datos de vuelo ANTES de enterPhase:", {
        dataSource: getContextDataSource(),
        flight: flightContextRef.current?.getFlight(),
        preferences,
        uiState: {
          airline: getAirlineName(airline),
          flightCode,
          originICAO,
          destICAO,
          originCityName,
          destCityName,
          gate,
          departureTime: departureTimeStr,
        },
      });
      // Iniciar el FlightController (autoStart: false → solo al hacer clic en "Iniciar Vuelo")
      if (flightControllerRef.current && !flightControllerRef.current.isConnected()) {
        try {
          bindFlightController(flightControllerRef.current);
          await flightControllerRef.current.connect();
          connectionStatusService.setActiveController(flightControllerRef.current);
        } catch (e) {
          console.warn("[handleStartFlight] FlightController connect falló:", e);
          if (config.sim.provider === "msfs") {
            try { flightControllerRef.current.disconnect(); } catch {}
            const mock = new MockFlightController({
              speedMultiplier: config.mock.speedMultiplier,
              autoTransition: config.mock.autoTransition,
              autoStart: false,
            });
            flightControllerRef.current = mock;
            bindFlightController(mock);
            await mock.connect();
            connectionStatusService.setActiveController(mock);
          } else {
            throw e;
          }
        }
      } else if (flightControllerRef.current) {
        connectionStatusService.setActiveController(flightControllerRef.current);
      }

      // Aplicar preferencias de inicio en el scheduler / embarque
      phaseDetectorRef.current?.reset();
      lastDetectedPhaseRef.current = null;

      await schedulerRef.current?.startFlight(mode);
      // Arrancar el registro del recorrido para este vuelo (limpia buffer previo).
      flightPathRecorderRef.current?.start({
        phase: schedulerRef.current?.getCurrentPhase() ?? null,
        scenarioKey: selectedScenarioKey,
      });
      // Arrancar el tracker de bonos XP y vincularle los minutos de vuelo para
      // proyectar base_time_xp en el monitor.
      xpBonusTrackerRef.current?.start();
      // Fase 1 pasajeros: nueva muestra trackeada por vuelo + dt desde cero.
      passengerEngineRef.current?.startFlight();
      turbulenceRef.current?.reset();
      passengerLastTickMsRef.current = null;
      setPaxFinal(null);
      // Nuevo vuelo: descartar el resumen de XP del anterior.
      setXpCompletion(null);
      xpBonusTrackerRef.current?.setAirMinutesProvider(
        () => flightPathRecorderRef.current?.getAirMinutes() ?? null
      );
      // Scheduler.startFlight resincroniza los umbrales de demora desde la DB
      // (events.default_delay_ms); se re-aplican los delays elegidos por el usuario
      // en los sliders de "Configurar Eventos" para que se usen en el vuelo.
      applyUserDelayOverridesToContext();
      // Delegar lógica de fase inicial al Scheduler según preferencias.
      // El FSM se sincroniza con la fase inicial ANTES del enterPhase: sin
      // esto quedaba en GATE mientras el Scheduler avanzaba, y el detector
      // rechazaba todas las transiciones (p. ej. CRUISE → DESCENT).
      const enterInitialPhase = async (phase: FlightPhase, reason: string) => {
        flightFSMRef.current?.syncState(phase, 'simulator');
        await schedulerRef.current?.enterPhase(phase, 'simulator');
        console.log('[Scheduler] FSM sincronizado con fase inicial:', {
          phase,
          fsmState: flightFSMRef.current?.getCurrentState(),
          reason,
        });
        fileLogger.log('[Scheduler] FSM sincronizado con fase inicial', {
          phase,
          fsmState: flightFSMRef.current?.getCurrentState(),
          reason,
        });
      };
      if (preferences.initialState === 'runway') {
        // Cabecera de pista: embarcar a todos y saltar GATE/BOARDING
        const total = boardingManifest.length > 0 ? boardingManifest.length : passengers.length;
        if (total > 0) {
          setBoardedCount(total);
          setBoardingStarted(true);
          setIsBoardingActive(false);
          setBoardingStepsDone(true);
        }
        schedulerRef.current?.applyFlightStart(preferences);
        await enterInitialPhase(FlightPhase.TAKEOFF, `Iniciar vuelo (modo: ${mode}, ${preferences.initialState}) -> Scheduler.enterPhase(TAKEOFF)`);
        console.log(`[UI] Iniciar vuelo (modo: ${mode}, ${preferences.initialState}) -> Scheduler.enterPhase(TAKEOFF)`);
      } else if (preferences.initialState === 'gate_engines_on' && !preferences.includeBoarding) {
        const total = boardingManifest.length > 0 ? boardingManifest.length : passengers.length;
        if (total > 0) {
          setBoardedCount(total);
          setBoardingStarted(true);
          setIsBoardingActive(false);
          setBoardingStepsDone(true);
        }
        schedulerRef.current?.applyFlightStart(preferences);
        await enterInitialPhase(FlightPhase.GATE, `Iniciar vuelo (modo: ${mode}, gate_engines_on sin abordaje) -> GATE con embarque omitido`);
        console.log(`[UI] Iniciar vuelo (modo: ${mode}, gate_engines_on sin abordaje) -> GATE con embarque omitido`);
      } else {
        // cold_and_dark o gate_engines_on con abordaje: flujo normal desde GATE
        schedulerRef.current?.applyFlightStart(preferences);
        await enterInitialPhase(FlightPhase.GATE, `Iniciar vuelo (modo: ${mode}, ${preferences.initialState}) -> Scheduler.enterPhase(GATE)`);
        console.log(`[UI] Iniciar vuelo (modo: ${mode}, ${preferences.initialState}) -> Scheduler.enterPhase(GATE)`);
      }
    } catch (err: any) {
      console.error("Error al iniciar vuelo:", err);
    } finally {
      setIsStartingFlight(false);
    }
  };

  const handleStartFlight = async (mode: "normal" | "test" = "normal") => {
    // --- Validación: debe existir un vuelo real cargado (SimBrief / guardado) ---
    if (!hasValidFlight) {
      console.warn("[DEBUG] No se puede iniciar el vuelo sin datos de vuelo (hasValidFlight=false)");
      showToast("No hay vuelo cargado. Importá un vuelo desde SimBrief para poder iniciar.", "error");
      return;
    }

    // --- Validation ---
    const errors: string[] = [];
    const resolvedAirline = getAirlineName(airline);
    if (!resolvedAirline || !resolvedAirline.trim()) {
      errors.push("El nombre de la aerolínea no puede estar vacío.");
    }
    if (!originCityName || !originCityName.trim()) {
      errors.push("La ciudad de origen no puede estar vacía.");
    }
    if (!destCityName || !destCityName.trim()) {
      errors.push("La ciudad de destino no puede estar vacía.");
    }
    if (errors.length > 0) {
      showToast(errors.join("\n"), "error");
      return;
    }
    // Mostrar popup de elección de estado inicial antes de iniciar
    setPendingFlightMode(mode);
    setShowFlightStartPopup(true);
  };

  const handleConfirmFlightStart = async (preferences: FlightStartPreferences) => {
    setShowFlightStartPopup(false);
    await executeFlightStart(pendingFlightMode, preferences);
  };

  const handleStartTests = () => {
    handleStartFlight("test");
  };

  /**
   * Resuelve origen/destino contra la tabla `airports` de Supabase (con caché).
   * Si la DB no devuelve un aeropuerto, se usa `airportMapping.ts` como fallback.
   * Actualiza nombres de ciudad en la UI y coords del destino en FlightContext.
   *
   * Lleva guardia de secuencia: si se disparan varias resoluciones concurrentes
   * (p. ej. re-importación rápida), solo la última aplica sus valores.
   */
  const resolveSeqRef = useRef(0);
  const resolveAirports = useCallback(async (originICAO: string, destICAO: string) => {
    if (!originICAO && !destICAO) return;
    const seq = ++resolveSeqRef.current;
    try {
      const [originAirport, destAirport] = await Promise.all([
        originICAO ? getAirportByIcao(originICAO) : Promise.resolve(null),
        destICAO ? getAirportByIcao(destICAO) : Promise.resolve(null),
      ]);
      if (seq !== resolveSeqRef.current) {
        console.log('[SimBrief] Resolución de aeropuertos obsoleta, ignorando:', { originICAO, destICAO });
        return;
      }
      setResolvedAirports({ origin: originAirport, dest: destAirport });

      // Al cargar un plan nuevo se sobrescribe siempre (sin `prev ||`): si se
      // conservara el valor previo, una re-importación de otro ICAO mantendría
      // la ciudad vieja o el código ICAO en lugar del municipality recién
      // resuelto de la tabla `airports` (mismo criterio que el detalle final).
      if (originAirport?.municipality) setOriginCityName(originAirport.municipality);
      else if (originICAO) setOriginCityName(getAirportName(originICAO) || originICAO);
      else setOriginCityName("");
      if (destAirport?.municipality) setDestCityName(destAirport.municipality);
      else if (destICAO) setDestCityName(getAirportName(destICAO) || destICAO);
      else setDestCityName("");

      flightContextRef.current?.updateFlight({
        originICAO,
        destICAO,
        originCity: originAirport?.municipality || (originICAO ? getAirportName(originICAO) || originICAO : ""),
        destCity: destAirport?.municipality || (destICAO ? getAirportName(destICAO) || destICAO : ""),
        ...(destAirport?.latitude_deg != null ? { destLatitude: destAirport.latitude_deg } : {}),
        ...(destAirport?.longitude_deg != null ? { destLongitude: destAirport.longitude_deg } : {}),
      });

      console.log('[SimBrief] Aeropuertos resueltos:', {
        origin: { icao: originICAO, city: originAirport?.municipality ?? getAirportName(originICAO) ?? originICAO },
        destination: { icao: destICAO, city: destAirport?.municipality ?? getAirportName(destICAO) ?? destICAO },
      });
    } catch (e) {
      console.warn('[SimBrief] No se pudieron resolver aeropuertos (fallback a airportMapping):', e);
    }
  }, []);

  const handleImportSimbrief = async () => {
    setIsFetchingSimbrief(true);
    setSimbriefError(null);
    setSimbriefRawData(null);
    setSimbriefAircraft(null);
    setCampaignMatch(null);
    try {
      const response = await fetch(`https://www.simbrief.com/api/xml.fetcher.php?userid=${simbriefId}&json=1`);
      if (response.status === 400) {
        throw new Error("simbrief_no_plan");
      } else if (!response.ok) {
        throw new Error("simbrief_generic_error");
      }
      const data = await response.json();

      // --- Normalización de altitud de crucero (pipeline del anuncio) ---
      // La variable `cruising_altitude` se resuelve desde
      // `simbrief.general.route_altitude` crudo. Algunos OFP lo omiten aunque
      // traigan `initial_altitude`: se copia para que el anuncio no caiga al
      // fallback FL320 del catálogo. Sin ningún candidato se deja como está
      // (aplica el fallback actual). No se toca `prompts.variables`.
      try {
        const genAlt: any = (data as any)?.general ?? null;
        if (genAlt && typeof genAlt === "object") {
          const originalRouteAlt = genAlt.route_altitude;
          const isMissing =
            originalRouteAlt === undefined ||
            originalRouteAlt === null ||
            String(originalRouteAlt).trim() === "";
          const candidate =
            genAlt.initial_altitude ??
            genAlt.cruise_altitude ??
            genAlt.cruise_alt ??
            null;
          const candidateUsable =
            candidate !== undefined &&
            candidate !== null &&
            String(candidate).trim() !== "";
          if (isMissing && candidateUsable) {
            genAlt.route_altitude = candidate;
          }
          console.log('[SimBrief] Normalizando altitud de crucero:', {
            route_altitude: originalRouteAlt ?? null,
            initial_altitude: genAlt.initial_altitude ?? null,
            normalized: genAlt.route_altitude ?? null,
          });
        }
      } catch (normErr) {
        console.warn('[SimBrief] No se pudo normalizar route_altitude:', normErr);
      }
      setSimbriefRawData(data);

      // --- Datos de crucero ---
      // NOTA: SimBrief NO trae `times.cruise_time`; se deriva del navlog
      // (Σ time_leg con stage CRZ). Ver resolveCruiseTimeSeconds.
      const cruiseResolved = resolveCruiseTimeSeconds(data);
      const cruiseTimeSeconds = cruiseResolved.seconds;
      console.log('[SimBrief] cruise_time raw:', (data as any)?.times?.cruise_time);
      console.log('[SimBrief] cruiseTimeSeconds:', cruiseTimeSeconds, `(fuente: ${cruiseResolved.source})`);

      // --- Datos de vuelo internacional ---
      const originICAO = data?.origin?.icao_code || "";
      const destICAO = data?.destination?.icao_code || "";
      const isInternational = originICAO && destICAO
        ? isInternationalFlight(originICAO, destICAO)
        : false;

      // --- Datos de aeronave (widebody, una sola vez por importación) ---
      const aircraftIcao = String(
        data?.aircraft?.icao_code ?? data?.aircraft?.icaocode ?? data?.general?.icao_aircraft ?? ""
      ).toUpperCase();
      const aircraftData = await getAircraftType(aircraftIcao);
      const aircraftIsWidebody = aircraftData?.is_widebody === true;
      setSimbriefAircraft({
        icao: aircraftIcao,
        isWidebody: aircraftIsWidebody,
        displayName: aircraftData?.display_name || "N/A",
      });

      // --- Aeropuertos: tabla `airports` de Supabase (caché 7 días) ---
      // NOTA: NO resolver aquí con fire-and-forget. En re-lecturas el caché
      // responde al instante (microtask) y el `setDestCityName` síncrono de
      // abajo (fallback → ICAO) lo sobrescribiría después. Se resuelve con
      // `await` tras aplicar el fallback (ver más abajo).
      // `resolveAirports` actualiza ciudades en UI + FlightContext (lat/lon destino).

      console.log("[SimBrief] Datos de vuelo importados:", {
        cruiseTimeSeconds,
        originICAO,
        destICAO,
        isInternational,
        originCountry: originICAO ? getCountryKey(originICAO) : "—",
        destCountry: destICAO ? getCountryKey(destICAO) : "—",
        aircraftIcao,
        aircraftIsWidebody,
        aircraftDisplayName: aircraftData?.display_name || "N/A",
      });

      // Logs detallados solicitados: verificar estructura SimBrief
      console.log('[SimBrief] Estructura de datos:', Object.keys(data || {}));
      console.log('[SimBrief] general:', data?.general);
      console.log('[SimBrief] general.sched_out:', data?.general?.sched_out, '| tipo:', typeof data?.general?.sched_out);
      console.log('[SimBrief] times:', data?.times);

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error("User not authenticated");

      const gen = data.general || {};
      const origin = data.origin || {};
      const dest = data.destination || {};
      const alt = data.alternate || {};
      const ac = data.aircraft || {};
      const w = data.weights || {};
      const times = data.times || {};

      const defaultServices = {
        Catering: true,
        Entertainment: true,
        Retail: false,
        Procedures: true,
      };

      function parseTimestamp(ts: any): Date | null {
        if (!ts) return null;
        if (typeof ts === "number") return new Date(ts * 1000);
        if (typeof ts === "string") {
          const n = Number(ts);
          if (!isNaN(n)) return new Date(n * 1000);
          const d = new Date(ts);
          if (!isNaN(d.getTime())) return d;
        }
        return null;
      }

      const schedOutDate = parseTimestamp(gen.sched_out);
      const schedInDate = parseTimestamp(gen.sched_in);

      function fmtDate(d: Date | null): string | null {
        if (!d) return null;
        return d.toISOString().slice(0, 10);
      }
      function fmtTime(d: Date | null): string | null {
        if (!d) return null;
        return d.toISOString().slice(11, 19);
      }

      const flightRow = {
        user_id: userId,
        saved_flight: `${gen.icao_airline || ""}${gen.flight_number || ""}` || gen.flight_number || "",
        airlane_icao: gen.icao_airline || "",
        flight_number: gen.flight_number || "",
        atc_callsign: gen.callsign || "",
        depart_icao: origin.icao_code || "",
        arrive_icao: dest.icao_code || "",
        alternate_icao: alt.icao_code || "",
        aircraft_type: ac.icaocode || "",
        variant_airframe: "",
        departure_date: fmtDate(schedOutDate),
        departure_time: fmtTime(schedOutDate),
        arrival_time: fmtTime(schedInDate),
        air_time: String(Math.round(parseFloat(times.est_time_enroute || "0") * 60)) || "",
        block_time: String(Math.round(parseFloat(times.est_block || "0") * 60)) || "",
        airframe: ac.reg || ac.name || "",
        cost_index: gen.costindex || "",
        passengers_count: w.pax_count ? parseInt(w.pax_count) : 0,
        crew_count: 2,
        flight_status: "pending",
        flight_services_config: defaultServices,
        simbrief_snapshot: data,
        // Preservar el escenario seleccionado en la UI (si no, el default).
        scenario_key: selectedScenarioKey,
        lang_primary_id: captainPrimaryLang,
        lang_secondary_id: captainSecondaryLang === LANG_NONE || captainSecondaryLang === "" ? null : captainSecondaryLang,
        voice_captain_id: captainVoice,
        voice_crew_id: crewVoice,
        voice_gate_id: gateAgentVoiceId || null,
      };

      // Match blando con vuelos de campañas vigentes (solo origen + destino).
      // Se reserva el multiplicador para aplicarlo al cerrar el vuelo.
      let importCampaignMatch: CampaignMatch | null = null;
      try {
        const campaignsRes = await loadActiveCampaigns();
        if (campaignsRes.success && campaignsRes.data) {
          importCampaignMatch = findCampaignFlightMatch(
            campaignsRes.data,
            origin.icao_code || "",
            dest.icao_code || ""
          );
          if (importCampaignMatch) {
            console.log('[SimBrief] Vuelo de campaña detectado:', {
              campaign: importCampaignMatch.campaignTitle,
              multiplier: importCampaignMatch.xpMultiplier,
            });
            fileLogger.log('[SimBrief] Match de campaña', { ...importCampaignMatch });
          }
        }
      } catch (campaignErr) {
        console.warn('[SimBrief] No se pudo verificar campaña (no bloqueante):', campaignErr);
      }
      setCampaignMatch(importCampaignMatch);

      // Columnas de campaña (migración 20260929_campaign_xp) y voz de puerta:
      // si la DB aún no las tiene, se reintenta sin ellas para no romper la
      // importación.
      const CAMPAIGN_ROW_KEYS = ["campaign_id", "campaign_flight_id", "campaign_xp_multiplier"] as const;
      const VOICE_GATE_ROW_KEYS = ["voice_gate_id"] as const;
      const flightRowWithCampaign = {
        ...flightRow,
        campaign_id: importCampaignMatch?.campaignId ?? null,
        campaign_flight_id: importCampaignMatch?.campaignFlightId ?? null,
        campaign_xp_multiplier: importCampaignMatch?.xpMultiplier ?? null,
      };
      const stripOptionalColumns = (row: Record<string, unknown>) => {
        const copy = { ...row };
        for (const key of CAMPAIGN_ROW_KEYS) delete copy[key];
        for (const key of VOICE_GATE_ROW_KEYS) delete copy[key];
        return copy;
      };
      const isOptionalColumnError = (message: string) => /campaign|voice_gate/i.test(message ?? "");

      let currentFlightId: string | null = null;

      const { data: existingFlight } = await supabase
        .from("flights")
        .select("id")
        .eq("user_id", userId)
        .eq("flight_status", "pending")
        .maybeSingle();

      if (existingFlight?.id) {
        try {
          const { error: updateError } = await supabase
            .from("flights")
            .update(flightRowWithCampaign)
            .eq("id", existingFlight.id);
          if (updateError) throw new Error(updateError.message);
        } catch (persistErr: any) {
          if (!isOptionalColumnError(persistErr?.message ?? "")) throw persistErr;
          console.warn('[SimBrief] flights sin columnas opcionales; reintentando sin ellas');
          const { error: retryError } = await supabase
            .from("flights")
            .update(stripOptionalColumns(flightRowWithCampaign))
            .eq("id", existingFlight.id);
          if (retryError) throw new Error(retryError.message);
        }
        currentFlightId = existingFlight.id;
      } else {
        try {
          const { data: insertedFlight, error: insertError } = await supabase
            .from("flights")
            .insert(flightRowWithCampaign)
            .select("id")
            .single();
          if (insertError) throw new Error(insertError.message);
          currentFlightId = insertedFlight?.id || null;
        } catch (persistErr: any) {
          if (!isOptionalColumnError(persistErr?.message ?? "")) throw persistErr;
          console.warn('[SimBrief] flights sin columnas opcionales; reintentando sin ellas');
          const { data: insertedFlight, error: retryError } = await supabase
            .from("flights")
            .insert(stripOptionalColumns(flightRowWithCampaign))
            .select("id")
            .single();
          if (retryError) throw new Error(retryError.message);
          currentFlightId = insertedFlight?.id || null;
        }
      }

      if (currentFlightId) {
        setFlightId(currentFlightId);
        const hash = currentFlightId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        setGate("A" + ((hash % 30) + 1));
      }

      setFlightCode(gen.flight_number || "");
      setOriginICAO(origin.icao_code || "");
      setDestICAO(dest.icao_code || "");
      setAirline(gen.icao_airline || "");
      const initialRoute = getRouteDetails(origin.icao_code || "", dest.icao_code || "");
      setOriginCityName(initialRoute.orgCity);
      setDestCityName(initialRoute.destCity);

      // Resolver contra Supabase DESPUÉS del fallback síncrono y con `await`:
      // el valor de la DB (o su fallback) siempre se aplica en último lugar.
      // Sin `await`, en re-lecturas el caché instantáneo ganaba primero y el
      // fallback síncrono lo pisaba con el ICAO (bug: 1ª importación OK,
      // 2ª mostraba el código ICAO en ciudad destino).
      await resolveAirports(origin.icao_code || "", dest.icao_code || "");

      const mappedSimbriefData = {
        username: data.general?.pilot_id ? `pilot_${data.general.pilot_id}` : "capitán_msfs2024",
        nombrePiloto: data.general?.captain || "N. Sassano",
        vueloCodigo: data.general?.flight_number || "",
        origen: data.origin?.icao_code || "",
        destino: data.destination?.icao_code || "",
        aerolinea: data.general?.icao_airline || data.general?.airline || "",
        avion: data.aircraft?.name || "",
        cruisingAltitude: data.general?.route_altitude || "",
        blockTime: data.times?.est_block ? `${Math.round(parseFloat(data.times.est_block) * 60)} minutos` : "",
        pasajerosCount: parseInt(String(data.weights?.pax_count || "0"), 10),
      };

      onTriggerBriefImport(mappedSimbriefData);
      setIsBriefImported(true);
      setCanStartFlight(true);

      // Logs de depuración solicitados: verificar hora SimBrief UTC vs FlightContext
      // Formato consistente HH:MM UTC (para comparar con ZULU TIME)
      const utcDepartureHHMM = schedOutDate ? schedOutDate.toISOString().slice(11, 16) : null;
      console.log('[SimBrief] Hora de salida (UTC):', flightRow.departure_time, '| sched_out raw:', gen.sched_out, '| UTC HH:MM:', utcDepartureHHMM);
      // departureTimeStr se recalculará en el próximo render; log del valor derivado:
      console.log('[SimBrief] departureTime derivado (UTC HH:MM):', utcDepartureHHMM);
    } catch (err: any) {
      setSimbriefError(err?.message || "Error desconocido al conectar con SimBrief");
    } finally {
      setIsFetchingSimbrief(false);
    }
  };

  const eventGroups = useMemo(() => [
    // Inmersión: tarjeta de música + tarjeta de ritmo de embarque.
    { id: "immersion", label: t("current_flight.not_started.events.group_immersion"), count: immersionOptions.length + 1 },
    ...(scenarioSnapshot?.phases ?? []).map((phase) => ({
      id: phase.key,
      label: phase.name,
      count: phase.events.length,
    })),
  ], [t, scenarioSnapshot]);

  const getFilteredEvents = (): ScenarioEventConfig[] => {
    if (!scenarioSnapshot) return [];
    const phase = scenarioSnapshot.phases.find((entry) => entry.key === activeGroupTab);
    return phase?.events ?? [];
  };

  // Sub-stages state alignment according to user specs
  const [currentSubStage, setCurrentSubStage] = useState<string>(() => {
    if (currentState === FlightState.NoIniciado) return "No iniciado";
    if (currentState === FlightState.PreEmbarque) return "Embarque";
    if (currentState === FlightState.EnVuelo) return "Crucero";
    return "Rodaje a Puerta";
  });

  const simplifiedPhases = useMemo(() => [
    { label: t("current_flight.not_started.phases.boarding"), state: FlightState.PreEmbarque },
    { label: t("current_flight.not_started.phases.preflight"), state: FlightState.PreEmbarque },
    { label: t("current_flight.not_started.phases.taxi"), state: FlightState.PreEmbarque },
    { label: t("current_flight.not_started.phases.cruise"), state: FlightState.EnVuelo },
    { label: t("current_flight.not_started.phases.descent"), state: FlightState.EnVuelo },
    { label: t("current_flight.not_started.phases.taxitogate"), state: FlightState.Aterrizado },
    { label: t("current_flight.not_started.phases.atgate"), state: FlightState.Aterrizado }
  ], [t]);

  const getCurrentPhaseIndex = () => {
    const stage = currentSubStage.toLowerCase();
    if (stage === "no iniciado") return 0;
    if (stage === "embarque") return 0;
    if (stage === "pre-vuelo") return 1;
    if (stage.includes("pre-vuelo") || stage.includes("pre-embarque") || stage.includes("prevuelo")) return 1;
    if (stage === "rodaje") return 2;
    if (stage === "crucero" || stage === "despegue" || stage === "ascenso") return 3;
    if (stage === "descenso" || stage === "aproximación") return 4;
    if (stage === "rodaje a puerta" || stage === "aterrizaje" || stage.includes("puerta")) return 5;
    if (stage === "plataforma" || stage.includes("estacionamiento")) return 6;
    
    // Safety Fallbacks based on broad state
    if (currentState === FlightState.NoIniciado) return 0;
    if (currentState === FlightState.PreEmbarque) return 0;
    if (currentState === FlightState.EnVuelo) return 3;
    if (currentState === FlightState.Aterrizado) return 5;
    return 0;
  };

  const activeIndex = getCurrentPhaseIndex();

  // Fases del stepper dinámico, construidas a partir del escenario cargado
  // (GATE y BOARDING siempre presentes). Se recalculan cuando cambia la fase.
  const stepperPhases = useMemo(() => {
    return schedulerRef.current?.getScenarioPhases() ?? ["GATE", "BOARDING"];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepperCurrentPhase, flightPhase, currentState]);
  // `activeIndex` se mantiene para compatibilidad con el auto-avance legacy
  // (deshabilitado) de las fases 2 a 7.

  // El stepper es visual (Stage 18D): no dispara transiciones reales del FSM.
  const handleStepperPhaseChange = (phase: string) => {
    setStepperCurrentPhase(phase);
    const mapped = phaseToSubStage(phase);
    setCurrentSubStage(mapped.subStage);
  };

  const isPhase2To7 = ["Pre-vuelo", "Rodaje", "Crucero", "Descenso", "Rodaje a Puerta", "Plataforma"].includes(currentSubStage);
  const isPhase2To6 = ["Pre-vuelo", "Rodaje", "Crucero", "Descenso", "Rodaje a Puerta"].includes(currentSubStage);

  const stageMockData: Record<string, {
    satisfaction: number;
    fear: number;
    hunger: number;
    bathroom: number;
    announcement: {
      texto: string;
      tipo: string;
      reproduciendo: boolean;
    };
  }> = {
    "Pre-vuelo": {
      satisfaction: 92,
      fear: 12,
      hunger: 15,
      bathroom: 8,
      announcement: {
        texto: "Bienvenidos a bordo. Les habla el comandante de vuelo. Iniciamos listas de comprobación previas y daremos inicio en instantes a nuestro empuje (pushback). Buen viaje.",
        tipo: "bienvenida",
        reproduciendo: true
      }
    },
    "Rodaje": {
      satisfaction: 84,
      fear: 28,
      hunger: 35,
      bathroom: 20,
      announcement: {
        texto: "Cabin crew, slides armed and cross-check. Tripulación de cabina, armar toboganes y verificar puertas. Nos dirigimos al umbral de la pista para despegue inmediato.",
        tipo: "seguridad",
        reproduciendo: true
      }
    },
    "Crucero": {
      satisfaction: 95,
      fear: 8,
      hunger: 70,
      bathroom: 55,
      announcement: {
        texto: "Estimados pasajeros, hemos alcanzado nuestra altitud de crucero de 36,000 pies. Las condiciones del tiempo son óptimas. El servicio de comida a bordo comenzará en breve.",
        tipo: "bienvenida",
        reproduciendo: true
      }
    },
    "Descenso": {
      satisfaction: 81,
      fear: 38,
      hunger: 22,
      bathroom: 45,
      announcement: {
        texto: "Señores pasajeros, hemos iniciado nuestro descenso hacia destino. Se solicita regresar a sus asientos y asegurar sus cinturones de seguridad. Tripulación, preparar cabina.",
        tipo: "descenso",
        reproduciendo: true
      }
    },
    "Rodaje a Puerta": {
      satisfaction: 94,
      fear: 4,
      hunger: 30,
      bathroom: 15,
      announcement: {
        texto: "Bienvenidos a destino. Hemos estacionado de forma segura. Por favor mantengan sus cinturones abrochados hasta que el capitán apague el cartel indicador.",
        tipo: "aterrizaje",
        reproduciendo: true
      }
    },
    "Plataforma": {
      satisfaction: 98,
      fear: 2,
      hunger: 10,
      bathroom: 5,
      announcement: {
        texto: "Señores pasajeros, hemos completado nuestro estacionamiento en la plataforma de destino de forma totalmente segura. Ha sido un gran placer tripular este de vuelo junto a ustedes. Les deseamos una feliz estancia.",
        tipo: "desembarque",
        reproduciendo: true
      }
    }
  };

  const mockInfo = stageMockData[currentSubStage];

  // TODO Migration (Stage 18D):
  //
  // Legacy mockup auto-advance timer for phases 2 to 7.
  // DISABLED: the FlightFSM/SimulationController is the only authority that
  // may advance flight phases. The UI must NOT auto-advance between phases.
  // Kept as documentation; not replaced by another timer.
  React.useEffect(() => {
    if (!isPhase2To7) return;
    return;
    // eslint-disable-next-line no-unreachable
    const timer = setInterval(() => {
      const currentIndex = getCurrentPhaseIndex();
      // Only advance if we are in phases 2 to 6 (indices 1 to 5) - so we can advance to 7 (Plataforma, index 6)
      if (currentIndex >= 1 && currentIndex < 6) {
        const nextIndex = currentIndex + 1;
        const nextPhase = simplifiedPhases[nextIndex];
        setCurrentSubStage(nextPhase.label);
        onStateChange(nextPhase.state);
      }
    }, 10000); // 10 seconds

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhase2To7, currentSubStage]);

  React.useEffect(() => {
    if (currentState === FlightState.NoIniciado) {
      if (currentSubStage !== "No iniciado") {
        setCurrentSubStage("No iniciado");
      }
    } else if (currentState === FlightState.PreEmbarque) {
      const allowed = ["Embarque", "Pre-vuelo", "Pre-Vuelo", "Rodaje"];
      if (!allowed.includes(currentSubStage)) {
        setCurrentSubStage("Embarque");
      }
    } else if (currentState === FlightState.EnVuelo) {
      const allowed = ["Crucero", "Descenso"];
      if (!allowed.includes(currentSubStage)) {
        setCurrentSubStage("Crucero");
      }
    } else if (currentState === FlightState.Aterrizado) {
      const allowed = ["Rodaje a Puerta", "Plataforma"];
      if (!allowed.includes(currentSubStage)) {
        setCurrentSubStage("Rodaje a Puerta");
      }
    }
  }, [currentState]);

  // Phase 7 specific effects (AI report generation and manifest collapse)
  React.useEffect(() => {
    if (currentSubStage === "Plataforma") {
      setIsReportGenerating(true);
      setIsManifestCollapsed(true);
      const timer = setTimeout(() => {
        setIsReportGenerating(false);
      }, 3000); // 3 seconds AI Report generation simulation spinner
      return () => clearTimeout(timer);
    } else {
      setIsManifestCollapsed(false);
    }
  }, [currentSubStage]);

  // TODO Migration (Stage 18D):
  //
  // Legacy mockup auto-advance after boarding is complete.
  // DISABLED: the FlightFSM/SimulationController is the only authority that
  // may advance flight phases. The UI must NOT auto-advance to "Pre-vuelo".
  // Kept as documentation; not replaced by another timer.
  React.useEffect(() => {
    if (boardedCount >= passengers.length && passengers.length > 0 && currentState === FlightState.PreEmbarque && currentSubStage === "Embarque") {
      // const autoAdvanceTimer = setTimeout(() => {
      //   setCurrentSubStage("Pre-vuelo");
      // }, 30000);
      // return () => clearTimeout(autoAdvanceTimer);
    }
  }, [boardedCount, passengers.length, currentState, currentSubStage]);

  const displayTotalPassengers = boardingManifest.length > 0 ? boardingManifest.length : passengers.length;
  const displayBoardedCount = boardedCount;
  const boardingComplete = displayTotalPassengers > 0 && boardedCount >= displayTotalPassengers;
  // El cierre de puertas requiere ÚNICAMENTE el embarque de pasajeros
  // completo (boardedCount >= manifiesto). Los pasos opcionales pendientes
  // (p. ej. demoras no disparadas) no deben bloquearlo: Scheduler.closeDoors()
  // los omite automáticamente.
  const canCloseDoors = boardingComplete;

  // ── IFE (fase 1): resumen de vuelo + invitado aleatorio ──────────
  // Se calcula una sola vez por vuelo (clave estable) para que el
  // pasajero destacado no cambie en cada render.
  const ifeFlight = React.useMemo(() => buildIfeFlightInfo(simbriefRawData), [simbriefRawData]);
  const ifeFlightKey = `${ifeFlight.airlineIcao}-${ifeFlight.flightNumber}-${ifeFlight.originIcao}-${ifeFlight.destIcao}`;
  const ifeGuest = React.useMemo(() => {
    const source = boardingManifest.length > 0 ? boardingManifest : passengers;
    const boarded = source.slice(0, Math.max(boardedCount, source.length));
    return pickIfeGuest(boarded.length > 0 ? boarded : source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifeFlightKey]);

  // ── IFE · Mapa en vivo: coordenadas, telemetría y recorrido ──────
  const ifeOriginCoords = React.useMemo<[number, number] | null>(() => {
    const a = resolvedAirports.origin;
    return a && Number.isFinite(a.latitude_deg) && Number.isFinite(a.longitude_deg)
      ? [a.latitude_deg, a.longitude_deg]
      : null;
  }, [resolvedAirports.origin]);
  const ifeDestCoords = React.useMemo<[number, number] | null>(() => {
    const a = resolvedAirports.dest;
    return a && Number.isFinite(a.latitude_deg) && Number.isFinite(a.longitude_deg)
      ? [a.latitude_deg, a.longitude_deg]
      : null;
  }, [resolvedAirports.dest]);
  const ifeGetTelemetry = React.useCallback(() => {
    const tele: any = flightContextRef.current?.getTelemetry?.();
    if (!tele) return null;
    const lat = Number(tele.latitude);
    const lon = Number(tele.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      latitude: lat,
      longitude: lon,
      altitude: Number(tele.altitude) || 0,
      groundspeed: Number(tele.groundspeed ?? tele.ground_speed) || 0,
      heading: Number(tele.heading) || 0,
      verticalSpeed: Number(tele.verticalSpeed) || 0,
    };
  }, []);
  const ifeGetFlownPath = React.useCallback(() => {
    const pts = flightPathRecorderRef.current?.toSnapshot().points ?? [];
    // FlightPathPoint = [lon, lat, alt, spd, sec] → [lat, lon].
    return pts.map((p) => [p[1], p[0]] as [number, number]);
  }, []);

  // Compute ETA block minutes from raw SimBrief data
  const blockMinutes = React.useMemo(() => {
    if (simbriefRawData?.times?.est_block) {
      return Math.round(parseFloat(simbriefRawData.times.est_block) * 60);
    }
    const match = (simBriefData.blockTime || "").match(/(\d+)/);
    return match ? parseInt(match[1]) : 75;
  }, [simbriefRawData, simBriefData]);

  // Compute departure time UTC from SimBrief sched_out (para comparar con ZULU TIME)
  // FIX: antes se convertía a hora local del aeropuerto (getAirportTimezone), causando desfase vs SimBrief UTC.
  // Ahora se almacena siempre en HH:MM UTC consistente.
  // Se añaden logs detallados para diagnosticar por qué simbriefRawData puede no contener sched_out.
  const departureTimeStr = React.useMemo(() => {
    // Logs detallados solicitados
    console.log('[DepartureTime] 🔍 simbriefRawData:', simbriefRawData);
    console.log('[DepartureTime] 🔍 general.sched_out:', simbriefRawData?.general?.sched_out);
    console.log('[SimBrief] Estructura de datos:', Object.keys(simbriefRawData || {}));
    console.log('[SimBrief] general:', (simbriefRawData as any)?.general);

    // Extracción robusta: SimBrief puede tener sched_out en general.sched_out (timestamp),
    // en times.sched_out, o como string HH:MM / ISO. Probamos múltiples campos.
    const candidates: Record<string, unknown> = {
      'general.sched_out': (simbriefRawData as any)?.general?.sched_out,
      'times.sched_out': (simbriefRawData as any)?.times?.sched_out,
      'general.orig_time': (simbriefRawData as any)?.general?.orig_time,
      'general.est_out': (simbriefRawData as any)?.general?.est_out,
      'general.departure_time': (simbriefRawData as any)?.general?.departure_time,
    };
    let rawCandidate: unknown = null;
    let candidateKey: string | null = null;
    for (const [k, v] of Object.entries(candidates)) {
      if (v !== undefined && v !== null && v !== '') {
        rawCandidate = v;
        candidateKey = k;
        break;
      }
    }
    // Fallback: si times no existe pero general.sched_out es el primario
    if (rawCandidate == null && simbriefRawData) {
      rawCandidate = (simbriefRawData as any)?.general?.sched_out;
      candidateKey = 'general.sched_out (fallback)';
    }

    const ts = Number(rawCandidate);
    console.log('[DepartureTime] 🔍 sched_out parsed:', ts, '| candidateKey:', candidateKey, '| raw:', rawCandidate);
    console.log('[DepartureTime] 🔍 Condición:', {
      hasSimbrief: !!simbriefRawData,
      hasGeneral: !!simbriefRawData?.general,
      hasSchedOut: !!simbriefRawData?.general?.sched_out,
      candidateKey,
      rawCandidate,
      isNumber: !isNaN(ts),
      isPositive: ts > 0,
    });

    // Caso 1: timestamp numérico (SimBrief estándar: unix seconds)
    if (!isNaN(ts) && ts > 0) {
      // Validar rango unix plausible (1970-2100): > 1e9 y < 4e9
      // Algunos OFP devuelven timestamp en string numérico, funciona con Number()
      const utcTime = new Date(ts * 1000).toISOString().slice(11, 16); // "HH:MM"
      console.log('[DepartureTime] ✅ UTC HH:MM desde timestamp:', utcTime);
      return utcTime;
    }

    // Caso 2: string ya en formato HH:MM[:SS] o ISO datetime
    if (typeof rawCandidate === 'string') {
      const s = rawCandidate.trim();
      // "01:10" o "01:10:00"
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
        const hhmm = s.slice(0, 5).padStart(5, '0');
        console.log('[DepartureTime] ✅ HH:MM desde string:', hhmm);
        return hhmm;
      }
      // Intentar parsear fecha ISO / similar
      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        const hhmm = parsed.toISOString().slice(11, 16);
        console.log('[DepartureTime] ✅ HH:MM desde Date string:', hhmm);
        return hhmm;
      }
    }

    // Si no se pudo extraer, log y fallback
    if (simbriefRawData) {
      console.warn('[DepartureTime] ⚠️ No se pudo extraer sched_out - usando fallback 12:45. Verificar estructura SimBrief arriba.');
    }
    return "12:45";
  }, [simbriefRawData]);

  // Offsets UTC de `of_airports.timezone_offset` (respaldo cuando el mapa IANA
  // no trae el aeropuerto). null = sin dato o mapa IANA vigente (no hace falta).
  const [originTzOffset, setOriginTzOffset] = useState<number | null>(null);
  const [destTzOffset, setDestTzOffset] = useState<number | null>(null);

  // Carga los offsets de origen/destino al importar (solo si el mapa IANA no
  // los cubre; el mapa sigue teniendo prioridad por contemplar DST).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const oIcao = ((simbriefRawData as any)?.origin?.icao_code || originICAO || "").toUpperCase().trim();
      const dIcao = ((simbriefRawData as any)?.destination?.icao_code || destICAO || "").toUpperCase().trim();
      const needOrigin = oIcao !== "" && getAirportTimezone(oIcao) === "UTC";
      const needDest = dIcao !== "" && getAirportTimezone(dIcao) === "UTC";
      if (!needOrigin) setOriginTzOffset(null);
      if (!needDest) setDestTzOffset(null);
      if (!needOrigin && !needDest) return;
      const [oOff, dOff] = await Promise.all([
        needOrigin ? getAirportUtcOffsetHours(oIcao) : Promise.resolve(null),
        needDest ? getAirportUtcOffsetHours(dIcao) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (needOrigin) {
        setOriginTzOffset(oOff);
        console.log("[Timezone] offset origen desde of_airports:", { icao: oIcao, offsetHours: oOff });
      }
      if (needDest) {
        setDestTzOffset(dOff);
        console.log("[Timezone] offset destino desde of_airports:", { icao: dIcao, offsetHours: dOff });
      }
    })();
    return () => { cancelled = true; };
  }, [simbriefRawData, originICAO, destICAO]);

  // Hora local del aeropuerto de origen para mostrar en UI (pre-embarque)
  // departureTime (UTC) se mantiene para cálculos internos (demoras vs ZULU TIME)
  const departureTimeLocalStr = React.useMemo(() => {
    // Reusar misma extracción robusta que departureTimeStr pero convertir a hora local
    const candidates: Record<string, unknown> = {
      'general.sched_out': (simbriefRawData as any)?.general?.sched_out,
      'times.sched_out': (simbriefRawData as any)?.times?.sched_out,
      'general.orig_time': (simbriefRawData as any)?.general?.orig_time,
      'general.est_out': (simbriefRawData as any)?.general?.est_out,
    };
    let rawCandidate: unknown = null;
    for (const v of Object.values(candidates)) {
      if (v !== undefined && v !== null && v !== '') {
        rawCandidate = v;
        break;
      }
    }
    if (rawCandidate == null) rawCandidate = (simbriefRawData as any)?.general?.sched_out;

    const ts = Number(rawCandidate);
    // Origen para timezone: prioridad SimBrief, fallback estado editable
    const originForTz = (simbriefRawData as any)?.origin?.icao_code || originICAO || "";
    const mapTz = getAirportTimezone(originForTz);
    // Mapa IANA primero (con DST); offset de of_airports como respaldo.
    const iana = mapTz !== "UTC" ? mapTz : null;
    const localTime = formatLocalHHMM(ts, iana, originTzOffset);
    if (localTime !== null) {
      console.log('[DepartureTimeLocal] ✅ origin:', originForTz, '| timezone:', iana ?? `UTC${originTzOffset ?? 0}`, '| UTC ts:', ts, '| local HH:MM:', localTime, '| UTC HH:MM:', departureTimeStr);
      return localTime;
    }
    if (typeof rawCandidate === 'string' && /^\d{1,2}:\d{2}/.test(rawCandidate.trim())) {
      // Si ya es HH:MM, no hay conversión, devolver tal cual (asumimos local si no hay timestamp)
      return rawCandidate.trim().slice(0, 5);
    }
    // Fallback: si no hay SimBrief, mantener mismo fallback que departureTimeStr pero en contexto local
    return departureTimeStr;
  }, [simbriefRawData, originICAO, departureTimeStr, originTzOffset]);

  // Hora local programada de ARRIBO (destino) para anuncios (arrival_time,
  // local_time). De sched_in UTC + huso de destino (IANA u offset).
  const arrivalTimeStr = React.useMemo(() => {
    const candidates: Record<string, unknown> = {
      'times.sched_in': (simbriefRawData as any)?.times?.sched_in,
      'general.sched_in': (simbriefRawData as any)?.general?.sched_in,
    };
    let rawCandidate: unknown = null;
    for (const v of Object.values(candidates)) {
      if (v !== undefined && v !== null && v !== '') {
        rawCandidate = v;
        break;
      }
    }
    const ts = Number(rawCandidate);
    if (!Number.isFinite(ts) || ts <= 0) return "";
    const destForTz = ((simbriefRawData as any)?.destination?.icao_code || destICAO || "").toUpperCase().trim();
    const mapTz = destForTz !== "" ? getAirportTimezone(destForTz) : "UTC";
    const iana = mapTz !== "UTC" ? mapTz : null;
    const local = formatLocalHHMM(ts, iana, destTzOffset);
    if (local === null) {
      // Sin huso conocido: UTC explícito (mismo criterio que departure local).
      const utc = new Date(ts * 1000).toISOString().slice(11, 16);
      console.log('[ArrivalTime] ⚠️ sin huso de destino, usando UTC:', { dest: destForTz, utc });
      return utc;
    }
    console.log('[ArrivalTime] ✅ dest:', destForTz, '| timezone:', iana ?? `UTC${destTzOffset ?? 0}`, '| local HH:MM:', local);
    return local;
  }, [simbriefRawData, destICAO, destTzOffset]);

  // Verificar que simbriefRawData se actualiza correctamente después de importación
  React.useEffect(() => {
    console.log('[SimBrief] Verificación estado simbriefRawData:', {
      isNull: simbriefRawData === null,
      isUndefined: simbriefRawData === undefined,
      keys: simbriefRawData ? Object.keys(simbriefRawData) : null,
      hasGeneral: !!(simbriefRawData as any)?.general,
      departureTimeStr,
      departureTimeLocalStr,
    });
    console.log('[DepartureTime] Estado actualizado -> departureTimeStr (UTC):', departureTimeStr, '| departureTimeLocalStr:', departureTimeLocalStr);
  }, [simbriefRawData, departureTimeStr, departureTimeLocalStr]);

  // Datos de un vuelo guardado en el backend (futuro). Si se carga un vuelo
  // persistido se setea aquí y tendrá prioridad sobre el estado editable.
  const savedFlightData: FlightInfo | null = null;

  // Fuente de datos efectiva para FlightContext.
  // Prioridad: SimBrief (datos crudos) > Vuelo guardado > Estado editable.
  // La pantalla de ajustes lee `simbriefRawData` para mostrar la ruta; si el
  // estado editable quedó desactualizado (p. ej. falló la importación), se usa
  // igual el vuelo de SimBrief para que pantalla y anuncios coincidan.
  const getContextDataSource = (): "simbrief" | "saved" | "editable" => {
    if (simbriefRawData?.general?.flight_number) return "simbrief";
    if (savedFlightData) return "saved";
    return "editable";
  };

  const buildFlightDataForContext = useCallback((): FlightInfo => {
    const gen = simbriefRawData?.general ?? null;
    const hasSimBrief = !!(gen && gen.flight_number);

    // scheduledTakeoffTime (segundos del día UTC, 0-86400) derivado de SimBrief
    // sched_out (epoch en segundos). Se normaliza para comparar contra zuluTime
    // (que MSFS reporta como segundos desde medianoche UTC).
    const schedOutRaw: unknown =
      (simbriefRawData as any)?.general?.sched_out ??
      (simbriefRawData as any)?.times?.sched_out ??
      (simbriefRawData as any)?.general?.est_out ??
      null;
    const schedOutTs = Number(schedOutRaw);
    let scheduledTakeoffSec: number | undefined;
    if (!Number.isNaN(schedOutTs) && schedOutTs > 0) {
      if (schedOutTs > 86400 && schedOutTs < 4102444800) {
        const d = new Date(schedOutTs * 1000);
        scheduledTakeoffSec = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      } else {
        scheduledTakeoffSec = Math.round(schedOutTs);
      }
      console.log("[VueloActualView] scheduledTakeoffTime asignado:", {
        raw: schedOutRaw,
        epochSeconds: schedOutTs,
        scheduledTakeoffSec,
        formatted: secondsToHHMM(scheduledTakeoffSec),
      });
    } else {
      console.warn("[VueloActualView] scheduledTakeoffTime NO asignado:", schedOutRaw);
    }

    // ── Datos de crucero (fase CRUISE) ──────────────────────────────────
    // cruise_time de SimBrief (segundos) + cálculo de vuelo internacional
    // (una sola vez aquí, al construir los datos; se propaga vía syncFlightContext).
    // NOTA: `times.cruise_time` no existe en el JSON de SimBrief; se deriva del
    // navlog (Σ time_leg con stage CRZ). Ver resolveCruiseTimeSeconds.
    const cruiseResolved = resolveCruiseTimeSeconds(simbriefRawData);
    const cruiseTimeSeconds = cruiseResolved.seconds;
    if (hasSimBrief) {
      console.log('[SimBrief] cruise_time raw:', (simbriefRawData as any)?.times?.cruise_time);
      console.log('[SimBrief] cruiseTimeSeconds:', cruiseTimeSeconds, `(fuente: ${cruiseResolved.source})`);
      console.log('[SimBrief] durationMinutes:', (simbriefRawData as any)?.times?.est_time_enroute);
    }
    const cruiseOriginICAO = simbriefRawData?.origin?.icao_code || originICAO || "";
    const cruiseDestICAO = simbriefRawData?.destination?.icao_code || destICAO || "";
    const cruiseIsInternational = cruiseOriginICAO && cruiseDestICAO
      ? isInternationalFlight(cruiseOriginICAO, cruiseDestICAO)
      : false;

    // ── Datos de aeronave y duración (restricciones CRUISE) ─────────────
    // El ICAO se deriva de forma síncrona; el flag widebody llega del estado
    // `simbriefAircraft` (resuelto una sola vez en handleImportSimbrief contra
    // aircraft_types). Si aún no resolvió, se preserva el valor previo del contexto.
    const sbAircraftIcao = String(
      (simbriefRawData as any)?.aircraft?.icao_code
        ?? (simbriefRawData as any)?.aircraft?.icaocode
        ?? (simbriefRawData as any)?.general?.icao_aircraft
        ?? ""
    ).toUpperCase();
    const prevFlight = flightContextRef.current?.getFlight();
    const aircraftIsWidebody = (simbriefAircraft && sbAircraftIcao !== "" && simbriefAircraft.icao === sbAircraftIcao)
      ? simbriefAircraft.isWidebody
      : (prevFlight?.aircraftType === sbAircraftIcao ? prevFlight?.aircraftIsWidebody : undefined);

    // Duración estimada en minutos: est_time_enroute (segundos) con fallback
    // a est_block (horas decimales). Misma convención que blockMinutes/flightDuration.
    let durationMinutes = 0;
    const enrouteRaw = Number((simbriefRawData as any)?.times?.est_time_enroute);
    if (!Number.isNaN(enrouteRaw) && enrouteRaw > 0) {
      durationMinutes = Math.round(enrouteRaw / 60);
    } else {
      const blockRaw = parseFloat((simbriefRawData as any)?.times?.est_block);
      if (!Number.isNaN(blockRaw) && blockRaw > 0) durationMinutes = Math.round(blockRaw * 60);
    }

    // ── Altitud de crucero en pies (transición a descenso) ──────────────
    // SimBrief `general.route_altitude` (pies, a veces "FL350"). Si el valor
    // parece nivel de vuelo (<= 500), se convierte a pies. Sin dato se
    // preserva el valor previo del contexto.
    // Diagnóstico de campos de altitud del OFP (cruising_altitude caía a
    // fallback: verificar qué campo trae el dato real).
    if (hasSimBrief) {
      console.log('[SimBrief] Claves de general:', Object.keys((simbriefRawData as any)?.general || {}));
      console.log('[SimBrief] Valores de altitud:', {
        route_altitude: (simbriefRawData as any)?.general?.route_altitude,
        cruise_altitude: (simbriefRawData as any)?.general?.cruise_altitude,
        initial_altitude: (simbriefRawData as any)?.general?.initial_altitude,
        cruise_alt: (simbriefRawData as any)?.general?.cruise_alt,
        altitude: (simbriefRawData as any)?.general?.altitude,
        costindex_altitude: (simbriefRawData as any)?.general?.costindex_altitude,
      });
    }
    let cruiseAltitude: number | undefined;
    const rawAlt = (simbriefRawData as any)?.general?.route_altitude
      ?? (simbriefRawData as any)?.general?.initial_altitude
      ?? "";
    const altNum = Number(String(rawAlt).replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(altNum) && altNum > 0) {
      cruiseAltitude = altNum <= 500 ? Math.round(altNum * 100) : Math.round(altNum);
    } else if (prevFlight?.cruiseAltitude) {
      cruiseAltitude = prevFlight.cruiseAltitude;
    }
    if (hasSimBrief) {
      console.log("[SimBrief] Datos de crucero:", {
        cruiseTimeSeconds,
        cruiseTimeFormatted: `${Math.floor(cruiseTimeSeconds / 60)}m`,
        originICAO: cruiseOriginICAO,
        destICAO: cruiseDestICAO,
        isInternational: cruiseIsInternational,
        originCountry: cruiseOriginICAO ? getCountryKey(cruiseOriginICAO) : "—",
        destCountry: cruiseDestICAO ? getCountryKey(cruiseDestICAO) : "—",
      });
    }

    // ── Distancia total + coords destino ("cuenta regresiva" del progreso) ─
    // SimBrief `general.route_distance` o círculo máximo origen→destino
    // (pos_lat/pos_long). Sin dato, el progreso usa fallback por tiempo.
    // Las coords de la tabla `airports` (ya resueltas) tienen prioridad sobre
    // SimBrief porque cubren +10.000 aeropuertos con datos curados.
    const totalResolved = resolveTotalDistanceNm(simbriefRawData);
    const totalDistanceNm = totalResolved.nm > 0 ? totalResolved.nm : undefined;
    const dbDestLat = resolvedAirports.dest?.latitude_deg;
    const dbDestLon = resolvedAirports.dest?.longitude_deg;
    const sbDestLatRaw = Number(
      (simbriefRawData as any)?.destination?.pos_lat ??
      (simbriefRawData as any)?.destination?.posLat
    );
    const sbDestLonRaw = Number(
      (simbriefRawData as any)?.destination?.pos_long ??
      (simbriefRawData as any)?.destination?.posLong
    );
    const destLatitude =
      typeof dbDestLat === "number" && Number.isFinite(dbDestLat)
        ? dbDestLat
        : Number.isFinite(sbDestLatRaw) ? sbDestLatRaw : undefined;
    const destLongitude =
      typeof dbDestLon === "number" && Number.isFinite(dbDestLon)
        ? dbDestLon
        : Number.isFinite(sbDestLonRaw) ? sbDestLonRaw : undefined;
    if (hasSimBrief) {
      console.log('[SimBrief] Distancia total:', totalDistanceNm ?? 0, `NM (fuente: ${totalResolved.source})`);
    }

    if (hasSimBrief) {
      const srcOriginIcao = simbriefRawData?.origin?.icao_code ?? "";
      const srcDestIcao = simbriefRawData?.destination?.icao_code ?? "";
      return {
        airline:
          getAirlineName(gen.icao_airline || gen.airline) ||
          getAirlineName(airline) ||
          airline,
        flightNumber: gen.flight_number || flightCode,
        originICAO: srcOriginIcao || originICAO,
        destICAO: srcDestIcao || destICAO,
        originCity:
          resolvedAirports.origin?.municipality ||
          getAirportName(srcOriginIcao) ||
          simbriefRawData?.origin?.city ||
          originCityName ||
          getRouteDetails(originICAO, destICAO).orgCity,
        destCity:
          resolvedAirports.dest?.municipality ||
          getAirportName(srcDestIcao) ||
          simbriefRawData?.destination?.city ||
          destCityName ||
          getRouteDetails(originICAO, destICAO).destCity,
        gate,
        departureTime: departureTimeStr,
        departureTimeLocal: departureTimeLocalStr,
        // Hora local de arribo (destino) para anuncios de llegada; undefined
        // si no hay dato (la variable usa su fallback textual).
        arrivalTime: arrivalTimeStr !== "" ? arrivalTimeStr : undefined,
        scheduledTakeoffTime: scheduledTakeoffSec,
        cruiseTimeSeconds,
        isInternational: cruiseIsInternational,
        aircraftType: sbAircraftIcao || undefined,
        aircraftIsWidebody,
        durationMinutes,
        cruiseAltitude,
        totalDistanceNm,
        destLatitude,
        destLongitude,
        captainPrimaryLang,
        captainSecondaryLang,
        flightId,
        specialEvent: specialEvents,
        specialEventEnabled: specialEventEnabled,
      };
    }

    if (savedFlightData) {
      return {
        ...savedFlightData,
        scheduledTakeoffTime: scheduledTakeoffSec,
        cruiseTimeSeconds,
        arrivalTime: arrivalTimeStr !== "" ? arrivalTimeStr : savedFlightData.arrivalTime,
        totalDistanceNm: totalDistanceNm ?? savedFlightData.totalDistanceNm,
        destLatitude: destLatitude ?? savedFlightData.destLatitude,
        destLongitude: destLongitude ?? savedFlightData.destLongitude,
        isInternational: savedFlightData.isInternational ?? cruiseIsInternational,
        aircraftType: savedFlightData.aircraftType ?? (sbAircraftIcao || undefined),
        aircraftIsWidebody: savedFlightData.aircraftIsWidebody ?? aircraftIsWidebody,
        durationMinutes: savedFlightData.durationMinutes ?? durationMinutes,
        cruiseAltitude: savedFlightData.cruiseAltitude ?? cruiseAltitude,
        specialEvent: specialEvents,
        specialEventEnabled: specialEventEnabled,
      };
    }

    return {
      airline: getAirlineName(airline) || airline,
      flightNumber: flightCode,
      originICAO,
      destICAO,
      originCity: originCityName || getRouteDetails(originICAO, destICAO).orgCity,
      destCity: destCityName || getRouteDetails(originICAO, destICAO).destCity,
      gate,
      departureTime: departureTimeStr,
      departureTimeLocal: departureTimeLocalStr,
      scheduledTakeoffTime: scheduledTakeoffSec,
      cruiseTimeSeconds,
      isInternational: cruiseIsInternational,
      aircraftType: sbAircraftIcao || undefined,
      aircraftIsWidebody,
      durationMinutes,
      cruiseAltitude,
      captainPrimaryLang,
      captainSecondaryLang,
      flightId,
      specialEvent: specialEvents,
      specialEventEnabled: specialEventEnabled,
    };
  }, [
    airline, flightCode, originICAO, destICAO, originCityName, destCityName,
    gate, departureTimeStr, departureTimeLocalStr, arrivalTimeStr, captainPrimaryLang, captainSecondaryLang, flightId,
    simbriefRawData, simbriefAircraft, resolvedAirports,
    specialEvents, specialEventEnabled,
  ]);

  // Sincroniza FlightContext con los datos actuales de la UI. Es una función
  // (no solo un efecto) porque también se invoca explícitamente en
  // `handleStartFlight` para garantizar que los anuncios usen los datos del
  // vuelo recién importado y no los del vuelo anterior (condición de carrera).
  const syncFlightContext = useCallback((source = "useEffect sync") => {
    const ctx = flightContextRef.current;
    const player = announcementPlayerRef.current;
    if (ctx) {
      ctx.updateFlight(buildFlightDataForContext());
      ctx.updateVoices({
        captain: captainVoice,
        crew: crewVoice,
        gateAgent: gateAgentVoiceId,
        // Catálogo para el pinning en dispatch: rol e idiomas por voz. Sin
        // esto, los eventos gate_* no pueden validar voz↔idioma al invocar.
        voiceRoles: Object.fromEntries(availableVoices.map((v) => [v.id, v.role])),
        voiceLanguages: Object.fromEntries(availableVoices.map((v) => [v.id, v.languages ?? []])),
      });
      ctx.updateSettings({
        scenarioKey: selectedScenarioKey,
        eventConfig,
      });
      ctx.updateSimbrief(simbriefRawData ? { data: simbriefRawData } : { data: {} });
    }
    if (player && ctx) {
      player.setFlightContext(ctx);
    }
    // [DEBUG] Rastro de cuándo/cómo se actualizó FlightContext y con qué datos.
    console.log("[DEBUG] FlightContext actualizado:", {
      flight: ctx?.getFlight(),
      dataSource: getContextDataSource(),
      source,
      timestamp: Date.now(),
    });
    // Log requerido para criterio de aceptación: verificar departureTime en UTC y local
    console.log('[FlightContext] departureTime actualizado (UTC):', ctx?.getFlight().departureTime);
    console.log('[FlightContext] departureTimeLocal actualizado:', ctx?.getFlight().departureTimeLocal);
    // Verificación scheduledTakeoffTime (eventos de demora)
    console.log('[FlightContext] scheduledTakeoffTime:', {
      value: ctx?.getFlight().scheduledTakeoffTime,
      formatted: typeof ctx?.getFlight().scheduledTakeoffTime === "number" ? secondsToHHMM(ctx.getFlight().scheduledTakeoffTime!) : "NO DEFINIDO",
    });
    // Log adicional SimBrief UTC si hay datos
    if (simbriefRawData?.general?.sched_out) {
      const schedOutUtc = new Date(Number(simbriefRawData.general.sched_out) * 1000).toISOString().slice(11, 16);
      console.log('[SimBrief] Hora de salida (UTC):', schedOutUtc, '| raw sched_out:', simbriefRawData.general.sched_out, '| local:', departureTimeLocalStr);
    }
  }, [
    airline, flightCode, originICAO, destICAO, originCityName, destCityName,
    gate, departureTimeStr, departureTimeLocalStr, captainPrimaryLang, captainSecondaryLang, flightId,
    captainVoice, crewVoice, gateAgentVoiceId, availableVoices, eventConfig, selectedScenarioKey, simbriefRawData,
    buildFlightDataForContext,
  ]);

  // Sync all editable flight data to FlightContext
  useEffect(() => {
    syncFlightContext();

    // TEMP DIAGNOSTIC LOG (Stage 19A) — remove later.
    const ctx = flightContextRef.current;
    const cfg = ctx?.getSettings()?.eventConfig;
    if (cfg) {
      console.log("[CONFIG]");
      console.log("Flight event configuration loaded");
      console.log("Scenario: " + (ctx?.getSettings()?.scenarioKey ?? "(missing)"));
      for (const key of ["preflight_crew_welcome", "preflight_crew_basic_info", "preflight_capt_welcome", "preflight_capt_basic_info"]) {
        console.log(key + " = " + (cfg[key] ?? "(missing)"));
      }
    }
  }, [syncFlightContext]);

  // Compute flight duration from SimBrief air_time (seconds)
  const flightDuration = React.useMemo(() => {
    const raw = simbriefRawData?.times?.est_time_enroute;
    if (raw) {
      const seconds = Number(raw);
      if (!isNaN(seconds) && seconds > 0) {
        const totalMinutes = Math.floor(seconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return `${hours}h ${mins}m`;
      }
    }
    return null;
  }, [simbriefRawData]);

  // Parse METAR from SimBrief destination data
  const metarData = React.useMemo(() => {
    return parseMETAR(simbriefRawData?.destination?.metar || "");
  }, [simbriefRawData]);

  // Fase 1 pasajeros: el motor es la ÚNICA fuente de los resúmenes de
  // satisfacción (los mockups legacy por etapa quedaron eliminados).
  // paxAverages se refresca 1Hz; null = muestra aún no iniciada.
  const paxScore =
    paxAverages !== null
      ? Math.round(
          (paxAverages.saciedad +
            paxAverages.confortFisiologico +
            paxAverages.calma +
            paxAverages.entretenimiento) /
            4
        )
      : null;
  // Muestra trackeada para conteos y lista compacta (se relee en cada render;
  // el estado paxAverages 1Hz es el que dispara el re-render).
  const enginePaxList = passengerEngineRef.current?.isStarted()
    ? passengerEngineRef.current.getState().passengers
    : [];
  const enginePaxScore = (attrs: AttributeState): number =>
    Math.round(
      (attrs.saciedad + attrs.confortFisiologico + attrs.calma + attrs.entretenimiento) / 4
    );
  const enginePaxNames = (() => {
    try {
      const map = new Map<string, string>();
      for (const b of passengerEngineRef.current?.getArchetypeBreakdown() ?? []) {
        map.set(b.archetypeId, b.name);
      }
      return map;
    } catch {
      return new Map<string, string>();
    }
  })();

  // SVG parameters for satisfying circular gauge
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((paxScore ?? 0) / 100) * circumference;

  // Render score stars or land ratings back
  const getLandingRating = (fpm: number) => {
    const absFpm = Math.abs(fpm);
    if (absFpm <= 100) return { title: "¡Suavidad Celestial!", desc: "Aterrizaje perfecto de seda. ¡Los pasajeros aplauden de pie!", color: "text-[#43E600]", rating: "A++" };
    if (absFpm <= 150) return { title: "Aterrizaje de Mantequilla", desc: "Suave e impecable técnica de frenado and flare.", color: "text-[#43E600]", rating: "A" };
    if (absFpm <= 240) return { title: "Aterrizaje Comercial Firme", desc: "Firme pero seguro, correcto despliegue de deflactores.", color: "text-[#E68B00]", rating: "B" };
    if (absFpm <= 360) return { title: "Aterrizaje Duro (Denta-Check)", desc: "Impacto seco. Asegúrate de revisar el tren de aterrizaje.", color: "text-[#E68B00]", rating: "C" };
    return { title: "Aterrizaje Brutal (Destructor de Suspensión)", desc: "¡Excediste los límites del amortiguador estructural!", color: "text-[#E600D2]", rating: "F" };
  };

  const ratingObj = getLandingRating(landingFpm);

  if (showPackageManager) {
    return (
      <div id="package-manager-view" className="space-y-6 animate-fadeIn text-white w-full">
        {/* Header */}
        <div id="pkg-mgr-header" className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#3B7EB2]/50 pb-4 gap-4">
          <div>
            <button
              id="btn-return-flight"
              type="button"
              onClick={() => setShowPackageManager(false)}
              className="text-[#45AFFF] hover:text-[#43E600] font-mono font-bold text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5 focus:outline-none transition-all border border-[#3B7EB2]/30 px-3 py-1.5 rounded bg-[#00172e]/50 cursor-pointer"
            >
              ← {t("volar.back_to_select")}
            </button>
            <h1 className="font-display font-extrabold text-3xl tracking-tight text-[#45AFFF] flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-[#43E600] animate-pulse" />
              Gestión de Packages Personalizados
            </h1>
            <p className="text-sm text-white/70">
              Administra tus carpetas de sonido, voces pre-grabadas y asigna efectos personalizados para la simulación.
            </p>
          </div>
          
          <button
            id="btn-create-pkg"
            type="button"
            onClick={() => showToast("Simulación de Importación: Elige un archivo ZIP o JSON con el manifest del Sound Pack.", "info")}
            className="bg-[#43E600] text-black hover:bg-[#34b300] font-mono font-black text-xs px-4 py-2.5 rounded-[5px] transition-all flex items-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(67,230,0,0.4)]"
          >
            + Crear Nuevo Package
          </button>
        </div>

        {/* Dashboard Grid */}
        <div id="pkg-mgr-grid" className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* Package list left panel */}
          <div id="pkg-list-panel" className="xl:col-span-1 space-y-4">
            <div className="bg-[#00172e]/80 border border-[#3B7EB2]/45 rounded-[6px] p-5 space-y-4">
              <span className="text-[10px] font-mono text-[#45AFFF] font-bold block uppercase tracking-wider border-b border-white/5 pb-2">
                MIS SOUNDPACKS INSTALADOS
              </span>
              
              {[
                { id: "aerolineas", name: "Aerolíneas Argentinas AR Pack", items: 32, size: "124 MB", status: "Inyectado", desc: "Acento porteño y de cabina AR real con anuncios de radio." },
                { id: "latam", name: "LATAM Real Voice Pack v2", items: 28, size: "98 MB", status: "Listo", desc: "Voz bilingüe en español neutro e inglés para rutas sudamericanas." },
                { id: "iberia", name: "Iberia Premium Audio", items: 35, size: "155 MB", status: "Listo", desc: "Locuciones castellanas españolas optimizadas para Flota A320 y A350." },
                { id: "flybondi", name: "Flybondi Low-Cost set", items: 25, size: "82 MB", status: "Listo", desc: "Estilo informal del piloto con chistes de baja altura y humor bajo coste." },
                { id: "default", name: "Default FS Soundset", items: 32, size: "45 MB", status: "Por defecto", desc: "Voz robótica sintética estándar de Microsoft Flight Simulator." }
              ].map((pack) => {
                const isSelected = selectedPackage === pack.id;
                return (
                  <div
                    key={pack.id}
                    className={`p-3.5 rounded-[5px] border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-[#2C6591]/35 border-[#43E600] shadow-[0_0_10px_rgba(67,230,0,0.15)]"
                        : "bg-black/15 border-white/5 hover:border-[#3B7EB2]/40"
                    }`}
                    onClick={() => setSelectedPackage(pack.id)}
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="font-sans font-black text-sm text-white">{pack.name}</span>
                      <span className={`text-[8.5px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                        isSelected 
                          ? "bg-[#43E600]/20 text-[#43E600] border border-[#43E600]/30" 
                          : "bg-white/5 text-white/50"
                      }`}>
                        {isSelected ? "ACTIVO" : pack.status}
                      </span>
                    </div>
                    <p className="text-xs text-white/60 mb-2 leading-relaxed">{pack.desc}</p>
                    <div className="flex justify-between items-center text-[10px] font-mono text-white/40 border-t border-white/5 pt-2 mt-2">
                      <span>Tracks mapeados: <strong className="text-white">{pack.items}</strong></span>
                      <span>Tamaño: <strong className="text-white">{pack.size}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right audit details panel */}
          <div id="pkg-details-panel" className="xl:col-span-2 space-y-6">
            <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div>
                  <span className="text-[10px] font-mono text-[#45AFFF] font-bold block uppercase tracking-wider">
                    DETALLES DE REPRODUCCIÓN / TRACKS ACTUALES
                  </span>
                  <h3 className="text-lg font-sans font-black text-white uppercase mt-0.5">
                    {selectedPackage === "aerolineas" ? "Aerolíneas Argentinas AR Pack" :
                     selectedPackage === "latam" ? "LATAM Real Voice Pack v2" :
                     selectedPackage === "iberia" ? "Iberia Premium Audio" :
                     selectedPackage === "flybondi" ? "Flybondi Low-Cost set" : "Default FS Soundset"}
                  </h3>
                </div>
                <div className="text-right text-[11px] font-mono text-white/60">
                  {t("flight_view.pkg_manager_dir")} <strong className="text-white">announs/packs/{selectedPackage}/</strong>
                </div>
              </div>

              <p className="text-xs text-white/70 leading-relaxed mb-2">
                {t("flight_view.pkg_manager_intro")}
              </p>

              <div className="space-y-3.5 max-h-[580px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
                {[
                  { event: "Tono de aviso de cabina (Chime)", file: "chime_double_announcement.wav", key: "play_chime_sound_before_ann", type: "Efecto Cabina" },
                  { event: "Sonido ambiente en vuelo", file: "cabin_ambient_passengers.wav", key: "play_ambient_sound_during_flight", type: "Ambiente" },
                  { event: "Saludos de cabina en puerta", file: "crew_welcome_at_gate.mp3", key: "crew_greeting_passengers_at_gate", type: "Pista Tripulación" },
                  { event: "Reacciones de pasajeros al movimiento", file: "passenger_gasps_turbulence.wav", key: "passenger_reaction_to_planes_movement", type: "Efecto Cabina" },
                  { event: "Reacciones al aterrizar (Aplausos/Quejas)", file: "landing_applause_crowd.mp3", key: "play_passenger_reaction_during_landing", type: "Efecto Cabina" },
                  { event: "Música de embarque y desembarque", file: "boarding_jazz_lounge.mp3", key: "play_boarding_music", type: "Sonido de Fondo" },
                  { event: "Anuncio de Bienvenida Cap", file: "capt_bienvenida_ar.mp3", key: "preflight_capt_welcome", type: "Pista Comandante" },
                  { event: "Demostración de Seguridad Cabina", file: "safety_instruction_full.mp3", key: "taxi_crew_safety_brief", type: "Pista Tripulación" },
                  { event: "Cruising Altitude Crux", file: "cruise_capt_general_info.mp3", key: "cruise_capt_general_info", type: "Pista Comandante" }
                ].map((track, idx) => {
                  return (
                    <div key={track.key} className="bg-black/25 border border-white/5 hover:border-[#3B7EB2]/45 p-3.5 rounded-[5px] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 transition-all">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-white/30 font-bold w-5">{idx + 1}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-white/80">{track.event}</span>
                            <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-[#45AFFF]/20 text-[#45AFFF] leading-none uppercase">
                              {track.type}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-[#43E600]/80 mt-1 block">📄 {track.file}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between md:justify-end gap-3 border-t md:border-0 border-white/5 pt-2.5 md:pt-0">
                        <button
                          type="button"
                          onClick={() => {
                            showToast(`Probando sonido asociado: ${track.file}. Escuchando retroalimentación de altavoz de techo...`, "info");
                          }}
                          className="text-[10px] font-mono px-3 py-1.5 rounded cursor-pointer transition-all uppercase flex items-center gap-1.5 bg-[#002440]/60 text-[#45AFFF] border border-[#3B7EB2]/40 hover:bg-[#45AFFF] hover:text-[#00172e]"
                        >
                          <span>⚡ {t("flight_view.pkg_test_audio")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const newName = prompt(`Cambiar archivo asignado a ${track.event}:`, track.file);
                            if (newName) {
                              showToast(`Se ha reasociado el evento '${track.event}' al archivo '${newName}' de forma satisfactoria.`, "success");
                            }
                          }}
                          className="bg-white/5 text-white/70 hover:bg-white/10 text-[10px] font-mono px-3 py-1.5 rounded border border-white/10 transition-all cursor-pointer"
                        >
                          {t("flight_view.pkg_reassign")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status and instruction info */}
              <div className="bg-[#43E600]/5 border border-[#43E600]/30 rounded-[5px] p-4 text-xs font-sans text-white/90 leading-relaxed">
                💡 <strong>{t("flight_view.pkg_tip_title")}</strong> {t("flight_view.pkg_tip_body")}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  return (
      <div id="vuelo-actual-container" className="space-y-6">
      
      {/* 🛡️ DYNAMIC FLIGHT STAGES TIMELINE (Linear Stepper) */}
      {currentState !== FlightState.NoIniciado && (
        <div 
          id="debug-toolbar" 
          className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-4 text-xs shadow-lg space-y-4"
        >
          {/* Header line of the stepper */}
          <div className="flex items-center justify-between border-b border-white/5 pb-2 gap-2">
            <div className="flex items-center gap-2 font-mono text-[#45AFFF] font-extrabold text-xs uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-[#43E600] animate-pulse" />
              <span>{t("flight_view.stages_title")}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-mono text-white/55 uppercase hidden sm:block">
                {t("flight_view.active_phase")} <span className="text-[#43E600] font-black">{tStage(currentSubStage)}</span>
              </div>
              <DebugMonitorButton onClick={() => setIsDebugOpen(true)} />
            </div>
          </div>

          {/* Stepper dinámico construido a partir de las fases del escenario cargado */}
          <div className="pl-1 pr-1 pt-1.5 pb-1">
            <FlightStepper
              phases={stepperPhases}
              currentPhase={stepperCurrentPhase}
              onPhaseChange={handleStepperPhaseChange}
            />
          </div>

          {/* Manual step-by-step controls (modo pruebas) */}
          {isTestModeFlight && (
            <div className="border-t border-white/5 pt-3 space-y-3">
              <ManualStepControls
                step={pendingManualStep}
                index={stepIndex}
                total={stepTotal}
                displayName={
                  pendingManualStep
                    ? (EventCatalogService.get(pendingManualStep.eventKey)?.description ?? "")
                    : ""
                }
                onNext={() => {
                  console.log("[UI] Siguiente paso -> Scheduler.nextManualStep()");
                  schedulerRef.current?.nextManualStep();
                }}
                onSkip={() => {
                  console.log("[UI] Saltar paso -> Scheduler.skipStep()");
                  schedulerRef.current?.skipStep();
                }}
                busy={false}
              />
              <StepHistory entries={stepHistory} />
            </div>
          )}
        </div>
      )}

      {/* VIEW HEADER & PHASE TAG */}
      {currentState === FlightState.NoIniciado ? (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-[#3B7EB2]/50 pb-4 gap-4">
          <div>
            <h1 className="font-display font-extrabold text-3xl tracking-tight text-[#45AFFF]">
              {showFlightSelect
                ? t("volar.title")
                : isFlightSettingsOpen
                  ? t("current_flight.not_started.settings_title")
                  : t("current_flight.not_started.title")}
            </h1>
          </div>
          {/* La importación vive en la pantalla de selección (Volar);
              el encabezado clásico ya no duplica el botón. */}
        </div>
      ) : (
        <div className="bg-[#001d35]/75 border border-[#3B7EB2]/40 rounded-[5px] p-5 shadow-xl animate-fadeIn flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 w-full">
          {/* Horizontal route details */}
          <div className="flex flex-col sm:flex-row flex-wrap items-start gap-6 flex-1 w-full md:w-auto">
            {/* Airline & Flight */}
            <div className="flex flex-col text-center sm:text-left shrink-0">
              <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                {t("current_flight.not_started.header.airline_and_flight")}
              </span>
              <span className="text-sm font-sans font-black text-white mt-1 uppercase">
                {simbriefRawData?.general?.icao_airline || ""}{simbriefRawData?.general?.flight_number || ""}
              </span>
            </div>

            <div className="h-8 w-[1px] bg-white/10 hidden sm:block shrink-0" />

            {/* Origin */}
            <div className="flex flex-col text-center sm:text-left">
              <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                {t("current_flight.not_started.header.origin")}
              </span>
              <span className="text-sm font-sans font-black text-white mt-1 uppercase flex flex-col justify-center sm:justify-start">
                <span className="text-white">{simbriefRawData?.origin?.icao_code}</span>
                <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{preFlightOriginCity}{simbriefRawData?.origin?.name ? ' (' + simbriefRawData.origin.name + ')' : ''}</span>
              </span>
            </div>

            {/* Arrow */}
            <div className="text-white/30 hidden sm:block mt-2">
              <ArrowRight className="w-4 h-4 text-[#45AFFF]" />
            </div>

            {/* Destination */}
            <div className="flex flex-col text-center sm:text-left">
              <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                {t("current_flight.not_started.header.destination")}
              </span>
              <span className="text-sm font-sans font-black mt-1 uppercase flex flex-col justify-center sm:justify-start">
                <span className="text-[#43E600]">{simbriefRawData?.destination?.icao_code}</span>
                <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{preFlightDestCity}{simbriefRawData?.destination?.name ? ' (' + simbriefRawData.destination.name + ')' : ''}</span>
              </span>
            </div>

            <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

            {/* Additional operational details */}
            <div className="grid grid-cols-2 gap-x-5 text-[10px] font-mono text-white/70 flex-1 pl-0 lg:pl-1 mt-1 sm:mt-0 w-full lg:w-auto">
              <div>
                <span className="text-white/40 block">{t("current_flight.not_started.header.aircraft")}</span>
                <span className="text-white font-bold text-xl">{simbriefRawData?.aircraft?.name || ""}</span>
              </div>
              <div>
                <span className="text-white/40 block">{t("current_flight.not_started.header.passengers")}</span>
                <span className="text-sm font-sans font-black text-[#43E600]">{simbriefRawData?.weights?.pax_count || ""} PAX</span>
              </div>
            </div>
          </div>

          {/* Action Buttons area replacing Connection Widget & Phase Stamp */}
          <div className="flex flex-row items-center gap-3 shrink-0 border-t md:border-0 border-white/5 pt-3 md:pt-0 self-center md:self-auto">
            {isPhase2To7 ? (
              currentSubStage === "Plataforma" ? (
                <button 
                  id="header-btn-finalizar-vuelo"
                  onClick={() => { void handleFinalizarVuelo(); }}
                  className="bg-[#43E600] text-black font-mono font-black px-4 py-2 rounded-[5px] text-xs hover:bg-[#3bcc00] transition-all flex items-center justify-center gap-1.5 cursor-pointer h-9 shrink-0 shadow-[0_0_15px_rgba(67,230,0,0.35)] hover:scale-[1.01] active:scale-[0.99]"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {t("flight_view.finalize")}
                </button>
              ) : showCancelConfirm ? (
                <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 p-1.5 rounded-[5px] h-9 animate-fadeIn">
                  <span className="text-[9px] font-mono text-red-400 font-bold px-1 uppercase tracking-wider hidden sm:inline">                    {t("flight_view.confirm_q")}</span>
                  <button
                    onClick={() => {
                      setIsBoardingActive(false);
                      setBoardedCount(0);
                      setBoardingStarted(false);
                      setShowCancelConfirm(false);
                      onStateChange(FlightState.NoIniciado);
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold px-2 py-1 rounded text-[10px] uppercase transition-all cursor-pointer"
                  >
                    {t("flight_view.yes_exit")}
                  </button>
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="bg-white/10 hover:bg-white/20 text-white font-mono font-medium px-2 py-1 rounded text-[10px] uppercase transition-all cursor-pointer"
                  >
                    {t("flight_view.no")}
                  </button>
                </div>
              ) : (
                <button 
                  id="header-btn-cancelar"
                  onClick={() => setShowCancelConfirm(true)}
                  className="bg-red-500/20 hover:bg-red-500/35 text-red-400 font-mono font-bold px-3 py-2 rounded-[5px] text-xs border border-red-500/30 hover:border-red-500/50 transition-all flex items-center justify-center gap-1.5 cursor-pointer h-9 shrink-0"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  {t("flight_view.cancel")}
                </button>
              )
            ) : (
              currentState === FlightState.PreEmbarque && (flightPhase === "GATE" || boardingStarted) && (
                <div className="flex items-center gap-2">
                  {!boardingStarted ? (
                    <button 
                      id="header-btn-volver"
                      onClick={() => {
                        setIsBoardingActive(false);
                        setBoardedCount(0);
                        onStateChange(FlightState.NoIniciado);
                      }}
                      className="bg-[#002440]/60 hover:bg-[#002440]/90 text-white/90 font-mono font-bold px-3 py-2 rounded-[5px] text-xs border border-white/10 hover:border-white/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer h-9 shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {t("flight_view.back")}
                    </button>
                  ) : showCancelConfirm ? (
                    <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 p-1.5 rounded-[5px] h-9">
                      <span className="text-[9px] font-mono text-red-400 font-bold px-1 uppercase tracking-wider hidden sm:inline">                    {t("flight_view.confirm_q")}</span>
                      <button
                        onClick={() => {
                          setIsBoardingActive(false);
                          setBoardedCount(0);
                          setBoardingStarted(false);
                          setShowCancelConfirm(false);
                          onStateChange(FlightState.NoIniciado);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold px-2 py-1 rounded text-[10px] uppercase transition-all cursor-pointer"
                      >
                        {t("flight_view.yes_exit")}
                      </button>
                      <button
                        onClick={() => setShowCancelConfirm(false)}
                        className="bg-white/10 hover:bg-white/20 text-white font-mono font-medium px-2 py-1 rounded text-[10px] uppercase transition-all cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button 
                      id="header-btn-cancelar"
                      onClick={() => setShowCancelConfirm(true)}
                      className="bg-red-500/20 hover:bg-red-500/35 text-red-400 font-mono font-bold px-3 py-2 rounded-[5px] text-xs border border-red-500/30 hover:border-red-500/50 transition-all flex items-center justify-center gap-1.5 cursor-pointer h-9 shrink-0"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {t("flight_view.cancel")}
                    </button>
                  )}

                  {!boardingComplete && !isBoardingActive && (
                    <button 
                      id="header-btn-toggle-boarding"
                      onClick={() => {
                        setBoardingStarted(true);
                        setIsBoardingActive(true);

                        // Stage 18A.2: "Comenzar embarque" solo inicia el
                        // escenario narrativo de BOARDING cuando se está en
                        // GATE (Fase 0). La transición GATE -> BOARDING es
                        // controlada por el usuario vía Scheduler.startBoarding().
                        // Además notifica al Mock para liberar GATE y transiciona FSM con fuente 'user'
                        if (flightPhase === "GATE") {
                          console.log("[UI] Comenzar embarque -> Scheduler.startBoarding()");
                          schedulerRef.current?.startBoarding();
                          // Notificar al Mock que el usuario solicitó embarque (libera GATE hold)
                          const ctrl: any = flightControllerRef.current;
                          if (ctrl && typeof ctrl.notifyBoardingRequested === "function") {
                            ctrl.notifyBoardingRequested();
                          }
                          // Sincronizar FSM: GATE -> BOARDING solo con fuente 'user'
                          flightFSMRef.current?.transition(FlightPhase.BOARDING, 'user');
                        }
                      }}
                      className="bg-[#43E600] hover:bg-[#3bcc00] text-black font-mono font-bold px-4 py-2 rounded-[5px] text-xs flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-md h-9 shrink-0 cursor-pointer animate-pulse shadow-[0_0_15px_rgba(67,230,0,0.3)]"
                    >
                      <Play className="w-3.5 h-3.5 fill-black" />
                      {t("flight_view.start_boarding")}
                    </button>
                  )}

                  {/* Cierre de puertas mixto: manual (fallback) y automático.
                      Habilitado solo cuando todos los pasos de BOARDING
                      están completados. En modo pruebas se usa para avanzar
                      de BOARDING a PRE_FLIGHT. */}
                  {boardingStarted && (
                    <button
                      id="header-btn-close-doors"
                      onClick={() => {
                        console.log("[UI] Cerrar puertas -> Scheduler.closeDoors()");
                        schedulerRef.current?.closeDoors();
                      }}
                      disabled={!canCloseDoors}
                      title={!boardingComplete ? t("flight_view.waiting_boarding") : t("flight_view.close_doors_ready")}
                      className={`font-mono font-bold px-4 py-2 rounded-[5px] text-xs flex items-center justify-center gap-1.5 h-9 shrink-0 transition-all ${
                        canCloseDoors
                          ? "bg-[#E68B00] hover:bg-[#ffa726] text-black shadow-[0_0_15px_rgba(230,139,0,0.35)] cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                          : "bg-white/5 border border-white/10 text-white/35 cursor-not-allowed"
                      }`}
                    >
                      <DoorClosed className="w-3.5 h-3.5" />
                      {t("flight_view.close_doors")}
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ==================== ESTADO A: NO INICIADO ==================== */}
      {currentState === FlightState.NoIniciado && (
        <div id="vuelo-estado-A" className="space-y-6 animate-fadeIn text-white w-full">
          {/* Advertencia de conexión movida a la línea de Monitor/Descargar logs
              (cluster fijo superior derecho) para ganar espacio vertical. */}

          {isFlightSettingsOpen ? (
            <div id="pantalla-ajustes-vuelo" className="space-y-6 animate-fadeIn pb-8">
              {/* Sin vuelo cargado: se requiere importar desde SimBrief antes de iniciar */}
              {!canStartFlight && (
                <div className="bg-[#E68B00]/10 border border-[#E68B00]/40 rounded-[5px] p-4 text-xs font-sans text-[#ffb03a] leading-relaxed">
                  {t("current_flight.not_started.no_flight_loaded", {
                    defaultValue: "No hay vuelo cargado. Importá un vuelo desde SimBrief para poder iniciar.",
                  })}
                </div>
              )}
              
              {/* Horizontal route details banner maintained at the top */}
              {canStartFlight && (
                <div className="bg-[#001d35]/75 border border-[#3B7EB2]/40 rounded-[5px] p-5 shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 w-full">
                  {/* Horizontal route details */}
                  <div className="flex flex-col sm:flex-row flex-wrap items-start gap-6 flex-1 w-full md:w-auto">
                    {/* Airline & Flight */}
                    <div className="flex flex-col text-center sm:text-left shrink-0">
                      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                        {t("current_flight.not_started.header.airline_and_flight")}
                      </span>
                      <span className="text-sm font-sans font-black text-white mt-1 uppercase">
                        {simbriefRawData?.general?.icao_airline || ""}{simbriefRawData?.general?.flight_number || ""}
                      </span>
                    </div>

                    <div className="h-8 w-[1px] bg-white/10 hidden sm:block shrink-0" />

                    {/* Origin */}
                    <div className="flex flex-col text-center sm:text-left">
                      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                        {t("current_flight.not_started.header.origin")}
                      </span>
                      <span className="text-sm font-sans font-black text-white mt-1 uppercase flex flex-col justify-center sm:justify-start">
                        <span className="text-white">{simbriefRawData?.origin?.icao_code}</span>
                        <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{preFlightOriginCity}{simbriefRawData?.origin?.name ? ' (' + simbriefRawData.origin.name + ')' : ''}</span>
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="text-white/30 hidden sm:block mt-2">
                      <ArrowRight className="w-4 h-4 text-[#45AFFF]" />
                    </div>

                    {/* Destination */}
                    <div className="flex flex-col text-center sm:text-left">
                      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                        {t("current_flight.not_started.header.destination")}
                      </span>
                      <span className="text-sm font-sans font-black mt-1 uppercase flex flex-col justify-center sm:justify-start">
                        <span className="text-[#43E600]">{simbriefRawData?.destination?.icao_code}</span>
                        <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{preFlightDestCity}{simbriefRawData?.destination?.name ? ' (' + simbriefRawData.destination.name + ')' : ''}</span>
                      </span>
                    </div>

                <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

                {/* Badge de campaña vigente (match por origen + destino) */}
                {campaignMatch && campaignMatch.xpMultiplier > 1 && (
                  <div className="flex flex-col text-center sm:text-left shrink-0">
                    <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#E68B00]/90 uppercase">
                      {t("volar.campaign_matched")}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 bg-[#E68B00]/10 border border-[#E68B00]/50 rounded-[4px] px-2 py-1 font-mono font-extrabold text-[11px] text-[#E68B00] whitespace-nowrap">
                      {formatMultiplier(campaignMatch.xpMultiplier)} XP
                    </span>
                  </div>
                )}

                <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

                    {/* Additional operational details */}
                    <div className="grid grid-cols-2 gap-x-5 text-[10px] font-mono text-white/70 flex-1 pl-0 lg:pl-1 mt-1 sm:mt-0 w-full lg:w-auto">
                      <div>
                        <span className="text-white/40 block">{t("current_flight.not_started.header.aircraft")}</span>
                        <span className="text-white font-bold text-xl">{simbriefRawData?.aircraft?.name || ""}</span>
                      </div>
                      <div>
                        <span className="text-white/40 block">{t("current_flight.not_started.header.passengers")}</span>
                        <span className="text-sm font-sans font-black text-[#43E600]">{simbriefRawData?.weights?.pax_count || ""} PAX</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-3 shrink-0 border-t md:border-0 border-white/5 pt-3 md:pt-0">
                    <button
                      type="button"
                      onClick={() => setIsFlightSettingsOpen(false)}
                      className="bg-[#002440] hover:bg-[#00345C] text-white/90 hover:text-white border border-[#3B7EB2]/45 hover:border-[#3B7EB2] px-4 py-2 rounded-[5px] text-xs font-mono font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
                    >
                      {t("flight_view.back")}
                    </button>

                    <div className="flex flex-col items-stretch gap-1.5">
                      <button
                        type="button"
                        disabled={!hasValidFlight || isStartingFlight || languagesLoading || voicesLoading || !languagesReady || !!languageError || !voicesReady || !!voiceError || (!isConnected && !isTestMode)}
                        onClick={() => handleStartFlight("normal")}
                        title={!isConnected && !isTestMode ? t("volar.connection_required") : undefined}
                        className="bg-[#43E600] hover:bg-[#3cd000] disabled:bg-[#43E600]/40 disabled:cursor-not-allowed text-black font-black px-5 py-2 rounded-[5px] text-xs font-mono flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(67,230,0,0.3)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
                      >
                        <Play className="w-3.5 h-3.5 fill-black" strokeWidth={3} />
                        {isStartingFlight ? t("current_flight.not_started.starting_flight_btn") : t("flight.settings.start_flight_btn")}
                      </button>

                      <button
                        type="button"
                        disabled={!hasValidFlight || isStartingFlight || languagesLoading || voicesLoading || !languagesReady || !!languageError || !voicesReady || !!voiceError}
                        onClick={handleStartTests}
                        className="text-[10px] font-mono text-white/50 hover:text-white/80 hover:underline underline-offset-2 transition-colors cursor-pointer text-center disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t("flight.settings.start_test_btn")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* BLOQUE 1: Tripulación y Cabina */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Idioma y voces block - occupies 2 columns */}
                <div className="md:col-span-2 bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-6">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                    <Globe className="w-5 h-5 text-[#45AFFF]" />
                    <h3 className="font-display font-bold text-base text-[#45AFFF]">
                      {t("current_flight.not_started.crew.title")}
                    </h3>
                  </div>

                  {/* Idioma y voces */}
                  <div className="space-y-4">
                    {/* Idioma */}
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1">{t("current_flight.not_started.crew.language")}</label>
                      <select
                        value={captainPrimaryLang}
                        onChange={(e) => { userPickedRef.current.lang = true; setCaptainPrimaryLang(e.target.value); }}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {languagesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : langOptions.length === 0 ? (
                          <option value="" disabled>{languageError || t("flight_view.no_languages")}</option>
                        ) : (
                          langOptions.map((lang) => (
                            <option key={lang.id} value={lang.id}>{lang.name}</option>
                          ))
                        )}
                      </select>
                    </div>

                    {/* Voz del Agente de Puerta */}
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1">{t("current_flight.not_started.crew.gate_voice")}</label>
                      <select
                        value={gateAgentVoiceId}
                        onChange={(e) => { userPickedRef.current.gate = true; setGateAgentVoiceId(e.target.value); }}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {voicesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : gateVoiceOptions.length === 0 ? (
                          <option value="" disabled>{voiceError || t("flight_view.no_gate_voices")}</option>
                        ) : (
                          <>
                            <option value="" disabled>{t("current_flight.not_started.crew.select_voice")}</option>
                            {gateVoiceOptions.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>

                    {/* Voz del Capitán */}
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1">{t("current_flight.not_started.crew.captain_voice")}</label>
                      <select
                        value={captainVoice}
                        onChange={(e) => { userPickedRef.current.captain = true; setCaptainVoice(e.target.value); }}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {voicesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : captainVoiceOptions.length === 0 ? (
                          <option value="" disabled>{voiceError || t("flight_view.no_captain_voices")}</option>
                        ) : (
                          <>
                            <option value="" disabled>{t("current_flight.not_started.crew.select_voice")}</option>
                            {captainVoiceOptions.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>

                    {/* Voz de la Tripulación */}
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1">{t("current_flight.not_started.crew.cabin_voice")}</label>
                      <select
                        value={crewVoice}
                        onChange={(e) => { userPickedRef.current.crew = true; setCrewVoice(e.target.value); }}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {voicesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : crewVoiceOptions.length === 0 ? (
                          <option value="" disabled>{voiceError || t("flight_view.no_crew_voices")}</option>
                        ) : (
                          <>
                            <option value="" disabled>{t("current_flight.not_started.crew.select_voice")}</option>
                            {crewVoiceOptions.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>

                    {/* Hint */}
                    <div className="bg-[#45AFFF]/5 border border-[#45AFFF]/30 rounded-[5px] p-3 text-[11px] font-sans text-white/70 leading-relaxed">
                      <Info className="w-3.5 h-3.5 inline mr-1 text-[#45AFFF]" />
                      {t("current_flight.not_started.crew.voices_hint")}
                    </div>
                  </div>
                </div>

                {/* Editables Block - occupies 1 column */}
                <div className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                      <Plane className="w-5 h-5 text-[#45AFFF]" />
                      <h3 className="font-display font-bold text-base text-[#45AFFF]">
                        {t("current_flight.not_started.identifications.title")}
                      </h3>
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1 uppercase">{t("current_flight.not_started.identifications.airline")}</label>
                      <input
                        type="text"
                        value={getAirlineName(airline)}
                        onChange={(e) => setAirline(e.target.value)}
                        placeholder={t("current_flight.not_started.identifications.airline_placeholder")}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20 font-bold"
                      />
                      {airline.trim() && (
                        <span className="block text-[10px] font-mono mt-1.5 px-1">
                          {getAirlineName(airline) !== airline.trim().toUpperCase()
                            ? `Aerolínea: ${getAirlineName(airline)}`
                            : <span className="text-amber-400">Aerolínea no encontrada en base de datos</span>}
                        </span>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1 uppercase">{t("current_flight.not_started.identifications.origin_city")}</label>
                      <input
                        type="text"
                        value={originCityName}
                        onChange={(e) => setOriginCityName(e.target.value)}
                        placeholder={t("current_flight.not_started.identifications.city_placeholder")}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1 uppercase">{t("current_flight.not_started.identifications.dest_city")}</label>
                      <input
                        type="text"
                        value={destCityName}
                        onChange={(e) => setDestCityName(e.target.value)}
                        placeholder={t("current_flight.not_started.identifications.city_placeholder")}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20 font-bold"
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* BLOQUE 2: Eventos Especiales */}
              <div className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <span className="text-base">🎉</span>
                  <h3 className="font-display font-bold text-base text-[#45AFFF]">
                    {t("flight_view.special_events_title")}
                  </h3>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3 p-2.5 bg-[#002440]/35 border border-[#3B7EB2]/15 hover:border-[#3B7EB2]/35 rounded-[5px] cursor-pointer hover:bg-[#002440]/55 transition-all w-full select-none">
                    <span className="text-white text-[11px] font-sans font-medium">{t("flight_view.special_event_enable")}</span>
                    <div className="relative inline-flex items-center shrink-0">
                      <input
                        type="checkbox"
                        checked={specialEventEnabled}
                        onChange={(e) => setSpecialEventEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4.5 bg-[#00172e] border border-[#3B7EB2]/45 rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[3.5px] after:left-[3px] after:bg-white/40 peer-checked:after:bg-[#43E600] after:border-white/10 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-[#43E600]/20 peer-checked:border-[#43E600]/40"></div>
                    </div>
                  </label>

                  <div className="flex justify-between items-center text-[10px] font-mono text-white/50">
                    <span className="uppercase font-bold">{t("flight_view.special_event_detail")}</span>
                    <span className={specialEvents.length >= 450 ? "text-[#e68b00] font-bold animate-pulse" : "text-white/40"}>
                      {specialEvents.length} / 500 caract.
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={specialEvents}
                    onChange={(e) => setSpecialEvents(e.target.value)}
                    disabled={!specialEventEnabled}
                    placeholder={t("flight_view.special_event_placeholder")}
                    className={`w-full border rounded-[5px] p-3 text-xs placeholder-white/30 font-sans focus:outline-none resize-none leading-relaxed focus:border-[#45AFFF] ${specialEventEnabled ? "bg-[#002440]/60 border-[#3B7EB2]/60 text-white" : "bg-[#00172e]/40 border-white/10 text-white/40 cursor-not-allowed"}`}
                  />
                  <p className="text-[11px] text-white/50 italic leading-snug">
                    {t("flight_view.special_event_example")}
                  </p>
                  <p className="text-[11px] text-[#45AFFF]/70 italic leading-snug bg-black/20 p-2 border border-white/5 rounded flex items-start gap-1.5">
                    <span>ℹ️</span>
                    <span>{t("flight_view.special_event_note")}</span>
                  </p>
                </div>
              </div>

              {/* BLOQUE 3: Plan de Cabina */}
              <div className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-6">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <Compass className="w-5 h-5 text-[#45AFFF]" />
                  <h3 className="font-display font-bold text-base text-[#45AFFF]">
                    {t("flight_view.cabin_plan_title")}
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Zona 1: Gastronomía */}
                  <div className="space-y-4 bg-black/20 p-4 rounded border border-white/5 flex flex-col">
                    <div>
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase block border-b border-white/5 pb-1 mb-3">
                        {t("flight_view.zone_catering")}
                      </span>
                      <div className="space-y-2.5">
                        <ToggleSwitch checked={foodService} onChange={setFoodService} label={t("flight_view.toggle_meal")} />
                        <ToggleSwitch checked={breakfastService} onChange={setBreakfastService} label={t("flight_view.toggle_breakfast")} />
                        <ToggleSwitch checked={snacksService} onChange={setSnacksService} label={t("flight_view.toggle_snacks")} />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5 mt-3">
                      <span className="block text-[10px] font-mono text-white/55 mb-2 uppercase tracking-wide">Catering:</span>
                      <div className="grid grid-cols-2 gap-1 bg-[#00345C] p-0.5 rounded border border-[#3B7EB2]/55">
                        <button
                          type="button"
                          onClick={() => setCateringType("cortesia")}
                          className={`text-[9.5px] font-mono py-1.5 rounded transition-all uppercase font-medium ${
                            cateringType === "cortesia"
                              ? "bg-[#43E600] text-black font-black shadow-sm"
                              : "text-[#45AFFF]/60 hover:text-white"
                          }`}
                        >
                          Cortesía
                        </button>
                        <button
                          type="button"
                          onClick={() => setCateringType("venta")}
                          className={`text-[9.5px] font-mono py-1.5 rounded transition-all uppercase font-medium ${
                            cateringType === "venta"
                              ? "bg-[#43E600] text-black font-black shadow-sm"
                              : "text-[#45AFFF]/60 hover:text-white"
                          }`}
                        >
                          Venta a bordo
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Zona 2: Ventas y Promociones */}
                  <div className="space-y-3 bg-black/20 p-4 rounded border border-white/5 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#45AFFF] uppercase block border-b border-white/5 pb-1 mb-3">
                        {t("flight_view.zone_sales")}
                      </span>
                      <div className="space-y-2.5">
                        <ToggleSwitch checked={dutyFree} onChange={setDutyFree} label={t("flight_view.toggle_dutyfree")} />
                        <ToggleSwitch checked={frequentFlyer} onChange={setFrequentFlyer} label={t("flight_view.toggle_frequent")} />
                      </div>
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2 font-sans line-clamp-2">
                       {t("flight_view.sales_note")}
                    </div>
                  </div>

                  {/* Zona 3: Confort y Procedimientos */}
                  <div className="space-y-3 bg-black/20 p-4 rounded border border-white/5 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#45AFFF] uppercase block border-b border-white/5 pb-1 mb-3">
                        {t("flight_view.zone_comfort")}
                      </span>
                      <div className="space-y-2.5">
                        <ToggleSwitch checked={wifiAnnouncement} onChange={setWifiAnnouncement} label={t("flight_view.toggle_wifi")} />
                        <ToggleSwitch checked={customsForms} onChange={setCustomsForms} label={t("flight_view.toggle_customs")} />
                      </div>
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2 font-sans line-clamp-2">
                      {t("flight_view.comfort_note")}
                    </div>
                  </div>

                </div>

                {/* Zona 4: Estilo de Comunicación */}
                <div className="pt-4 border-t border-white/10 space-y-3">
                  <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase block border-b border-[#3B7EB2]/45 pb-1">
                    {t("flight_view.zone_style")}
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 select-none">
                    {[
                      { 
                        id: 1, 
                        nombre: t("flight_view.style1_name"), 
                        hace: t("flight_view.style1_does"),
                        para: t("flight_view.style1_for") 
                      },
                      { 
                        id: 2, 
                        nombre: t("flight_view.style2_name"), 
                        hace: t("flight_view.style2_does"),
                        para: t("flight_view.style2_for") 
                      },
                      { 
                        id: 3, 
                        nombre: t("flight_view.style3_name"), 
                        hace: t("flight_view.style3_does"),
                        para: t("flight_view.style3_for") 
                      },
                      { 
                        id: 4, 
                        nombre: t("flight_view.style4_name"), 
                        hace: t("flight_view.style4_does"),
                        para: t("flight_view.style4_for") 
                      }
                    ].map((style) => (
                      <div
                        key={style.id}
                        onClick={() => setCommunicationStyle(style.id)}
                        className={`p-3 rounded border transition-all cursor-pointer text-left flex flex-col justify-between h-full ${
                          communicationStyle === style.id
                            ? "bg-[#2C6591]/40 border-[#43E600] ring-1 ring-[#43E600]/30 shadow-md"
                            : "bg-[#01172e] border-white/10 hover:border-white/25 hover:bg-[#002440]/30"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between border-b border-white/5 pb-1 mb-1.5">
                            <span className={`text-[10px] font-sans font-black leading-tight ${communicationStyle === style.id ? "text-[#43E600]" : "text-white"}`}>
                              {style.nombre}
                            </span>
                            {communicationStyle === style.id && <span className="w-1.5 h-1.5 rounded-full bg-[#43E600] animate-pulse" />}
                          </div>
                          <p className="text-[9.5px] text-white/70 leading-normal font-sans">{style.hace}</p>
                        </div>
                        <p className="text-[8px] text-[#45AFFF] leading-normal italic mt-2 border-t border-white/5 pt-1.5 font-sans">{style.para}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          ) : showFlightSelect ? (
            <FlightSelectView
              hasSimbriefId={!!simbriefId}
              isFetchingSimbrief={isFetchingSimbrief}
              simbriefError={simbriefError}
              onImportSimbrief={handleImportSimbrief}
              onNavigateToAccount={onNavigateToAccount}
            />
          ) : (
            <>
              {/* Informacion de Vuelo Básico (Visible after import or load) */}
              {canStartFlight && (
            <div className="bg-[#001d35]/75 border border-[#3B7EB2]/40 rounded-[5px] p-5 shadow-xl animate-fadeIn flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 w-full">
              {/* Horizontal route details */}
              <div className="flex flex-col sm:flex-row flex-wrap items-start gap-6 flex-1 w-full md:w-auto">
                {/* Airline & Flight */}
                <div className="flex flex-col text-center sm:text-left shrink-0">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                    {t("current_flight.not_started.header.airline_and_flight")}
                  </span>
                  <span className="text-sm font-sans font-black text-white mt-1 uppercase">
                    {simbriefRawData?.general?.icao_airline || ""}{simbriefRawData?.general?.flight_number || ""}
                  </span>
                </div>

                <div className="h-8 w-[1px] bg-white/10 hidden sm:block shrink-0" />

                {/* Origin */}
                <div className="flex flex-col text-center sm:text-left">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                    {t("current_flight.not_started.header.origin")}
                  </span>
                  <span className="text-sm font-sans font-black text-white mt-1 uppercase flex flex-col justify-center sm:justify-start">
                    <span className="text-white">{simbriefRawData?.origin?.icao_code}</span>
                    <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{preFlightOriginCity}{simbriefRawData?.origin?.name ? ' (' + simbriefRawData.origin.name + ')' : ''}</span>
                  </span>
                </div>

                {/* Arrow */}
                <div className="text-white/30 hidden sm:block mt-2">
                  <ArrowRight className="w-4 h-4 text-[#45AFFF]" />
                </div>

                {/* Destination */}
                <div className="flex flex-col text-center sm:text-left">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                    {t("current_flight.not_started.header.destination")}
                  </span>
                  <span className="text-sm font-sans font-black mt-1 uppercase flex flex-col justify-center sm:justify-start">
                    <span className="text-[#43E600]">{simbriefRawData?.destination?.icao_code}</span>
                    <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{preFlightDestCity}{simbriefRawData?.destination?.name ? ' (' + simbriefRawData.destination.name + ')' : ''}</span>
                  </span>
                </div>

                <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

                {/* Additional operational details */}
                <div className="grid grid-cols-2 gap-x-5 text-[10px] font-mono text-white/70 flex-1 pl-0 lg:pl-1 mt-1 sm:mt-0 w-full lg:w-auto">
                  <div>
                    <span className="text-white/40 block">{t("current_flight.not_started.header.aircraft")}</span>
                    <span className="text-white font-bold text-xl">{simbriefRawData?.aircraft?.name || ""}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">{t("current_flight.not_started.header.passengers")}</span>
                    <span className="text-sm font-sans font-black text-[#43E600]">{simbriefRawData?.weights?.pax_count || ""} PAX</span>
                  </div>
                </div>
              </div>

              {/* Status or reimport callback options */}
              <div className="flex flex-col items-center md:items-end justify-center gap-2.5 shrink-0 border-t md:border-0 border-white/5 pt-3 md:pt-0">
                <button
                  id="btn-iniciar-vuelo-main"
                  type="button"
                  onClick={() => {
                    setIsFlightSettingsOpen(true);
                  }}
                  className="bg-[#43E600] hover:bg-[#3cd000] text-black font-black px-6 py-2.5 rounded-[5px] text-xs font-mono flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(67,230,0,0.3)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
                >
                  <Play className="w-3.5 h-3.5 fill-black" strokeWidth={3} />
                  {t("current_flight.not_started.start_flight_btn")}
                </button>
                <button
                  onClick={handleBackToSelection}
                  className="text-[10px] text-[#45AFFF] hover:underline flex items-center gap-1 cursor-pointer font-mono font-bold"
                >
                  <ArrowLeft className="w-3 h-3" />
                  {t("volar.back_to_select")}
                </button>
              </div>
            </div>
          )}
          
          {/* Configurar Eventos - Stacked full width */}
          <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-5 shadow-lg space-y-4 w-full">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-[#45AFFF]" />
                <h3 className="font-display font-bold text-base text-[#45AFFF]">
                  {t("current_flight.not_started.event_config.title")}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* Scenario selector: la config de eventos está vinculada a un escenario */}
                <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-[5px] px-3 py-1.5">
                  <label className="text-[9px] font-mono font-bold text-white/55 uppercase tracking-wider whitespace-nowrap">
                    {t("current_flight.not_started.event_config.scenario_label")}
                  </label>
                  <select
                    value={selectedScenarioKey}
                    onChange={(e) => setSelectedScenarioKey(e.target.value)}
                    className="bg-black/55 border border-[#3B7EB2]/45 text-xs text-white font-mono font-bold rounded-[3px] px-2 py-0.5 focus:outline-none cursor-pointer hover:border-[#45AFFF] transition-colors"
                  >
                    {scenarios.length === 0 && (
                      <option value={selectedScenarioKey}>{selectedScenarioKey}</option>
                    )}
                    {scenarios.map((scenario) => (
                      <option key={scenario.key} value={scenario.key}>{scenario.name}</option>
                    ))}
                  </select>
                  {scenarioLoading && (
                    <span className="text-[10px] font-mono text-[#45AFFF] animate-pulse">
                      {t("current_flight.not_started.event_config.scenario_loading")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <p className="text-xs text-white/80 leading-relaxed">
              {t("current_flight.not_started.event_config.description")}
            </p>

            {/* Event Category Tabs */}
            <div className="flex flex-wrap gap-1 bg-black/20 p-1 rounded-[5px] border border-white/5 w-full">
              {eventGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroupTab(group.id)}
                  className={`px-2.5 py-1.5 text-[10px] font-mono font-bold rounded-[3px] transition-all flex-1 text-center cursor-pointer ${
                    activeGroupTab === group.id
                      ? "bg-[#45AFFF] text-[#00172e] shadow-sm"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {group.label} ({group.count})
                </button>
              ))}
            </div>

            {/* wider layout event configuration cards: 2 columns in full-width workspace with description first and narrator below */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[460px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
              {activeGroupTab === "immersion" ? (
                <>
                {immersionOptions.map((item) => {
                  const currentValue = immersionConfig[item.key] ?? true;

                  return (
                    <div 
                      key={item.key} 
                      title={t(item.deepKey)}
                      className={`group relative bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col sm:flex-row justify-between gap-4 transition-all ${
                        item.key === "play_boarding_music" && currentValue ? "sm:items-start" : "sm:items-center"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0 pr-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-sans font-bold text-white leading-normal tracking-wide">
                            {t(item.briefKey)}
                          </span>
                          <span className="text-[#45AFFF] hover:text-[#43E600] transition-colors cursor-help shrink-0 relative">
                            <Info className="w-3.5 h-3.5" />
                            {/* Hover Tooltip bubble inside the group - rendered cleanly downwards so it never slips behind the persistent group tabs container */}
                            <div className="invisible group-hover:visible absolute top-full left-1/2 -translate-x-1/2 mt-2.5 w-64 p-3 bg-[#01172e] border border-[#3B7EB2] text-[11px] text-white/90 leading-relaxed font-sans rounded shadow-2xl z-50 pointer-events-none font-normal">
                              <span className="text-[#43E600] font-bold block mb-1 uppercase text-[9px] tracking-wider">{t("current_flight.not_started.immersion.details_header")}</span>
                              {t(item.deepKey)}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-b-4 border-b-[#3B7EB2]"></div>
                            </div>
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-white/45 uppercase block tracking-wider">
                          {t("current_flight.not_started.immersion.def_label")} <strong className="text-[#43E600]/80">{t("current_flight.not_started.immersion.def_active")}</strong>
                        </span>
                        {item.key === "play_boarding_music" && currentValue && (
                          <div className="mt-3 space-y-1" onClick={(e) => e.stopPropagation()}>
                            <label className="block text-[10px] font-mono text-white/70 uppercase tracking-wider">
                              {t("current_flight.not_started.immersion.track_label")}
                            </label>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full max-w-[320px]">
                              <select
                                value={boardingMusicTrackId}
                                onChange={(e) => setBoardingMusicTrackId(e.target.value)}
                                disabled={musicTracksLoading}
                                className="w-full max-w-[240px] bg-[#00172e] border border-[#3B7EB2]/50 text-white rounded-[4px] px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#45AFFF]"
                              >
                                <option value="">{t("music.no_music")}</option>
                                <option value={RANDOM_MUSIC_ID}>{t("music.random")}</option>
                                {musicTracksLoading ? (
                                  <option value="" disabled>{t("music.loading_tracks")}</option>
                                ) : (
                                  musicTracks.map((track) => (
                                    <option key={track.id} value={track.id}>{track.name}</option>
                                  ))
                                )}
                              </select>
                              <MusicPreview
                                cleanUrl={selectedMusicTrack?.cleanUrl ?? null}
                                previewUrl={selectedMusicTrack?.previewUrl ?? null}
                              />
                            </div>
                          </div>
                        )}
                        {/* Fuente de música: catálogo (IA) o audio de la comunidad (Pack) */}
                        {item.key === "play_boarding_music" && currentValue && (
                          <div className="mt-3 space-y-2 border-t border-white/10 pt-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-mono text-white/70 uppercase tracking-wider">
                                {t("current_flight.not_started.immersion.source_label")}
                              </span>
                              <div className="flex bg-black/60 border border-white/15 rounded-[4px] overflow-hidden h-fit w-[165px]">
                                {(["ia", "pack"] as const).map((mode) => {
                                  const isSelected = effectiveBoardingAudioSource === mode;
                                  let activeStyle = "text-white/30 border-transparent hover:text-white/60 text-[9px]";
                                  if (isSelected) {
                                    if (mode === "pack") activeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40 font-extrabold shadow-sm text-[9px]";
                                    else activeStyle = "bg-sky-500/20 text-sky-400 border-[#45AFFF]/35 font-extrabold shadow-sm text-[9px]";
                                  }
                                  return (
                                    <button
                                      key={mode}
                                      type="button"
                                      onClick={() => handleBoardingAudioSourceChange(mode)}
                                      className={`px-1.5 py-1 rounded-[3px] font-mono uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${activeStyle}`}
                                    >
                                      {mode === "pack" ? t("current_flight.not_started.events.mode_pack") : t("current_flight.not_started.events.mode_ia")}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            {effectiveBoardingAudioSource === "pack" && (
                              <BoardingAudioPackSelector
                                airlineIcao={safetyAirlineIcao}
                                value={boardingAudioPackage?.id ?? storedBoardingAudioPackageId}
                                onChange={handleBoardingAudioPackageChange}
                                idPrefix="flight-boarding-pack"
                                title={
                                  boardingAudioPackage
                                    ? `${t("boarding_pack.selector_title")} - ${boardingAudioPackage.package_name}`
                                    : t("boarding_pack.selector_title")
                                }
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Pill button switch SÍ/NO to match theme */}
                      <div className="flex bg-black/60 border border-white/15 rounded-[4px] p-0.5 shrink-0 h-fit w-[120px] justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setImmersionConfig(prev => ({
                              ...prev,
                              [item.key]: true
                            }));
                          }}
                          className={`px-3 py-1 rounded-[3px] font-mono text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${
                            currentValue 
                              ? "bg-[#43E600]/20 text-[#43E600] border-[#43E600]/30 font-extrabold shadow-sm" 
                              : "text-white/30 border-transparent hover:text-white/60"
                          }`}
                        >
                          {t("current_flight.not_started.immersion.yes")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setImmersionConfig(prev => ({
                              ...prev,
                              [item.key]: false
                            }));
                          }}
                          className={`px-3 py-1 rounded-[3px] font-mono text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${
                            !currentValue 
                              ? "bg-red-500/20 text-red-300 border-red-500/35 font-extrabold shadow-sm" 
                              : "text-white/30 border-transparent hover:text-white/60"
                          }`}
                        >
                          {t("current_flight.not_started.immersion.no")}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {/* Ritmo de embarque (pax/min): override por vuelo del default
                    global de Settings. Muestra el ETA del manifiesto. */}
                <div
                  key="boarding-pace"
                  className="group relative bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col sm:flex-row justify-between gap-4 transition-all sm:items-start"
                >
                  <div className="space-y-1.5 flex-1 min-w-0 pr-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-sans font-bold text-white leading-normal tracking-wide">
                        {t("current_flight.not_started.immersion.pace.brief")}
                        {boardingPaceOverride != null && (
                          <span className="ml-2 text-[9px] font-mono font-bold uppercase tracking-wider text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5">
                            {t("current_flight.not_started.immersion.pace_global", { count: boardingPaceGlobal })}
                          </span>
                        )}
                      </span>
                      <span className="text-[#45AFFF] hover:text-[#43E600] transition-colors cursor-help shrink-0 relative">
                        <Info className="w-3.5 h-3.5" />
                        <div className="invisible group-hover:visible absolute top-full left-1/2 -translate-x-1/2 mt-2.5 w-64 p-3 bg-[#01172e] border border-[#3B7EB2] text-[11px] text-white/90 leading-relaxed font-sans rounded shadow-2xl z-50 pointer-events-none font-normal">
                          <span className="text-[#43E600] font-bold block mb-1 uppercase text-[9px] tracking-wider">{t("current_flight.not_started.immersion.details_header")}</span>
                          {t("current_flight.not_started.immersion.pace.deep")}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-b-4 border-b-[#3B7EB2]"></div>
                        </div>
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-white/45 uppercase block tracking-wider">
                      {t("current_flight.not_started.immersion.pace_eta", {
                        time: formatEtaMinSec(estimateBoardingSeconds(
                          boardingManifest.length > 0 ? boardingManifest.length : passengers.length,
                          effectiveBoardingPace
                        )),
                        count: boardingManifest.length > 0 ? boardingManifest.length : passengers.length,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto sm:max-w-[320px]">
                    <input
                      type="range"
                      min={BOARDING_PACE_MIN_PPM}
                      max={BOARDING_PACE_MAX_PPM}
                      step={5}
                      value={effectiveBoardingPace}
                      onChange={(e) => setBoardingPaceOverride(clampBoardingPace(Number(e.target.value)))}
                      className="flex-1 accent-[#45AFFF] cursor-pointer"
                      aria-label={t("current_flight.not_started.immersion.pace.brief")}
                    />
                    <span className="font-mono text-xs text-[#43E600] font-bold shrink-0 min-w-[85px] text-right">
                      {t("current_flight.not_started.immersion.pace_value", { count: effectiveBoardingPace })}
                    </span>
                    {boardingPaceOverride != null && (
                      <button
                        type="button"
                        onClick={() => setBoardingPaceOverride(null)}
                        className="text-[#45AFFF] hover:text-[#43E600] text-[10px] font-mono font-bold hover:underline cursor-pointer border-l border-white/10 pl-2 shrink-0 transition-colors"
                      >
                        {t("current_flight.not_started.immersion.pace_reset")}
                      </button>
                    )}
                  </div>
                </div>
                </>
              ) : getFilteredEvents().length === 0 ? (
                <div className="col-span-full bg-black/25 border border-white/10 rounded-[5px] p-6 text-center">
                  <p className="text-xs font-mono text-white/50">
                    {t("current_flight.not_started.event_config.scenario_no_events")}
                  </p>
                </div>
              ) : (
                getFilteredEvents().map((item) => {
                  const currentValue = eventConfig[item.eventKey] || "IA";
                  const isCaptain = item.speakerRole === "captain";
                  const isDelaySliderEvent = (DELAY_SLIDER_EVENT_KEYS as readonly string[]).includes(item.eventKey);
                  const isEventEnabled = currentValue !== "OFF";
                  const delayMinutes = isDelaySliderEvent ? getDelaySliderMinutes(item.eventKey) : DELAY_SLIDER_MIN_MIN;

                  return (
                    <div 
                      key={item.eventKey} 
                      className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 rounded-[6px] min-h-[120px] flex flex-col justify-between w-full h-full p-4 gap-3 transition-all"
                    >
                      {/* First Row: Título */}
                      <span className="text-[12.5px] font-sans font-bold text-white/95 leading-snug w-full">
                        {item.displayName || item.eventKey}
                      </span>
                      {item.description && (
                        <span className="text-[11px] font-sans font-medium text-white/60 leading-snug w-full">
                          {item.description}
                        </span>
                      )}

                      {/* Sliders de delay: centro de la tarjeta, antes del narrador y switches */}
                      {(item.eventKey === GATE_STARTED_DELAY_KEY || isDelaySliderEvent) && (
                        <div className="space-y-2.5">
                          {/* Slider de delay entre anuncios de puerta (solo gate_crew_started) */}
                          {item.eventKey === GATE_STARTED_DELAY_KEY && (
                            <div className="pt-2 border-t border-white/10">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono text-white/55 uppercase tracking-wider">
                                  Demora entre anuncios de puerta
                                </span>
                                <span className="text-[11px] font-mono text-[#45AFFF] font-bold">{gateStartedDelaySec} seg</span>
                              </div>
                              <input
                                type="range"
                                min={GATE_STARTED_DELAY_MIN}
                                max={GATE_STARTED_DELAY_MAX}
                                step={1}
                                value={gateStartedDelaySec}
                                disabled={!isEventEnabled}
                                onChange={(e) => handleGateStartedDelayChange(Number(e.target.value))}
                                className="w-full accent-[#45AFFF] mt-1.5 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                              />
                              <div className="flex justify-between text-[9px] font-mono text-white/35">
                                <span>Mínimo: {GATE_STARTED_DELAY_MIN}s</span>
                                <span>Máximo: {GATE_STARTED_DELAY_MAX}s</span>
                              </div>
                            </div>
                          )}

                          {/* Slider de umbral de demora (eventos de demora, en minutos) */}
                          {isDelaySliderEvent && (
                            <div className="pt-2 border-t border-white/10">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono text-white/55 uppercase tracking-wider">
                                  Demora detectada (min)
                                </span>
                                <span className="text-[11px] font-mono text-[#45AFFF] font-bold">{delayMinutes} min</span>
                              </div>
                              <input
                                type="range"
                                min={DELAY_SLIDER_MIN_MIN}
                                max={DELAY_SLIDER_MAX_MIN}
                                step={1}
                                value={delayMinutes}
                                disabled={!isEventEnabled}
                                onChange={(e) => handleDelaySliderChange(item.eventKey, Number(e.target.value))}
                                className="w-full accent-[#45AFFF] mt-1.5 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                              />
                              <div className="flex justify-between text-[9px] font-mono text-white/35">
                                <span>Mínimo: {DELAY_SLIDER_MIN_MIN} min</span>
                                <span>Máximo: {DELAY_SLIDER_MAX_MIN} min</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Second Row: Narrator + Selector */}
                      <div className="flex flex-row items-center justify-between w-full">
                        {/* Narrator */}
                        <div className="text-xs font-medium text-gray-400 truncate shrink min-w-0 mr-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${isCaptain ? "bg-[#e68b00]" : "bg-[#45AFFF]"}`}></span>
                          <span>{t("current_flight.not_started.events.narrator_label")} <strong className={isCaptain ? "text-[#ffb340]" : "text-[#45AFFF]"}>{getNarratorLabel(item.speakerRole)}</strong></span>
                        </div>

                        {/* Selector Mode Pill */}
                        <div className="flex-shrink-0">
                          <div className="flex bg-black/60 border border-white/15 rounded-[4px] overflow-hidden h-fit w-[165px]">
                        {(["OFF", "PACK", "IA"] as const).map((mode) => {
                          const isSelected = currentValue === mode;
                          // El video de seguridad (PACK de taxi_crew_safety_brief)
                          // usa los packages de la comunidad (safety_video), no
                          // el sound pack legacy: su opción PACK siempre está
                          // habilitada.
                          const isPackModeDisabled =
                            mode === "PACK" &&
                            item.eventKey !== SAFETY_VIDEO_EVENT_KEY &&
                            !selectedPackage;
                          let activeStyle = "text-white/30 border-transparent hover:text-white/60 text-[9px]";
                          if (isSelected) {
                            if (mode === "OFF") activeStyle = "bg-red-500/20 text-red-300 border-red-500/35 font-extrabold shadow-sm text-[9px]";
                            if (mode === "PACK") activeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40 font-extrabold shadow-sm text-[9px]";
                            if (mode === "IA") activeStyle = "bg-sky-500/20 text-sky-400 border-[#45AFFF]/35 font-extrabold shadow-sm text-[9px]";
                          }
                          return (
                            <button
                              key={mode}
                              type="button"
                              disabled={isPackModeDisabled}
                              onClick={() => handleEventConfigChange(item.eventKey, mode)}
                              title={isPackModeDisabled ? t("current_flight.not_started.events.tooltip_no_package") : ""}
                              className={`px-1.5 py-1 rounded-[3px] font-mono uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${activeStyle} ${
                                isPackModeDisabled ? "opacity-25 cursor-not-allowed hover:text-white/20" : ""
                              }`}
                            >
                              {mode === "OFF" ? t("current_flight.not_started.events.mode_off") : mode === "PACK" ? t("current_flight.not_started.events.mode_pack") : t("current_flight.not_started.events.mode_ia")}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    </div>
                      {/* Selector del video de seguridad (modo PACK): consulta
                          los packages de la comunidad para la aerolínea del
                          vuelo (+ genéricos) con auto-selección por defecto. */}
                      {item.eventKey === SAFETY_VIDEO_EVENT_KEY && currentValue === "PACK" && (
                        <SafetyVideoPackSelector
                          airlineIcao={safetyAirlineIcao}
                          value={safetyPackage?.id ?? storedSafetyPackageId}
                          onChange={handleSafetyPackageChange}
                          idPrefix="flight-safety-pack"
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>

          </div>

            </>
          )}
        </div>
      )}

      {/* ==================== ESTADO B: PRE-EMBARQUE ==================== */}
      {currentState === FlightState.PreEmbarque && !isPhase2To7 && (
        <div id="vuelo-estado-B" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          
          {/* Columna Izquierda (2/3 de ancho) */}
          <div className="lg:col-span-2 space-y-5">
            
            {/* Seccion superior con Monitor y Cabina Vertical */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              
              {/* Monitor de Embarque estilo Aeropuerto (IFE Terminal Display) */}
              <div className="md:col-span-3 bg-[#0024f0] border-4 border-[#3B7EB2]/40 rounded-[8px] p-5 text-white font-sans flex flex-col justify-between shadow-2xl h-auto aspect-video min-h-[220px]">
                {/* Fila 1: Cabecera */}
                <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/25 pb-2 uppercase text-white/85">
                  <span className="flex items-center gap-1.5">
                    <span className="transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "title"}>{showEnglish || isLangEnglish ? "MSFS GATE MONITOR" : t("current_flight.not_started.boarding_display.monitor_title")}</span>
                  </span>
                  <span className="text-[#43E600] flex items-center gap-1.5 font-sans">
                    <span className="w-2 h-2 rounded-full bg-[#43E600] animate-pulse" />
                    <span className="transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "boardopen"}>{showEnglish || isLangEnglish ? "BOARDING OPEN" : t("current_flight.not_started.boarding_display.boarding_open")}</span>
                  </span>
                  <span>{new Date().toLocaleDateString('es-ES', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}</span>
                </div>

                {/* Fila 2: Origen / Destino */}
                <div className="grid grid-cols-3 gap-4 border-b border-white/20 py-3 flex-1 items-center">
                  <div className="col-span-2">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "dep"}>
                      {showEnglish || isLangEnglish
                        ? "DEPARTING TO:"
                        : t("current_flight.not_started.boarding_display.departing_to")}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-sans font-black tracking-tight text-white uppercase">{routeDetails.destCity || getAirportName(destICAO) || destICAO}</h2>
                    {routeDetails.destCountry && (
                      <span className="text-[10px] text-white/60 font-mono tracking-wider">({destICAO}) • {routeDetails.destCountry}</span>
                    )}
                  </div>
                  <div className="border-l border-white/20 pl-4">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "flight"}>
                      {showEnglish || isLangEnglish ? "FLIGHT:" : t("current_flight.not_started.boarding_display.flight")}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-mono font-black text-amber-400">{flightCode}</h2>
                    <span className="text-sm text-white/80 font-sans font-bold tracking-wide mt-0.5 block">{getAirlineName(airline)}</span>
                  </div>
                </div>

                {/* Fila 3: Estado de Embarque / Temperatura */}
                <div className="grid grid-cols-3 gap-4 border-b border-white/20 py-2.5 flex-1 items-center">
                  <div className="col-span-2">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "status"}>
                      {showEnglish || isLangEnglish ? "STATUS:" : t("current_flight.not_started.boarding_display.status")}
                    </span>
                    <h3 className={`text-xl sm:text-2xl font-sans font-black tracking-tight ${isBoardingActive ? "text-amber-400 animate-pulse" : boardedCount >= passengers.length ? "text-[#43E600]" : "text-[#45AFFF]"} transition-opacity duration-500`} style={{ opacity: labelOpacity }} key={showEnglish + "statval"}>
                      {isBoardingActive 
                        ? (showEnglish || isLangEnglish ? "BOARDING" : t("current_flight.not_started.boarding_display.boarding"))
                        : boardedCount >= passengers.length 
                          ? (showEnglish || isLangEnglish ? "BOARDING CLOSED" : t("current_flight.not_started.boarding_display.boarding_closed"))
                          : (showEnglish || isLangEnglish ? "ON TIME / READY" : t("current_flight.not_started.boarding_display.on_time_ready"))}
                    </h3>
                  </div>
                  <div className="border-l border-white/20 pl-4">
                    <span className="block text-[8px] font-mono text-white/50 tracking-widest uppercase font-extrabold truncate mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "weather"}>
                      {showEnglish || isLangEnglish ? "WEATHER IN" : t("current_flight.not_started.boarding_display.weather_in")} {(getAirportName(destICAO) || destICAO).toUpperCase()}:
                    </span>
                    <div className="text-[10px] font-mono text-white/95 mt-1">
                      <div className="flex justify-between gap-1">
                        <span className="transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "fair"}>{showEnglish || isLangEnglish ? "FAIR:" : t("current_flight.not_started.boarding_display.fair")}</span> 
                        <span className="text-[#43E600] font-bold">{metarData.temperature}</span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span className="transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "wind"}>{showEnglish || isLangEnglish ? "WIND:" : t("current_flight.not_started.boarding_display.wind")}</span> 
                        <span>{metarData.windSpeed}{metarData.windGust ? " G" + metarData.windGust : ""} {metarData.windDir !== "--" ? metarData.windDir : ""}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fila 4: Horarios y Duración */}
                <div className="grid grid-cols-3 gap-4 pt-2.5 items-center">
                  <div className="col-span-2">
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "time"}>
                          {showEnglish || isLangEnglish
                            ? "LOCAL TIME:"
                            : t("current_flight.not_started.boarding_display.local_time")}
                        </span>
                        <strong className="text-sm sm:text-base font-mono tracking-wider text-white" title={`UTC: ${departureTimeStr} | Local: ${departureTimeLocalStr}`}>
                          {departureTimeLocalStr || departureTimeStr} <span className="text-[10px] text-white/40 font-normal">(hora local)</span>
                        </strong>
                      </div>
                      <div className="border-l border-white/20 pl-4">
                        <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "dur"}>
                          {showEnglish || isLangEnglish
                            ? "DURATION:"
                            : t("current_flight.not_started.boarding_display.duration")}
                        </span>
                        <strong className="text-sm sm:text-base font-mono tracking-wider text-white">
                          {flightDuration !== null ? flightDuration : "---"}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="border-l border-white/20 pl-4">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5 transition-opacity duration-500" style={{ opacity: labelOpacity }} key={showEnglish + "pax"}>
                      {showEnglish || isLangEnglish ? "PASSENGERS:" : t("current_flight.not_started.boarding_display.passengers")}
                    </span>
                    <strong className="text-sm sm:text-base font-mono text-[#43E600]">{displayBoardedCount} / {displayTotalPassengers}</strong>
                  </div>
                </div>
              </div>

              {/* Silueta de Avión Vacía / Rellenándose en Vertical */}
              <div className="md:col-span-1 bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-4 flex flex-col justify-between items-center shadow-lg min-h-[220px]">
                <span className="text-[10px] font-mono text-white/40 tracking-wider">A320 CABIN</span>
                
                {/* Vertical Silhouette Wrapper (Nose points up) */}
                <div className="relative w-24 h-36 flex items-center justify-center my-1.5 shrink-0 select-none">
                  {/* 1. Base Empty Silhouette Outline */}
                  <img 
                    src={siluetaAvion} 
                    alt="Cabin Base" 
                    className="absolute w-full h-full object-contain opacity-20 pointer-events-none"
                    referrerPolicy="no-referrer"
                  />
                  
                  {/* 2. Color Fill Layer (Glow green fill profile clipped dynamically from bottom to top) */}
                  <div 
                    className="absolute inset-0 overflow-hidden transition-all duration-500 ease-in-out flex items-end justify-center w-full"
                    style={{ clipPath: `inset(${100 - (boardedCount / passengers.length) * 100}% 0 0 0)` }}
                  >
                    <img 
                      src={siluetaAvionFill} 
                      alt="Cabin Fill" 
                      className="w-full h-full object-contain pointer-events-none filter drop-shadow-[0_0_8px_#43E600]"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>

                {/* Porcentaje y Contador de Pax */}
                <div className="w-full text-center font-mono text-[10px] border-t border-white/5 pt-2 space-y-0.5">
                  <div className="text-[#43E600] font-black text-sm font-sans tracking-tight">
                    {Math.round((displayBoardedCount / displayTotalPassengers) * 100)}%
                  </div>
                  <div className="text-white/80 font-bold">
                    {displayBoardedCount} / {displayTotalPassengers} PAX
                  </div>
                </div>
              </div>

            </div>

            {/* Listado de Pasajeros de Cabina */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 flex flex-col h-[380px] shadow-lg">
              <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
                <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#45AFFF]" /> {t("flight_view.manifest_boarding")}
                </h3>
                <span className="text-[10px] font-mono bg-[#45AFFF]/15 px-2 py-0.5 rounded text-white/80 border border-white/10">
                  {t("flight_view.total_pax", { count: displayTotalPassengers })}
                </span>
              </div>

              <div className="overflow-y-auto flex-1 space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10" id="compact-passenger-list">
                {(boardingManifest.length > 0 ? boardingManifest : passengers).map((p, idx) => {
                  const isBoarded = idx < boardedCount;
                  const isBoardingCurrent = idx === boardedCount && isBoardingActive;
                  
                  let statusBg = "bg-white/5 border-white/10 text-white/40";
                  let statusText = t("flight_view.status_waiting");
                  if (isBoarded) {
                    statusBg = "bg-[#43E600]/10 border-[#43E600]/30 text-[#43E600]";
                    statusText = t("flight_view.status_boarded");
                  } else if (isBoardingCurrent) {
                    statusBg = "bg-amber-500/20 border-amber-500/40 text-amber-300 animate-pulse";
                    statusText = t("flight_view.status_boarding");
                  }

                  return (
                    <div 
                      key={p.id}
                      id={`p-list-item-${p.id}`}
                      onClick={() => setSelectedPasajero(p)}
                      className="bg-[#002440]/40 border border-[#3B7EB2]/25 hover:border-[#45AFFF]/50 rounded-[5px] p-2.5 flex items-center justify-between hover:bg-[#002440]/75 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-3">
                        {/* Seating badge */}
                        <div className="text-[11px] font-mono bg-black/45 px-2 py-1 rounded text-white font-extrabold border border-white/10 text-center w-12 shrink-0">
                          {p.asiento}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-white truncate max-w-[150px]">{p.nombre}</span>
                            <span className="text-[9px] font-mono text-white/45 bg-white/5 px-1 py-0.5 rounded">{t("flight_view.class_label", { class: p.clase })}</span>
                          </div>
                          <span className="text-[9.5px] text-[#45AFFF]/75 font-mono">{p.nacionalidad}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {/* Satisfaccion / Miedo indicator */}
                        <div className="text-[10px] font-mono text-right hidden sm:block">
                          <span className="text-white/60">{t("flight_view.sat_short")}</span> <strong className="text-white bg-[#43E600]/10 border border-[#43E600]/25 px-1 py-0.2 rounded font-black">{p.satisfaccion}%</strong>
                        </div>

                        {/* Connection status badge */}
                        <div className={`text-[9px] font-mono px-2 py-1 rounded border font-bold uppercase ${statusBg}`}>
                          {statusText}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Columna Derecha (1/3 de ancho) */}
          <div className="space-y-5">
            
            {/* Último Anuncio Inteligente Completo */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-3">
              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-1.5 font-bold">
                  <Radio className="w-4 h-4 text-[#43E600]" /> {t("flight_view.last_announcement")}
                </h3>
              </div>
              
              <div className="bg-black/45 p-3.5 rounded-[5px] border border-[#3B7EB2]/30 text-xs font-sans relative overflow-hidden">
                <div className="absolute top-1 right-2 animate-pulse flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isAudioPlaying ? 'bg-[#43E600]' : isGenerating ? 'bg-yellow-400' : 'bg-white/20'}`} />
                  <span className="text-[8px] font-mono text-white/30">{isAudioPlaying ? 'ON AIR' : isGenerating ? 'GENERATING' : 'MUTED'}</span>
                </div>
                
                <p className="text-white/95 italic leading-relaxed pt-1.5">
                  {generatingError
                    ? <span className="text-red-400">{generatingError}</span>
                    : currentAnnouncement
                      ? `"${currentAnnouncement.text}"`
                      : isGenerating
                        ? t("flight_view.generating_announcement")
                        : null}
                </p>
                
                <div className="mt-3 pt-2.5 border-t border-white/15 flex justify-between items-center text-[9.5px] font-mono text-white/50">
                  {(() => {
                    if (!currentAnnouncement) return null;
                    const roleLabel = currentAnnouncement.speaker_role === "captain" ? t("flight_view.role_captain") : currentAnnouncement.speaker_role === "crew" ? t("flight_view.role_crew") : t("flight_view.role_gate");
                    return (
                      <>
                        <span>{t("flight_view.narration")} <strong className="text-white font-bold">{getSpeakerName(currentAnnouncement.speaker_role)}</strong></span>
                        <span className="text-[#45AFFF] uppercase font-black text-[8px] tracking-wider bg-[#45AFFF]/10 px-1.5 py-0.5 rounded border border-[#45AFFF]/20">{roleLabel}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Fase 1 pasajeros: estado agregado de cabina (muestra de 10) */}
            <PassengerStatusPanel averages={paxAverages} started={paxStarted} flash={paxFlash} />

            {/* Tripulación al Mando (Con indicadores que se iluminan al hablar) */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-4">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2">
                {t("flight_view.crew_channels")}
              </h3>
              
              <div className="space-y-3">
                {/* Captain Card */}
                {(() => {
                  const isCaptainSpeaking = isAudioPlaying && currentAnnouncement?.speaker_role === "captain";
                  
                  return (
                    <div className={`p-3 rounded-[5px] border transition-all duration-300 flex items-center justify-between ${
                      isCaptainSpeaking 
                        ? "bg-[#43E600]/10 border-[#43E600] shadow-[0_0_15px_rgba(67,230,0,0.25)]" 
                        : "bg-black/25 border-white/5 hover:border-white/15"
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full relative transition-colors duration-300 ${isCaptainSpeaking ? 'bg-[#43E600]/25 text-[#43E600]' : 'bg-white/5 text-white/50'}`}>
                          <Volume2 className={`w-4 h-4 ${isCaptainSpeaking ? 'animate-bounce' : ''}`} />
                          {isCaptainSpeaking && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#43E600] animate-ping" />
                          )}
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-white/45 block uppercase font-bold">{t("flight_view.commander")}</span>
                          <span className={`text-[12px] font-sans font-black tracking-wide ${isCaptainSpeaking ? 'text-[#43E600]' : 'text-white'}`}>
                            {getSpeakerName("captain")}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                        isCaptainSpeaking ? "bg-[#43E600] text-black bg-opacity-80" : "bg-black/40 text-white/30"
                      }`}>
                        {isCaptainSpeaking ? t("flight_view.speaking") : t("flight_view.listening")}
                      </span>
                    </div>
                  );
                })()}

                {/* Cabin Crew Lead Card */}
                {(() => {
                  const isCrewSpeaking = isAudioPlaying && currentAnnouncement?.speaker_role === "crew";
                  
                  return (
                    <div className={`p-3 rounded-[5px] border transition-all duration-300 flex items-center justify-between ${
                      isCrewSpeaking 
                        ? "bg-[#43E600]/10 border-[#43E600] shadow-[0_0_15px_rgba(67,230,0,0.25)]" 
                        : "bg-black/25 border-white/5 hover:border-white/15"
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full relative transition-colors duration-300 ${isCrewSpeaking ? 'bg-[#43E600]/25 text-[#43E600]' : 'bg-white/5 text-white/50'}`}>
                          <Volume2 className={`w-4 h-4 ${isCrewSpeaking ? 'animate-bounce' : ''}`} />
                          {isCrewSpeaking && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#43E600] animate-ping" />
                          )}
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-white/45 block uppercase font-bold font-mono">{t("flight_view.crew_chief")}</span>
                          <span className={`text-[12px] font-sans font-black tracking-wide ${isCrewSpeaking ? 'text-[#43E600]' : 'text-white'}`}>
                            {getSpeakerName("crew")}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                        isCrewSpeaking ? "bg-[#43E600] text-black bg-opacity-80" : "bg-black/40 text-white/30"
                      }`}>
                        {isCrewSpeaking ? t("flight_view.speaking") : t("flight_view.listening")}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Consola de Simulación (solo música y volumen) */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg">
              <div className="space-y-4">
                {/* Música Ambiente Info */}
                <div className="p-3 bg-black/25 rounded-[5px] border border-[#3B7EB2]/30 text-xs text-white/95 font-sans">
                  <span className="font-mono text-[#45AFFF] font-semibold text-[11px] block mb-1">{t("flight_view.boarding_music")}</span>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span>{t("flight_view.system_label")} <strong className="text-[#43E600]">ON AIR</strong></span>
                    <span>{t("flight_view.theme_label")} {boardingMusicTrackId === RANDOM_MUSIC_ID ? t("music.random") : selectedMusicTrack?.name || t("music.no_music")}</span>
                  </div>
                </div>

                {/* Volumen Slider */}
                <div>
                  <div className="flex justify-between items-center text-xs font-mono mb-1 text-white/80">
                    <span>{t("flight_view.volume")}</span>
                    <span className="text-[#45AFFF] font-bold">{copilotVolume}%</span>
                  </div>
                  <input 
                    type="range"
                    id="volume-slider-B-new"
                    min="0"
                    max="100"
                    value={copilotVolume}
                    onChange={(e) => onCopilotVolumeChange(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer accent-[#45AFFF] border border-white/10"
                  />
                </div>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ==================== ESTADO C: EN VUELO (EMBARQUE Y CRUCERO) ==================== */}
      {currentState === FlightState.EnVuelo && !isPhase2To7 && (
        <div id="vuelo-estado-C" className="space-y-6 animate-fadeIn">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* IFE principal: reemplaza al manifiesto tras el cierre de puertas */}
          <div className="lg:col-span-2 min-w-0">
            <IfeScreen
              flight={ifeFlight}
              guest={ifeGuest}
              originCoords={ifeOriginCoords}
              destCoords={ifeDestCoords}
              getTelemetry={ifeGetTelemetry}
              getFlownPath={ifeGetFlownPath}
            />
          </div>

          {/* Circular Satisfaction Meter Left, triggers right */}
          <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 flex flex-col md:flex-row items-center gap-6 justify-around shadow-md">
            
            {/* Circular SVG Gauge for global satisfaction */}
            <div className="text-center">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider mb-4 text-center">
                {t("flight_view.general_satisfaction")}
              </h3>
              
              <div className="relative w-36 h-36 mx-auto flex items-center justify-center">
                {/* SVG circular track */}
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="72"
                    cy="72"
                    r={radius}
                    className="stroke-[#00345C]"
                    strokeWidth="12"
                    fill="transparent"
                  />
                  <circle
                    cx="72"
                    cy="72"
                    r={radius}
                    className="stroke-[#43E600] transition-all duration-500"
                    strokeWidth="12"
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    style={{ filter: "drop-shadow(0 0 4px #43E600)" }}
                  />
                </svg>
                {/* Embedded digit in the center */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-display font-extrabold text-white">{paxScore !== null ? `${paxScore}%` : "—"}</span>
                  <span className="text-[9px] font-mono text-white/60">{t("flight_view.satisfied")}</span>
                </div>
              </div>

              <div className="mt-4 flex gap-4 justify-center text-xs font-mono">
                <span className="flex items-center gap-1 text-[#43E600]">
                  <Smile className="w-4 h-4" /> {enginePaxList.filter(p => enginePaxScore(p.attributes) >= 70).length} {t("flight_view.happy")}
                </span>
                <span className="flex items-center gap-1 text-[#E68B00]">
                  <Frown className="w-4 h-4" /> {enginePaxList.filter(p => enginePaxScore(p.attributes) < 50).length} {t("flight_view.uncomfortable")}
                </span>
              </div>
            </div>

            {/* Simulated fear meter and metrics */}
            <div className="space-y-4 max-w-xs w-full">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1 text-white/95">
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#E68B00]" />
                    {t("flight_view.calm_turbulence")}
                  </span>
                  <span className={`font-bold ${paxAverages !== null && paxAverages.calma < 40 ? 'text-[#E600D2]' : 'text-white'}`}>{paxAverages !== null ? `${Math.round(paxAverages.calma)}%` : "—"}</span>
                </div>
                {/* Linear tracking bar */}
                <div className="w-full bg-[#00345C] h-2 rounded overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${paxAverages !== null && paxAverages.calma < 40 ? 'bg-[#E600D2]' : paxAverages !== null && paxAverages.calma < 70 ? 'bg-[#E68B00]' : 'bg-[#43E600]'}`}
                    style={{ width: `${paxAverages !== null ? Math.round(paxAverages.calma) : 0}%` }}
                  />
                </div>
              </div>

              {/* Announcement dispatcher */}
              <div className="bg-black/20 p-2.5 rounded border border-[#3B7EB2]/40 text-[11px] font-mono">
                📞 <strong className="text-[#45AFFF]">{t("flight_view.announcements_in_progress")}</strong>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                  <button 
                    id="btn-envuelo-turbulencia"
                    onClick={() => onTriggerAnnouncement("turbulencia")}
                    className="p-1 bg-[#2C6591] border border-white/20 hover:border-white/60 rounded text-white text-left cursor-pointer"
                  >
                    ⛈️ {t("flight_view.turbulence_btn")}
                  </button>
                  <button 
                    id="btn-envuelo-descenso"
                    onClick={() => onTriggerAnnouncement("descenso")}
                    className="p-1 bg-[#2C6591] border border-white/20 hover:border-white/60 rounded text-white text-left cursor-pointer"
                  >
                    📉 {t("flight_view.descent_btn")}
                  </button>
                </div>
              </div>
            </div>

          </div>



          </div>

          {/* Manifiesto reubicado en acordeón colapsado por defecto */}
          <ManifestAccordion
            title={t("flight_view.compact_pax_list")}
            countLabel={t("flight_view.total_pax", { count: displayTotalPassengers })}
          >
            <div className="overflow-y-auto space-y-2 pr-1 max-h-[300px]" id="compact-passenger-list">
              {enginePaxList.map((p) => {
                const score = enginePaxScore(p.attributes);
                let statusColor = "text-[#43E600]";
                if (score < 55) statusColor = "text-[#E68B00]";
                if (score < 40) statusColor = "text-[#E600D2]";

                return (
                  <div 
                    key={p.id}
                    id={`p-list-item-${p.id}`}
                    className="bg-[#00345C]/55 border border-[#3B7EB2]/40 rounded-[5px] p-2 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-white truncate max-w-[120px]">{p.id}</span>
                        <span className="text-[10px] font-mono bg-white/10 px-1 rounded text-white/80">{enginePaxNames.get(p.archetypeId) ?? p.archetypeId}</span>
                      </div>
                      <span className="text-[9px] text-[#45AFFF] font-mono uppercase">{t("flight_view.tracked_sample")}</span>
                    </div>

                    <div className="text-right flex items-center gap-2">
                      <div className="text-[10px] font-mono">
                        <div className="text-white">😊 Score: <strong className={statusColor}>{score}%</strong></div>
                        <div className="text-white/70">😌 Calma: <strong className="text-white/90">{Math.round(p.attributes.calma)}%</strong></div>
                      </div>
                      <span className="text-[#45AFFF]/60">➔</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ManifestAccordion>
        </div>
      )}

      {/* ==================== COCKPIT & CABIN FLIGHT DASHBOARD (PHASES 2 TO 7) ==================== */}
      {currentState !== FlightState.NoIniciado && isPhase2To7 && (
        <div id="vuelo-estado-Phases2To6" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          
          {/* Columna Izquierda (2/3 de ancho) */}
          <div className="lg:col-span-2 space-y-5">
            
            {/* 1. RESUMEN DE SATISFACCIÓN GENERAL CON INDICADORES GRÁFICOS */}
            <div className="bg-[#2C6591]/20 rounded-[8px] border-2 border-[#3B7EB2]/40 p-5 shadow-2xl text-white">
              {/* Cabecera */}
              <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/10 pb-2.5 uppercase text-[#45AFFF]">
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#43E600]" />
                  <span>{t("flight_view.summary_title")}</span>
                </span>
                <span className="text-[#43E600] flex items-center gap-1.5 font-sans font-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#43E600] animate-pulse" />
                  {t("flight_view.active")} • {tStage(currentSubStage).toUpperCase()}
                </span>
              </div>

              {/* Grid de 4 Atributos Promedio (Estilo Bento Card) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                
                {/* Atributo 1: Saciedad */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-[#43E600]/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>{t("flight_view.attr_satiety")}</span>
                    <Smile className="w-3.5 h-3.5 text-[#43E600]" />
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{paxAverages !== null ? `${Math.round(paxAverages.saciedad)}%` : "—"}</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${paxAverages === null ? 'text-white/40' : paxAverages.saciedad >= 70 ? 'text-[#43E600]' : paxAverages.saciedad >= 45 ? 'text-[#E68B00]' : 'text-[#E600D2]'}`}>
                      {paxAverages === null ? t("flight_view.no_data") : paxAverages.saciedad >= 70 ? t("flight_view.satiety_high") : paxAverages.saciedad >= 45 ? t("flight_view.satiety_ok") : t("flight_view.satiety_low")}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#43E600] rounded-full transition-all duration-500" 
                      style={{ width: `${paxAverages !== null ? Math.round(paxAverages.saciedad) : 0}%`, filter: "drop-shadow(0 0 2px #43E600)" }} 
                    />
                  </div>
                </div>

                {/* Atributo 2: Calma */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-[#E600D2]/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>{t("flight_view.attr_calm")}</span>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#E600D2]" />
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{paxAverages !== null ? `${Math.round(paxAverages.calma)}%` : "—"}</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${paxAverages === null ? 'text-white/40' : paxAverages.calma >= 70 ? 'text-[#43E600]' : paxAverages.calma >= 40 ? 'text-[#E68B00]' : 'text-[#E600D2]'}`}>
                      {paxAverages === null ? t("flight_view.no_data") : paxAverages.calma >= 70 ? t("flight_view.calm_calm") : paxAverages.calma >= 40 ? t("flight_view.calm_restless") : t("flight_view.calm_tense")}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${paxAverages !== null && paxAverages.calma < 40 ? 'bg-[#E600D2]' : paxAverages !== null && paxAverages.calma < 70 ? 'bg-[#E68B00]' : 'bg-[#43E600]'}`} 
                      style={{ width: `${paxAverages !== null ? Math.round(paxAverages.calma) : 0}%` }} 
                    />
                  </div>
                </div>

                {/* Atributo 3: Entretenimiento */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-amber-400/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>{t("flight_view.attr_entertainment")}</span>
                    <Coffee className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{paxAverages !== null ? `${Math.round(paxAverages.entretenimiento)}%` : "—"}</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${paxAverages === null ? 'text-white/40' : paxAverages.entretenimiento >= 70 ? 'text-[#43E600]' : paxAverages.entretenimiento >= 45 ? 'text-amber-400' : 'text-[#E600D2]'}`}>
                      {paxAverages === null ? t("flight_view.no_data") : paxAverages.entretenimiento >= 70 ? t("flight_view.ent_entertained") : paxAverages.entretenimiento >= 45 ? t("flight_view.ent_distracted") : t("flight_view.ent_bored")}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${paxAverages !== null && paxAverages.entretenimiento < 45 ? 'bg-red-500' : paxAverages !== null && paxAverages.entretenimiento < 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${paxAverages !== null ? Math.round(paxAverages.entretenimiento) : 0}%` }} 
                    />
                  </div>
                </div>

                {/* Atributo 4: Confort */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-violet-400/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>{t("flight_view.attr_comfort")}</span>
                    <span className="text-[11px] leading-none select-none">🚻</span>
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{paxAverages !== null ? `${Math.round(paxAverages.confortFisiologico)}%` : "—"}</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${paxAverages === null ? 'text-white/40' : paxAverages.confortFisiologico >= 70 ? 'text-[#43E600]' : paxAverages.confortFisiologico >= 45 ? 'text-violet-400' : 'text-[#E600D2]'}`}>
                      {paxAverages === null ? t("flight_view.no_data") : paxAverages.confortFisiologico >= 70 ? t("flight_view.comfort_ok") : paxAverages.confortFisiologico >= 45 ? t("flight_view.comfort_annoyed") : t("flight_view.comfort_urgent")}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${paxAverages !== null && paxAverages.confortFisiologico < 45 ? 'bg-red-500' : paxAverages !== null && paxAverages.confortFisiologico < 70 ? 'bg-violet-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${paxAverages !== null ? Math.round(paxAverages.confortFisiologico) : 0}%` }} 
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* 1b. IFE - ENTRETENIMIENTO A BORDO (misma posición desde
                PRE-FLIGHT hasta TAXI-TO-GATE; en Plataforma lo reemplaza el
                resumen de aterrizaje). El monitor queda montado y operativo en
                todas esas fases; el video de seguridad (modo PACK) se
                reproduce dentro del mismo. */}
            {currentSubStage !== "Plataforma" && (
              <div className="animate-fadeIn">
                <IfeScreen
              flight={ifeFlight}
              guest={ifeGuest}
              originCoords={ifeOriginCoords}
              destCoords={ifeDestCoords}
              getTelemetry={ifeGetTelemetry}
              getFlownPath={ifeGetFlownPath}
            />
              </div>
            )}

            {/* 2. COMPORTAMIENTO DE ETAPA 7 (PLATAFORMA) - RESUMENES DE ATERRIZAJE E IA */}
            {currentSubStage === "Plataforma" && (
              <div className="space-y-5 animate-fadeIn">
                {/* Caja: Resumen de Aterrizaje */}
                <div className="bg-[#2C6591]/20 rounded-[8px] border-2 border-[#E68B00]/60 p-5 shadow-2xl text-white">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/10 pb-2.5 uppercase text-[#E68B00]">
                    <span className="flex items-center gap-1.5 font-bold">
                      <span className="text-sm">🛬</span>
                      <span>{t("flight_view.landing_summary_title")}</span>
                    </span>
                    <span className="text-[#43E600] font-sans font-black bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
                      {t("flight_view.soft_greaser")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 font-mono">
                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">{t("flight_view.classification")}</span>
                      <strong className="text-sm text-[#43E600] block mt-1 font-sans font-black">{t("flight_view.soft_landing")}</strong>
                    </div>

                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">{t("flight_view.gforce")}</span>
                      <strong className="text-base text-white font-sans font-black block mt-0.5">1.12 G</strong>
                    </div>

                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">{t("flight_view.vertical_speed")}</span>
                      <strong className="text-base text-[#43E600] font-sans font-black block mt-0.5">-115 FPM</strong>
                    </div>

                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">{t("flight_view.bounces")}</span>
                      <strong className="text-base text-white font-sans font-black block mt-0.5">0 ({t("flight_view.none")})</strong>
                    </div>
                  </div>
                </div>

                {/* Caja: Experiencia Ganada (datos reales del cierre: bonus
                    capturados pre-reset + respuesta de la RPC). */}
                <div id="xp-earned-box" className="bg-[#00345C]/30 rounded-[8px] border-2 border-[#43E600]/40 p-5 shadow-2xl text-white">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/10 pb-2.5 uppercase text-[#43E600]">
                    <span className="flex items-center gap-1.5 font-bold">
                      <Trophy className="w-4 h-4" />
                      <span>{t("flight_view.xp_earned_title")}</span>
                    </span>
                    {xpCompletion?.status === "done" && xpCompletion.totalFlightXp !== null && (
                      <span className="font-sans font-black bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
                        +{xpCompletion.totalFlightXp.toLocaleString("en-US")} XP
                      </span>
                    )}
                  </div>

                  {!xpCompletion || xpCompletion.status === "pending" ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center space-y-2">
                      <Loader2 className="w-6 h-6 text-[#43E600] animate-spin" />
                      <p className="text-xs font-mono text-white/70 font-bold">
                        {!xpCompletion ? t("flight_view.awaiting_close") : t("flight_view.calculating_xp")}
                      </p>
                      <p className="text-[10px] font-mono text-white/40">
                        {t("flight_view.breakdown_note")}
                      </p>
                    </div>
                  ) : xpCompletion.status === "error" ? (
                    <div className="space-y-3 mt-3">
                      <div className="bg-red-900/30 border border-red-500/40 rounded px-3 py-2 text-[11px] font-mono text-red-300">
                        {t("flight_view.xp_error", { error: xpCompletion.error ?? t("flight_view.breakdown_note") })}
                      </div>
                      <ul className="space-y-2">
                        {explainXpBreakdown(xpCompletion.bonuses).map((bonus) => (
                          <li key={bonus.key} className="flex items-start justify-between gap-2 text-xs font-mono pl-1">
                            <span className="flex flex-col gap-0.5">
                              <span className="text-white/75">{bonus.label}</span>
                              <span className="text-[10px] leading-snug text-white/35">{bonus.reason}</span>
                            </span>
                            <span className="font-extrabold whitespace-nowrap pt-0.5 text-white/35">
                              → {bonus.xp.toLocaleString("en-US")} XP
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="space-y-3 mt-3">
                      <div className="flex items-center justify-between gap-2 bg-black/30 rounded border border-white/10 px-3 py-2">
                        <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                          {t("flight_view.base_time")}
                        </span>
                        <span className="text-lg font-mono font-extrabold text-white whitespace-nowrap">
                          → {(xpCompletion.baseXpAwarded ?? 0).toLocaleString("en-US")} XP
                        </span>
                      </div>
                      {(xpCompletion.campaignXp ?? 0) > 0 && (
                        <div className="flex items-center justify-between gap-2 bg-[#E68B00]/10 rounded border border-[#E68B00]/40 px-3 py-2">
                          <span className="text-xs font-mono font-bold text-[#E68B00] uppercase tracking-wider">
                            {t("volar.campaign_bonus_label")}
                            {xpCompletion.campaignMultiplier && xpCompletion.campaignMultiplier > 1
                              ? ` ${formatMultiplier(xpCompletion.campaignMultiplier)}`
                              : ""}
                          </span>
                          <span className="text-lg font-mono font-extrabold text-[#E68B00] whitespace-nowrap">
                            → +{(xpCompletion.campaignXp ?? 0).toLocaleString("en-US")} XP
                          </span>
                        </div>
                      )}
                      <ul className="space-y-2">
                        {explainXpBreakdown(xpCompletion.bonuses).map((bonus) => (
                          <li key={bonus.key} className="flex items-start justify-between gap-2 text-xs font-mono pl-1">
                            <span className="flex flex-col gap-0.5">
                              <span className="text-white/75">{bonus.label}</span>
                              <span className={`text-[10px] leading-snug ${
                                bonus.state === "earned"
                                  ? "text-[#43E600]/80"
                                  : bonus.state === "partial"
                                    ? "text-amber-400/80"
                                    : "text-white/35"
                              }`}>
                                {bonus.reason}
                              </span>
                            </span>
                            <span className={`font-extrabold whitespace-nowrap pt-0.5 ${bonus.xp > 0 ? "text-[#43E600]" : "text-white/35"}`}>
                              → {bonus.xp.toLocaleString("en-US")} XP
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Caja: Resumen de IA */}
                <div className="bg-[#2C6591]/30 rounded-[8px] border-2 border-[#45AFFF]/40 p-5 shadow-2xl text-white">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/10 pb-2.5 uppercase text-[#45AFFF]">
                    <span className="flex items-center gap-1.5 font-bold">
                      <span className="text-sm">🤖</span>
                      <span>{t("flight_view.ai_report_title")}</span>
                    </span>
                    <span className="text-[#45AFFF] font-mono font-bold">
                      {t("flight_view.version")}
                    </span>
                  </div>

                  {isReportGenerating ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                      <Loader2 className="w-8 h-8 text-[#45AFFF] animate-spin" />
                      <div className="space-y-1">
                        <p className="text-xs font-mono text-white/80 animate-pulse font-bold">{t("flight_view.generating_report")}</p>
                        <p className="text-[10px] font-mono text-white/40">{t("flight_view.syncing_data")}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3 font-mono text-xs leading-relaxed text-white/95 bg-black/45 p-4 rounded border border-[#3B7EB2]/30 animate-fadeIn" id="ai-report-body">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold border-b border-emerald-500/10 pb-1.5 text-[11px] mb-2 uppercase">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                        {t("flight_view.flight_completed_ok")}
                      </div>
                      <p>
                        {t("flight_view.ai_op_body", { origin: originICAO, dest: destICAO, aircraft: simBriefData.avion || "Airbus A320" })}
                      </p>
                      <p>
                        {t("flight_view.ai_pax_body", {
                          score: paxFinal !== null ? Math.round(paxFinal.overallScore) : "—",
                          attrs: paxFinal !== null
                            ? ` (${t("flight_view.metric_satiety")} ${Math.round(paxFinal.globalAttributeAverages.saciedad)}%, ${t("flight_view.metric_comfort")} ${Math.round(paxFinal.globalAttributeAverages.confortFisiologico)}%, ${t("flight_view.metric_calm")} ${Math.round(paxFinal.globalAttributeAverages.calma)}%, ${t("flight_view.metric_entertainment")} ${Math.round(paxFinal.globalAttributeAverages.entretenimiento)}%)`
                            : "",
                        })}
                      </p>
                      <p>
                        {t("flight_view.ai_touchdown_body", { rating: ratingObj.rating, fpm: Math.round(landingFpm) })}
                      </p>
                      <div className="pt-2 border-t border-white/10 flex justify-between items-center text-[10px] text-white/40 font-bold">
                        <span>{t("flight_view.operator")}</span>
                        <span className="text-[#43E600] font-black uppercase text-[10px]">{t("flight_view.global_rating")}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. MANIFEST COMPACTA DE PASAJEROS (CON COLUMNA DE MINI-BARRAS SAT/MIEDO!) */}
            <div className={`bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 flex flex-col shadow-lg transition-all duration-300 ${isManifestCollapsed ? 'h-auto mb-2' : 'h-[380px]'}`}>
              <div 
                className="flex items-center justify-between border-b border-white/10 pb-2 mb-3 cursor-pointer select-none"
                onClick={() => setIsManifestCollapsed(!isManifestCollapsed)}
              >
                <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-bold font-black">
                  <Users className="w-4 h-4 text-[#45AFFF]" /> {t("flight_view.pax_manifest")}
                  {isManifestCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </h3>
                <span className="text-[10px] font-mono bg-[#45AFFF]/15 px-2 py-0.5 rounded text-white/80 border border-white/10 font-bold">
                  {t("flight_view.onboard_count", { count: passengers.length })} {isManifestCollapsed && t("flight_view.collapsed")}
                </span>
              </div>

              {!isManifestCollapsed && (
                <div className="overflow-y-auto flex-1 space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10 text-white animate-fadeIn" id="compact-passenger-list-p26">
                  {passengers.map((p) => {
                    let displaySat = p.satisfaccion;
                    let displayFear = p.miedo;

                    if (mockInfo) {
                      const seed = (p.id ? parseInt(p.id.toString().replace(/\D/g, "")) || 5 : 5) % 10;
                      const satDiff = mockInfo.satisfaction - 75;
                      const fearDiff = mockInfo.fear - 15;
                      
                      displaySat = Math.max(5, Math.min(100, Math.round(p.satisfaccion + satDiff + (seed - 5))));
                      displayFear = Math.max(0, Math.min(100, Math.round(p.miedo + fearDiff + (seed - 5))));
                    }

                    return (
                    <div 
                      key={p.id}
                      id={`p26-list-item-${p.id}`}
                      onClick={() => setSelectedPasajero({ ...p, satisfaccion: displaySat, miedo: displayFear })}
                      className="bg-[#002440]/40 border border-[#3B7EB2]/25 hover:border-[#45AFFF]/50 rounded-[5px] p-2.5 flex items-center justify-between hover:bg-[#002440]/75 cursor-pointer transition-all animate-fadeIn"
                    >
                      {/* Asiento, Nombre y clase */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="text-[11px] font-mono bg-black/45 px-2 py-1 rounded text-white font-extrabold border border-white/10 text-center w-12 shrink-0">
                          {p.asiento}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-white truncate max-w-[110px] sm:max-w-[150px]">{p.nombre}</span>
                            <span className="text-[9px] font-mono text-white/45 bg-white/5 px-1 py-0.5 rounded shrink-0">{p.clase}</span>
                          </div>
                          <span className="text-[9.5px] text-[#45AFFF]/75 font-mono truncate block">{p.nacionalidad}</span>
                        </div>
                      </div>

                      {/* DOS MINI-BARRAS: SATISFACCIÓN Y MIEDO */}
                      <div className="flex items-center gap-4 shrink-0 font-mono">
                        <div className="flex flex-col gap-1 text-[10px]">
                          {/* Mini-barra de satisfacción */}
                          <div className="flex items-center gap-1.5 w-28 sm:w-32">
                            <span className="text-[8px] font-mono text-white/45 w-6 uppercase text-left font-bold">{t("flight_view.sat_label")}</span>
                            <div className="flex-1 bg-black/45 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-300 ${displaySat >= 70 ? 'bg-[#43E600]' : displaySat >= 45 ? 'bg-[#E68B00]' : 'bg-[#E600D2]'}`}
                                style={{ width: `${displaySat}%` }} 
                              />
                            </div>
                            <span className={`text-[9px] font-mono font-black w-6 text-right ${displaySat >= 70 ? 'text-[#43E600]' : displaySat >= 45 ? 'text-[#E68B00]' : 'text-[#E600D2]'}`}>
                              {displaySat}%
                            </span>
                          </div>
                          
                          {/* Mini-barra de miedo */}
                          <div className="flex items-center gap-1.5 w-28 sm:w-32">
                            <span className="text-[8px] font-mono text-white/45 w-6 uppercase text-left font-bold">{t("flight_view.fear_label")}</span>
                            <div className="flex-1 bg-black/45 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-300 ${displayFear >= 60 ? 'bg-[#E600D2]' : displayFear >= 30 ? 'bg-[#E68B00]' : 'bg-[#43E600]'}`}
                                style={{ width: `${displayFear}%` }} 
                              />
                            </div>
                            <span className={`text-[9px] font-mono font-black w-6 text-right ${displayFear >= 60 ? 'text-[#E600D2]' : displayFear >= 30 ? 'text-[#E68B00]' : 'text-[#43E600]'}`}>
                              {displayFear}%
                            </span>
                          </div>
                        </div>
                        <span className="text-white/30 text-xs select-none">➔</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </div>

          {/* Columna Derecha (1/3 de ancho) */}
          <div className="space-y-5">
            
            {/* Último Anuncio Inteligente (datos reales del último anuncio reproducido) */}
            <LastAnnouncementBox
              announcement={currentAnnouncement}
              isPlaying={isAudioPlaying}
              isGenerating={isGenerating}
              getSpeakerName={getSpeakerName}
            />

            {/* Canales de Voz de Tripulación (datos reales por speaker_role) */}
            <VoiceIndicator
              announcement={currentAnnouncement}
              isPlaying={isAudioPlaying}
              getSpeakerName={getSpeakerName}
            />

            {/* Consola de Simulación (solo control de volumen, música eliminada) */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg text-white">
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center text-xs font-mono mb-1 text-white/80">
                    <span>{t("flight_view.volume_global")}</span>
                    <span className="text-[#45AFFF] font-bold">{copilotVolume}%</span>
                  </div>
                  <input 
                    type="range"
                    id="volume-slider-p26"
                    min="0"
                    max="100"
                    value={copilotVolume}
                    onChange={(e) => onCopilotVolumeChange(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer accent-[#45AFFF] border border-white/10"
                  />
                </div>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ==================== ESTADO D: ATERRIZADO ==================== */}
      {currentState === FlightState.Aterrizado && !isPhase2To7 && (
        <div id="vuelo-estado-D" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          
          {/* Main Landing Report card */}
          <div className="lg:col-span-2 bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 font-mono shadow-md">
            <h3 className="text-sm font-bold text-[#45AFFF] uppercase tracking-wider mb-4 border-b border-white/15 pb-2 flex items-center gap-2">
              🛬 {t("flight_view.landing_report_title")}
            </h3>

            <div className="bg-black/35 border border-white/10 rounded-[7px] p-6 text-center space-y-4">
              <span className="text-xs text-white/70 block">{t("flight_view.touchdown_vspeed")}</span>
              <strong className={`text-5xl font-display font-extrabold tracking-tight ${ratingObj.color} block`} id="touchdown-fpm-display">
                {landingFpm} FPM
              </strong>
              
              <div className="inline-block bg-white/10 border border-white/20 px-3 py-1.5 rounded text-xs">
                {t("flight_view.cabin_rating")} <strong className={`text-sm ${ratingObj.color}`}>{ratingObj.rating}</strong>
              </div>

              <div className="max-w-md mx-auto py-2">
                <span className="font-bold text-sm block text-[#45AFFF] uppercase mt-2 mb-1">{ratingObj.title}</span>
                <p className="text-xs text-white/85 leading-relaxed">
                  {ratingObj.desc}
                </p>
              </div>

              {/* Slider simulation for landing */}
              <div className="pt-4 border-t border-white/10 max-w-sm mx-auto">
                <label className="text-[10px] text-white/60 block mb-1">{t("flight_view.test_landing")}</label>
                <div className="flex gap-3 items-center">
                  <span className="text-[10px] text-white">-60 FPM</span>
                  <input 
                    type="range" 
                    id="landing-fpm-simulator"
                    min="50" 
                    max="650"
                    value={Math.abs(landingFpm)}
                    onChange={(e) => onLandingFpmChange(-parseInt(e.target.value))}
                    className="flex-1 accent-[#E68B00]"
                  />
                  <span className="text-[10px] text-white">-650 FPM</span>
                </div>
              </div>
            </div>

            {/* Satisfaction Summary (Fase 1 pasajeros: score final del engine) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="bg-[#00345C]/50 p-4 rounded border border-[#3B7EB2]/40">
                <span className="text-[11px] font-bold text-[#45AFFF]">{t("flight_view.final_satisfaction")}</span>
                <div className="flex items-center gap-2 mt-2">
                  <Smile className="w-5 h-5 text-[#43E600]" />
                  <strong className="text-lg text-white">{paxFinal !== null ? `${Math.round(paxFinal.overallScore)}%` : "—"}</strong>
                  <span className="text-[10px] text-white/60">{t("flight_view.approval")}</span>
                </div>
                {paxFinal !== null && (
                  <div className="text-[10px] font-mono text-white/50 mt-2">
                    sac {Math.round(paxFinal.globalAttributeAverages.saciedad)} ·{" "}
                    con {Math.round(paxFinal.globalAttributeAverages.confortFisiologico)} ·{" "}
                    cal {Math.round(paxFinal.globalAttributeAverages.calma)} ·{" "}
                    ent {Math.round(paxFinal.globalAttributeAverages.entretenimiento)}
                    {paxFinal.variancePenaltyApplied > 0 && (
                      <span className="text-[#E68B00]"> · penalización −{paxFinal.variancePenaltyApplied}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="bg-[#00345C]/50 p-4 rounded border border-[#3B7EB2]/40">
                <span className="text-[11px] font-bold text-[#E68B00]">{t("flight_view.xp_acquired")}</span>
                <strong className="text-lg text-[#43E600] block mt-1">{t("flight_view.xp_career")}</strong>
              </div>
            </div>

            {/* Reset / Loop restart button */}
            <div className="mt-6 pt-4 border-t border-white/15 flex justify-end">
              <button
                id="btn-reiniciar-sim"
                onClick={() => { void handleFinalizarVuelo(); }}
                className="bg-[#43E600] text-black font-bold font-mono px-5 py-2.5 rounded-[5px] text-xs hover:bg-[#34b600] transition-all cursor-pointer flex items-center gap-1.5"
              >
                🔄 {t("flight_view.load_new_dispatch")}
              </button>
            </div>
          </div>

          {/* Side stats passport awards */}
          <div className="space-y-6">
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 space-y-4 shadow-md">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1.5 flex items-center gap-1.5">
                🎉 {t("flight_view.achievements_awarded")}
              </h3>
              
              <ul className="space-y-3 font-mono text-xs">
                {Math.abs(landingFpm) <= 120 && (
                  <li className="p-2.5 bg-[#43E600]/10 border border-[#43E600]/40 rounded flex items-center gap-2 text-[#43E600]">
                    🏆 {t("flight_view.unlocked")} <strong>{t("flight_view.ach_silk")}</strong>
                  </li>
                )}
                {paxFinal !== null && Math.round(paxFinal.overallScore) >= 90 ? (
                  <li className="p-2.5 bg-[#45AFFF]/10 border border-[#45AFFF]/40 rounded flex items-center gap-2 text-[#45AFFF]">
                    ❤ {t("flight_view.unlocked")} <strong>{t("flight_view.ach_host")}</strong>
                  </li>
                ) : (
                  <li className="p-2.5 bg-black/20 text-white/50 rounded">
                    🔇 {t("flight_view.no_achievements")}
                  </li>
                )}
              </ul>
            </div>
          </div>

        </div>
      )}

      {selectedPasajero && (
        <PasajeroSlideOver 
          pasajero={selectedPasajero}
          onClose={() => setSelectedPasajero(null)}
          flightCode={flightCode}
          passengerList={boardingManifest.length > 0 ? boardingManifest : passengers}
          onNavigate={(p) => setSelectedPasajero(p)}
          simBriefData={simBriefData}
          airlineName={getAirlineName(airline)}
        />
      )}

      {/* Monitor de variables (ventana de depuración) */}
      <DebugMonitor
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        flightContext={flightContextRef.current}
        flightController={flightControllerRef.current}
        narrativeEngine={(() => {
          try { return schedulerRef.current?.getNarrativeEngine() ?? null; } catch { return null; }
        })()}
        scheduler={schedulerRef.current}
        ruleEngine={ruleEngineRef.current}
        phaseDetector={phaseDetectorRef.current}
        xpBonusTracker={xpBonusTrackerRef.current}
        passengerEngine={passengerEngineRef.current}
        turbulenceDetector={turbulenceRef.current}
        lastEventVariables={lastEventVars}
      />

      {/* Debug cluster — barra superior derecha (aviso conexión / Monitor).
          Los botones temporales "Descargar / Limpiar logs" se eliminaron. */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1.5">
        {!isConnected && !isTestMode && currentState === FlightState.NoIniciado && (
          <div className="warning-banner bg-amber-500/10 border border-amber-500/40 rounded-[5px] px-2.5 py-2 text-[11px] font-sans text-amber-300 leading-tight flex items-center gap-2 shadow-lg shadow-black/30">
            <span className="whitespace-nowrap">⚠️ {t("connection.banner")}</span>
            <button
              type="button"
              onClick={() => {
                setIsTestMode(true);
                fileLogger.log('[VueloActualView] Modo pruebas activado desde banner');
              }}
              className="bg-[#E68B00] hover:bg-[#ffa726] text-black font-mono font-black text-[10px] px-2.5 py-1 rounded-[5px] transition-all cursor-pointer shrink-0"
            >
              {t("connection.banner_cta")}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsDebugOpen(true)}
          className="bg-[#002440]/90 hover:bg-[#00345C]/90 text-[#45AFFF] border border-[#3B7EB2]/50 px-3 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center gap-1.5 shadow-lg shadow-black/30 cursor-pointer transition-colors"
          title={t("flight_view.monitor_tooltip")}
        >
          <Activity className="w-3.5 h-3.5" />
          {t("flight_view.monitor_btn")}
        </button>
      </div>

      <FlightStartPopup
        isOpen={showFlightStartPopup}
        onClose={() => setShowFlightStartPopup(false)}
        onConfirm={handleConfirmFlightStart}
      />
      
    </div>
  );
}
