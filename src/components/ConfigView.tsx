/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { UserEventDefaultsService } from "../services/UserEventDefaultsService";
import { ScenarioConfigService } from "../services/ScenarioConfigService";
import type {
  ScenarioConfigSnapshot,
  ScenarioEventConfig,
  ScenarioOption,
} from "../services/ScenarioConfigService";
import {
  EVENT_CONFIG_DEFAULT_VALUE,
  EVENT_CONFIG_FLAVOR_KEY,
  NORMAL_SCENARIO_KEY,
  SAFETY_VIDEO_EVENT_KEY,
  SAFETY_VIDEO_PACKAGE_STORAGE_KEY,
  EventSwitchValue,
  isConfigurableEvent,
  isEventSwitchValue,
  toUiSwitchValue,
} from "../services/eventConfigConstants";
import { 
  Sliders, 
  Radio, 
  Volume2, 
  Music, 
  Globe, 
  Mic, 
  SlidersHorizontal,
  VolumeX,
  Sparkles,
  Headphones,
  Check,
  Info,
  ChevronDown,
  ChevronUp,
  Compass,
  Gauge,
  Activity,
  Heart,
  Settings,
  ShieldAlert,
  Play,
  Plus,
  Search
} from "lucide-react";
import { SimBriefData, ConfigVoces, ConfigAudio } from "../types";
import { BoardingMusicService, BoardingMusicTrack } from "../services/BoardingMusicService";
import { RANDOM_MUSIC_ID } from "../services/MusicController";
import MusicPreview from "./music/MusicPreview";
import MusicDistortionPreview from "./music/MusicDistortionPreview";
import VoicesPage from "../pages/configuration/VoicesPage";
import PackagesTab from "./packages/PackagesTab";
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
import {
  BOARDING_PACE_DEFAULT_PPM,
  BOARDING_PACE_MAX_PPM,
  BOARDING_PACE_MIN_PPM,
  BOARDING_PACE_STORAGE_KEY,
  clampBoardingPace,
} from "../utils/flightUtils";

/** Foto de la voz seleccionada (40px). Fuera del componente para no perder estado. */
function StaffVoiceAvatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-10 h-10 rounded-full object-cover border border-[#3B7EB2]/50 shrink-0 bg-black/40"
      />
    );
  }
  return (
    <div
      className="w-10 h-10 rounded-full bg-[#00345C] border border-[#3B7EB2]/40 flex items-center justify-center shrink-0"
      title={name}
    >
      <Mic className="w-4 h-4 text-white/50" />
    </div>
  );
}

interface ConfigViewProps {
  simBriefData: SimBriefData;
  voicesConfig: ConfigVoces;
  audioConfig: ConfigAudio;
  onSimBriefUpdate: (data: Partial<SimBriefData>) => void;
  onVoicesUpdate: (data: Partial<ConfigVoces>) => void;
  onAudioUpdate: (data: Partial<ConfigAudio>) => void;
}

// Preset definition matching requirements
const CAPTAIN_PRESETS: Record<string, number[]> = {
  estandar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  vhf: [-12, -12, -12, -5, 4, 6, 4, -2, -12, -12],
  muffled_pa: [-2, 2, 5, 4, 0, -2, -5, -8, -10, -12]
};

const CREW_PRESETS: Record<string, number[]> = {
  estandar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  vhf: [-12, -12, -12, -5, 4, 6, 4, -2, -12, -12],
  muffled_pa: [-2, 2, 5, 4, 0, -2, -5, -8, -10, -12]
};

const FREQUENCIES = ["31Hz", "62Hz", "125Hz", "250Hz", "500Hz", "1kHz", "2kHz", "4kHz", "8kHz", "16kHz"];

interface EventGroup {
  id: string;
  labelKey: string;
  count: number;
}

