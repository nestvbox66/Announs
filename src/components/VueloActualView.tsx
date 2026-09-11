/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { generateManifest, getRegionFromICAO } from "../engine/PassengerManifest";
import { getAirportName, parseMETAR, getAirportTimezone } from "../utils/airportMapping";
import { getAirlineName } from "../utils/airlineMapping";
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
  Activity
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
import { BoardingMusicService, BoardingMusicTrack } from "../services/BoardingMusicService";
import { musicController, RANDOM_MUSIC_ID } from "../services/MusicController";
import { fileLogger } from "../services/FileLogger";
import { secondsToHHMM } from "../utils/timeUtils";
import { isInternationalFlight, getCountryKey } from "../utils/flightUtils";
import MusicPreview from "./music/MusicPreview";
import type {
  ScenarioConfigSnapshot,
  ScenarioEventConfig,
  ScenarioOption,
} from "../services/ScenarioConfigService";
import { EVENT_CONFIG_FLAVOR_KEY, EVENT_CONFIG_PACKAGE_KEY, NORMAL_SCENARIO_KEY, EventSwitchValue, isEventSwitchValue } from "../services/eventConfigConstants";
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
  const [showSecondaryLang, setShowSecondaryLang] = useState<boolean>(false);
  // Evita sobrescribir los valores guardados antes de que termine la carga.
  const musicSettingsLoadedRef = useRef(false);

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
      return v?.name || simBriefData.nombrePiloto || "Capitán";
    }
    if (role === "crew") {
      const v = availableVoices.find((v) => v.id === crewVoice);
      return v?.name || "Tripulación";
    }
    if (role === "gate") {
      const v = availableVoices.find((v) => v.id === gateAgentVoiceId);
      return v?.name || "Agente de Puerta";
    }
    return "Desconocido";
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

  const bindFlightController = useCallback((controller: FlightController) => {
    const ctx = flightContextRef.current!;
    const scheduler = schedulerRef.current!;
    const fsm = flightFSMRef.current!;
    controller.onTelemetry = (snap) => {
      ctx.updateTelemetry(snap);
      scheduler.notifyTelemetry(snap);

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

    return () => {
      unsubPending();
      unsubExecuted();
      unsubSkipped();
      unsubCompleted();
      unsubClear();
    };
  }, []);

  // Keep TimerManager flight context in sync
  useEffect(() => {
    timerManagerRef.current?.setEventContext(flightId, captainPrimaryLang);
  }, [flightId, captainPrimaryLang]);

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

        // Pre-seleccionar en los selectores si existen y son válidos
        if (settings.language_id) {
          setCaptainPrimaryLang(settings.language_id);
          console.log("[VueloActualView] language_id pre-seleccionado:", settings.language_id);
        }
        if (settings.captain_voice_id) {
          setCaptainVoice(settings.captain_voice_id);
          console.log("[VueloActualView] captain_voice_id pre-seleccionado:", settings.captain_voice_id);
        }
        if (settings.crew_voice_id) {
          setCrewVoice(settings.crew_voice_id);
          console.log("[VueloActualView] crew_voice_id pre-seleccionado:", settings.crew_voice_id);
        }
        if (settings.gate_agent_voice_id) {
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

  interface ImmersionOption {
    key: string;
    briefKey: string;
    deepKey: string;
    defaultVal: boolean;
  }

  const immersionOptions: ImmersionOption[] = [
    {
      key: "play_chime_sound_before_ann",
      briefKey: "current_flight.not_started.immersion.chime.brief",
      deepKey: "current_flight.not_started.immersion.chime.deep",
      defaultVal: true
    },
    {
      key: "play_ambient_sound_during_flight",
      briefKey: "current_flight.not_started.immersion.ambient.brief",
      deepKey: "current_flight.not_started.immersion.ambient.deep",
      defaultVal: true
    },
    {
      key: "crew_greeting_passengers_at_gate",
      briefKey: "current_flight.not_started.immersion.greeting.brief",
      deepKey: "current_flight.not_started.immersion.greeting.deep",
      defaultVal: true
    },
    {
      key: "passenger_reaction_to_planes_movement",
      briefKey: "current_flight.not_started.immersion.reaction.brief",
      deepKey: "current_flight.not_started.immersion.reaction.deep",
      defaultVal: true
    },
    {
      key: "play_passenger_reaction_during_landing",
      briefKey: "current_flight.not_started.immersion.landing.brief",
      deepKey: "current_flight.not_started.immersion.landing.deep",
      defaultVal: true
    },
    {
      key: "play_boarding_music",
      briefKey: "current_flight.not_started.immersion.music.brief",
      deepKey: "current_flight.not_started.immersion.music.deep",
      defaultVal: true
    },
    {
      key: "speed_kph",
      briefKey: "current_flight.not_started.immersion.speed.brief",
      deepKey: "current_flight.not_started.immersion.speed.deep",
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
          mapped = (stockResult.data || []).map((vs: any) => ({
            id: vs.id,
            name: vs.voice_name,
            role: vs.voice_role,
            languages: Array.isArray(vs.languages)
              ? vs.languages
              : vs.languages
                ? [vs.languages]
                : [],
          }));
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
        if ((d as any).gate_agent_voice_id != null) {
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
  useEffect(() => {
    musicController.configure({
      tracks: musicTracks,
      selectedTrackId: boardingMusicTrackId || null,
      enabled: immersionConfig.play_boarding_music ?? true,
    });
  }, [musicTracks, boardingMusicTrackId, immersionConfig.play_boarding_music]);

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
        if (isEventSwitchValue(value)) {
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

  React.useEffect(() => {
    setFlightCode(simBriefData.vueloCodigo);
    setOriginICAO(simBriefData.origen);
    setDestICAO(simBriefData.destino);
    setAirline(simBriefData.aerolinea);
    const initialRoute = getRouteDetails(simBriefData.origen, simBriefData.destino);
    setOriginCityName(initialRoute.orgCity);
    setDestCityName(initialRoute.destCity);
  }, [simBriefData]);

  // Generate passenger manifest when simBriefData or PreEmbarque state is ready
  React.useEffect(() => {
    if (simBriefData?.origen && simBriefData?.pasajerosCount > 0) {
      const manifest = generateManifest(simBriefData.pasajerosCount, simBriefData.origen);
      setBoardingManifest(manifest);
    }
  }, [simBriefData]);

  // Phase 1 boarding simulation timer effect
  React.useEffect(() => {
    let intervalId: any = null;
    const targetLength = boardingManifest.length > 0 ? boardingManifest.length : passengers.length;
    if (isBoardingActive && boardedCount < targetLength) {
      intervalId = setInterval(() => {
        setBoardedCount(prev => {
          if (prev >= targetLength) {
            setIsBoardingActive(false);
            clearInterval(intervalId);
            return targetLength;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isBoardingActive, boardedCount, boardingManifest.length, passengers.length]);

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
      // Scheduler.startFlight resincroniza los umbrales de demora desde la DB
      // (events.default_delay_ms); se re-aplican los delays elegidos por el usuario
      // en los sliders de "Configurar Eventos" para que se usen en el vuelo.
      applyUserDelayOverridesToContext();
      // Delegar lógica de fase inicial al Scheduler según preferencias
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
        await schedulerRef.current?.enterPhase(FlightPhase.TAKEOFF, 'simulator');
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
        await schedulerRef.current?.enterPhase(FlightPhase.GATE, 'simulator');
        console.log(`[UI] Iniciar vuelo (modo: ${mode}, gate_engines_on sin abordaje) -> GATE con embarque omitido`);
      } else {
        // cold_and_dark o gate_engines_on con abordaje: flujo normal desde GATE
        schedulerRef.current?.applyFlightStart(preferences);
        await schedulerRef.current?.enterPhase(FlightPhase.GATE, 'simulator');
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

  const handleImportSimbrief = async () => {
    setIsFetchingSimbrief(true);
    setSimbriefError(null);
    setSimbriefRawData(null);
    try {
      const response = await fetch(`https://www.simbrief.com/api/xml.fetcher.php?userid=${simbriefId}&json=1`);
      if (response.status === 400) {
        throw new Error("simbrief_no_plan");
      } else if (!response.ok) {
        throw new Error("simbrief_generic_error");
      }
      const data = await response.json();
      setSimbriefRawData(data);

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
      };

      let currentFlightId: string | null = null;

      const { data: existingFlight } = await supabase
        .from("flights")
        .select("id")
        .eq("user_id", userId)
        .eq("flight_status", "pending")
        .maybeSingle();

      if (existingFlight?.id) {
        const { error: updateError } = await supabase
          .from("flights")
          .update(flightRow)
          .eq("id", existingFlight.id);
        if (updateError) throw new Error(updateError.message);
        currentFlightId = existingFlight.id;
      } else {
        const { data: insertedFlight, error: insertError } = await supabase
          .from("flights")
          .insert(flightRow)
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);
        currentFlightId = insertedFlight?.id || null;
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
    { id: "immersion", label: t("current_flight.not_started.events.group_immersion"), count: immersionOptions.length },
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
    const timezone = getAirportTimezone(originForTz);

    if (!isNaN(ts) && ts > 0) {
      try {
        const localTime = new Date(ts * 1000).toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timezone,
          hour12: false,
        });
        console.log('[DepartureTimeLocal] ✅ origin:', originForTz, '| timezone:', timezone, '| UTC ts:', ts, '| local HH:MM:', localTime, '| UTC HH:MM:', departureTimeStr);
        return localTime;
      } catch (e) {
        console.warn('[DepartureTimeLocal] ⚠️ Error toLocaleTimeString con timezone', timezone, e);
        return departureTimeStr; // fallback a UTC si falla timezone
      }
    }
    if (typeof rawCandidate === 'string' && /^\d{1,2}:\d{2}/.test(rawCandidate.trim())) {
      // Si ya es HH:MM, no hay conversión, devolver tal cual (asumimos local si no hay timestamp)
      return rawCandidate.trim().slice(0, 5);
    }
    // Fallback: si no hay SimBrief, mantener mismo fallback que departureTimeStr pero en contexto local
    return departureTimeStr;
  }, [simbriefRawData, originICAO, departureTimeStr]);

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
    const cruiseTimeSeconds = Number((simbriefRawData as any)?.times?.cruise_time || 0);
    const cruiseOriginICAO = simbriefRawData?.origin?.icao_code || originICAO || "";
    const cruiseDestICAO = simbriefRawData?.destination?.icao_code || destICAO || "";
    const cruiseIsInternational = cruiseOriginICAO && cruiseDestICAO
      ? isInternationalFlight(cruiseOriginICAO, cruiseDestICAO)
      : false;
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
          getAirportName(srcOriginIcao) ||
          simbriefRawData?.origin?.city ||
          originCityName ||
          getRouteDetails(originICAO, destICAO).orgCity,
        destCity:
          getAirportName(srcDestIcao) ||
          simbriefRawData?.destination?.city ||
          destCityName ||
          getRouteDetails(originICAO, destICAO).destCity,
        gate,
        departureTime: departureTimeStr,
        departureTimeLocal: departureTimeLocalStr,
        scheduledTakeoffTime: scheduledTakeoffSec,
        cruiseTimeSeconds,
        isInternational: cruiseIsInternational,
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
        isInternational: savedFlightData.isInternational ?? cruiseIsInternational,
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
      captainPrimaryLang,
      captainSecondaryLang,
      flightId,
      specialEvent: specialEvents,
      specialEventEnabled: specialEventEnabled,
    };
  }, [
    airline, flightCode, originICAO, destICAO, originCityName, destCityName,
    gate, departureTimeStr, departureTimeLocalStr, captainPrimaryLang, captainSecondaryLang, flightId,
    simbriefRawData,
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
    captainVoice, crewVoice, gateAgentVoiceId, eventConfig, selectedScenarioKey, simbriefRawData,
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

  // Calculate global passenger statistics
  const avgSatisfaction = Math.round(
    passengers.reduce((sum, p) => sum + p.satisfaccion, 0) / passengers.length
  );
  const avgFear = Math.round(
    passengers.reduce((sum, p) => sum + p.miedo, 0) / passengers.length
  );
  const avgHunger = Math.round(
    passengers.reduce((sum, p) => sum + p.hambre, 0) / passengers.length
  );
  const avgBathroom = Math.round(
    passengers.reduce((sum, p) => sum + p.bano, 0) / passengers.length
  );

  const p26Satisfaction = mockInfo ? mockInfo.satisfaction : avgSatisfaction;
  const p26Fear = mockInfo ? mockInfo.fear : avgFear;
  const p26Hunger = mockInfo ? mockInfo.hunger : avgHunger;
  const p26Bathroom = mockInfo ? mockInfo.bathroom : avgBathroom;

  // SVG parameters for satisfying circular gauge
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (avgSatisfaction / 100) * circumference;

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
              ← Volver al Vuelo Actual
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
                  Directorio: <strong className="text-white">announs/packs/{selectedPackage}/</strong>
                </div>
              </div>

              <p className="text-xs text-white/70 leading-relaxed mb-2">
                Asigna un archivo de audio real (.mp3, .wav) para cada evento de cabina del simulador. Al interactuar con el simulador o activar el evento, se reproducirá el archivo seleccionado.
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
                          <span>⚡ PROBAR AUDIO</span>
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
                          Reasignar archivo
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status and instruction info */}
              <div className="bg-[#43E600]/5 border border-[#43E600]/30 rounded-[5px] p-4 text-xs font-sans text-white/90 leading-relaxed">
                💡 <strong>Consejo del Operador:</strong> Cuando utilices el modo <strong>"PACK"</strong> en el panel de eventos del vuelo, el sistema omitirá automáticamente la síntesis neuronal generativa del copiloto o la azafata y cargará la grabación estática de paquete listada en esta pantalla. Es ideal para emular azafatas reales con grabaciones originales de cada aerolínea.
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
              <span>Etapas de Vuelo</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-mono text-white/55 uppercase hidden sm:block">
                Fase Activa: <span className="text-[#43E600] font-black">{currentSubStage}</span>
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
              {isFlightSettingsOpen ? t("current_flight.not_started.settings_title") : t("current_flight.not_started.title")}
            </h1>
          </div>
          {/* Action Buttons inside header for instant usability */}
          {!isFlightSettingsOpen && (
            <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {/* Tooltip Wrapper for Import button */}
              {simbriefId ? (
              <>
              <div className="relative group inline-block">
                <button
                  id="btn-import-simbrief-header"
                  type="button"
                  onClick={handleImportSimbrief}
                  disabled={isFetchingSimbrief}
                  className={`px-5 py-2.5 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all ${
                    isFetchingSimbrief
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                  } ${
                    !isBriefImported
                      ? "bg-[#43E600]/10 hover:bg-[#43E600]/20 text-[#43E600] border border-[#43E600] shadow-[0_0_15px_rgba(67,230,0,0.25)]"
                      : "bg-[#45AFFF]/15 hover:bg-[#45AFFF]/30 text-[#45AFFF] border border-[#45AFFF]/40 shadow"
                  }`}
                >
                  {isFetchingSimbrief ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isFetchingSimbrief ? "Importando..." : t("current_flight.not_started.import_btn")}
                </button>
                {/* Tooltip Popup */}
                <div className="absolute right-0 top-full mt-2 hidden group-hover:block w-72 p-3 bg-[#00172e] border border-[#3B7EB2] text-white text-xs rounded shadow-2xl z-50 animate-fadeIn pointer-events-none">
                  <p className="font-sans font-medium text-white/90 leading-relaxed text-left text-[11px]">
                    {t("current_flight.not_started.import_tooltip")}
                  </p>
                  {/* Arrow pointing up */}
                </div>
              </div>
              </>
              ) : (
              <button
                type="button"
                onClick={onNavigateToAccount}
                className="px-5 py-2.5 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_15px_rgba(251,191,36,0.15)]"
              >
                <AlertTriangle className="w-4 h-4" />
                {t("current_flight.not_started.no_simbrief_id_msg")}
              </button>
              )}

              {simbriefError && (
                <div className="w-full text-center text-red-500 text-sm font-semibold">
                  {t(`current_flight.not_started.errors.${simbriefError}`, { defaultValue: simbriefError })}
                </div>
              )}
              </div>
            </div>
          )}
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
                <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{getAirportName(simbriefRawData?.origin?.icao_code)}{simbriefRawData?.origin?.name ? ' (' + simbriefRawData.origin.name + ')' : ''}</span>
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
                <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{getAirportName(simbriefRawData?.destination?.icao_code)}{simbriefRawData?.destination?.name ? ' (' + simbriefRawData.destination.name + ')' : ''}</span>
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
                  onClick={onResetSimulation}
                  className="bg-[#43E600] text-black font-mono font-black px-4 py-2 rounded-[5px] text-xs hover:bg-[#3bcc00] transition-all flex items-center justify-center gap-1.5 cursor-pointer h-9 shrink-0 shadow-[0_0_15px_rgba(67,230,0,0.35)] hover:scale-[1.01] active:scale-[0.99]"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  FINALIZAR
                </button>
              ) : showCancelConfirm ? (
                <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 p-1.5 rounded-[5px] h-9 animate-fadeIn">
                  <span className="text-[9px] font-mono text-red-400 font-bold px-1 uppercase tracking-wider hidden sm:inline">¿Confirmar?</span>
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
                    Sí, Salir
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
                  Cancelar
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
                      Volver
                    </button>
                  ) : showCancelConfirm ? (
                    <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 p-1.5 rounded-[5px] h-9">
                      <span className="text-[9px] font-mono text-red-400 font-bold px-1 uppercase tracking-wider hidden sm:inline">¿Confirmar?</span>
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
                        Sí, Salir
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
                      Cancelar
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
                      COMENZAR EMBARQUE
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
                      title={!boardingComplete ? "Esperando embarque completo" : "Cerrar puertas y pasar a PRE_FLIGHT"}
                      className={`font-mono font-bold px-4 py-2 rounded-[5px] text-xs flex items-center justify-center gap-1.5 h-9 shrink-0 transition-all ${
                        canCloseDoors
                          ? "bg-[#E68B00] hover:bg-[#ffa726] text-black shadow-[0_0_15px_rgba(230,139,0,0.35)] cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                          : "bg-white/5 border border-white/10 text-white/35 cursor-not-allowed"
                      }`}
                    >
                      <DoorClosed className="w-3.5 h-3.5" />
                      CERRAR PUERTAS
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
          {/* Advertencia si no hay conexión con un simulador real */}
          {!isConnected && !isTestMode && (
            <div className="warning-banner bg-amber-500/10 border border-amber-500/40 rounded-[5px] p-4 text-xs font-sans text-amber-300 leading-relaxed flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>⚠️ No hay conexión con un simulador. El sistema usará el modo Mock (simulado).</span>
              <button
                type="button"
                onClick={() => {
                  setIsTestMode(true);
                  fileLogger.log('[VueloActualView] Modo pruebas activado desde banner');
                }}
                className="bg-[#E68B00] hover:bg-[#ffa726] text-black font-mono font-black text-[10px] px-4 py-2 rounded-[5px] transition-all cursor-pointer shrink-0"
              >
                Usar modo pruebas
              </button>
            </div>
          )}

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
                        <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{getAirportName(simbriefRawData?.origin?.icao_code)}{simbriefRawData?.origin?.name ? ' (' + simbriefRawData.origin.name + ')' : ''}</span>
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
                        <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{getAirportName(simbriefRawData?.destination?.icao_code)}{simbriefRawData?.destination?.name ? ' (' + simbriefRawData.destination.name + ')' : ''}</span>
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
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-3 shrink-0 border-t md:border-0 border-white/5 pt-3 md:pt-0">
                    <button
                      type="button"
                      onClick={() => setIsFlightSettingsOpen(false)}
                      className="bg-[#002440] hover:bg-[#00345C] text-white/90 hover:text-white border border-[#3B7EB2]/45 hover:border-[#3B7EB2] px-4 py-2 rounded-[5px] text-xs font-mono font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
                    >
                      Volver
                    </button>

                    <div className="flex flex-col items-stretch gap-1.5">
                      <button
                        type="button"
                        disabled={!hasValidFlight || isStartingFlight || languagesLoading || voicesLoading || !languagesReady || !!languageError || !voicesReady || !!voiceError || (!isConnected && !isTestMode)}
                        onClick={() => handleStartFlight("normal")}
                        title={!isConnected && !isTestMode ? "Se requiere conexión con un simulador (o modo pruebas)" : undefined}
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
                        onChange={(e) => setCaptainPrimaryLang(e.target.value)}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {languagesLoading ? (
                          <option value="" disabled>Cargando...</option>
                        ) : langOptions.length === 0 ? (
                          <option value="" disabled>{languageError || "Sin idiomas disponibles"}</option>
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
                        onChange={(e) => setGateAgentVoiceId(e.target.value)}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {voicesLoading ? (
                          <option value="" disabled>Cargando...</option>
                        ) : gateVoiceOptions.length === 0 ? (
                          <option value="" disabled>{voiceError || "Sin voces de agente de puerta para este idioma"}</option>
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
                        onChange={(e) => setCaptainVoice(e.target.value)}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {voicesLoading ? (
                          <option value="" disabled>Cargando...</option>
                        ) : captainVoiceOptions.length === 0 ? (
                          <option value="" disabled>{voiceError || "Sin voces de capitán para este idioma"}</option>
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
                        onChange={(e) => setCrewVoice(e.target.value)}
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                      >
                        {voicesLoading ? (
                          <option value="" disabled>Cargando...</option>
                        ) : crewVoiceOptions.length === 0 ? (
                          <option value="" disabled>{voiceError || "Sin voces de tripulación para este idioma"}</option>
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
                    Eventos Especiales de Cabina
                  </h3>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3 p-2.5 bg-[#002440]/35 border border-[#3B7EB2]/15 hover:border-[#3B7EB2]/35 rounded-[5px] cursor-pointer hover:bg-[#002440]/55 transition-all w-full select-none">
                    <span className="text-white text-[11px] font-sans font-medium">Activar evento especial</span>
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
                    <span className="uppercase font-bold">Detalle de Eventos Especiales</span>
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
                    placeholder="Ingresa aquí el evento especial o situación especial del vuelo..."
                    className={`w-full border rounded-[5px] p-3 text-xs placeholder-white/30 font-sans focus:outline-none resize-none leading-relaxed focus:border-[#45AFFF] ${specialEventEnabled ? "bg-[#002440]/60 border-[#3B7EB2]/60 text-white" : "bg-[#00172e]/40 border-white/10 text-white/40 cursor-not-allowed"}`}
                  />
                  <p className="text-[11px] text-white/50 italic leading-snug">
                    Ej: "Hoy viaja el equipo de fútbol" o "Es Navidad"
                  </p>
                  <p className="text-[11px] text-[#45AFFF]/70 italic leading-snug bg-black/20 p-2 border border-white/5 rounded flex items-start gap-1.5">
                    <span>ℹ️</span>
                    <span>El evento será narrado por el capitán durante la fase de crucero.</span>
                  </p>
                </div>
              </div>

              {/* BLOQUE 3: Plan de Cabina */}
              <div className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-6">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <Compass className="w-5 h-5 text-[#45AFFF]" />
                  <h3 className="font-display font-bold text-base text-[#45AFFF]">
                    Servicios y Planificación de Cabina
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Zona 1: Gastronomía */}
                  <div className="space-y-4 bg-black/20 p-4 rounded border border-white/5 flex flex-col">
                    <div>
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase block border-b border-white/5 pb-1 mb-3">
                        1) Gastronomía
                      </span>
                      <div className="space-y-2.5">
                        <ToggleSwitch checked={foodService} onChange={setFoodService} label="Servicio de Comida Principal" />
                        <ToggleSwitch checked={breakfastService} onChange={setBreakfastService} label="Servicio de Desayuno" />
                        <ToggleSwitch checked={snacksService} onChange={setSnacksService} label="Servicio rápido de Snacks y Bebidas" />
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
                        2) Ventas y Promociones
                      </span>
                      <div className="space-y-2.5">
                        <ToggleSwitch checked={dutyFree} onChange={setDutyFree} label="Venta de Duty Free" />
                        <ToggleSwitch checked={frequentFlyer} onChange={setFrequentFlyer} label="Anuncio de Pasajero Frecuente" />
                      </div>
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2 font-sans line-clamp-2">
                       Promocione programas de viajero o duty free durante la fase de crucero.
                    </div>
                  </div>

                  {/* Zona 3: Confort y Procedimientos */}
                  <div className="space-y-3 bg-black/20 p-4 rounded border border-white/5 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#45AFFF] uppercase block border-b border-white/5 pb-1 mb-3">
                        3) Confort y Procedimientos
                      </span>
                      <div className="space-y-2.5">
                        <ToggleSwitch checked={wifiAnnouncement} onChange={setWifiAnnouncement} label="Anuncio disponibilidad de Wi-Fi" />
                        <ToggleSwitch checked={customsForms} onChange={setCustomsForms} label="Formularios de Aduana" />
                      </div>
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2 font-sans line-clamp-2">
                      Configure anuncios para vuelos internacionales o con conectividad habilitable.
                    </div>
                  </div>

                </div>

                {/* Zona 4: Estilo de Comunicación */}
                <div className="pt-4 border-t border-white/10 space-y-3">
                  <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase block border-b border-[#3B7EB2]/45 pb-1">
                    4) Estilo de Comunicación
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 select-none">
                    {[
                      { 
                        id: 1, 
                        nombre: "Strict/Operational (Default)", 
                        hace: "Se limita a la telemetría pura, meteorología y tiempos (ETA).",
                        para: "Vuelos cortos, low-cost o simulación rigurosa y técnica." 
                      },
                      { 
                        id: 2, 
                        nombre: "Tourist/Cultural", 
                        hace: "Busca datos curiosos, históricos o gastronómicos sobre el destino.",
                        para: 'Ejemplo: "...justo para disfrutar del clima serrano o alfajores locales".' 
                      },
                      { 
                        id: 3, 
                        nombre: "Scenic/Landscape", 
                        hace: "El capitán hace de guía turístico solicitando mirar por las ventanas.",
                        para: 'Ejemplo: "...apreciar una vista despejada de la cordillera de los Andes".' 
                      },
                      { 
                        id: 4, 
                        nombre: "Relaxed/Charismatic", 
                        hace: "Tono coloquial, amigable, incluye comentarios simpáticos.",
                        para: "Ideal para simulación chárter o aerolíneas con cultura distendida." 
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
                    <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{getAirportName(simbriefRawData?.origin?.icao_code)}{simbriefRawData?.origin?.name ? ' (' + simbriefRawData.origin.name + ')' : ''}</span>
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
                    <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{getAirportName(simbriefRawData?.destination?.icao_code)}{simbriefRawData?.destination?.name ? ' (' + simbriefRawData.destination.name + ')' : ''}</span>
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
                  onClick={handleImportSimbrief}
                  className="text-[10px] text-[#45AFFF] hover:underline flex items-center gap-1 cursor-pointer font-mono font-bold"
                >
                  <Download className="w-3 h-3" />
                  {t("current_flight.not_started.reimport_btn")}
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
                <div id="package-selector-container" className="flex items-center gap-3 bg-black/30 border border-white/10 rounded-[5px] px-3 py-1.5 shrink-0 max-w-full overflow-x-auto">
                  <label className="text-[9px] font-mono font-bold text-white/55 uppercase tracking-wider whitespace-nowrap">{t("current_flight.not_started.package_box.active_label")}</label>
                  <select
                    id="package-select"
                    value={selectedPackage}
                    onChange={(e) => setSelectedPackage(e.target.value)}
                    className="bg-black/55 border border-[#3B7EB2]/45 text-xs text-white font-mono font-bold rounded-[3px] px-2 py-0.5 focus:outline-none cursor-pointer hover:border-[#45AFFF] transition-colors"
                  >
                    <option value="">{t("current_flight.not_started.package_box.no_package")}</option>
                    <option value="aerolineas">Aerolíneas Argentinas AR Pack</option>
                    <option value="latam">LATAM Real Voice Pack v2</option>
                    <option value="iberia">Iberia Premium Audio</option>
                    <option value="flybondi">Flybondi Low-Cost set</option>
                    <option value="default">Default FS Soundset</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowPackageManager(true)}
                    className="text-[#45AFFF] hover:text-[#43E600] text-[10px] font-mono font-bold hover:underline cursor-pointer border-l border-white/10 pl-2 shrink-0 transition-colors"
                  >
                    {t("current_flight.not_started.package_box.manage_btn")}
                  </button>
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
                immersionOptions.map((item) => {
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
                })
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
                          const isPackModeDisabled = mode === "PACK" && !selectedPackage;
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
                  <Users className="w-4 h-4 text-[#45AFFF]" /> MANIFEST DE EMBARQUE DE PASAJEROS
                </h3>
                <span className="text-[10px] font-mono bg-[#45AFFF]/15 px-2 py-0.5 rounded text-white/80 border border-white/10">
                  Total: {displayTotalPassengers} pax
                </span>
              </div>

              <div className="overflow-y-auto flex-1 space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10" id="compact-passenger-list">
                {(boardingManifest.length > 0 ? boardingManifest : passengers).map((p, idx) => {
                  const isBoarded = idx < boardedCount;
                  const isBoardingCurrent = idx === boardedCount && isBoardingActive;
                  
                  let statusBg = "bg-white/5 border-white/10 text-white/40";
                  let statusText = "SALA DE ESPERA";
                  if (isBoarded) {
                    statusBg = "bg-[#43E600]/10 border-[#43E600]/30 text-[#43E600]";
                    statusText = "A BORDO";
                  } else if (isBoardingCurrent) {
                    statusBg = "bg-amber-500/20 border-amber-500/40 text-amber-300 animate-pulse";
                    statusText = "ABORDANDO...";
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
                            <span className="text-[9px] font-mono text-white/45 bg-white/5 px-1 py-0.5 rounded">Clase {p.clase}</span>
                          </div>
                          <span className="text-[9.5px] text-[#45AFFF]/75 font-mono">{p.nacionalidad}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {/* Satisfaccion / Miedo indicator */}
                        <div className="text-[10px] font-mono text-right hidden sm:block">
                          <span className="text-white/60">Sat:</span> <strong className="text-white bg-[#43E600]/10 border border-[#43E600]/25 px-1 py-0.2 rounded font-black">{p.satisfaccion}%</strong>
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
                  <Radio className="w-4 h-4 text-[#43E600]" /> Último anuncio
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
                        ? "Generando anuncio..."
                        : null}
                </p>
                
                <div className="mt-3 pt-2.5 border-t border-white/15 flex justify-between items-center text-[9.5px] font-mono text-white/50">
                  {(() => {
                    if (!currentAnnouncement) return null;
                    const roleLabel = currentAnnouncement.speaker_role === "captain" ? "Capitán" : currentAnnouncement.speaker_role === "crew" ? "Tripulación de Cabina" : "Agente de Puerta";
                    return (
                      <>
                        <span>NARRACIÓN: <strong className="text-white font-bold">{getSpeakerName(currentAnnouncement.speaker_role)}</strong></span>
                        <span className="text-[#45AFFF] uppercase font-black text-[8px] tracking-wider bg-[#45AFFF]/10 px-1.5 py-0.5 rounded border border-[#45AFFF]/20">{roleLabel}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Tripulación al Mando (Con indicadores que se iluminan al hablar) */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-4">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2">
                Canales de Voz de Tripulación
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
                          <span className="text-[10px] font-mono text-white/45 block uppercase font-bold">Comandante</span>
                          <span className={`text-[12px] font-sans font-black tracking-wide ${isCaptainSpeaking ? 'text-[#43E600]' : 'text-white'}`}>
                            {getSpeakerName("captain")}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                        isCaptainSpeaking ? "bg-[#43E600] text-black bg-opacity-80" : "bg-black/40 text-white/30"
                      }`}>
                        {isCaptainSpeaking ? "Hablando" : "A la escucha"}
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
                          <span className="text-[10px] font-mono text-white/45 block uppercase font-bold font-mono">Jefe de Tripulación</span>
                          <span className={`text-[12px] font-sans font-black tracking-wide ${isCrewSpeaking ? 'text-[#43E600]' : 'text-white'}`}>
                            {getSpeakerName("crew")}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                        isCrewSpeaking ? "bg-[#43E600] text-black bg-opacity-80" : "bg-black/40 text-white/30"
                      }`}>
                        {isCrewSpeaking ? "Hablando" : "A la escucha"}
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
                  <span className="font-mono text-[#45AFFF] font-semibold text-[11px] block mb-1">MÚSICA EMBARQUE:</span>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span>SISTEMA: <strong className="text-[#43E600]">ON AIR</strong></span>
                    <span>TEMA: {boardingMusicTrackId === RANDOM_MUSIC_ID ? t("music.random") : selectedMusicTrack?.name || t("music.no_music")}</span>
                  </div>
                </div>

                {/* Volumen Slider */}
                <div>
                  <div className="flex justify-between items-center text-xs font-mono mb-1 text-white/80">
                    <span>VOLUMEN:</span>
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
        <div id="vuelo-estado-C" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          
          {/* Circular Satisfaction Meter Left, triggers right */}
          <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 flex flex-col md:flex-row items-center gap-6 justify-around shadow-md">
            
            {/* Circular SVG Gauge for global satisfaction */}
            <div className="text-center">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider mb-4 text-center">
                Satisfacción General
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
                  <span className="text-2xl font-display font-extrabold text-white">{avgSatisfaction}%</span>
                  <span className="text-[9px] font-mono text-white/60">CONFORME</span>
                </div>
              </div>

              <div className="mt-4 flex gap-4 justify-center text-xs font-mono">
                <span className="flex items-center gap-1 text-[#43E600]">
                  <Smile className="w-4 h-4" /> {passengers.filter(p => p.satisfaccion >= 70).length} Felices
                </span>
                <span className="flex items-center gap-1 text-[#E68B00]">
                  <Frown className="w-4 h-4" /> {passengers.filter(p => p.satisfaccion < 50).length} Incómodos
                </span>
              </div>
            </div>

            {/* Simulated fear meter and metrics */}
            <div className="space-y-4 max-w-xs w-full">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1 text-white/95">
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#E68B00]" />
                    ÍNDICE DE MIEDO GENERAL / TURBULENCIA:
                  </span>
                  <span className={`font-bold ${avgFear > 50 ? 'text-[#E600D2]' : 'text-white'}`}>{avgFear}%</span>
                </div>
                {/* Linear tracking bar */}
                <div className="w-full bg-[#00345C] h-2 rounded overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${avgFear > 50 ? 'bg-[#E600D2]' : 'bg-[#E68B00]'}`}
                    style={{ width: `${avgFear}%` }}
                  />
                </div>
              </div>

              {/* Announcement dispatcher */}
              <div className="bg-black/20 p-2.5 rounded border border-[#3B7EB2]/40 text-[11px] font-mono">
                📞 <strong className="text-[#45AFFF]">Anuncios en curso:</strong>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                  <button 
                    id="btn-envuelo-turbulencia"
                    onClick={() => onTriggerAnnouncement("turbulencia")}
                    className="p-1 bg-[#2C6591] border border-white/20 hover:border-white/60 rounded text-white text-left cursor-pointer"
                  >
                    ⛈️ Turbulencia
                  </button>
                  <button 
                    id="btn-envuelo-descenso"
                    onClick={() => onTriggerAnnouncement("descenso")}
                    className="p-1 bg-[#2C6591] border border-white/20 hover:border-white/60 rounded text-white text-left cursor-pointer"
                  >
                    📉 Descenso
                  </button>
                </div>
              </div>
            </div>

          </div>



          {/* Scrollable list of Passenger metrics */}
          <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 flex flex-col h-[300px] shadow-md">
            <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider mb-2 border-b border-white/10 pb-1.5 flex items-center justify-between">
              <span>LISTA COMPACTA DE PASAJEROS</span>
              <span className="text-[10px] text-white/50">{displayTotalPassengers} pax</span>
            </h3>

            <div className="overflow-y-auto flex-1 space-y-2 pr-1" id="compact-passenger-list">
              {passengers.map((p) => {
                let statusColor = "text-[#43E600]";
                if (p.satisfaccion < 55) statusColor = "text-[#E68B00]";
                if (p.miedo > 70) statusColor = "text-[#E600D2]";

                return (
                  <div 
                    key={p.id}
                    id={`p-list-item-${p.id}`}
                    onClick={() => setSelectedPasajero(p)}
                    className="bg-[#00345C]/55 border border-[#3B7EB2]/40 rounded-[5px] p-2 flex items-center justify-between hover:bg-[#00345C]/90 hover:border-[#45AFFF]/70 cursor-pointer transition-all"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-white truncate max-w-[120px]">{p.nombre}</span>
                        <span className="text-[10px] font-mono bg-white/10 px-1 rounded text-white/80">{p.asiento}</span>
                      </div>
                      <span className="text-[9px] text-[#45AFFF] font-mono uppercase">{p.clase} Clase</span>
                    </div>

                    <div className="text-right flex items-center gap-2">
                      <div className="text-[10px] font-mono">
                        <div className="text-white">😊 Sat: <strong className={statusColor}>{p.satisfaccion}%</strong></div>
                        <div className="text-white/70">😰 Miedo: <strong className="text-white/90">{p.miedo}%</strong></div>
                      </div>
                      <span className="text-[#45AFFF]/60">➔</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

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
                  <span>Resumen de Satisfacción a Bordo - Cabin Status</span>
                </span>
                <span className="text-[#43E600] flex items-center gap-1.5 font-sans font-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#43E600] animate-pulse" />
                  ACTIVO • {currentSubStage.toUpperCase()}
                </span>
              </div>

              {/* Grid de 4 Atributos Promedio (Estilo Bento Card) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                
                {/* Atributo 1: Satisfacción */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-[#43E600]/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>SATISFACCIÓN</span>
                    <Smile className="w-3.5 h-3.5 text-[#43E600]" />
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{p26Satisfaction}%</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${p26Satisfaction >= 70 ? 'text-[#43E600]' : p26Satisfaction >= 45 ? 'text-[#E68B00]' : 'text-[#E600D2]'}`}>
                      {p26Satisfaction >= 70 ? "Alta" : p26Satisfaction >= 45 ? "Aceptable" : "Baja"}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#43E600] rounded-full transition-all duration-500" 
                      style={{ width: `${p26Satisfaction}%`, filter: "drop-shadow(0 0 2px #43E600)" }} 
                    />
                  </div>
                </div>

                {/* Atributo 2: Miedo */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-[#E600D2]/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>ÍNDICE MIEDO</span>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#E600D2]" />
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{p26Fear}%</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${p26Fear >= 60 ? 'text-[#E600D2]' : p26Fear >= 30 ? 'text-[#E68B00]' : 'text-[#43E600]'}`}>
                      {p26Fear >= 60 ? "Trastorno" : p26Fear >= 30 ? "Ansiedad" : "Estable"}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${p26Fear >= 60 ? 'bg-[#E600D2]' : p26Fear >= 30 ? 'bg-[#E68B00]' : 'bg-[#43E600]'}`} 
                      style={{ width: `${p26Fear}%` }} 
                    />
                  </div>
                </div>

                {/* Atributo 3: Hambre */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-amber-400/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>HAMBRE ALERTA</span>
                    <Coffee className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{p26Hunger}%</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${p26Hunger >= 70 ? 'text-[#E600D2]' : p26Hunger >= 35 ? 'text-amber-400' : 'text-[#43E600]'}`}>
                      {p26Hunger >= 70 ? "Urgente" : p26Hunger >= 35 ? "Ganas" : "Satisfecho"}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${p26Hunger >= 70 ? 'bg-red-500' : p26Hunger >= 35 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${p26Hunger}%` }} 
                    />
                  </div>
                </div>

                {/* Atributo 4: Demanda Baño */}
                <div className="bg-[#002440]/65 border border-[#3B7EB2]/25 p-3.5 rounded-[7px] flex flex-col justify-between min-h-[110px] hover:border-violet-400/40 transition-all duration-300">
                  <div className="flex justify-between items-center text-[10px] font-mono text-white/55 uppercase">
                    <span>DEMANDA BAÑO</span>
                    <span className="text-[11px] leading-none select-none">🚻</span>
                  </div>
                  <div className="my-2 flex items-baseline gap-1">
                    <strong className="text-3xl font-display font-black text-white">{p26Bathroom}%</strong>
                    <span className={`text-[8.5px] font-mono font-bold uppercase ${p26Bathroom >= 70 ? 'text-[#E600D2]' : p26Bathroom >= 35 ? 'text-violet-400' : 'text-[#43E600]'}`}>
                      {p26Bathroom >= 70 ? "Crítico" : p26Bathroom >= 35 ? "Ganas" : "Relajados"}
                    </span>
                  </div>
                  <div className="w-full bg-black/45 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${p26Bathroom >= 70 ? 'bg-red-500' : p26Bathroom >= 35 ? 'bg-violet-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${p26Bathroom}%` }} 
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* 2. COMPORTAMIENTO DE ETAPA 7 (PLATAFORMA) - RESUMENES DE ATERRIZAJE E IA */}
            {currentSubStage === "Plataforma" && (
              <div className="space-y-5 animate-fadeIn">
                {/* Caja: Resumen de Aterrizaje */}
                <div className="bg-[#2C6591]/20 rounded-[8px] border-2 border-[#E68B00]/60 p-5 shadow-2xl text-white">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/10 pb-2.5 uppercase text-[#E68B00]">
                    <span className="flex items-center gap-1.5 font-bold">
                      <span className="text-sm">🛬</span>
                      <span>Resumen de Aterrizaje - Touchdown Telemetry</span>
                    </span>
                    <span className="text-[#43E600] font-sans font-black bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
                      SUAVE / GREASER
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 font-mono">
                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">CLASIFICACIÓN:</span>
                      <strong className="text-sm text-[#43E600] block mt-1 font-sans font-black">Soft Landing</strong>
                    </div>

                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">FUERZA G (G-FORCE):</span>
                      <strong className="text-base text-white font-sans font-black block mt-0.5">1.12 G</strong>
                    </div>

                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">VELOCIDAD VERTICAL:</span>
                      <strong className="text-base text-[#43E600] font-sans font-black block mt-0.5">-115 FPM</strong>
                    </div>

                    <div className="bg-black/30 p-3 rounded border border-white/10 text-center">
                      <span className="text-[9px] text-white/50 block">BOTES (BOUNCES):</span>
                      <strong className="text-base text-white font-sans font-black block mt-0.5">0 (Ninguno)</strong>
                    </div>
                  </div>
                </div>

                {/* Caja: Resumen de IA */}
                <div className="bg-[#2C6591]/30 rounded-[8px] border-2 border-[#45AFFF]/40 p-5 shadow-2xl text-white">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold tracking-wider border-b border-white/10 pb-2.5 uppercase text-[#45AFFF]">
                    <span className="flex items-center gap-1.5 font-bold">
                      <span className="text-sm">🤖</span>
                      <span>Informe de Operaciones IA - Virtual Cab AI Report</span>
                    </span>
                    <span className="text-[#45AFFF] font-mono font-bold">
                      VERSIÓN 1.2
                    </span>
                  </div>

                  {isReportGenerating ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                      <Loader2 className="w-8 h-8 text-[#45AFFF] animate-spin" />
                      <div className="space-y-1">
                        <p className="text-xs font-mono text-white/80 animate-pulse font-bold">GENERANDO INFORME DE INTELIGENCIA DE VUELO...</p>
                        <p className="text-[10px] font-mono text-white/40">Sincronizando encuestas de satisfacción y datos telemétricos...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3 font-mono text-xs leading-relaxed text-white/95 bg-black/45 p-4 rounded border border-[#3B7EB2]/30 animate-fadeIn" id="ai-report-body">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold border-b border-emerald-500/10 pb-1.5 text-[11px] mb-2 uppercase">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                        VUELO COMPLETADO CON ÉXITO • FLIGHT DIRECTIVE SATISFIED
                      </div>
                      <p>
                        <strong className="text-[#45AFFF]">OPERACIÓN DE CABINA:</strong> Se completó el traslado de los pasajeros desde <strong className="text-[#43E600]">{originICAO}</strong> hasta <strong className="text-[#43E600]">{destICAO}</strong> en el avión <strong className="font-bold text-white">{simBriefData.avion || "Airbus A320"}</strong>. El servicio general de cabina se coordinó en un 100% de efectividad.
                      </p>
                      <p>
                        <strong className="text-[#45AFFF]">MÉTRICAS DE PASAJEROS:</strong> La satisfacción promedio cerró en un increíble <strong className="text-[#43E600]">98%</strong>, demostrando una recepción impecable del servicio de café y el orden de los flujos de baño. El índice de miedo en cabina se estabilizó en un mínimo de <strong className="text-emerald-400">2%</strong> gracias a comunicados claros y oportunos de la tripulación técnica en las altitudes designadas.
                      </p>
                      <p>
                        <strong className="text-[#45AFFF]">REPORTE DE TOQUE:</strong> El aterrizaje catalogado como <strong className="text-[#43E600]">SOFT LANDING (-115 FPM, 1.12 G)</strong> contribuyó a la máxima valoración del confort del cliente al final de la ruta. Las puertas se desarmaron en plataforma sin incidentes de seguridad reportados.
                      </p>
                      <div className="pt-2 border-t border-white/10 flex justify-between items-center text-[10px] text-white/40 font-bold">
                        <span>OPERADOR: AC-AI INTELLIGENCE v1.2</span>
                        <span className="text-[#43E600] font-black uppercase text-[10px]">CALIFICACIÓN GLOBAL: A+ EXCELENTE</span>
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
                  <Users className="w-4 h-4 text-[#45AFFF]" /> MANIFEST DE PASAJEROS EN CABINA
                  {isManifestCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </h3>
                <span className="text-[10px] font-mono bg-[#45AFFF]/15 px-2 py-0.5 rounded text-white/80 border border-white/10 font-bold">
                  A Bordo: {passengers.length} pax {isManifestCollapsed && "(Colapsado)"}
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
                            <span className="text-[8px] font-mono text-white/45 w-6 uppercase text-left font-bold">SAT</span>
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
                            <span className="text-[8px] font-mono text-white/45 w-6 uppercase text-left font-bold">MDO</span>
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
                    <span>VOLUMEN GLOBAL CABINA:</span>
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
              🛬 REGISTRO POST-ATERRIZAJE DE FLIGHT REALS
            </h3>

            <div className="bg-black/35 border border-white/10 rounded-[7px] p-6 text-center space-y-4">
              <span className="text-xs text-white/70 block">VELOCIDAD VERTICAL DE IMPACTO (TOUCHDOWN):</span>
              <strong className={`text-5xl font-display font-extrabold tracking-tight ${ratingObj.color} block`} id="touchdown-fpm-display">
                {landingFpm} FPM
              </strong>
              
              <div className="inline-block bg-white/10 border border-white/20 px-3 py-1.5 rounded text-xs">
                CALIFICACIÓN DE CABINA / RANG: <strong className={`text-sm ${ratingObj.color}`}>{ratingObj.rating}</strong>
              </div>

              <div className="max-w-md mx-auto py-2">
                <span className="font-bold text-sm block text-[#45AFFF] uppercase mt-2 mb-1">{ratingObj.title}</span>
                <p className="text-xs text-white/85 leading-relaxed">
                  {ratingObj.desc}
                </p>
              </div>

              {/* Slider simulation for landing */}
              <div className="pt-4 border-t border-white/10 max-w-sm mx-auto">
                <label className="text-[10px] text-white/60 block mb-1">PROBAR OTRO TOQUE DE PISTA (FPM):</label>
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

            {/* Satisfaction Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="bg-[#00345C]/50 p-4 rounded border border-[#3B7EB2]/40">
                <span className="text-[11px] font-bold text-[#45AFFF]">SATISFACCIÓN GENERAL FINAL:</span>
                <div className="flex items-center gap-2 mt-2">
                  <Smile className="w-5 h-5 text-[#43E600]" />
                  <strong className="text-lg text-white">{avgSatisfaction}%</strong>
                  <span className="text-[10px] text-white/60">de aprobación</span>
                </div>
              </div>
              <div className="bg-[#00345C]/50 p-4 rounded border border-[#3B7EB2]/40">
                <span className="text-[11px] font-bold text-[#E68B00]">XP ADQUIRIDOS EN ESTE VUELO:</span>
                <strong className="text-lg text-[#43E600] block mt-1">+4,500 XP de carrera</strong>
              </div>
            </div>

            {/* Reset / Loop restart button */}
            <div className="mt-6 pt-4 border-t border-white/15 flex justify-end">
              <button
                id="btn-reiniciar-sim"
                onClick={onResetSimulation}
                className="bg-[#43E600] text-black font-bold font-mono px-5 py-2.5 rounded-[5px] text-xs hover:bg-[#34b600] transition-all cursor-pointer flex items-center gap-1.5"
              >
                🔄 CARGAR NUEVO DESPACHO (REINICIAR RUTA)
              </button>
            </div>
          </div>

          {/* Side stats passport awards */}
          <div className="space-y-6">
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 space-y-4 shadow-md">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1.5 flex items-center gap-1.5">
                🎉 RECONOCIMIENTOS ADJUDICADOS
              </h3>
              
              <ul className="space-y-3 font-mono text-xs">
                {Math.abs(landingFpm) <= 120 && (
                  <li className="p-2.5 bg-[#43E600]/10 border border-[#43E600]/40 rounded flex items-center gap-2 text-[#43E600]">
                    🏆 Unlocked: <strong>Seda en los Mandos</strong>
                  </li>
                )}
                {avgSatisfaction >= 90 ? (
                  <li className="p-2.5 bg-[#45AFFF]/10 border border-[#45AFFF]/40 rounded flex items-center gap-2 text-[#45AFFF]">
                    ❤ Unlocked: <strong>Anfitrión Supremo</strong>
                  </li>
                ) : (
                  <li className="p-2.5 bg-black/20 text-white/50 rounded">
                    🔇 No se desbloquearon logros nuevos por satisfacción.
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
        lastEventVariables={lastEventVars}
      />

      {/* Debug cluster — barra superior derecha (Monitor / Descargar / Limpiar logs) */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsDebugOpen(true)}
          className="bg-[#002440]/90 hover:bg-[#00345C]/90 text-[#45AFFF] border border-[#3B7EB2]/50 px-3 py-2 rounded-[5px] text-[11px] font-mono font-bold flex items-center gap-1.5 shadow-lg shadow-black/30 cursor-pointer transition-colors"
          title="Abrir monitor de variables"
        >
          <Activity className="w-3.5 h-3.5" />
          Monitor
        </button>
        <button
          type="button"
          onClick={() => fileLogger.download()}
          className="bg-[#002440]/90 hover:bg-[#00345C]/90 text-white border border-[#3B7EB2]/50 px-3 py-2 rounded-[5px] text-[11px] font-mono flex items-center gap-1.5 shadow-lg shadow-black/30 cursor-pointer transition-colors"
          title="Descargar logs de depuración (eventos y fases)"
        >
          <Download className="w-3.5 h-3.5" />
          Descargar Logs
        </button>
        <button
          type="button"
          onClick={() => { fileLogger.clear(); console.log('[FileLogger] Logs limpiados'); }}
          className="bg-black/40 hover:bg-black/60 text-white/70 hover:text-white border border-white/10 px-2.5 py-2 rounded-[5px] text-[11px] font-mono cursor-pointer transition-colors"
          title="Limpiar logs"
        >
          Limpiar
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
