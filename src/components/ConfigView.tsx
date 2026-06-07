/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  User, 
  Radio, 
  Volume2, 
  Music, 
  Globe, 
  Mic, 
  SlidersHorizontal,
  FolderSync,
  VolumeX,
  Sparkles,
  Headphones,
  Check,
  Info,
  ChevronDown,
  ChevronUp,
  Users,
  Compass,
  Gauge,
  Activity,
  Heart,
  Settings,
  ShieldAlert,
  Play,
  Plus,
  FolderOpen,
  Search
} from "lucide-react";
import { SimBriefData, ConfigVoces, ConfigAudio } from "../types";

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
  vhf_radio: [0, 2, 4, 3, 0, -1, -3, -4, 0, 0],
  intercom_muffled: [5, 6, 4, 2, -1, -3, -5, -6, -10, -12]
};

const CREW_PRESETS: Record<string, number[]> = {
  estandar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  cabin_pa: [0, 0, 1, 2, 2, 0, -1, -1, 0, 0]
};

const FREQUENCIES = ["31Hz", "62Hz", "125Hz", "250Hz", "500Hz", "1kHz", "2kHz", "4kHz", "8kHz", "16kHz"];

interface EventGroup {
  id: string;
  label: string;
}

interface EventDefinition {
  key: string;
  narrator: "Capitán" | "Tripulación";
  desc: string;
  phaseId: string;
}