export default function ConfigView({
  simBriefData,
  voicesConfig,
  audioConfig,
  onSimBriefUpdate,
  onVoicesUpdate,
  onAudioUpdate
}: ConfigViewProps) {
  const { t } = useTranslation();
  // Top level tabs
  const [activeTab, setActiveTab] = useState<"generales" | "eventos" | "packages" | "voces">("generales");
  const [showSaveAlert, setShowSaveAlert] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (cancelled || authErr || !user) return;

      setUserId(user.id);

      const { data, error } = await supabase
        .from("setting_general")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled || error) return;

      if (data) {
        if (data.boarding_pax_per_minute != null)
          setBoardingPaxPerMinute(clampBoardingPace(data.boarding_pax_per_minute));
        if ((data as any).boarding_music_distortion != null)
          setBoardingMusicDistortion(Boolean((data as any).boarding_music_distortion));
        if ((data as any).boarding_music_source != null)
          setBoardingAudioSource(toBoardingAudioSource((data as any).boarding_music_source));
        if (data.mute_ann_when_user_not_in_cabin != null)
          setMuteAnnWhenNotInCabin(data.mute_ann_when_user_not_in_cabin);
        if (data.auto_detect_flight_phase != null)
          setAutoDetectFlightPhase(data.auto_detect_flight_phase);
        if (data.start_after_simulator_connect != null)
          setStartAfterSimulatorConnect(data.start_after_simulator_connect);
        if (data.enable_cabin_voice_effect != null)
          setEnableCabinVoiceEffect(data.enable_cabin_voice_effect);
        if (data.disable_prompts_when_changing_flight_state_manually != null)
          setDisablePromptsManually(data.disable_prompts_when_changing_flight_state_manually);
        if (data.show_icao_codes != null)
          setShowIcaoCodes(data.show_icao_codes);
        if (data.save_language_settings != null)
          setSaveLanguageSettings(data.save_language_settings);
        if (data.show_local_time_of_simulator != null)
          setShowLocalTimeSim(data.show_local_time_of_simulator);
        if (data.show_ai_generation_progress_on_pre_flight_screen != null)
          setShowAiProgressPreflight(data.show_ai_generation_progress_on_pre_flight_screen);
        if (data.audio_3d_enabled != null)
          setAudio3dEnabled(data.audio_3d_enabled);
        if (data.eq_captain_preset != null)
          setEqCaptainPreset(data.eq_captain_preset);
        if (data.eq_captain_bands != null)
          setEqCaptainBands(data.eq_captain_bands);
        if (data.eq_crew_preset != null)
          setEqCrewPreset(data.eq_crew_preset);
        if (data.eq_crew_bands != null)
          setEqCrewBands(data.eq_crew_bands);
        if (data.gforce != null)
          setPfGforce(data.gforce);
        if (data.vertical_speed != null)
          setPfVerticalSpeed(data.vertical_speed);
        if (data.landing_force != null)
          setPfLandingForce(data.landing_force);
        if (data.irregular_ground_speed != null)
          setPfIrregularGroundSpeed(data.irregular_ground_speed);
        if (data.acceleration_ground_speed != null)
          setPfAccelerationGroundSpeed(data.acceleration_ground_speed);
        if (data.delay_feedback != null)
          setPfDelayFeedback(data.delay_feedback);
        // Personal de Vuelo - persistido en setting_general
        if ((data as any).language_id != null) {
          setSelectedLanguageId((data as any).language_id);
          localStorage.setItem("cfg_selected_language_id", (data as any).language_id);
        }
        if ((data as any).captain_voice_id != null) {
          setSelectedCaptainVoiceId((data as any).captain_voice_id);
          localStorage.setItem("cfg_selected_captain_voice_id", (data as any).captain_voice_id);
        }
        if ((data as any).crew_voice_id != null) {
          setSelectedCrewVoiceId((data as any).crew_voice_id);
          localStorage.setItem("cfg_selected_crew_voice_id", (data as any).crew_voice_id);
        }
        if ((data as any).gate_agent_voice_id != null) {
          // gate_agent_voice_id también se valida contra voices_stock más abajo.
          localStorage.setItem("cfg_gate_agent_voice_id", (data as any).gate_agent_voice_id);
        }
      } else {
        setBoardingPaxPerMinute(BOARDING_PACE_DEFAULT_PPM);
        setBoardingMusicDistortion(true);
        setBoardingAudioSource("ia");
        setMuteAnnWhenNotInCabin(false);
        setAutoDetectFlightPhase(true);
        setStartAfterSimulatorConnect(false);
        setEnableCabinVoiceEffect(true);
        setDisablePromptsManually(false);
        setShowIcaoCodes(true);
        setSaveLanguageSettings(true);
        setShowLocalTimeSim(true);
        setShowAiProgressPreflight(true);
        setAudio3dEnabled(false);
        setEqCaptainPreset("estandar");
        setEqCaptainBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        setEqCrewPreset("estandar");
        setEqCrewBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        setPfGforce(true);
        setPfVerticalSpeed(true);
        setPfLandingForce(true);
        setPfIrregularGroundSpeed(true);
        setPfAccelerationGroundSpeed(true);
        setPfDelayFeedback(true);
        setPlayChimeBeforeAnn(true);
        setPlayAmbientDuringFlight(true);
        setCrewGreetingGate(true);
        setPassengerReactionPlanesMovement(true);
        setPassengerReactionLanding(true);
        setPlayBoardingMusic(true);
        setSongBoardingMusic("");
        setSpeedKph(true);
      }

      // Load gate agent voices from stock
      const { data: gateVoices, error: gateErr } = await supabase
        .from("voices_stock")
        .select("id, voice_name")
        .eq("voice_role", "gate");

      if (cancelled || gateErr) return;

      if (gateVoices && gateVoices.length > 0) {
        setGateAgentVoices(gateVoices.map(v => ({ id: v.id, name: v.voice_name })));

        const loadedGateId = data?.gate_agent_voice_id;
        if (loadedGateId && gateVoices.some(v => v.id === loadedGateId)) {
          setGateAgentVoiceId(loadedGateId);
        } else {
          setGateAgentVoiceId(gateVoices[0].id);
        }
      }
    };

    loadSettings();
    return () => { cancelled = true; };
  }, []);

  // Cargar preferencias de Personal de Vuelo al abrir la pestaña Generales (setting_general)
  useEffect(() => {
    if (activeTab !== "generales" || !userId) return;
    let cancelled = false;
    (async () => {
      const { data: settings, error } = await supabase
        .from('setting_general')
        .select('language_id, captain_voice_id, crew_voice_id, gate_agent_voice_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled || error || !settings) {
        if (error) console.warn("[ConfigView] Generales setting_general load error:", error.message);
        return;
      }
      console.log('[ConfigView] Generales - setting_general cargado:', settings);
      if ((settings as any).language_id) {
        setSelectedLanguageId((settings as any).language_id);
        localStorage.setItem("cfg_selected_language_id", (settings as any).language_id);
      }
      if ((settings as any).captain_voice_id) {
        setSelectedCaptainVoiceId((settings as any).captain_voice_id);
        localStorage.setItem("cfg_selected_captain_voice_id", (settings as any).captain_voice_id);
      }
      if ((settings as any).crew_voice_id) {
        setSelectedCrewVoiceId((settings as any).crew_voice_id);
        localStorage.setItem("cfg_selected_crew_voice_id", (settings as any).crew_voice_id);
      }
      if ((settings as any).gate_agent_voice_id) {
        setGateAgentVoiceId((settings as any).gate_agent_voice_id);
        localStorage.setItem("cfg_gate_agent_voice_id", (settings as any).gate_agent_voice_id);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, userId]);

  // Carga idiomas y voces habilitadas del usuario (misma lógica que la configuración previa al vuelo)
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setStaffLanguagesLoading(true);
      try {
        const { data, error } = await supabase.from("languages").select("id, language_name");
        if (error) throw error;
        if (cancelled) return;
        const mapped = (data || []).map((l: any) => ({ id: l.id, name: l.language_name }));
        if (mapped.length > 0) {
          setStaffLanguageList(mapped);
          setSelectedLanguageId((prev) => {
            const next = prev && mapped.some((l) => l.id === prev) ? prev : mapped[0].id;
            localStorage.setItem("cfg_selected_language_id", next);
            return next;
          });
        }
      } catch (e: any) {
        if (!cancelled) setStaffLanguagesError(e?.message || "Error al cargar idiomas");
      } finally {
        if (!cancelled) setStaffLanguagesLoading(false);
      }
    })();

    (async () => {
      setStaffVoicesLoading(true);
      try {
        const { data: userVoices, error: voicesError } = await supabase
          .from("voices")
          .select("voicestock_id")
          .eq("user_id", userId)
          .eq("voice_enabled", true);
        if (voicesError) throw voicesError;
        if (cancelled) return;

        const stockIds = (userVoices || []).map((v: any) => v.voicestock_id);

        let mapped: StaffVoiceOption[] = [];
        if (stockIds.length > 0) {
          let stockResult: any = await supabase
            .from("voices_stock")
            .select("id, voice_name, voice_role, avatar_url, languages")
            .in("id", stockIds);
          if (stockResult.error) {
            // Schema sin columna `languages`: reintentar sin ella.
            stockResult = await supabase
              .from("voices_stock")
              .select("id, voice_name, voice_role, avatar_url")
              .in("id", stockIds);
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
            avatarUrl:
              typeof vs.avatar_url === "string" && vs.avatar_url.trim() !== ""
                ? vs.avatar_url.trim()
                : null,
          }));
        }
        if (!cancelled) setStaffVoiceList(mapped);
      } catch (e: any) {
        if (!cancelled) setStaffVoicesError(e?.message || "Error al cargar voces");
      } finally {
        if (!cancelled) setStaffVoicesLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const [toastNotification, setToastNotification] = useState<string | null>(null);

  // NEW VOCES TAB STATES
  const [voicesList, setVoicesList] = useState(() => {
    const raw = localStorage.getItem("cfg_voices_list");
    if (raw) return JSON.parse(raw);
    return [
      { id: "v1", name: "Carlos (Capitán)", type: "Estándar" as const, enabled: true, gender: "masculino", description: "Voz firme y experimentada para anuncios de cabina." },
      { id: "v2", name: "Sofía (Jefa de Cabina)", type: "Estándar" as const, enabled: true, gender: "femenino", description: "Voz clara y amable para bienvenida y demostración." },
      { id: "v3", name: "Helena (ATC)", type: "Estándar" as const, enabled: true, gender: "femenino", description: "Voz robótica típica de transmisiones de torre de control ATC." },
      { id: "v4", name: "Roberto (Usuario)", type: "Usuario" as const, enabled: true, gender: "masculino", description: "Voz de usuario personalizada registrada con micrófono." },
      { id: "v5", name: "Mi propia voz grabada", type: "Usuario" as const, enabled: false, gender: "femenino", description: "Lectura pausada y con buen volumen grabado." }
    ];
  });

  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // Add/Edit voice forms states
  const [showNewVoiceModal, setShowNewVoiceModal] = useState(false);
  const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
  const [newVoiceName, setNewVoiceName] = useState("");
  const [newVoiceDescription, setNewVoiceDescription] = useState("");
  const [newVoiceGender, setNewVoiceGender] = useState<"masculino" | "femenino">("femenino");
  const [newVoiceIsPublic, setNewVoiceIsPublic] = useState(false);

  // Recording status
  const [isRecording, setIsRecording] = useState(false);
  const [recordTimer, setRecordTimer] = useState(0);

  useEffect(() => {
    let intervalId: any;
    if (isRecording) {
      intervalId = setInterval(() => {
        setRecordTimer((prev) => {
          if (prev >= 10) {
            setIsRecording(false);
            clearInterval(intervalId);
            return 10;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => {
      clearInterval(intervalId);
    };
  }, [isRecording]);

  const playSyntheticVoicePreview = (name: string, voiceId: string) => {
    if (playingVoiceId === voiceId) {
      setPlayingVoiceId(null);
      return;
    }
    setPlayingVoiceId(voiceId);
    setTimeout(() => {
      setPlayingVoiceId(null);
    }, 3000);

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      const now = ctx.currentTime;
      let freq = 220;
      if (name.includes("Sofía")) freq = 360;
      else if (name.includes("Helena")) freq = 310;
      else if (name.includes("Carlos")) freq = 175;
      
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq + 30, now + 0.15);
      osc.frequency.linearRampToValueAtTime(freq - 15, now + 0.35);
      osc.frequency.linearRampToValueAtTime(freq + 20, now + 0.6);
      osc.frequency.linearRampToValueAtTime(freq, now + 0.82);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
      
      osc.start(now);
      osc.stop(now + 1.25);
    } catch (e) {
      console.log("Audio preview not supported or blocked by browser policies", e);
    }
  };

  // ==================== STATE MANAGEMENT & LOCAL STORAGE PERSISTENCE ====================
  
  // Bloque 1: Preferencias - Generales del Sistema
  // Ritmo de embarque global del piloto (pax/min). Reemplaza al ajuste
  // legacy de segundos (columna `passenger_boarding_time_seconds`, sin uso).
  const [boardingPaxPerMinute, setBoardingPaxPerMinute] = useState<number>(() => {
    try {
      return clampBoardingPace(localStorage.getItem(BOARDING_PACE_STORAGE_KEY));
    } catch {
      return BOARDING_PACE_DEFAULT_PPM;
    }
  });
  // Efecto de distorsión en música de embarque (default: Sí).
  const [boardingMusicDistortion, setBoardingMusicDistortion] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cfg_boarding_music_distortion") !== "false";
    } catch {
      return true;
    }
  });
  const [muteAnnWhenNotInCabin, setMuteAnnWhenNotInCabin] = useState<boolean>(() => {
    return localStorage.getItem("cfg_Mute_Ann_When_User_Not_In_Cabin") === "true";
  });
  const [autoDetectFlightPhase, setAutoDetectFlightPhase] = useState<boolean>(() => {
    return localStorage.getItem("cfg_Auto_Detect_Flight_Phase") !== "false"; // default true
  });
  const [startAfterSimulatorConnect, setStartAfterSimulatorConnect] = useState<boolean>(() => {
    return localStorage.getItem("cfg_start_after_simulator_connect") === "true"; // default false
  });
  const [enableCabinVoiceEffect, setEnableCabinVoiceEffect] = useState<boolean>(() => {
    return localStorage.getItem("cfg_enable_cabin_voice_effect") !== "false"; // default true
  });
  const [disablePromptsManually, setDisablePromptsManually] = useState<boolean>(() => {
    return localStorage.getItem("cfg_disable_prompts_when_changing_flight_state_manually") === "true"; // default false
  });
  const [showIcaoCodes, setShowIcaoCodes] = useState<boolean>(() => {
    return localStorage.getItem("cfg_show_ICAO_codes") !== "false"; // default true
  });
  const [saveLanguageSettings, setSaveLanguageSettings] = useState<boolean>(() => {
    return localStorage.getItem("cfg_save_language_settings") !== "false"; // default true
  });
  const [showLocalTimeSim, setShowLocalTimeSim] = useState<boolean>(() => {
    return localStorage.getItem("cfg_show_local_time_of_simulator") !== "false"; // default true
  });
  const [showAiProgressPreflight, setShowAiProgressPreflight] = useState<boolean>(() => {
    return localStorage.getItem("cfg_show_ai_generation_progress_on_pre_flight_screen") !== "false"; // default true
  });

  // Bloque 1: Preferencias Modificables en cada vuelo (Immersion Config)
  const [playChimeBeforeAnn, setPlayChimeBeforeAnn] = useState<boolean>(() => {
    return localStorage.getItem("cfg_play_chime_sound_before_ann") !== "false"; // default true
  });
  const [playAmbientDuringFlight, setPlayAmbientDuringFlight] = useState<boolean>(() => {
    return localStorage.getItem("cfg_play_ambient_sound_during_flight") !== "false"; // default true
  });
  const [crewGreetingGate, setCrewGreetingGate] = useState<boolean>(() => {
    return localStorage.getItem("cfg_crew_greeting_passengers_at_gate") !== "false"; // default true
  });
  const [passengerReactionPlanesMovement, setPassengerReactionPlanesMovement] = useState<boolean>(() => {
    return localStorage.getItem("cfg_passenger_reaction_to_planes_movement") !== "false"; // default true
  });
  const [passengerReactionLanding, setPassengerReactionLanding] = useState<boolean>(() => {
    return localStorage.getItem("cfg_play_passenger_reaction_during_landing") !== "false"; // default true
  });
  const [playBoardingMusic, setPlayBoardingMusic] = useState<boolean>(() => {
    return localStorage.getItem("cfg_play_boarding_music") !== "false"; // default true
  });
  const [songBoardingMusic, setSongBoardingMusic] = useState<string>(() => {
    return localStorage.getItem("cfg_song_boarding_music") || "";
  });
  const [musicTracks, setMusicTracks] = useState<BoardingMusicTrack[]>([]);
  const [musicTracksLoading, setMusicTracksLoading] = useState<boolean>(false);
  const [speedKph, setSpeedKph] = useState<boolean>(() => {
    return localStorage.getItem("cfg_speed_kph") !== "false"; // default true
  });

  // Personal de Vuelo - persistido en setting_general (language_id, captain_voice_id, crew_voice_id, gate_agent_voice_id)
  const [selectedLanguageId, setSelectedLanguageId] = useState<string>(() => {
    return localStorage.getItem("cfg_selected_language_id") || "";
  });
  const [selectedCaptainVoiceId, setSelectedCaptainVoiceId] = useState<string>(() => {
    return localStorage.getItem("cfg_selected_captain_voice_id") || "";
  });
  const [selectedCrewVoiceId, setSelectedCrewVoiceId] = useState<string>(() => {
    return localStorage.getItem("cfg_selected_crew_voice_id") || "";
  });
  // Gate Agent Voice
  const [gateAgentVoiceId, setGateAgentVoiceId] = useState<string>(() => {
    return localStorage.getItem("cfg_gate_agent_voice_id") || "";
  });
  const [gateAgentVoices, setGateAgentVoices] = useState<{ id: string; name: string }[]>([]);

  // Opciones de idiomas y voces (misma fuente que la configuración previa al vuelo)
  interface StaffVoiceOption {
    id: string;
    name: string;
    role: string;
    languages: string[];
    avatarUrl: string | null;
  }
  const [staffLanguageList, setStaffLanguageList] = useState<{ id: string; name: string }[]>([]);
  const [staffLanguagesLoading, setStaffLanguagesLoading] = useState(false);
  const [staffLanguagesError, setStaffLanguagesError] = useState<string | null>(null);
  const [staffVoiceList, setStaffVoiceList] = useState<StaffVoiceOption[]>([]);
  const [staffVoicesLoading, setStaffVoicesLoading] = useState(false);
  const [staffVoicesError, setStaffVoicesError] = useState<string | null>(null);

  const staffVoiceMatchesLanguage = (voice: StaffVoiceOption, langId?: string): boolean =>
    !voice.languages || voice.languages.length === 0 || voice.languages.includes(langId ?? selectedLanguageId);

  const getStaffVoiceOptionsForRole = (role: string, langId?: string): StaffVoiceOption[] =>
    staffVoiceList.filter((v) => v.role === role && staffVoiceMatchesLanguage(v, langId));

  const staffCaptainVoiceOptions = getStaffVoiceOptionsForRole("captain");
  const staffCrewVoiceOptions = getStaffVoiceOptionsForRole("crew");
  const staffGateVoiceOptions = getStaffVoiceOptionsForRole("gate");

  /** Avatar de la voz seleccionada (con fallback si no hay imagen o falla). */
  const staffSelectedAvatar = (options: StaffVoiceOption[], voiceId: string): StaffVoiceOption | null =>
    options.find((v) => v.id === voiceId) ?? null;

  // ── Consistencia idioma ↔ voces (Personal de Vuelo) ──────────────────
  // Si una voz guardada (preferencia del usuario) NO pertenece al idioma
  // elegido (o ya no está disponible), se corrige a la primera voz válida de
  // ese rol para el idioma. Evita persistir/arrancar con voces que no
  // corresponden al idioma (causa de "audio no encontrado"). No auto-selecciona
  // voces vacías: si el usuario aún no eligió, se respeta ese estado.
  const staffFirstVoiceForRole = (role: string, langId: string): string => {
    const v = getStaffVoiceOptionsForRole(role, langId)[0];
    return v?.id ?? "";
  };
  const staffIsVoiceValidForLanguage = (role: string, voiceId: string, langId: string): boolean => {
    if (!voiceId) return false;
    const v = staffVoiceList.find((item) => item.id === voiceId);
    return !!v && v.role === role && staffVoiceMatchesLanguage(v, langId);
  };
  useEffect(() => {
    if (staffVoicesLoading || staffVoiceList.length === 0) return;
    const lang = selectedLanguageId;
    const fix = (role: string, current: string, setter: (id: string) => void): void => {
      // Voz vacía: el usuario aún no eligió; no auto-seleccionar.
      if (!current) return;
      if (staffIsVoiceValidForLanguage(role, current, lang)) return;
      setter(staffFirstVoiceForRole(role, lang));
    };
    fix("captain", selectedCaptainVoiceId, setSelectedCaptainVoiceId);
    fix("crew", selectedCrewVoiceId, setSelectedCrewVoiceId);
    fix("gate", gateAgentVoiceId, setGateAgentVoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLanguageId, selectedCaptainVoiceId, selectedCrewVoiceId, gateAgentVoiceId, staffVoiceList, staffVoicesLoading]);

  // Bloque 2: Audio Config
  const [audio3dEnabled, setAudio3dEnabled] = useState<boolean>(() => {
    return localStorage.getItem("cfg_audio_3d_enabled") === "true"; // default false
  });
  const [eqCaptainPreset, setEqCaptainPreset] = useState<string>(() => {
    return localStorage.getItem("cfg_eq_captain_preset") || "estandar";
  });
  const [eqCaptainBands, setEqCaptainBands] = useState<number[]>(() => {
    const raw = localStorage.getItem("cfg_eq_captain_bands");
    return raw ? JSON.parse(raw) : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  });
  const [eqCrewPreset, setEqCrewPreset] = useState<string>(() => {
    return localStorage.getItem("cfg_eq_crew_preset") || "estandar";
  });
  const [eqCrewBands, setEqCrewBands] = useState<number[]>(() => {
    const raw = localStorage.getItem("cfg_eq_crew_bands");
    return raw ? JSON.parse(raw) : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  });

  // Bloque 4: Experiencia del Pasajero Trigger Switches
  const [pfGforce, setPfGforce] = useState<boolean>(() => {
    return localStorage.getItem("cfg_gforce") !== "false"; // default true
  });
  const [pfVerticalSpeed, setPfVerticalSpeed] = useState<boolean>(() => {
    return localStorage.getItem("cfg_vertical_speed") !== "false"; // default true
  });
  const [pfLandingForce, setPfLandingForce] = useState<boolean>(() => {
    return localStorage.getItem("cfg_landing_force") !== "false"; // default true
  });
  const [pfIrregularGroundSpeed, setPfIrregularGroundSpeed] = useState<boolean>(() => {
    return localStorage.getItem("cfg_irregular_ground_speed") !== "false"; // default true
  });
  const [pfAccelerationGroundSpeed, setPfAccelerationGroundSpeed] = useState<boolean>(() => {
    return localStorage.getItem("cfg_acceleration_ground_speed") !== "false"; // default true
  });
  const [pfDelayFeedback, setPfDelayFeedback] = useState<boolean>(() => {
    return localStorage.getItem("cfg_delay_feedback") !== "false"; // default true
  });

  // Pestaña "Eventos" settings
  const [selectedPackage, setSelectedPackage] = useState<string>(() => {
    return localStorage.getItem("cfg_selected_package") || "";
  });
  // Package de video de seguridad por defecto (modo PACK de
  // `taxi_crew_safety_brief`). Solo se guarda el id; el registro completo lo
  // resuelve el selector (con auto-selección del primero por defecto).
  const [safetyPackage, setSafetyPackage] = useState<PackageRecord | null>(null);
  const [storedSafetyPackageId] = useState<string | null>(() => {
    return localStorage.getItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY);
  });
  const [activeGroupTab, setActiveGroupTab] = useState<string>("immersion");
  const [announcementFlavor, setAnnouncementFlavor] = useState<"operative" | "cultural" | "scenic" | "casual">(() => {
    return (localStorage.getItem("cfg_announcement_flavor") as any) || "operative";
  });
  const [eventConfig, setEventConfig] = useState<Record<string, EventSwitchValue>>(() => {
    const raw = localStorage.getItem("cfg_event_config");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, EventSwitchValue> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") {
            normalized[key] = toUiSwitchValue(value);
          }
        }
        return normalized;
      } catch {
        // localStorage corrupto → valores por defecto.
      }
    }
    return {
      gate_crew_start_soon: "IA",
      gate_crew_started: "IA",
      common_crew_boarding: "IA",
      preflight_crew_welcome: "IA",
      preflight_capt_welcome: "IA",
      preflight_capt_delay: "IA",
      preflight_capt_basic_info: "IA",
      preflight_crew_basic_info: "IA",
      taxi_capt_armdoors: "IA",
      taxi_crew_safety_brief: "IA",
      taxi_capt_dimlights: "IA",
      taxi_crew_dimlights: "IA",
      takeoff_capt_prepare: "IA",
      climb_crew_upcoming_service: "IA",
      cruise_capt_general_info: "IA",
      cruise_crew_service_info1: "IA",
      cruise_crew_service_info2: "IA",
      cruise_crew_shopping_info: "IA",
      cruise_crew_customs_forms: "IA",
      cruise_crew_service_info3: "IA",
      descent_capt_close_desc: "IA",
      descent_capt_upcoming_actions: "IA",
      descent_crew_upcoming_actions: "IA",
      descent_capt_10kfeet: "IA",
      descent_crew_landing_fewmin: "IA",
      final_capt_take_seats: "IA",
      taxitogate_crew_welcome: "IA",
      taxitogate_crew_ramining_seating: "IA",
      taxitogate_crew_delay_apologies: "IA",
      atgate_capt_disarm_doors: "IA",
      atgate_crew_deboarding: "IA",
      common_capt_seatbelt: "IA",
      common_crew_seatbelt: "IA"
    };
  });

  // Escenarios para el selector de la pestaña "Eventos".
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<string>(NORMAL_SCENARIO_KEY);
  const [scenarioSnapshot, setScenarioSnapshot] = useState<ScenarioConfigSnapshot | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState<boolean>(false);

  // Carga la lista de escenarios activos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await ScenarioConfigService.listActiveScenarios();
      if (cancelled || !result.success) return;
      const list = result.data ?? [];
      setScenarios(list);
      if (list.length > 0 && !list.some((entry) => entry.key === selectedScenarioKey)) {
        setSelectedScenarioKey(list[0].key);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Migración retrocompatible: si el valor guardado es un nombre de pista
        // (esquema anterior) en lugar de un id, se convierte al id actual.
        setSongBoardingMusic((prev) => {
          if (!prev || prev === RANDOM_MUSIC_ID) return prev;
          if (result.data!.some((track) => track.id === prev)) return prev;
          const byName = result.data!.find((track) => track.name === prev);
          return byName ? byName.id : "";
        });
      } else {
        console.warn("[ConfigView] No se pudieron cargar las pistas de música:", result.error);
      }
      if (!cancelled) setMusicTracksLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Carga el snapshot del escenario seleccionado + la configuración guardada.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setScenarioLoading(true);
      const [snapshotResult, configResult] = await Promise.all([
        ScenarioConfigService.loadPublishedSnapshot(selectedScenarioKey),
        UserEventDefaultsService.loadEffectiveUserConfig(userId, selectedScenarioKey),
      ]);
      if (cancelled) return;

      if (snapshotResult.success && snapshotResult.data) {
        setScenarioSnapshot(snapshotResult.data);
        setActiveGroupTab("immersion");
      } else {
        console.warn("[ConfigView] No se pudo cargar el escenario:", snapshotResult.error);
        setScenarioSnapshot(null);
        setActiveGroupTab("immersion");
      }

      if (configResult.success) {
        const loaded = configResult.data ?? {};
        const switchMap: Record<string, EventSwitchValue> = {};
        for (const [key, value] of Object.entries(loaded)) {
          if (isEventSwitchValue(value) && isConfigurableEvent(key)) {
            switchMap[key] = value;
          }
        }
        if (Object.keys(switchMap).length > 0) {
          setEventConfig(switchMap);
        }

        const flavor = loaded[EVENT_CONFIG_FLAVOR_KEY];
        if (flavor != null) {
          setAnnouncementFlavor(flavor as any);
        }
      }

      setScenarioLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedScenarioKey]);

  // Guardar todas las configuraciones
  const handleSaveAll = () => {
    // Bloque 1
    localStorage.setItem(BOARDING_PACE_STORAGE_KEY, String(boardingPaxPerMinute));
    localStorage.setItem("cfg_boarding_music_distortion", String(boardingMusicDistortion));
    localStorage.setItem("cfg_Mute_Ann_When_User_Not_In_Cabin", String(muteAnnWhenNotInCabin));
    localStorage.setItem("cfg_Auto_Detect_Flight_Phase", String(autoDetectFlightPhase));
    localStorage.setItem("cfg_start_after_simulator_connect", String(startAfterSimulatorConnect));
    localStorage.setItem("cfg_enable_cabin_voice_effect", String(enableCabinVoiceEffect));
    localStorage.setItem("cfg_disable_prompts_when_changing_flight_state_manually", String(disablePromptsManually));
    localStorage.setItem("cfg_show_ICAO_codes", String(showIcaoCodes));
    localStorage.setItem("cfg_save_language_settings", String(saveLanguageSettings));
    localStorage.setItem("cfg_show_local_time_of_simulator", String(showLocalTimeSim));
    localStorage.setItem("cfg_show_ai_generation_progress_on_pre_flight_screen", String(showAiProgressPreflight));

    localStorage.setItem("cfg_play_chime_sound_before_ann", String(playChimeBeforeAnn));
    localStorage.setItem("cfg_play_ambient_sound_during_flight", String(playAmbientDuringFlight));
    localStorage.setItem("cfg_crew_greeting_passengers_at_gate", String(crewGreetingGate));
    localStorage.setItem("cfg_passenger_reaction_to_planes_movement", String(passengerReactionPlanesMovement));
    localStorage.setItem("cfg_play_passenger_reaction_during_landing", String(passengerReactionLanding));
    localStorage.setItem("cfg_play_boarding_music", String(playBoardingMusic));
    localStorage.setItem("cfg_song_boarding_music", songBoardingMusic);
    localStorage.setItem("cfg_speed_kph", String(speedKph));
    localStorage.setItem("cfg_gate_agent_voice_id", gateAgentVoiceId);
    // Personal de Vuelo - persistido en setting_general
    localStorage.setItem("cfg_selected_language_id", selectedLanguageId);
    localStorage.setItem("cfg_selected_captain_voice_id", selectedCaptainVoiceId);
    localStorage.setItem("cfg_selected_crew_voice_id", selectedCrewVoiceId);

    // Bloque 2
    localStorage.setItem("cfg_audio_3d_enabled", String(audio3dEnabled));
    localStorage.setItem("cfg_eq_captain_preset", eqCaptainPreset);
    localStorage.setItem("cfg_eq_captain_bands", JSON.stringify(eqCaptainBands));
    localStorage.setItem("cfg_eq_crew_preset", eqCrewPreset);
    localStorage.setItem("cfg_eq_crew_bands", JSON.stringify(eqCrewBands));

    // Bloque 4
    localStorage.setItem("cfg_gforce", String(pfGforce));
    localStorage.setItem("cfg_vertical_speed", String(pfVerticalSpeed));
    localStorage.setItem("cfg_landing_force", String(pfLandingForce));
    localStorage.setItem("cfg_irregular_ground_speed", String(pfIrregularGroundSpeed));
    localStorage.setItem("cfg_acceleration_ground_speed", String(pfAccelerationGroundSpeed));
    localStorage.setItem("cfg_delay_feedback", String(pfDelayFeedback));

    // Eventos
    localStorage.setItem("cfg_selected_package", selectedPackage);
    if (safetyPackage) {
      localStorage.setItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY, safetyPackage.id);
    }
    localStorage.setItem("cfg_event_config", JSON.stringify(eventConfig));
    localStorage.setItem("cfg_announcement_flavor", announcementFlavor);

    // Despachar actualizaciones a componentes padres si estuvieran definidas
    onAudioUpdate({
      eqGrave: eqCaptainBands[1], // simular mapeando bandas
      eqMedio: eqCaptainBands[4],
      eqAgudo: eqCaptainBands[7],
      musicaEmbarque: playBoardingMusic,
      ruidoCabina: playAmbientDuringFlight
    });

    onVoicesUpdate({
      volumenVoz: voicesConfig.volumenVoz,
      efectoRadio: enableCabinVoiceEffect
    });

    // Voces adicionales (legacy local)
    localStorage.setItem("cfg_voices_list", JSON.stringify(voicesList));

    setShowSaveAlert(true);
    setTimeout(() => setShowSaveAlert(false), 3000);

    if (userId) {
      (async () => {
        try {
          const upsertPayload = {
            user_id: userId,
            mute_ann_when_user_not_in_cabin: muteAnnWhenNotInCabin,
            auto_detect_flight_phase: autoDetectFlightPhase,
            start_after_simulator_connect: startAfterSimulatorConnect,
            enable_cabin_voice_effect: enableCabinVoiceEffect,
            disable_prompts_when_changing_flight_state_manually: disablePromptsManually,
            show_icao_codes: showIcaoCodes,
            save_language_settings: saveLanguageSettings,
            show_local_time_of_simulator: showLocalTimeSim,
            show_ai_generation_progress_on_pre_flight_screen: showAiProgressPreflight,
            audio_3d_enabled: audio3dEnabled,
            eq_captain_preset: eqCaptainPreset,
            eq_captain_bands: eqCaptainBands,
            eq_crew_preset: eqCrewPreset,
            eq_crew_bands: eqCrewBands,
            gforce: pfGforce,
            vertical_speed: pfVerticalSpeed,
            landing_force: pfLandingForce,
            irregular_ground_speed: pfIrregularGroundSpeed,
            acceleration_ground_speed: pfAccelerationGroundSpeed,
            delay_feedback: pfDelayFeedback,
            play_chime_sound_before_ann: playChimeBeforeAnn,
            play_ambient_sound_during_flight: playAmbientDuringFlight,
            crew_greeting_passengers_at_gate: crewGreetingGate,
            passenger_reaction_to_planes_movement: passengerReactionPlanesMovement,
            play_passenger_reaction_during_landing: passengerReactionLanding,
            play_boarding_music: playBoardingMusic,
            song_boarding_music: songBoardingMusic,
            speed_kph: speedKph,
            gate_agent_voice_id: gateAgentVoiceId || null,
            language_id: selectedLanguageId || null,
            captain_voice_id: selectedCaptainVoiceId || null,
            crew_voice_id: selectedCrewVoiceId || null,
          };

          const [genResult, annResult] = await Promise.all([
            supabase.from("setting_general").upsert(upsertPayload, { onConflict: "user_id" }),
            UserEventDefaultsService.saveForUser(userId, eventConfig, {
              scenarioKey: selectedScenarioKey,
              flavor: announcementFlavor,
            }),
          ]);

          if (genResult.error) throw genResult.error;
          if (!annResult.success) throw new Error(annResult.error ?? "Error al guardar la configuración de eventos");

          // Ritmo de embarque + distorsión: columnas nuevas (migraciones
          // 20261007). Best-effort separado para no romper el guardado si las
          // migraciones aún no se aplicaron (localStorage ya los tiene).
          for (const [column, value] of [
            ["boarding_pax_per_minute", boardingPaxPerMinute],
            ["boarding_music_distortion", boardingMusicDistortion],
            ["boarding_music_source", boardingAudioSource],
          ] as const) {
            try {
              const { error: colErr } = await supabase
                .from("setting_general")
                .update({ [column]: value })
                .eq("user_id", userId);
              if (colErr) {
                console.warn(
                  `[ConfigView] ${column} no persistido en la nube (¿migración pendiente?):`,
                  colErr.message
                );
              }
            } catch (colCatch) {
              console.warn(`[ConfigView] ${column} no persistido en la nube:`, colCatch);
            }
          }
        } catch (err) {
          console.error("Supabase save error:", err);
          setToastNotification("⚠️ Error al guardar en la nube. Los cambios locales están seguros.");
          setTimeout(() => setToastNotification(null), 5000);
        }
      })();
    }
  };

  // Helper de sincronización al elegir Presets del Equalizer de Capitán
  const handleCaptainPresetChange = (presetName: string) => {
    setEqCaptainPreset(presetName);
    if (presetName !== "custom" && CAPTAIN_PRESETS[presetName]) {
      setEqCaptainBands([...CAPTAIN_PRESETS[presetName]]);
    }
  };

  const handleCaptainBandChange = (index: number, val: number) => {
    const updated = [...eqCaptainBands];
    updated[index] = val;
    setEqCaptainBands(updated);
    setEqCaptainPreset("custom"); // Se marca como custom al retocar bandas a mano
  };

  // Helper de sincronización al elegir Presets de Tripulación
  const handleCrewPresetChange = (presetName: string) => {
    setEqCrewPreset(presetName);
    if (presetName !== "custom" && CREW_PRESETS[presetName]) {
      setEqCrewBands([...CREW_PRESETS[presetName]]);
    }
  };

  const handleCrewBandChange = (index: number, val: number) => {
    const updated = [...eqCrewBands];
    updated[index] = val;
    setEqCrewBands(updated);
    setEqCrewPreset("custom");
  };

  // ==================== DEFINICIÓN DE EVENTOS (desde el escenario) ====================
  // Inmersión: solo las opciones activas (música de embarque + voz del
  // agente de puerta, esta última como tarjeta separada). El resto eran
  // mockups y se eliminaron de la UI (los estados persisten con defaults).
  const immersionOptions = [
    {
      key: "play_boarding_music",
      briefKey: "config.immersion_music_brief",
      deepKey: "config.immersion_music_deep",
      setter: setPlayBoardingMusic,
      getter: playBoardingMusic
    }
  ];

  // Grupos de la pestaña de eventos: "Fase 0" (inmersión) + fases del escenario.
  // Inmersión cuenta la tarjeta de música + la de voz del agente de puerta.
  const eventGroups: EventGroup[] = [
    { id: "immersion", labelKey: "config.events.groups.immersion", count: immersionOptions.length + 1 },
    ...(scenarioSnapshot?.phases ?? []).map((phase) => ({
      id: phase.key,
      labelKey: phase.name,
      count: phase.events.length,
    })),
  ];

  const getFilteredEvents = (): ScenarioEventConfig[] => {
    if (!scenarioSnapshot) return [];
    const phase = scenarioSnapshot.phases.find((entry) => entry.key === activeGroupTab);
    return phase?.events ?? [];
  };

  const getNarratorLabel = (role: string | null | undefined): string => {
    if (role === "captain") return t("config.events.narrator_captain");
    if (role === "crew") return t("config.events.narrator_crew");
    if (role === "gate") return t("config.events.narrator_gate") || "Agente de Puerta";
    return "—";
  };

  const handleEventConfigChange = (key: string, value: EventSwitchValue) => {
    setEventConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Selección del video de seguridad (modo PACK): persiste el id por defecto
  // y lo deja activo en el servicio para el próximo vuelo.
  const handleSafetyPackageChange = (pkg: PackageRecord | null) => {
    setSafetyPackage(pkg);
    if (pkg) {
      localStorage.setItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY, pkg.id);
      safetyVideoPackService.setActivePackage(pkg);
    } else {
      localStorage.removeItem(SAFETY_VIDEO_PACKAGE_STORAGE_KEY);
    }
  };

  // Fuente de música de embarque por defecto (`ia` = catálogo, `pack` =
  // audio de la comunidad) + package elegido. Igual que el safety video.
  const [boardingAudioSource, setBoardingAudioSource] = useState<BoardingAudioSource>(() => {
    try {
      return toBoardingAudioSource(localStorage.getItem(BOARDING_AUDIO_SOURCE_STORAGE_KEY));
    } catch {
      return "ia";
    }
  });
  const [boardingAudioPackage, setBoardingAudioPackage] = useState<PackageRecord | null>(null);
  const [storedBoardingAudioPackageId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const handleBoardingAudioSourceChange = (source: BoardingAudioSource) => {
    setBoardingAudioSource(source);
    try {
      localStorage.setItem(BOARDING_AUDIO_SOURCE_STORAGE_KEY, source);
    } catch {
      // almacenamiento no disponible: la selección sigue en memoria
    }
  };
  const handleBoardingAudioPackageChange = (pkg: PackageRecord | null) => {
    setBoardingAudioPackage(pkg);
    if (pkg) {
      try {
        localStorage.setItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY, pkg.id);
      } catch {
        // ignorar
      }
      boardingAudioPackService.setActivePackage(pkg);
    } else {
      try {
        localStorage.removeItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY);
      } catch {
        // ignorar
      }
    }
  };

  // Pista de música seleccionada actualmente (para el preview de audio).
  const selectedMusicTrack = musicTracks.find((track) => track.id === songBoardingMusic) ?? null;

  return (
    <div id="config-view-container" className="space-y-6">
      
      {/* View Header */}
      <div id="config-header" className="flex items-center justify-between border-b border-[#3B7EB2]/50 pb-4">
        <div>
          <h1 className="font-display font-black text-3xl tracking-tight text-[#45AFFF] flex items-center gap-2 uppercase">
            <Settings className="w-8 h-8 text-[#43E600] animate-pulse" /> {t("config.title")}
          </h1>
          <p className="text-xs font-mono text-white/70">
            {t("config.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {showSaveAlert && (
            <span className="bg-[#43E600] text-black text-[10px] font-mono font-black px-3 py-2 rounded-[5px] flex items-center gap-1.5 shadow-[0_0_15px_rgba(67,230,0,0.3)] animate-fadeIn">
              <Check className="w-3.5 h-3.5" /> {t("config.saved")}
            </span>
          )}
          <button
            onClick={handleSaveAll}
            className="bg-[#43E600] text-black font-mono font-black hover:bg-[#3bcc00] px-4 py-2 rounded-[5px] text-xs transition-all shadow-[0_0_12px_rgba(67,230,0,0.25)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer inline-flex items-center gap-1.5 h-9"
          >
            {t("config.save")}
          </button>
        </div>
      </div>

      {/* Tab navigation styled like a flight checklist menu */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-[#3B7EB2]/30 bg-black/10 p-1 rounded-[6px] gap-1">
        <button
          onClick={() => setActiveTab("generales")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "generales"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          🎛️ {t("config.tab_generales")}
        </button>
        <button
          onClick={() => setActiveTab("eventos")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "eventos"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          📢 {t("config.tab_eventos")}
        </button>
        <button
          onClick={() => setActiveTab("packages")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "packages"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          📦 {t("config.tab_packages")}
        </button>
        <button
          onClick={() => setActiveTab("voces")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "voces"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          🗣️ {t("config.tab_voces")}
        </button>
      </div>

      {/* TABS CONTAINER */}
      <div className="tab-contents">
        
        {/* ==================== TAB 1: GENERALES ==================== */}
        {activeTab === "generales" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 animate-fadeIn">
            
            {/* COLUMN LEFT: Preference Blocks */}
            <div className="space-y-6">
              
              {/* IDIOMA Y PERSONAL DE VUELO */}
              <div id="cfg-bloque-staff" className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md flex flex-col gap-3">
                <div className="border-b border-white/10 pb-2">
                  <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
                    <Globe className="w-4.5 h-4.5 text-[#43E600]" /> {t("config.staff_title")}
                  </h3>
                  <p className="text-[10px] text-white/50 font-mono mt-1">{t("config.staff_desc")}</p>
                </div>

                <div className="space-y-4">
                  {/* Idioma */}
                  <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] space-y-2 flex flex-col">
                    <label className="font-mono text-[11px] font-bold text-white uppercase tracking-wider block">
                      {t("current_flight.not_started.crew.language")}
                    </label>
                    <select
                      value={selectedLanguageId}
                      onChange={(e) => {
                        setSelectedLanguageId(e.target.value);
                        setSelectedCaptainVoiceId("");
                        setSelectedCrewVoiceId("");
                        setGateAgentVoiceId("");
                      }}
                      className="w-full bg-[#00345C]/75 border border-[#3B7EB2]/60 rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-[#45AFFF]"
                    >
                      {staffLanguagesLoading ? (
                        <option value="" disabled>{t("config.loading")}</option>
                      ) : staffLanguageList.length === 0 ? (
                        <option value="" disabled>{staffLanguagesError || "Sin idiomas disponibles"}</option>
                      ) : (
                        staffLanguageList.map((lang) => (
                          <option key={lang.id} value={lang.id}>{lang.name}</option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Voz del Agente de Puerta */}
                  <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] space-y-2 flex flex-col">
                    <label className="font-mono text-[11px] font-bold text-white uppercase tracking-wider block">
                      {t("current_flight.not_started.crew.gate_voice")}
                    </label>
                    <div className="flex items-center gap-3">
                      <StaffVoiceAvatar
                        url={staffSelectedAvatar(staffGateVoiceOptions, gateAgentVoiceId)?.avatarUrl ?? null}
                        name={staffSelectedAvatar(staffGateVoiceOptions, gateAgentVoiceId)?.name ?? ""}
                      />
                      <select
                        value={gateAgentVoiceId}
                        onChange={(e) => setGateAgentVoiceId(e.target.value)}
                        className="flex-1 min-w-0 bg-[#00345C]/75 border border-[#3B7EB2]/60 rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-[#45AFFF]"
                      >
                        {staffVoicesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : staffGateVoiceOptions.length === 0 ? (
                          <option value="" disabled>{staffVoicesError || "Sin voces de agente de puerta para este idioma"}</option>
                        ) : (
                          <>
                            <option value="" disabled>{t("current_flight.not_started.crew.select_voice")}</option>
                            {staffGateVoiceOptions.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Voz del Capitán */}
                  <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] space-y-2 flex flex-col">
                    <label className="font-mono text-[11px] font-bold text-white uppercase tracking-wider block">
                      {t("current_flight.not_started.crew.captain_voice")}
                    </label>
                    <div className="flex items-center gap-3">
                      <StaffVoiceAvatar
                        url={staffSelectedAvatar(staffCaptainVoiceOptions, selectedCaptainVoiceId)?.avatarUrl ?? null}
                        name={staffSelectedAvatar(staffCaptainVoiceOptions, selectedCaptainVoiceId)?.name ?? ""}
                      />
                      <select
                        value={selectedCaptainVoiceId}
                        onChange={(e) => setSelectedCaptainVoiceId(e.target.value)}
                        className="flex-1 min-w-0 bg-[#00345C]/75 border border-[#3B7EB2]/60 rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-[#45AFFF]"
                      >
                        {staffVoicesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : staffCaptainVoiceOptions.length === 0 ? (
                          <option value="" disabled>{staffVoicesError || "Sin voces de capitán para este idioma"}</option>
                        ) : (
                          <>
                            <option value="" disabled>{t("current_flight.not_started.crew.select_voice")}</option>
                            {staffCaptainVoiceOptions.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Voz de la Tripulación */}
                  <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] space-y-2 flex flex-col">
                    <label className="font-mono text-[11px] font-bold text-white uppercase tracking-wider block">
                      {t("current_flight.not_started.crew.cabin_voice")}
                    </label>
                    <div className="flex items-center gap-3">
                      <StaffVoiceAvatar
                        url={staffSelectedAvatar(staffCrewVoiceOptions, selectedCrewVoiceId)?.avatarUrl ?? null}
                        name={staffSelectedAvatar(staffCrewVoiceOptions, selectedCrewVoiceId)?.name ?? ""}
                      />
                      <select
                        value={selectedCrewVoiceId}
                        onChange={(e) => setSelectedCrewVoiceId(e.target.value)}
                        className="flex-1 min-w-0 bg-[#00345C]/75 border border-[#3B7EB2]/60 rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-[#45AFFF]"
                      >
                        {staffVoicesLoading ? (
                          <option value="" disabled>{t("config.loading")}</option>
                        ) : staffCrewVoiceOptions.length === 0 ? (
                          <option value="" disabled>{staffVoicesError || "Sin voces de tripulación para este idioma"}</option>
                        ) : (
                          <>
                            <option value="" disabled>{t("current_flight.not_started.crew.select_voice")}</option>
                            {staffCrewVoiceOptions.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Hint */}
                  <div className="bg-[#45AFFF]/5 border border-[#45AFFF]/30 rounded-[5px] p-3 text-[10px] font-sans text-white/70 leading-relaxed">
                    <Info className="w-3.5 h-3.5 inline mr-1 text-[#45AFFF]" />
                    {t("current_flight.not_started.crew.voices_hint")}
                  </div>
                </div>
              </div>

            </div>

            {/* COLUMN RIGHT: Preferencias del Sistema (solo opciones activas) */}
            <div className="space-y-6">
              {/* PREFERENCIAS DEL SISTEMA */}
              <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md flex flex-col gap-4">
                <div className="border-b border-white/10 pb-2.5">
                  <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
                    <SlidersHorizontal className="w-4.5 h-4.5 text-[#43E600]" /> {t("config.system_preferences")}
                  </h3>
                  <p className="text-[10px] text-white/50 font-mono mt-1">{t("config.system_preferences_desc")}</p>
                </div>

                <div className="flex flex-col gap-4">
                  {/* 1. Ritmo de embarque (pax/min) — default global del piloto */}
                  <div className="bg-black/35 p-3.5 rounded border border-white/5 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider">
                        {t("config.boarding_pace")}
                      </span>
                      <span className="font-mono text-xs text-[#43E600] font-bold shrink-0">
                        {t("config.boarding_pace_value", { count: boardingPaxPerMinute })}
                      </span>
                    </div>
                    <span className="text-[9px] text-white/45 block">{t("config.boarding_pace_helper")}</span>
                    <input
                      type="range"
                      min={BOARDING_PACE_MIN_PPM}
                      max={BOARDING_PACE_MAX_PPM}
                      step="5"
                      className="w-full accent-[#45AFFF] h-1 cursor-pointer"
                      value={boardingPaxPerMinute}
                      onChange={(e) => setBoardingPaxPerMinute(clampBoardingPace(Number(e.target.value)))}
                      aria-label={t("config.boarding_pace")}
                    />
                  </div>

                  {/* 2. Efecto de distorsión en música de embarque */}
                  <div className="bg-black/35 p-3.5 rounded border border-white/5 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="pr-1 min-w-0">
                        <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">
                          {t("config.music_distortion_label")}
                        </span>
                        <span className="text-[9px] text-white/45 block mt-0.5">
                          {t("config.music_distortion_helper")}
                        </span>
                      </div>
                      <div className="flex bg-black/60 border border-white/15 rounded-[4px] p-0.5 shrink-0 h-fit w-[120px] justify-between font-mono">
                        <button
                          type="button"
                          onClick={() => setBoardingMusicDistortion(true)}
                          className={`px-3 py-1 rounded-[3px] text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${
                            boardingMusicDistortion
                              ? "bg-[#43E600]/20 text-[#43E600] border-[#43E600]/30 font-extrabold shadow-sm"
                              : "text-white/30 border-transparent hover:text-white/60"
                          }`}
                        >
                          {t("config.events.yes")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setBoardingMusicDistortion(false)}
                          className={`px-3 py-1 rounded-[3px] text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${
                            !boardingMusicDistortion
                              ? "bg-red-500/20 text-red-300 border-red-500/35 font-extrabold shadow-sm"
                              : "text-white/30 border-transparent hover:text-white/60"
                          }`}
                        >
                          {t("config.events.no")}
                        </button>
                      </div>
                    </div>
                    <MusicDistortionPreview tracks={musicTracks} />
                  </div>
                </div>
              </div>
              
            </div>

          </div>
        )}

        {/* ==================== TAB 2: CONFIGURAR EVENTOS ==================== */}
        {activeTab === "eventos" && (
          <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-5 shadow-lg space-y-4 w-full animate-fadeIn">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-[#45AFFF] animate-pulse" />
                <h3 className="font-display font-bold text-base text-[#45AFFF] uppercase tracking-wider font-black">
                  {t("config.eventos_title")}
                </h3>
              </div>
            </div>

            <p className="text-xs text-white/80 font-mono leading-relaxed">
              {t("config.eventos_desc")}
            </p>

            {/* Scenario selector: la config de eventos está vinculada a un escenario */}
            <div className="flex flex-wrap items-center gap-3 bg-black/30 border border-white/10 rounded-[5px] px-3 py-2">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#45AFFF]" />
                <label className="text-[9px] font-mono font-bold text-white/55 uppercase tracking-wider whitespace-nowrap">
                  {t("config.scenario_label")}
                </label>
              </div>
              <select
                value={selectedScenarioKey}
                onChange={(e) => setSelectedScenarioKey(e.target.value)}
                className="bg-black/55 border border-[#3B7EB2]/45 text-xs text-white font-mono font-bold rounded-[3px] px-2 py-1 focus:outline-none cursor-pointer hover:border-[#45AFFF] transition-colors"
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
                  {t("config.scenario_loading")}
                </span>
              )}
            </div>

            {/* Event Category Tabs matching flight screen */}
            <div className="flex flex-wrap gap-1 bg-black/35 p-1 rounded-[5px] border border-white/5 w-full">
              {eventGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroupTab(group.id)}
                  className={`px-2.5 py-1.5 text-[10px] font-mono font-bold rounded-[3px] transition-all flex-1 text-center cursor-pointer ${
                    activeGroupTab === group.id
                      ? "bg-[#45AFFF] text-[#00172e] shadow-sm font-black"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {t(group.labelKey)} ({group.count})
                </button>
              ))}
            </div>

            {/* Grid display for category options */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[460px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
              
              {/* IMMERSION SPECIAL GROUP */}
              {activeGroupTab === "immersion" ? (
                <>
                {immersionOptions.map((item) => {
                  return (
                    <div 
                      key={item.key} 
                      className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col transition-all gap-4"
                    >
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div className="space-y-1.5 flex-1 min-w-0 pr-1 font-mono">
                          <div className="flex items-center gap-2">
                            <span className="text-[12.5px] font-sans font-bold text-white leading-normal tracking-wide">
                              {t(item.briefKey)}
                            </span>
                          </div>
                          <span className="text-[10px] text-white/45 block max-w-sm leading-relaxed">
                            {t(item.deepKey)}
                          </span>
                        </div>

                        {/* Pill switch YES/NO */}
                        <div className="flex bg-black/60 border border-white/15 rounded-[4px] p-0.5 shrink-0 h-fit w-[120px] justify-between font-mono">
                          <button
                            type="button"
                            onClick={() => item.setter(true)}
                            className={`px-3 py-1 rounded-[3px] text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${
                              item.getter 
                                ? "bg-[#43E600]/20 text-[#43E600] border-[#43E600]/30 font-extrabold shadow-sm" 
                                : "text-white/30 border-transparent hover:text-white/60"
                            }`}
                          >
                            {t("config.events.yes")}
                          </button>
                          <button
                            type="button"
                            onClick={() => item.setter(false)}
                            className={`px-3 py-1 rounded-[3px] text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${
                              !item.getter 
                                ? "bg-red-500/20 text-red-300 border-red-500/35 font-extrabold shadow-sm" 
                                : "text-white/30 border-transparent hover:text-white/60"
                            }`}
                          >
                            {t("config.events.no")}
                          </button>
                        </div>
                      </div>

                      {/* Display boarding music dropdown selector if play_boarding_music is Yes */}
                      {item.key === "play_boarding_music" && item.getter && (
                        <div className="border-t border-white/5 pt-3 mt-1 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                          <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">
                            {t("config.immersion_music_label")}
                          </span>
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                            <select
                              className="bg-[#00172e] border border-[#3B7EB2]/50 text-white rounded-[4px] px-2.5 py-1 text-xs font-mono focus:outline-none w-full sm:w-auto min-w-[220px]"
                              value={songBoardingMusic}
                              onChange={(e) => setSongBoardingMusic(e.target.value)}
                              disabled={musicTracksLoading}
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
                      {item.key === "play_boarding_music" && item.getter && (
                        <div className="border-t border-white/5 pt-3 mt-1 flex flex-col gap-2">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                            <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">
                              {t("config.boarding_source_label")}
                            </span>
                            <div className="flex bg-black/60 border border-white/15 rounded-[4px] overflow-hidden shrink-0 h-fit w-[165px]">
                              {(["ia", "pack"] as const).map((mode) => {
                                const isSelected = boardingAudioSource === mode;
                                let activeStyle = "text-white/30 border-transparent hover:text-white/60 text-[9px] font-semibold";
                                if (isSelected) {
                                  if (mode === "pack") activeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40 font-black shadow-sm text-[9px]";
                                  else activeStyle = "bg-sky-500/20 text-sky-400 border-[#45AFFF]/35 font-black shadow-sm text-[9px]";
                                }
                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => handleBoardingAudioSourceChange(mode)}
                                    className={`px-1.5 py-1 rounded-[3px] font-mono uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${activeStyle}`}
                                  >
                                    {mode === "pack" ? t("config.events.mode_pack_label") : t("config.events.mode_ia_label")}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {boardingAudioSource === "pack" && (
                            <BoardingAudioPackSelector
                              airlineIcao={null}
                              value={boardingAudioPackage?.id ?? storedBoardingAudioPackageId}
                              onChange={handleBoardingAudioPackageChange}
                              idPrefix="cfg-boarding-pack"
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
                  );
                })}

                {/* Gate Agent Voice selection */}
                <div className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col transition-all gap-4">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0 pr-1 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-sans font-bold text-white leading-normal tracking-wide">
                          {t("config.immersion_gate_agent_brief")}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/45 block max-w-sm leading-relaxed">
                        {t("config.immersion_gate_agent_deep")}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-white/5 pt-3 mt-1 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">
                      {t("config.immersion_gate_agent_label")}
                    </span>
                    <select
                      className="bg-[#00172e] border border-[#3B7EB2]/50 text-white rounded-[4px] px-2.5 py-1 text-xs font-mono focus:outline-none w-full sm:w-auto min-w-[200px]"
                      value={gateAgentVoiceId}
                      onChange={(e) => setGateAgentVoiceId(e.target.value)}
                    >
                      {gateAgentVoices.length === 0 && (
                        <option value="">{t("config.immersion_gate_agent_loading")}</option>
                      )}
                      {gateAgentVoices.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                </>
              ) : getFilteredEvents().length === 0 ? (
                <div className="col-span-full bg-black/25 border border-white/10 rounded-[5px] p-6 text-center">
                  <p className="text-xs font-mono text-white/50">{t("config.scenario_no_events")}</p>
                </div>
              ) : (
                /* EVENTOS DEL ESCENARIO (desde el snapshot publicado) */
                getFilteredEvents().map((item) => {
                  const currentValue = eventConfig[item.eventKey] || "IA";
                  const isCaptain = item.speakerRole === "captain";

                  return (
                    <div 
                      key={item.eventKey} 
                      className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all font-mono"
                    >
                      <div className="space-y-1 my-1 flex-1 min-w-0 pr-1">
                          <span className="text-[12.5px] font-sans font-medium text-white/95 leading-normal block">
                            {item.displayName || item.eventKey}
                          </span>
                          {item.description && (
                            <span className="text-[10px] text-white/55 leading-relaxed block mt-1">
                              {item.description}
                            </span>
                          )}
                          {/* Narrator Display below description */}
                          <div className="flex items-center gap-1.5 text-[9px] uppercase font-mono tracking-wider text-white/50 mt-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isCaptain ? "bg-[#e68b00]" : "bg-[#45AFFF]"}`}></span>
                            <span>{t("config.events.narrator_label")} <strong className={isCaptain ? "text-[#ffb340]" : "text-[#45AFFF]"}>{getNarratorLabel(item.speakerRole)}</strong></span>
                          </div>
                          {/* Selector del video de seguridad (modo PACK):
                              catálogo de la comunidad; sin vuelo asociado
                              muestra todas las aerolíneas. */}
                          {item.eventKey === SAFETY_VIDEO_EVENT_KEY && currentValue === "PACK" && (
                            <SafetyVideoPackSelector
                              airlineIcao={null}
                              value={safetyPackage?.id ?? storedSafetyPackageId}
                              onChange={handleSafetyPackageChange}
                              idPrefix="cfg-safety-pack"
                            />
                          )}
                      </div>

                      {/* Selector Mode Pill */}
                      <div className="flex bg-black/60 border border-white/15 rounded-[4px] overflow-hidden shrink-0 h-fit w-[165px]">
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
                          let activeStyle = "text-white/30 border-transparent hover:text-white/60 text-[9px] font-semibold";
                          if (isSelected) {
                            if (mode === "OFF") activeStyle = "bg-red-500/20 text-red-300 border-red-500/35 font-black shadow-sm text-[9px]";
                            if (mode === "PACK") activeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40 font-black shadow-sm text-[9px]";
                            if (mode === "IA") activeStyle = "bg-sky-500/20 text-sky-400 border-[#45AFFF]/35 font-black shadow-sm text-[9px]";
                          }
                          return (
                            <button
                              key={mode}
                              type="button"
                              disabled={isPackModeDisabled}
                              onClick={() => handleEventConfigChange(item.eventKey, mode)}
                              title={isPackModeDisabled ? t("config.events.tooltip_no_package") : ""}
                              className={`px-1.5 py-1 rounded-[3px] font-mono uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${activeStyle} ${
                                isPackModeDisabled ? "opacity-25 cursor-not-allowed hover:text-white/20" : ""
                              }`}
                            >
                              {mode === "OFF" ? t("config.events.mode_off_label") : mode === "PACK" ? t("config.events.mode_pack_label") : t("config.events.mode_ia_label")}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

          </div>
        )}

        {/* ==================== TAB 3: PACKAGES ==================== */}
        {activeTab === "packages" && <PackagesTab />}

        {/* ==================== TAB 4: VOCES ==================== */}
        {activeTab === "voces" && <VoicesPage />}

       </div>

      {/* ==================== POPUP MODAL: CONFIGURAR NUEVA VOZ ==================== */}
      {showNewVoiceModal && (
        <div id="new-voice-modal-overlay" className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div id="new-voice-modal-box" className="bg-[#0b2844] border-2 border-[#3b7eb2]/50 rounded-xl max-w-md w-full shadow-[0_0_40px_rgba(0,0,0,0.85)] p-6 space-y-4 animate-fadeIn">
            <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
              <h3 className="font-display font-black text-sm text-[#45AFFF] uppercase tracking-wider flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-[#43E600]" />
                {editingVoiceId ? "EDITAR PERFIL DE VOZ" : "CONFIGURAR NUEVA VOZ"}
              </h3>
              <button
                type="button"
                className="text-white/40 hover:text-white font-mono text-xs cursor-pointer p-1"
                onClick={() => setShowNewVoiceModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              {/* Campo Nombre de la voz */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="voice-name-input" className="text-white/80 font-bold uppercase text-[10.5px]">
                  Nombre de la voz:
                </label>
                <input
                  id="voice-name-input"
                  type="text"
                  required
                  placeholder="Ej: Voz de Tripulante AR"
                  value={newVoiceName}
                  onChange={(e) => setNewVoiceName(e.target.value)}
                  className="bg-[#00172e] border border-[#3B7EB2]/50 rounded-[4px] px-3 py-2 text-white font-mono focus:outline-none focus:border-[#43E600]"
                />
              </div>

              {/* Campo Descripción */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="voice-desc-input" className="text-white/80 font-bold uppercase text-[10.5px]">
                  Descripción:
                </label>
                <textarea
                  id="voice-desc-input"
                  placeholder="Ej: Locución nativa de España de timbre medio."
                  value={newVoiceDescription}
                  onChange={(e) => setNewVoiceDescription(e.target.value)}
                  rows={2}
                  className="bg-[#00172e] border border-[#3B7EB2]/50 rounded-[4px] px-3 py-2 text-white font-mono focus:outline-none focus:border-[#43E600] resize-none"
                />
              </div>

              {/* Selector de Género */}
              <div className="flex flex-col gap-1.5">
                <span className="text-white/80 font-bold uppercase text-[10.5px]">Selector de género:</span>
                <div className="grid grid-cols-2 gap-2 bg-[#00172e] p-1 border border-[#3B7EB2]/40 rounded-[4px]">
                  <button
                    type="button"
                    onClick={() => setNewVoiceGender("masculino")}
                    className={`py-1.5 rounded text-[10px] uppercase font-black tracking-wide border cursor-pointer transition-all ${
                      newVoiceGender === "masculino"
                        ? "bg-[#45AFFF]/20 text-[#45AFFF] border-[#45AFFF]/40 font-black shadow-sm"
                        : "text-white/40 border-transparent hover:text-white/70"
                    }`}
                  >
                    masculino
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewVoiceGender("femenino")}
                    className={`py-1.5 rounded text-[10px] uppercase font-black tracking-wide border cursor-pointer transition-all ${
                      newVoiceGender === "femenino"
                        ? "bg-[#45AFFF]/20 text-[#45AFFF] border-[#45AFFF]/40 font-black shadow-sm"
                        : "text-white/40 border-transparent hover:text-white/70"
                    }`}
                  >
                    femenino
                  </button>
                </div>
              </div>

              {/* Bloque explicativo de voz de usuario (exact text requirement) */}
              <div className="bg-[#1a3852]/60 border border-white/10 p-3.5 rounded-[5px] space-y-3">
                <p className="text-[11px] text-white/95 leading-relaxed font-sans">
                  <strong>Voz.</strong> Grabe su voz durante al menos diez segundos o mas. Asegurese de estar en un ambiente tranquilo y sin ruidos. Puede leer un articulo periodístico o un libro. Lea en forma pausada y clara.
                </p>

                {/* Simulated recording visual waves */}
                {isRecording && (
                  <div className="space-y-1 bg-black/40 p-2 border border-red-500/30 rounded">
                    <div className="flex justify-between items-center text-[9px] text-red-400 font-bold">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
                        GRABANDO MICRÓFONO...
                      </span>
                      <span>00:{recordTimer < 10 ? "0" + recordTimer : recordTimer} / 00:10</span>
                    </div>
                    {/* Visual waveform simulation */}
                    <div className="h-4 flex items-center justify-between gap-[2px] overflow-hidden">
                      {Array.from({ length: 24 }).map((_, i) => {
                        const h = Math.floor(Math.sin((i + recordTimer) * 0.9) * 11) + 13;
                        return (
                          <div
                            key={i}
                            className="bg-red-500 flex-1 rounded-[1px] transition-all duration-300"
                            style={{ height: `${isRecording ? h : 3}px` }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Botón Comenzar Grabación */}
                <button
                  type="button"
                  onClick={() => {
                    setIsRecording(true);
                    setRecordTimer(0);
                  }}
                  disabled={isRecording}
                  className="w-full bg-[#ff2020] hover:bg-red-650 disabled:bg-[#1a3a54] disabled:text-white/40 text-white font-mono font-bold py-2 rounded-[4px] tracking-wide transition-all uppercase flex items-center justify-center gap-1.5 cursor-pointer text-xs"
                >
                  <Mic className="w-4 h-4" />
                  {isRecording ? `Grabando: 00:${recordTimer < 10 ? "0" + recordTimer : recordTimer}` : "Comenzar Grabación"}
                </button>
              </div>

              {/* switch Voz Pública */}
              <label className="flex items-center justify-between bg-black/25 hover:bg-black/45 p-3 rounded border border-white/5 cursor-pointer transition-colors select-none">
                <div className="pr-2 space-y-0.5">
                  <span className="text-[10.5px] font-bold text-white uppercase tracking-wide block">Voz pública</span>
                  <p className="text-[9.5px] text-white/50 block">Si habilita esta opción, la voz creada estará disponible para otros usuarios.</p>
                </div>
                <input
                  type="checkbox"
                  checked={newVoiceIsPublic}
                  onChange={(e) => setNewVoiceIsPublic(e.target.checked)}
                  className="accent-[#43E600] h-4 w-4 shrink-0 cursor-pointer"
                />
              </label>
            </div>

            {/* Cancelar y Crear Buttons (of course, we match the requirement: Cancelar and Crear) */}
            <div className="flex gap-2.5 pt-2 border-t border-white/10 shrink-0 font-mono">
              <button
                type="button"
                onClick={() => setShowNewVoiceModal(false)}
                className="flex-1 bg-black/40 hover:bg-black/60 border border-white/15 text-white font-bold py-2 rounded-[5px] text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newVoiceName.trim()) {
                    setToastNotification("⚠️ Ingrese un nombre de voz válido.");
                    setTimeout(() => setToastNotification(null), 3000);
                    return;
                  }

                  if (editingVoiceId) {
                    const updated = voicesList.map((v: any) =>
                      v.id === editingVoiceId
                        ? {
                            ...v,
                            name: newVoiceName,
                            description: newVoiceDescription,
                            gender: newVoiceGender,
                            isPublic: newVoiceIsPublic
                          }
                        : v
                    );
                    setVoicesList(updated);
                    setToastNotification("¡Voz de usuario guardada con éxito!");
                  } else {
                    const newVoiceObj = {
                      id: "v" + Date.now(),
                      name: newVoiceName,
                      type: "Usuario" as const,
                      enabled: true,
                      gender: newVoiceGender,
                      description: newVoiceDescription,
                      isPublic: newVoiceIsPublic
                    };
                    const updated = [...voicesList, newVoiceObj];
                    setVoicesList(updated);
                    setToastNotification("¡La nueva voz ha sido creada y encolada con éxito!");
                  }

                  setShowNewVoiceModal(false);
                  setTimeout(() => setToastNotification(null), 3500);
                }}
                className="flex-1 bg-[#43E600] hover:bg-[#3bcc00] text-[#00172e] font-black py-2 rounded-[5px] text-xs transition-colors cursor-pointer"
              >
                {editingVoiceId ? "Crear" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating System-Wide Alerts Feedback */}
      {toastNotification && (
        <div id="toast-v2-holder" className="fixed bottom-5 right-5 z-[60] animate-fadeIn text-[11px] font-mono font-black bg-[#43E600] text-[#00172e] px-4 py-3 rounded-[5px] flex items-center gap-2 shadow-[0_4px_30px_rgba(0,0,0,0.6)]">
          <Info className="w-4.5 h-4.5 shrink-0" />
          <span>{toastNotification}</span>
        </div>
      )}

    </div>
  );
}