export default function ConfigView({
  simBriefData,
  voicesConfig,
  audioConfig,
  onSimBriefUpdate,
  onVoicesUpdate,
  onAudioUpdate
}: ConfigViewProps) {
  // Top level tabs
  const [activeTab, setActiveTab] = useState<"generales" | "eventos" | "packages" | "voces">("generales");
  const [showSaveAlert, setShowSaveAlert] = useState(false);

  // NEW PACKAGES TAB STATES
  const [packagesDir, setPackagesDir] = useState<string>(() => {
    return localStorage.getItem("cfg_packages_directory") || "C:\\Users\\User\\AppData\\Roaming\\Microsoft Flight Simulator\\Packages\\Community";
  });
  
  const [packagesList, setPackagesList] = useState(() => {
    const raw = localStorage.getItem("cfg_packages_list");
    if (raw) return JSON.parse(raw);
    return [
      { id: "p1", name: "Aerolíneas Argentinas AR Pack", description: "Locuciones nativas con acento rioplatense y música de embarque clásica de la compañía.", enabled: true, author: "FSEspañol Team", version: "2.4.1", lang1: "Español (AR)", lang2: "Inglés (US)" },
      { id: "p2", name: "LATAM Real Voice Pack v2", description: "Set completo de tripulación de cabina y comandante para rutas regionales de Sudamérica.", enabled: false, author: "SimAudio Labs", version: "1.0.8", lang1: "Español (ES)", lang2: "Portugués (BR)" },
      { id: "p3", name: "Iberia Premium Audio", description: "Mensajes realistas de cabina grabados en alta definición con acento de España y avisos ATC transatlánticos.", enabled: false, author: "IberiaVirtual group", version: "3.1.0", lang1: "Español (ES)", lang2: "Inglés (UK)" },
      { id: "p4", name: "Flybondi Low-Cost set", description: "Voces desenfadas, anuncios cómicos para vuelos turísticos de cabotaje.", enabled: false, author: "FlySim Devs", version: "1.1.2", lang1: "Español (AR)", lang2: "Ninguno" },
      { id: "p5", name: "Default FS Soundset", description: "Biblioteca genérica del simulador de vuelo con avisos automáticos y chimes integrados.", enabled: true, author: "Asobo Studio", version: "1.0.0", lang1: "Español (ES)", lang2: "Inglés (US)" }
    ];
  });

  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
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

  const handleScanDirectory = () => {
    setIsScanning(true);
    setScanMessage("Escaneando ubicación: " + packagesDir);
    setTimeout(() => {
      setScanMessage("Analizando paquetes de voz e inmersión...");
      setTimeout(() => {
        setIsScanning(false);
        setScanMessage("");
        setToastNotification("¡Escaneo completado con éxito! Se sincronizaron 5 paquetes de audio.");
        setTimeout(() => setToastNotification(null), 4000);
      }, 1200);
    }, 1000);
  };

  const handleOpenDirectory = () => {
    setToastNotification(`📁 Abriendo explorador en: "${packagesDir}"`);
    setTimeout(() => setToastNotification(null), 3500);
  };

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
  const [passengerBoardingTimeSeconds, setPassengerBoardingTimeSeconds] = useState<number>(() => {
    return Number(localStorage.getItem("cfg_Passenger_Boarding_Time_Seconds") || "30");
  });
  const [muteAnnWhenNotInCabin, setMuteAnnWhenNotInCabin] = useState<boolean>(() => {
    return localStorage.getItem("cfg_Mute_Ann_When_User_Not_In_Cabin") !== "false"; // default is true / false based on user preference
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
    return localStorage.getItem("cfg_song_boarding_music") || "Vivaldi Concert VIII";
  });
  const [speedKph, setSpeedKph] = useState<boolean>(() => {
    return localStorage.getItem("cfg_speed_kph") !== "false"; // default true
  });

  // Bloque 2: Audio Config
  const [audio3dEnabled, setAudio3dEnabled] = useState<boolean>(() => {
    return localStorage.getItem("cfg_audio_3d_enabled") === "true"; // default false
  });
  const [eqCaptainPreset, setEqCaptainPreset] = useState<string>(() => {
    return localStorage.getItem("cfg_eq_captain_preset") || "vhf_radio";
  });
  const [eqCaptainBands, setEqCaptainBands] = useState<number[]>(() => {
    const raw = localStorage.getItem("cfg_eq_captain_bands");
    return raw ? JSON.parse(raw) : [0, 2, 4, 3, 0, -1, -3, -4, 0, 0];
  });
  const [eqCrewPreset, setEqCrewPreset] = useState<string>(() => {
    return localStorage.getItem("cfg_eq_crew_preset") || "cabin_pa";
  });
  const [eqCrewBands, setEqCrewBands] = useState<number[]>(() => {
    const raw = localStorage.getItem("cfg_eq_crew_bands");
    return raw ? JSON.parse(raw) : [0, 0, 1, 2, 2, 0, -1, -1, 0, 0];
  });

  // Bloque 3: Staff Config
  const [customPilotNameSet, setCustomPilotNameSet] = useState<boolean>(() => {
    return localStorage.getItem("cfg_custom_pilot_name_set") === "true";
  });
  const [customPilotName, setCustomPilotName] = useState<string>(() => {
    return localStorage.getItem("cfg_custom_pilot_name") || "Capitán Carlos";
  });
  const [customCrewNameSet, setCustomCrewNameSet] = useState<boolean>(() => {
    return localStorage.getItem("cfg_custom_crew_name_set") === "true";
  });
  const [customCrewName, setCustomCrewName] = useState<string>(() => {
    return localStorage.getItem("cfg_custom_crew_name") || "Sofía (Sobrecargo)";
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
    return localStorage.getItem("cfg_selected_package") || "aerolineas";
  });
  const [activeGroupTab, setActiveGroupTab] = useState<string>("immersion");
  const [eventConfig, setEventConfig] = useState<Record<string, "off" | "pack" | "IA">>(() => {
    const raw = localStorage.getItem("cfg_event_config");
    if (raw) return JSON.parse(raw);
    return {
      gate_crew_start_soon: "off",
      gate_crew_started: "IA",
      common_crew_boarding: "IA",
      preflight_crew_welcome: "IA",
      preflight_capt_welcome: "IA",
      preflight_capt_delay: "IA",
      preflight_capt_basic_info: "IA",
      preflight_crew_basic_info: "off",
      taxi_capt_armdoors: "IA",
      taxi_crew_safety_brief: "IA",
      taxi_capt_dimlights: "off",
      taxi_crew_dimlights: "off",
      takeoff_capt_prepare: "IA",
      climb_crew_upcoming_service: "IA",
      cruise_capt_general_info: "IA",
      cruise_crew_service_info1: "IA",
      cruise_crew_service_info2: "off",
      cruise_crew_shopping_info: "off",
      cruise_crew_customs_forms: "off",
      cruise_crew_service_info3: "off",
      descent_capt_close_desc: "IA",
      descent_capt_upcoming_actions: "IA",
      descent_crew_upcoming_actions: "IA",
      descent_capt_10kfeet: "off",
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

  // Guardar todas las configuraciones
  const handleSaveAll = () => {
    // Bloque 1
    localStorage.setItem("cfg_Passenger_Boarding_Time_Seconds", String(passengerBoardingTimeSeconds));
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

    // Bloque 2
    localStorage.setItem("cfg_audio_3d_enabled", String(audio3dEnabled));
    localStorage.setItem("cfg_eq_captain_preset", eqCaptainPreset);
    localStorage.setItem("cfg_eq_captain_bands", JSON.stringify(eqCaptainBands));
    localStorage.setItem("cfg_eq_crew_preset", eqCrewPreset);
    localStorage.setItem("cfg_eq_crew_bands", JSON.stringify(eqCrewBands));

    // Bloque 3
    localStorage.setItem("cfg_custom_pilot_name_set", String(customPilotNameSet));
    localStorage.setItem("cfg_custom_pilot_name", customPilotName);
    localStorage.setItem("cfg_custom_crew_name_set", String(customCrewNameSet));
    localStorage.setItem("cfg_custom_crew_name", customCrewName);

    // Bloque 4
    localStorage.setItem("cfg_gforce", String(pfGforce));
    localStorage.setItem("cfg_vertical_speed", String(pfVerticalSpeed));
    localStorage.setItem("cfg_landing_force", String(pfLandingForce));
    localStorage.setItem("cfg_irregular_ground_speed", String(pfIrregularGroundSpeed));
    localStorage.setItem("cfg_acceleration_ground_speed", String(pfAccelerationGroundSpeed));
    localStorage.setItem("cfg_delay_feedback", String(pfDelayFeedback));

    // Eventos
    localStorage.setItem("cfg_selected_package", selectedPackage);
    localStorage.setItem("cfg_event_config", JSON.stringify(eventConfig));

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

    // Guardar Packages y Voces adicionales
    localStorage.setItem("cfg_packages_directory", packagesDir);
    localStorage.setItem("cfg_packages_list", JSON.stringify(packagesList));
    localStorage.setItem("cfg_voices_list", JSON.stringify(voicesList));

    setShowSaveAlert(true);
    setTimeout(() => setShowSaveAlert(false), 3000);
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

  // ==================== DEFINICIÓN DE EVENTOS (PREESTABLECIDAS) ====================
  const eventGroups: EventGroup[] = [
    { id: "immersion", label: "Inmersión (8)" },
    { id: "fase1", label: "Embarque (3)" },
    { id: "fase2", label: "Pre-Vuelo (5)" },
    { id: "fase3", label: "Rodaje (5)" },
    { id: "fase4", label: "Crucero (7)" },
    { id: "fase5", label: "Descenso (6)" },
    { id: "fase6", label: "Rodaje a Puerta (3)" },
    { id: "fase7", label: "Plataforma (2)" },
    { id: "transversal", label: "Transversales (2)" }
  ];

  const immersionOptions = [
    {
      key: "play_chime_sound_before_ann",
      brief: "Tono de aviso de cabina",
      deep: "Reproduce el timbre tradicional justo antes de los comunicados de voz.",
      setter: setPlayChimeBeforeAnn,
      getter: playChimeBeforeAnn
    },
    {
      key: "play_ambient_sound_during_flight",
      brief: "Sonido ambiente en vuelo",
      deep: "Activa zumbido de fondo y murmullos continuos en la cabina.",
      setter: setPlayAmbientDuringFlight,
      getter: playAmbientDuringFlight
    },
    {
      key: "crew_greeting_passengers_at_gate",
      brief: "Saludos en puerta por tripulación",
      deep: "Habilita que los asistentes de cabina saluden en la bienvenida física.",
      setter: setCrewGreetingGate,
      getter: crewGreetingGate
    },
    {
      key: "passenger_reaction_to_planes_movement",
      brief: "Reacciones a fuerzas de aceleración",
      deep: "Habilita exclamaciones u jadeos grupales bajo Gs abruptas o frenadas severas.",
      setter: setPassengerReactionPlanesMovement,
      getter: passengerReactionPlanesMovement
    },
    {
      key: "play_passenger_reaction_during_landing",
      brief: "Reacciones audibles al tocar pista / touchdown",
      deep: "Activa aplausos o quejas en el impacto según los pies por minuto en el toque.",
      setter: setPassengerReactionLanding,
      getter: passengerReactionLanding
    },
    {
      key: "play_boarding_music",
      brief: "Música ambiental d'Embarque/Desembarque",
      deep: "Música de fondo activa únicamente en rampa de acceso o con las puertas abiertas.",
      setter: setPlayBoardingMusic,
      getter: playBoardingMusic
    },
    {
      key: "speed_kph",
      brief: "Unidad métrica en Km/h",
      deep: "Cambia la mención oficial de velocidades del capitán de millas por hora a Km/h.",
      setter: setSpeedKph,
      getter: speedKph
    }
  ];

  const eventDefinitionList: EventDefinition[] = [
    { key: "gate_crew_start_soon", narrator: "Tripulación", desc: "Anuncio en terminal informando el inicio inminente del abordaje.", phaseId: "fase1" },
    { key: "gate_crew_started", narrator: "Tripulación", desc: "Aviso de abordaje en curso invitando a acomodar grupos o zonas.", phaseId: "fase1" },
    { key: "common_crew_boarding", narrator: "Tripulación", desc: "Instrucciones de pasillo y acomodación del equipaje de cabina.", phaseId: "fase1" },
    
    { key: "preflight_crew_welcome", narrator: "Tripulación", desc: "Mensaje cordial de tripulante dándole la bienvenida oficial tras el ingreso.", phaseId: "fase2" },
    { key: "preflight_capt_welcome", narrator: "Capitán", desc: "Saludo principal del Comandante desde el puesto técnico de control.", phaseId: "fase2" },
    { key: "preflight_capt_delay", narrator: "Capitán", desc: "Explicación de demora ATC por flujos, aerovías o autorizaciones.", phaseId: "fase2" },
    { key: "preflight_capt_basic_info", narrator: "Capitán", desc: "Datos operativos generales (tiempo estimado de crucero, plan y niveles).", phaseId: "fase2" },
    { key: "preflight_crew_basic_info", narrator: "Tripulación", desc: "Datos y servicios disponibles en el tramo programado.", phaseId: "fase2" },
    
    { key: "taxi_capt_armdoors", narrator: "Capitán", desc: "Instrucción formal de cierre y armado de toboganes de evacuación (cross-check).", phaseId: "fase3" },
    { key: "taxi_crew_safety_brief", narrator: "Tripulación", desc: "Demostración de procedimientos y salidas de emergencia en cabina.", phaseId: "fase3" },
    { key: "taxi_capt_dimlights", narrator: "Capitán", desc: "Señal de luces bajas de cabina a la tripulación para el despegue.", phaseId: "fase3" },
    { key: "taxi_crew_dimlights", narrator: "Tripulación", desc: "Advertencia a pasajeros sobre el oscurecimiento acústico nocturno en cabina.", phaseId: "fase3" },
    { key: "takeoff_capt_prepare", narrator: "Capitán", desc: "Aviso perentorio de tomar asientos inminentes para el ascenso primario.", phaseId: "fase3" },
    
    { key: "climb_crew_upcoming_service", narrator: "Tripulación", desc: "Aviso de liberación y detalles de menúes al superar los diez mil pies.", phaseId: "fase4" },
    { key: "cruise_capt_general_info", narrator: "Capitán", desc: "Actualización a mitad sobre hitos, clima en destino y travesía.", phaseId: "fase4" },
    { key: "cruise_crew_service_info1", narrator: "Tripulación", desc: "Apertura del carrito de comidas calientes o refrigerios.", phaseId: "fase4" },
    { key: "cruise_crew_service_info2", narrator: "Tripulación", desc: "Recogida de residuos y ronda secundaria de bebidas.", phaseId: "fase4" },
    { key: "cruise_crew_shopping_info", narrator: "Tripulación", desc: "Anuncio de catálogo de compras o productos libres de impuestos (Duty Free).", phaseId: "fase4" },
    { key: "cruise_crew_customs_forms", narrator: "Tripulación", desc: "Reparto de aduana e internacional migratorio.", phaseId: "fase4" },
    { key: "cruise_crew_service_info3", narrator: "Tripulación", desc: "Pre-snack o tentempié antes de culminar la altitud superior.", phaseId: "fase4" },
    
    { key: "descent_capt_close_desc", narrator: "Capitán", desc: "Primer anuncio de descenso abandonando altitud asignada del crucero.", phaseId: "fase5" },
    { key: "descent_capt_upcoming_actions", narrator: "Capitán", desc: "Altitud, pista en destino, clima local y estimación final.", phaseId: "fase5" },
    { key: "descent_crew_upcoming_actions", narrator: "Tripulación", desc: "Ajuste de cinturones, guardar bandejas y trabar asientos.", phaseId: "fase5" },
    { key: "descent_capt_10kfeet", narrator: "Capitán", desc: "Señal estéril a asistentes de cabina para cese de servicios.", phaseId: "fase5" },
    { key: "descent_crew_landing_fewmin", narrator: "Tripulación", desc: "Comprobación final visual de equipajes y preparación al suelo.", phaseId: "fase5" },
    { key: "final_capt_take_seats", narrator: "Capitán", desc: "Comando verbal exigiendo tomar transportines para tocar tierra.", phaseId: "fase5" },
    
    { key: "taxitogate_crew_welcome", narrator: "Tripulación", desc: "Bienvenida cordial al destino, facilitando hora y temperatura.", phaseId: "fase6" },
    { key: "taxitogate_crew_ramining_seating", narrator: "Tripulación", desc: "Firme retención de pasajeros sentados hasta el apagado del aviso.", phaseId: "fase6" },
    { key: "taxitogate_crew_delay_apologies", narrator: "Tripulación", desc: "Disculpas si hay filas excesivas en plataforma o esperas de remolque.", phaseId: "fase6" },
    
    { key: "atgate_capt_disarm_doors", narrator: "Capitán", desc: "Orden formal a los tripulantes para desarmar toboganes.", phaseId: "fase7" },
    { key: "atgate_crew_deboarding", narrator: "Tripulación", desc: "Despedida final regulada e instrucciones de salida.", phaseId: "fase7" },
    
    { key: "common_capt_seatbelt", narrator: "Capitán", desc: "Señal auditiva de cinturones manual por baches o cambios.", phaseId: "transversal" },
    { key: "common_crew_seatbelt", narrator: "Tripulación", desc: "Exigencia verbal de acatar el ajuste lumínico de seguridad.", phaseId: "transversal" }
  ];

  const getFilteredEvents = (): EventDefinition[] => {
    return eventDefinitionList.filter(item => item.phaseId === activeGroupTab);
  };

  const handleEventConfigChange = (key: string, value: "off" | "pack" | "IA") => {
    setEventConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  return (
    <div id="config-view-container" className="space-y-6">
      
      {/* View Header */}
      <div id="config-header" className="flex items-center justify-between border-b border-[#3B7EB2]/50 pb-4">
        <div>
          <h1 className="font-display font-black text-3xl tracking-tight text-[#45AFFF] flex items-center gap-2 uppercase">
            <Settings className="w-8 h-8 text-[#43E600] animate-pulse" /> CONFIGURACIÓN DEL SISTEMA
          </h1>
          <p className="text-xs font-mono text-white/70">
            Customize acoustic EQ bands, pilot details, passenger reactions, and automatic simulated triggers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {showSaveAlert && (
            <span className="bg-[#43E600] text-black text-[10px] font-mono font-black px-3 py-2 rounded-[5px] flex items-center gap-1.5 shadow-[0_0_15px_rgba(67,230,0,0.3)] animate-fadeIn">
              <Check className="w-3.5 h-3.5" /> ¡CAMBIOS REGISTRADOS!
            </span>
          )}
          <button
            onClick={handleSaveAll}
            className="bg-[#43E600] text-black font-mono font-black hover:bg-[#3bcc00] px-4 py-2 rounded-[5px] text-xs transition-all shadow-[0_0_12px_rgba(67,230,0,0.25)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer inline-flex items-center gap-1.5 h-9"
          >
            GUARDAR AJUSTES
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
          🎛️ Generales (Configuración de Sistema)
        </button>
        <button
          onClick={() => setActiveTab("eventos")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "eventos"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          📢 Configurar Eventos (Matriz Inteligente)
        </button>
        <button
          onClick={() => setActiveTab("packages")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "packages"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          📦 Packages
        </button>
        <button
          onClick={() => setActiveTab("voces")}
          className={`py-2 text-center text-xs font-mono font-bold tracking-wider uppercase transition-all rounded-[4px] cursor-pointer ${
            activeTab === "voces"
              ? "bg-[#2C6591]/85 border-b-2 border-[#43E600] text-white font-extrabold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          🗣️ Voces
        </button>
      </div>

      {/* TABS CONTAINER */}
      <div className="tab-contents">
        
        {/* ==================== TAB 1: GENERALES ==================== */}
        {activeTab === "generales" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 animate-fadeIn">
            
            {/* COLUMN LEFT: Preference Blocks */}
            <div className="space-y-6">
              
              {/* PREFERENCIAS DEL SISTEMA */}
              <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md flex flex-col gap-4">
                <div className="border-b border-white/10 pb-2.5">
                  <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
                    <SlidersHorizontal className="w-4.5 h-4.5 text-[#43E600]" /> PREFERENCIAS DEL SISTEMA
                  </h3>
                  <p className="text-[10px] text-white/50 font-mono mt-1">Variables básicas de embarque y automatización de procesos</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Passenger Boarding Time Seconds */}
                  <div className="bg-black/35 p-3 rounded border border-white/5 flex flex-col justify-between">
                    <div>
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">TIEMPO DE EMBARQUE EN SEGUNDOS:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Demora de abordaje de pasajeros</span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <input 
                        type="range"
                        min="5"
                        max="180"
                        step="5"
                        className="flex-1 accent-[#45AFFF] h-1"
                        value={passengerBoardingTimeSeconds}
                        onChange={(e) => setPassengerBoardingTimeSeconds(Number(e.target.value))}
                      />
                      <span className="font-mono text-xs text-[#43E600] font-bold shrink-0 min-w-[45px] text-right">{passengerBoardingTimeSeconds}s</span>
                    </div>
                  </div>

                  {/* Mute Ann When User Not In Cabin */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">MUTEAR AFUERA DE CABINA:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Silenciar si el usuario cambia el foco de la cámara</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0 transition-all"
                      checked={muteAnnWhenNotInCabin}
                      onChange={(e) => setMuteAnnWhenNotInCabin(e.target.checked)}
                    />
                  </label>

                  {/* Auto_Detect_Flight_Phase */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">DETECCIÓN AUTOMÁTICA DE ETAPAS:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Avanza fases telemétricamente</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={autoDetectFlightPhase}
                      onChange={(e) => setAutoDetectFlightPhase(e.target.checked)}
                    />
                  </label>

                  {/* start_after_simulator_connect */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">CONEXIÓN SIM DISPARADOR:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Iniciar simulación tras SimConnect</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={startAfterSimulatorConnect}
                      onChange={(e) => setStartAfterSimulatorConnect(e.target.checked)}
                    />
                  </label>

                  {/* enable_cabin_voice_effect */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">EFECTO ACÚSTICO DE MEGÁFONO:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Aplica eco y filtro sutil PA</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={enableCabinVoiceEffect}
                      onChange={(e) => setEnableCabinVoiceEffect(e.target.checked)}
                    />
                  </label>

                  {/* disable_prompts_when_changing_flight_state_manually */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">DESHABILITAR PROMPTS EN CAMBIOS MANUALES:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Deshabilitar los prompt cuando el usuario cambia manualmente el estado del vuelo</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={disablePromptsManually}
                      onChange={(e) => setDisablePromptsManually(e.target.checked)}
                    />
                  </label>

                  {/* show_ICAO_codes */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">MOSTRAR CÓDIGOS ICAO:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">muestra código ICAO/IATA</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={showIcaoCodes}
                      onChange={(e) => setShowIcaoCodes(e.target.checked)}
                    />
                  </label>

                  {/* save_language_settings */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">GUARDAR AJUSTES DE IDIOMA:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Persistir lenguajes del Comandante/ATC</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={saveLanguageSettings}
                      onChange={(e) => setSaveLanguageSettings(e.target.checked)}
                    />
                  </label>

                  {/* show_local_time_of_simulator */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">HORA LOCAL DEL SIMULADOR:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Mostrar hora del sim en vez de GMT/UTC</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={showLocalTimeSim}
                      onChange={(e) => setShowLocalTimeSim(e.target.checked)}
                    />
                  </label>

                  {/* show_ai_generation_progress_on_pre_flight_screen */}
                  <label className="bg-black/35 p-3 rounded border border-white/5 flex items-center justify-between cursor-pointer hover:bg-black/45 transition-colors">
                    <div className="pr-2">
                      <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">PROGRESO DIRECTO IA:</span>
                      <span className="text-[9px] text-white/45 block mt-0.5">Ver barra de IA durante preflight</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-4 w-4 shrink-0"
                      checked={showAiProgressPreflight}
                      onChange={(e) => setShowAiProgressPreflight(e.target.checked)}
                    />
                  </label>
                </div>

              </div>

              {/* STAFF & TRIPULACIÓN */}
              <div id="cfg-bloque-staff" className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md flex flex-col gap-3">
                <div className="border-b border-white/10 pb-2">
                  <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
                    <User className="w-4.5 h-4.5 text-[#43E600]" /> PERSONAL DE VUELO (STAFF)
                  </h3>
                </div>

                <div className="space-y-4">
                  {/* Pilot Customization */}
                  <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] space-y-2 flex flex-col">
                    <label className="flex items-center gap-2 font-mono text-[11px] font-bold text-white uppercase tracking-wider cursor-pointer">
                      <input 
                        type="checkbox"
                        className="accent-[#43E600]"
                        checked={customPilotNameSet}
                        onChange={(e) => setCustomPilotNameSet(e.target.checked)}
                      />
                      <span>Personalizar nombre del Capitan</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#45AFFF]/50" />
                      <input 
                        type="text"
                        disabled={!customPilotNameSet}
                        className="w-full bg-[#00345C]/75 border border-[#3B7EB2]/60 rounded p-2 text-xs text-white pl-9 font-mono disabled:opacity-40 focus:outline-none"
                        placeholder="Ej: Cap. Alberto Fernández"
                        value={customPilotName}
                        onChange={(e) => setCustomPilotName(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Cabin Crew Customization */}
                  <div className="bg-black/25 p-3.5 border border-white/5 rounded-[4px] space-y-2 flex flex-col">
                    <label className="flex items-center gap-2 font-mono text-[11px] font-bold text-white uppercase tracking-wider cursor-pointer">
                      <input 
                        type="checkbox"
                        className="accent-[#43E600]"
                        checked={customCrewNameSet}
                        onChange={(e) => setCustomCrewNameSet(e.target.checked)}
                      />
                      <span>Personalizar nombre del responsable de tripulación</span>
                    </label>
                    <div className="relative">
                      <Users className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#45AFFF]/50" />
                      <input 
                        type="text"
                        disabled={!customCrewNameSet}
                        className="w-full bg-[#00345C]/75 border border-[#3B7EB2]/60 rounded p-2 text-xs text-white pl-9 font-mono disabled:opacity-40 focus:outline-none"
                        placeholder="Ej: Jefa de Cabina Sofía"
                        value={customCrewName}
                        onChange={(e) => setCustomCrewName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* COLUMN RIGHT: Audio Equalization, Staff, and Passenger Experience */}
            <div className="space-y-6">
              
              {/* AUDIO Y ECUALIZADOR */}
              <div id="cfg-bloque-audio" className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md space-y-4">
                <div className="border-b border-white/10 pb-2 flex justify-between items-center">
                  <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
                    <Headphones className="w-4.5 h-4.5 text-[#43E600]" /> MEZCLADOR & ECUALIZADORES DE SONIDO
                  </h3>
                  {/* audio_3d_enabled switch */}
                  <label className="inline-flex items-center gap-1.5 bg-black/40 border border-white/10 px-2.5 py-1 rounded-[4px] cursor-pointer text-[10px] text-white/80 font-mono">
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3 w-3"
                      checked={audio3dEnabled}
                      onChange={(e) => setAudio3dEnabled(e.target.checked)}
                    />
                    <span>AUDIO 3D ACTIVO</span>
                  </label>
                </div>

                <div className="space-y-5">
                  {/* EQ Comandante / Captain */}
                  <div className="space-y-1.5">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <span className="text-[11px] font-mono font-black text-[#ffab2d] uppercase">🎙️ ECUALIZADOR DEL COMANDANTE (CO-PILOTO / ATC):</span>
                      
                      {/* Presets dropdown */}
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-[10px] text-white/50 font-mono">PRESET:</span>
                        <select
                          className="bg-black/55 text-white text-[11px] font-mono border border-white/25 rounded px-2.5 py-1 focus:outline-none"
                          value={eqCaptainPreset}
                          onChange={(e) => handleCaptainPresetChange(e.target.value)}
                        >
                          <option value="estandar">Elegir estándar</option>
                          <option value="vhf_radio">Radio VHF (Cabina de Mando)</option>
                          <option value="intercom_muffled">Megáfono Intercom sordo</option>
                          <option value="custom">Ecualización Personalizada [Custom]</option>
                        </select>
                      </div>
                    </div>

                    {/* 10 Band Faders Visualizer */}
                    <div className="bg-black/40 border border-white/10 rounded-lg p-3">
                      <div className="grid grid-cols-10 gap-1.5 text-center items-center">
                        {eqCaptainBands.map((bandVal, index) => (
                          <div key={index} className="flex flex-col items-center gap-1.5 group">
                            <span className="text-[8px] font-mono text-white/40 block leading-none">{FREQUENCIES[index]}</span>
                            <div className="h-20 sm:h-24 flex items-center justify-center">
                              <input 
                                type="range"
                                min="-12"
                                max="12"
                                value={bandVal}
                                orient="vertical"
                                onChange={(e) => handleCaptainBandChange(index, Number(e.target.value))}
                                className="h-full accent-[#ffab2d] cursor-ns-resize"
                                style={{ writingMode: "bt-lr", WebkitAppearance: "slider-vertical" } as any}
                              />
                            </div>
                            <span className="text-[9px] font-mono font-bold text-[#ffab2d] block min-w-[18px]">
                              {bandVal > 0 ? `+${bandVal}` : bandVal}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* EQ Tripulantes / Cabin Crew */}
                  <div className="space-y-1.5 border-t border-white/5 pt-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <span className="text-[11px] font-mono font-black text-[#57b8ff] uppercase">🎙️ ECUALIZADOR DE TRIPULACIÓN (CABIN GENERAL PA):</span>
                      
                      {/* Presets dropdown */}
                      <div className="flex items-center gap-1.5 text-xs font-mono">
                        <span className="text-[10px] text-white/50 block">PRESET:</span>
                        <select
                          className="bg-black/55 text-white text-[11px] font-mono border border-white/25 rounded px-2.5 py-1 focus:outline-none"
                          value={eqCrewPreset}
                          onChange={(e) => handleCrewPresetChange(e.target.value)}
                        >
                          <option value="estandar">Elegir estándar</option>
                          <option value="cabin_pa">Cabin PA System (Altavoz Techo)</option>
                          <option value="custom">Ecualización Personalizada [Custom]</option>
                        </select>
                      </div>
                    </div>

                    {/* 10 Band Faders Visualizer */}
                    <div className="bg-black/40 border border-white/10 rounded-lg p-3">
                      <div className="grid grid-cols-10 gap-1.5 text-center items-center">
                        {eqCrewBands.map((bandVal, index) => (
                          <div key={index} className="flex flex-col items-center gap-1.5 group">
                            <span className="text-[8px] font-mono text-white/40 block leading-none">{FREQUENCIES[index]}</span>
                            <div className="h-20 sm:h-24 flex items-center justify-center">
                              <input 
                                type="range"
                                min="-12"
                                max="12"
                                value={bandVal}
                                orient="vertical"
                                onChange={(e) => handleCrewBandChange(index, Number(e.target.value))}
                                className="h-full accent-[#57b8ff] cursor-ns-resize"
                                style={{ writingMode: "bt-lr", WebkitAppearance: "slider-vertical" } as any}
                              />
                            </div>
                            <span className="text-[9px] font-mono font-bold text-[#57b8ff] block min-w-[18px]">
                              {bandVal > 0 ? `+${bandVal}` : bandVal}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* EXPERIENCIA DEL PASAJERO */}
              <div id="cfg-bloque-passenger-exp" className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md flex flex-col gap-3">
                <div className="border-b border-white/10 pb-2">
                  <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-black">
                    <Activity className="w-4.5 h-4.5 text-[#43E600]" /> EXPERIENCIA DEL PASAJERO - SENSORES FÍSICOS
                  </h3>
                  <p className="text-[10px] text-white/50 font-mono mt-1">Habilitar análisis dinámico de fuerzas físicas en cabina</p>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <label className="bg-black/25 p-2.5 rounded border border-white/5 hover:bg-black/45 flex items-center justify-between cursor-pointer transition-colors font-mono">
                    <span className="text-[10px] text-white/90 uppercase font-black">G-Force Sensor:</span>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3.5 w-3.5"
                      checked={pfGforce}
                      onChange={(e) => setPfGforce(e.target.checked)}
                    />
                  </label>

                  <label className="bg-black/25 p-2.5 rounded border border-white/5 hover:bg-black/45 flex items-center justify-between cursor-pointer transition-colors font-mono">
                    <span className="text-[10px] text-white/90 uppercase font-black">Velocidad Vertical:</span>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3.5 w-3.5"
                      checked={pfVerticalSpeed}
                      onChange={(e) => setPfVerticalSpeed(e.target.checked)}
                    />
                  </label>

                  <label className="bg-black/25 p-2.5 rounded border border-white/5 hover:bg-black/45 flex items-center justify-between cursor-pointer transition-colors font-mono">
                    <span className="text-[10px] text-white/90 uppercase font-black">Fuerza de Toque:</span>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3.5 w-3.5"
                      checked={pfLandingForce}
                      onChange={(e) => setPfLandingForce(e.target.checked)}
                    />
                  </label>

                  <label className="bg-black/25 p-2.5 rounded border border-white/5 hover:bg-black/45 flex items-center justify-between cursor-pointer transition-colors font-mono">
                    <span className="text-[10px] text-white/90 uppercase font-black">Rodadura Irregular:</span>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3.5 w-3.5"
                      checked={pfIrregularGroundSpeed}
                      onChange={(e) => setPfIrregularGroundSpeed(e.target.checked)}
                    />
                  </label>

                  <label className="bg-black/25 p-2.5 rounded border border-white/5 hover:bg-black/45 flex items-center justify-between cursor-pointer transition-colors font-mono">
                    <span className="text-[10px] text-white/90 uppercase font-black">Aceleración en Suelo:</span>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3.5 w-3.5"
                      checked={pfAccelerationGroundSpeed}
                      onChange={(e) => setPfAccelerationGroundSpeed(e.target.checked)}
                    />
                  </label>

                  <label className="bg-black/25 p-2.5 rounded border border-white/5 hover:bg-black/45 flex items-center justify-between cursor-pointer transition-colors font-mono">
                    <span className="text-[10px] text-white/90 uppercase font-black font-semibold">Feedback Demo:</span>
                    <input 
                      type="checkbox"
                      className="accent-[#43E600] h-3.5 w-3.5"
                      checked={pfDelayFeedback}
                      onChange={(e) => setPfDelayFeedback(e.target.checked)}
                    />
                  </label>
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
                  Configurar Eventos Inteligentes de Cabina
                </h3>
              </div>

              {/* Package selector mimicking Flight screen */}
              <div id="cfg-package-selector" className="flex items-center gap-3 bg-black/30 border border-white/10 rounded-[5px] px-3 py-1.5 shrink-0 max-w-full overflow-x-auto">
                <label className="text-[9px] font-mono font-bold text-white/55 uppercase tracking-wider whitespace-nowrap">Package Activo:</label>
                <select
                  id="package-select"
                  value={selectedPackage}
                  onChange={(e) => setSelectedPackage(e.target.value)}
                  className="bg-black/55 border border-[#3B7EB2]/45 text-xs text-white font-mono font-bold rounded-[3px] px-2 py-0.5 focus:outline-none cursor-pointer hover:border-[#45AFFF] transition-colors"
                >
                  <option value="">-- Sin Package (Desactivar PACK) --</option>
                  <option value="aerolineas">Aerolíneas Argentinas AR Pack</option>
                  <option value="latam">LATAM Real Voice Pack v2</option>
                  <option value="iberia">Iberia Premium Audio</option>
                  <option value="flybondi">Flybondi Low-Cost set</option>
                  <option value="default">Default FS Soundset</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-white/80 font-mono leading-relaxed">
              Selecciona las preferencias de aviso para cada etapa del vuelo. Habilita locuciones IA para mayor detalle de trayecto.
            </p>

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
                  {group.label}
                </button>
              ))}
            </div>

            {/* Grid display for category options */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[460px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
              
              {/* IMMERSION SPECIAL GROUP */}
              {activeGroupTab === "immersion" ? (
                immersionOptions.map((item) => {
                  return (
                    <div 
                      key={item.key} 
                      className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col transition-all gap-4"
                    >
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div className="space-y-1.5 flex-1 min-w-0 pr-1 font-mono">
                          <div className="flex items-center gap-2">
                            <span className="text-[12.5px] font-sans font-bold text-white leading-normal tracking-wide">
                              {item.brief}
                            </span>
                          </div>
                          <span className="text-[10px] text-white/45 block max-w-sm leading-relaxed">
                            {item.deep}
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
                            Sí
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
                            No
                          </button>
                        </div>
                      </div>

                      {/* Display boarding music dropdown selector if play_boarding_music is Yes */}
                      {item.key === "play_boarding_music" && item.getter && (
                        <div className="border-t border-white/5 pt-3 mt-1 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                          <span className="text-[10.5px] font-mono text-white/95 font-bold uppercase tracking-wider block">
                            PISTA DE EMBARQUE SELECCIONADA:
                          </span>
                          <select 
                            className="bg-[#00172e] border border-[#3B7EB2]/50 text-white rounded-[4px] px-2.5 py-1 text-xs font-mono focus:outline-none w-full sm:w-auto min-w-[200px]"
                            value={songBoardingMusic}
                            onChange={(e) => setSongBoardingMusic(e.target.value)}
                          >
                            <option value="Vivaldi Concert VIII">Vivaldi Concert VIII</option>
                            <option value="Jazz Lounge Classics">Jazz Lounge Classics</option>
                            <option value="Ambient Synth Wave">Ambient Synth Wave</option>
                            <option value="Copa Airlines Boarding Theme">Copa Airlines Boarding Theme</option>
                            <option value="Bossa Nova Breeze">Bossa Nova Breeze</option>
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                /* REGULAR TRIGGER EVENTS GROUPS (FLIGHT EVENTS) */
                getFilteredEvents().map((item) => {
                  const currentValue = eventConfig[item.key] || "IA";

                  return (
                    <div 
                      key={item.key} 
                      className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all font-mono"
                    >
                      <div className="space-y-1 my-1 flex-1 min-w-0 pr-1">
                        <span className="text-[12.5px] font-sans font-medium text-white/95 leading-normal block">
                          {item.desc}
                        </span>
                        {/* Narrator Display below description */}
                        <div className="flex items-center gap-1.5 text-[9px] uppercase font-mono tracking-wider text-white/50 mt-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${item.narrator === "Capitán" ? "bg-[#e68b00]" : "bg-[#45AFFF]"}`}></span>
                          <span>NARRADOR: <strong className={item.narrator === "Capitán" ? "text-[#ffb340]" : "text-[#45AFFF]"}>{item.narrator}</strong></span>
                        </div>
                      </div>

                      {/* Selector Mode Pill */}
                      <div className="flex bg-black/60 border border-white/15 rounded-[4px] p-0.5 shrink-0 h-fit max-w-[150px] w-full justify-between">
                        {(["off", "pack", "IA"] as const).map((mode) => {
                          const isSelected = currentValue === mode;
                          const isPackModeDisabled = mode === "pack" && !selectedPackage;
                          let activeStyle = "text-white/30 border-transparent hover:text-white/60 text-[9px] font-semibold";
                          if (isSelected) {
                            if (mode === "off") activeStyle = "bg-red-500/20 text-red-300 border-red-500/35 font-black shadow-sm text-[9px]";
                            if (mode === "pack") activeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40 font-black shadow-sm text-[9px]";
                            if (mode === "IA") activeStyle = "bg-sky-500/20 text-sky-400 border-[#45AFFF]/35 font-black shadow-sm text-[9px]";
                          }
                          return (
                            <button
                              key={mode}
                              type="button"
                              disabled={isPackModeDisabled}
                              onClick={() => handleEventConfigChange(item.key, mode)}
                              title={isPackModeDisabled ? "Debes seleccionar un Package activo para habilitar la opción PACK" : ""}
                              className={`px-1.5 py-1 rounded-[3px] font-mono uppercase tracking-wider border cursor-pointer transition-all flex-1 text-center ${activeStyle} ${
                                isPackModeDisabled ? "opacity-25 cursor-not-allowed hover:text-white/20" : ""
                              }`}
                            >
                              {mode}
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
        {activeTab === "packages" && (
          <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-5 shadow-lg space-y-6 w-full animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-display font-black text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                  📦 Directorio de Control de Audio Packages
                </h3>
                <p className="text-xs text-white/60 font-mono mt-1">
                  Administre las carpetas de recursos fónicos y sets de sonido de aerolíneas reales.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleScanDirectory}
                  disabled={isScanning}
                  className="bg-[#45AFFF] text-[#00172e] hover:bg-[#6ec2ff] font-mono font-black px-4 py-2 rounded-[5px] text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <FolderSync className={`w-4 h-4 ${isScanning ? "animate-spin" : ""}`} />
                  ESCANEAR DIRECTORIO
                </button>
                <button
                  type="button"
                  onClick={handleOpenDirectory}
                  className="border border-white/30 hover:bg-white/5 text-white font-mono font-bold px-4 py-2 rounded-[5px] text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-[#43E600]" />
                  ABRIR DIRECTORIO
                </button>
              </div>
            </div>

            {/* Scanning Feedback Alert */}
            {isScanning && (
              <div className="bg-black/40 border border-[#3b7eb2]/50 p-4 rounded-[5px] flex items-center gap-3 animate-pulse">
                <div className="w-2.5 h-2.5 rounded-full bg-[#43E600] animate-ping" />
                <span className="font-mono text-xs text-[#45AFFF] font-bold uppercase">{scanMessage}</span>
              </div>
            )}

            {/* Input para el directorio */}
            <div className="bg-black/30 border border-white/10 p-4 rounded-[5px] flex flex-col gap-2">
              <label htmlFor="packages-dir-input" className="text-xs font-mono text-white/80 font-black uppercase tracking-wider">
                Directorio de ubicación de packages:
              </label>
              <div className="relative">
                <FolderOpen className="absolute left-3 top-2.5 h-4 w-4 text-white/45" />
                <input
                  id="packages-dir-input"
                  type="text"
                  value={packagesDir}
                  onChange={(e) => setPackagesDir(e.target.value)}
                  placeholder="Ej: C:\Users\User\AppData\Roaming\Microsoft Flight Simulator\Packages\Community"
                  className="w-full bg-[#00213d] border border-[#3B7EB2]/50 rounded-[4px] py-2 pl-10 pr-4 text-xs font-mono text-white focus:outline-none focus:border-[#43E600] transition-colors"
                />
              </div>
              <p className="text-[10px] text-white/45 font-mono mt-0.5">
                Ruta absoluta del simulador de vuelo MSFS / Community donde se despliegan las librerías físicas (.wav / .gai).
              </p>
            </div>

            {/* Lista de cards de paquetes */}
            <div className="space-y-4">
              <h4 className="text-xs font-mono text-[#43E600] uppercase font-black tracking-wider border-b border-white/5 pb-1">
                Paquetes de Sonido Detectados ({packagesList.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {packagesList.map((pkg: any) => (
                  <div
                    key={pkg.id}
                    className={`p-4 rounded-[6px] border transition-all flex flex-col justify-between ${
                      pkg.enabled
                        ? "bg-[#002440]/65 border-[#3B7EB2]/55 shadow-md shadow-[#2C6591]/10"
                        : "bg-black/25 border-white/10 opacity-60 hover:opacity-85"
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-4">
                        <h5 className="font-sans font-bold text-sm text-white leading-tight tracking-wide">
                          {pkg.name}
                        </h5>
                        <label className="relative inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={pkg.enabled}
                            onChange={(e) => {
                              const updated = packagesList.map((p: any) =>
                                p.id === pkg.id ? { ...p, enabled: e.target.checked } : p
                              );
                              setPackagesList(updated);
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-8 h-4.5 bg-white/15 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-500 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-[#43E600]"></div>
                        </label>
                      </div>
                      <p className="text-xs text-white/70 font-mono mt-2 leading-relaxed">
                        {pkg.description}
                      </p>
                    </div>

                    {/* Información secundaria de menor relevancia */}
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 border-t border-white/5 pt-3 mt-4 text-[10px] font-mono text-white/55">
                      <div>
                        <span className="block text-white/35 uppercase text-[9px]">Autor:</span>
                        <span className="text-[#45AFFF] font-semibold">{pkg.author}</span>
                      </div>
                      <div>
                        <span className="block text-white/35 uppercase text-[9px]">Versión:</span>
                        <span className="font-semibold text-white/85">{pkg.version}</span>
                      </div>
                      <div>
                        <span className="block text-white/35 uppercase text-[9px]">Lenguaje 1:</span>
                        <span className="text-white/85 font-semibold">{pkg.lang1}</span>
                      </div>
                      <div>
                        <span className="block text-white/35 uppercase text-[9px]">Lenguaje 2:</span>
                        <span className="text-white/85 font-semibold">{pkg.lang2}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: VOCES ==================== */}
        {activeTab === "voces" && (
          <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-5 shadow-lg space-y-6 w-full animate-fadeIn">
            <div className="border-b border-white/10 pb-3">
              <h3 className="text-base font-display font-black text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                🗣️ Control y Registro de Voces Naturales
              </h3>
              <p className="text-xs text-white/60 font-mono mt-1">
                Configure los perfiles sintéticos de cabina o registre grabaciones de voz de tripulantes reales.
              </p>
            </div>

            {/* Grilla de cartas de voz */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {voicesList.map((voice: any) => {
                const isPlaying = playingVoiceId === voice.id;
                return (
                  <div
                    key={voice.id}
                    className={`p-4 rounded-[6px] border transition-all flex flex-col justify-between min-h-[180px] ${
                      voice.enabled
                        ? "bg-[#002440]/65 border-[#3B7EB2]/55 shadow-md"
                        : "bg-black/25 border-white/10 opacity-60 hover:opacity-85"
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-4">
                        {/* Nombre de la voz (solo el nombre, sin etiqueta) */}
                        <span className="font-sans font-bold text-sm text-white block">
                          {voice.name}
                        </span>
                        
                        {/* Toggle switch */}
                        <label className="relative inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={voice.enabled}
                            onChange={(e) => {
                              const updated = voicesList.map((v: any) =>
                                v.id === voice.id ? { ...v, enabled: e.target.checked } : v
                              );
                              setVoicesList(updated);
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-8 h-4.5 bg-white/15 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-500 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-[#43E600]"></div>
                        </label>
                      </div>

                      {/* Descripción */}
                      <p className="text-[11px] text-white/65 font-mono mt-2 leading-relaxed">
                        {voice.description || "Perfil de voz registrado para locuciones generales de aeronaves."}
                      </p>

                      {/* Tipo de voz (Estándar o Usuario) */}
                      <div className="mt-3.5 flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase font-black ${
                          voice.type === "Estándar" 
                            ? "bg-[#45AFFF]/20 text-[#45AFFF]" 
                            : "bg-[#43E600]/25 text-[#43E600] border border-[#43E600]/25"
                        }`}>
                          {voice.type}
                        </span>
                        <span className="text-[10px] text-white/35 font-mono capitalize">
                          {voice.gender || "femenino"}
                        </span>
                      </div>
                    </div>

                    {/* Botón de acción */}
                    <div className="mt-4 border-t border-white/5 pt-3">
                      {voice.type === "Estándar" ? (
                        <button
                          type="button"
                          onClick={() => playSyntheticVoicePreview(voice.name, voice.id)}
                          className={`w-full font-mono text-xs font-bold py-1.5 px-3 rounded-[3px] border cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
                            isPlaying
                              ? "bg-red-500/25 text-red-300 border-red-500/40 font-black animate-pulse"
                              : "bg-black/35 hover:bg-black/60 border-white/20 hover:border-white/40 text-white"
                          }`}
                        >
                          <Volume2 className={`w-3.5 h-3.5 ${isPlaying ? "animate-bounce" : ""}`} />
                          {isPlaying ? "REPRODUCIENDO..." : "Reproducir"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVoiceId(voice.id);
                            setNewVoiceName(voice.name);
                            setNewVoiceDescription(voice.description || "");
                            setNewVoiceGender(voice.gender || "femenino");
                            setNewVoiceIsPublic(voice.isPublic || false);
                            setShowNewVoiceModal(true);
                          }}
                          className="w-full bg-black/35 hover:bg-black/60 border border-white/20 hover:border-white/40 font-mono text-xs font-bold text-white py-1.5 px-3 rounded-[3px] flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-[#43E600]" />
                          Editar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Botón Agregar Card: que solo tenga símbolo "+" y el texto agregar */}
              <button
                type="button"
                onClick={() => {
                  setEditingVoiceId(null);
                  setNewVoiceName("");
                  setNewVoiceDescription("");
                  setNewVoiceGender("femenino");
                  setNewVoiceIsPublic(false);
                  setIsRecording(false);
                  setRecordTimer(0);
                  setShowNewVoiceModal(true);
                }}
                className="p-6 rounded-[6px] border border-dashed border-white/25 hover:border-[#45AFFF] bg-black/15 hover:bg-black/30 transition-all flex flex-col items-center justify-center gap-2 cursor-pointer group min-h-[180px] text-center"
              >
                <div className="w-9 h-9 rounded-full border border-dashed border-white/35 group-hover:border-[#45AFFF] group-hover:scale-105 flex items-center justify-center transition-all bg-black/20 text-white/50 group-hover:text-[#45AFFF] text-xl font-bold">
                  +
                </div>
                <span className="font-sans font-bold text-sm text-white/75 group-hover:text-white uppercase tracking-wider">
                  agregar
                </span>
                <span className="text-[10px] font-mono text-white/40">Grabar voz de usuario</span>
              </button>
            </div>
          </div>
        )}

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
