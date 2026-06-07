/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from "react";
import { 
  Plane, 
  Download, 
  Play, 
  Save, 
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
  Pause,
  ArrowLeft,
  RotateCcw,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2
} from "lucide-react";
import { FlightState, Pasajero, SimBriefData, ConfigVoces, ConfigAudio, UltimoAnuncio } from "../types";
import PasajeroSlideOver from "./PasajeroSlideOver";
// @ts-ignore
import siluetaAvion from "./Silueta Avion.png";
// @ts-ignore
import siluetaAvionFill from "./Silueta Avion Fill.png";

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
  onTriggerBriefImport: () => void;
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
  onTriggerBriefImport
}: VueloActualViewProps) {
  const [flightCode, setFlightCode] = useState(simBriefData.vueloCodigo);
  const [originICAO, setOriginICAO] = useState(simBriefData.origen);
  const [destICAO, setDestICAO] = useState(simBriefData.destino);
  const [airline, setAirline] = useState(simBriefData.aerolinea);
  const [originCityName, setOriginCityName] = useState<string>("Buenos Aires");
  const [destCityName, setDestCityName] = useState<string>("Córdoba");

  // Phase 1 Boarding states
  const [boardedCount, setBoardedCount] = useState<number>(0);
  const [isBoardingActive, setIsBoardingActive] = useState<boolean>(false);
  const [boardingStarted, setBoardingStarted] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);

  // Phase 7 States
  const [isReportGenerating, setIsReportGenerating] = useState<boolean>(true);
  const [isManifestCollapsed, setIsManifestCollapsed] = useState<boolean>(false);

  // Flight Plan Import local state matching the new flow
  const [isBriefImported, setIsBriefImported] = useState<boolean>(false);
  const [canStartFlight, setCanStartFlight] = useState<boolean>(false);
  const [activeGroupTab, setActiveGroupTab] = useState<string>("immersion");
  const [selectedPackage, setSelectedPackage] = useState<string>("aerolineas");
  const [showPackageManager, setShowPackageManager] = useState<boolean>(false);
  const [selectedPasajero, setSelectedPasajero] = useState<Pasajero | null>(null);
  
  // --- FLIGHT SETTINGS SCREEN STATES ---
  const [isFlightSettingsOpen, setIsFlightSettingsOpen] = useState<boolean>(false);

  // Block 1: Tripulación e Identificación
  const [captainVoice, setCaptainVoice] = useState<string>("Alejandro (Voz IA)");
  const [crewVoice, setCrewVoice] = useState<string>("Sofía (Voz IA)");
  const [captainLanguage, setCaptainLanguage] = useState<string>("Español (ES)");
  const [crewLanguage, setCrewLanguage] = useState<string>("Ninguno");
  const [captainAccent, setCaptainAccent] = useState<string>("Rioplatense (AR)");
  const [crewAccent, setCrewAccent] = useState<string>("Neutro (LATAM)");
  const [boardingMusicTrack, setBoardingMusicTrack] = useState<string>("Vivaldi Concert VIII");

  const [showSecondaryLang, setShowSecondaryLang] = useState<boolean>(false);

  useEffect(() => {
    if (currentState !== FlightState.PreEmbarque) {
      setShowSecondaryLang(false);
      return;
    }
    const hasSecondary = crewLanguage && crewLanguage !== "Ninguno" && crewLanguage !== captainLanguage;
    if (!hasSecondary) {
      setShowSecondaryLang(false);
      return;
    }

    const interval = setInterval(() => {
      setShowSecondaryLang((prev) => !prev);
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [currentState, captainLanguage, crewLanguage]);

  const getBoardingText = (es: string, en: string) => {
    const activeLang = showSecondaryLang ? (crewLanguage || "Ninguno") : (captainLanguage || "Español (ES)");
    if (activeLang.toLowerCase().includes("español") || activeLang.toLowerCase().includes("castellano")) {
      return es;
    }
    return en;
  };

  // Block 2: Eventos Especiales
  const [specialEvents, setSpecialEvents] = useState<string>("");

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
    brief: string;
    deep: string;
    defaultVal: boolean;
  }

  const immersionOptions: ImmersionOption[] = [
    {
      key: "play_chime_sound_before_ann",
      brief: "Tono de aviso de cabina",
      deep: "Reproduce el clásico tono de aviso de cabina (\"Ding\" o \"Ding-Dong\") justo un segundo antes de que comience cualquier anuncio de la tripulación o del capitán. Ayuda a captar la atención del jugador sobre el ruido de los motores.",
      defaultVal: true
    },
    {
      key: "play_ambient_sound_during_flight",
      brief: "Sonido ambiente en vuelo",
      deep: "Activa una pista de audio en bucle de muy bajo volumen que simula la vida en la cabina (murmullos sutiles, tintineo de vasos, pasos en el pasillo). Se reproduce de forma continua durante el vuelo, enmascarando el silencio absoluto si el simulador no tiene buenos sonidos internos.",
      defaultVal: true
    },
    {
      key: "crew_greeting_passengers_at_gate",
      brief: "Saludos de cabina en puerta",
      deep: "Habilita pequeñas locuciones aleatorias (\"Hola\", \"Bienvenidos\", \"Buenas tardes\") superpuestas al sonido ambiente de embarque, simulando a la jefa de cabina recibiendo a los pasajeros en la puerta del avión.",
      defaultVal: true
    },
    {
      key: "passenger_reaction_to_planes_movement",
      brief: "Reacciones de pasajeros al movimiento",
      deep: "Permite que el motor de simulación de pasajeros emita sonidos audibles (jadeos, exclamaciones, murmullos nerviosos) en respuesta a fuerzas G repentinas, turbulencia severa, caídas bruscas de altitud o frenadas intensas.",
      defaultVal: true
    },
    {
      key: "play_passenger_reaction_during_landing",
      brief: "Reacciones al aterrizar",
      deep: "Activa una respuesta sonora colectiva de la cabina inmediatamente después de que el avión toca la pista. Dependiendo de los pies por minuto (FPM) del aterrizaje, puede generar desde un clásico aplauso de alivio hasta quejas audibles.",
      defaultVal: true
    },
    {
      key: "play_boarding_music",
      brief: "Música de embarque y desembarque",
      deep: "Habilita la reproducción de una lista musical de fondo durante todo el proceso de embarque y desembarque, deteniéndose automáticamente cuando el capitán ordena armar las puertas. Ideal para establecer el clima de la aerolínea (desde música clásica relajante hasta synth-pop retro).",
      defaultVal: true
    },
    {
      key: "speed_kph",
      brief: "Reporte de velocidad en km/h",
      deep: "Define el sistema de unidades que utilizará la Inteligencia Artificial cuando deba mencionar la velocidad a los pasajeros (por ejemplo, en el reporte de mitad de vuelo). Si está activo, el capitán anunciará la velocidad en kilómetros por hora (km/h). Si está apagado, utilizará millas por hora (mph).",
      defaultVal: true
    }
  ];

  // 33 Active attributes with user preset values
  const [eventConfig, setEventConfig] = useState<Record<string, "off" | "pack" | "IA">>({
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
  });

  interface EventDefinition {
    key: string;
    narrator: "Capitán" | "Tripulación";
    desc: string;
    phaseId: string;
  }  const eventDefinitionList: EventDefinition[] = [


    // Fase 1
    { key: "gate_crew_start_soon", narrator: "Tripulación", desc: "Anuncio en la terminal indicando que el proceso de embarque comenzará en breve.", phaseId: "fase1" },
    { key: "gate_crew_started", narrator: "Tripulación", desc: "Aviso oficial del inicio del abordaje por grupos o zonas.", phaseId: "fase1" },
    { key: "common_crew_boarding", narrator: "Tripulación", desc: "Mensajes rutinarios emitidos dentro de la cabina mientras los pasajeros buscan sus asientos y guardan el equipaje.", phaseId: "fase1" },
    // Fase 2
    { key: "preflight_crew_welcome", narrator: "Tripulación", desc: "Mensaje inicial de bienvenida a bordo una vez que el flujo principal de pasajeros se ha estabilizado.", phaseId: "fase2" },
    { key: "preflight_capt_welcome", narrator: "Capitán", desc: "Saludo inicial oficial desde la cabina de mando.", phaseId: "fase2" },
    { key: "preflight_capt_delay", narrator: "Capitán", desc: "Explicación sobre posibles demoras por tráfico ATC o carga (anuncio condicional).", phaseId: "fase2" },
    { key: "preflight_capt_basic_info", narrator: "Capitán", desc: "Resumen operativo detallando la altitud, tiempo en ruta y meteorología esperada.", phaseId: "fase2" },
    { key: "preflight_crew_basic_info", narrator: "Tripulación", desc: "Complemento informativo repasando normas generales o disponibilidad de servicios.", phaseId: "fase2" },
    // Fase 3
    { key: "taxi_capt_armdoors", narrator: "Capitán", desc: "Orden estricta a la tripulación para armar toboganes y verificar puertas cerradas (Cross-check).", phaseId: "fase3" },
    { key: "taxi_crew_safety_brief", narrator: "Tripulación", desc: "Ejecución de la demostración de seguridad (manual o por pantallas).", phaseId: "fase3" },
    { key: "taxi_capt_dimlights", narrator: "Capitán", desc: "Orden a la tripulación para reducir la iluminación general (típicamente en vuelos nocturnos).", phaseId: "fase3" },
    { key: "taxi_crew_dimlights", narrator: "Tripulación", desc: "Aviso a los pasajeros sobre la atenuación de luces para el despegue.", phaseId: "fase3" },
    { key: "takeoff_capt_prepare", narrator: "Capitán", desc: "Orden ejecutiva indicando a los tripulantes que tomen sus lugares para el despegue inminente.", phaseId: "fase3" },
    // Fase 4
    { key: "climb_crew_upcoming_service", narrator: "Tripulación", desc: "Aviso sobre los servicios a bordo que se ofrecerán, emitido generalmente al superar los 10.000 pies.", phaseId: "fase4" },
    { key: "cruise_capt_general_info", narrator: "Capitán", desc: "Actualización a mitad del vuelo sobre el progreso, puntos de interés geográficos o cambios en la ruta.", phaseId: "fase4" },
    { key: "cruise_crew_service_info1", narrator: "Tripulación", desc: "Inicio del servicio primario de comidas o bebidas.", phaseId: "fase4" },
    { key: "cruise_crew_service_info2", narrator: "Tripulación", desc: "Segundo pase en cabina (recolección de bandejas, oferta de té/café).", phaseId: "fase4" },
    { key: "cruise_crew_shopping_info", narrator: "Tripulación", desc: "Promoción de la venta a bordo (Duty Free). Al maquetar la UI y vincularla a este evento, hay que asegurarse de que si estas ventas se marcan como opcionales, la lógica no saltee la pantalla de pago ni falle al actualizar la variable del monto al confirmar una transacción.", phaseId: "fase4" },
    { key: "cruise_crew_customs_forms", narrator: "Tripulación", desc: "Aviso sobre la distribución de los formularios de migraciones y aduanas para vuelos internacionales.", phaseId: "fase4" },
    { key: "cruise_crew_service_info3", narrator: "Tripulación", desc: "Tercer servicio ocasional, típicamente un desayuno o snack en vuelos de largo radio antes del descenso.", phaseId: "fase4" },
    // Fase 5
    { key: "descent_capt_close_desc", narrator: "Capitán", desc: "Aviso previo informando que el avión está a punto de abandonar la altitud de crucero (Top of Descent).", phaseId: "fase5" },
    { key: "descent_capt_upcoming_actions", narrator: "Capitán", desc: "Detalles finales sobre la pista de aterrizaje, terminal asignada y clima local en destino.", phaseId: "fase5" },
    { key: "descent_crew_upcoming_actions", narrator: "Tripulación", desc: "Solicitud a los pasajeros de guardar mesas, enderezar respaldos y prepararse para la llegada.", phaseId: "fase5" },
    { key: "descent_capt_10kfeet", narrator: "Capitán", desc: "Señal acústica o verbal al cruzar 10.000 pies hacia abajo, indicando el inicio de la cabina estéril.", phaseId: "fase5" },
    { key: "descent_crew_landing_fewmin", narrator: "Tripulación", desc: "Chequeo final de cabina y confirmación de que el aterrizaje ocurrirá en breves minutos.", phaseId: "fase5" },
    { key: "final_capt_take_seats", narrator: "Capitán", desc: "Orden perentoria a la tripulación de ocupar sus transportines para el aterrizaje.", phaseId: "fase5" },
    // Fase 6
    { key: "taxitogate_crew_welcome", narrator: "Tripulación", desc: "Anuncio protocolar dando la bienvenida oficial al destino y confirmando la hora local.", phaseId: "fase6" },
    { key: "taxitogate_crew_ramining_seating", narrator: "Tripulación", desc: "Recordatorio preventivo para que nadie se levante antes de que se apague la señal correspondiente.", phaseId: "fase6" },
    { key: "taxitogate_crew_delay_apologies", narrator: "Tripulación", desc: "Mensaje para gestionar la impaciencia si la puerta de desembarque está ocupada y hay demoras en plataforma (condicional).", phaseId: "fase6" },
    // Fase 7
    { key: "atgate_capt_disarm_doors", narrator: "Capitán", desc: "Orden ejecutiva para desarmar los toboganes de evacuación una vez detenidos por completo.", phaseId: "fase7" },
    { key: "atgate_crew_deboarding", narrator: "Tripulación", desc: "Instrucciones finales sobre el flujo de salida, despedida y recordatorio sobre objetos personales.", phaseId: "fase7" },
    // Transversales
    { key: "common_capt_seatbelt", narrator: "Capitán", desc: "Cambio de estado de la señal lumínica de cinturones (se dispara en cualquier momento por turbulencia).", phaseId: "transversal" },
    { key: "common_crew_seatbelt", narrator: "Tripulación", desc: "Refuerzo verbal exigiendo que todos vuelvan a sus asientos inmediatamente tras el aviso del capitán.", phaseId: "transversal" }
  ];

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

    const orgInfo = airports[o] || { name: `${o} Airport`, city: o, country: "Desconocido" };
    const destInfo = airports[d] || { name: `${d} Airport`, city: d, country: "Desconocido" };

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

  // Phase 1 boarding simulation timer effect
  React.useEffect(() => {
    let intervalId: any = null;
    if (isBoardingActive && boardedCount < passengers.length) {
      intervalId = setInterval(() => {
        setBoardedCount(prev => {
          if (prev >= passengers.length) {
            setIsBoardingActive(false);
            clearInterval(intervalId);
            return passengers.length;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isBoardingActive, boardedCount, passengers.length]);

  // Check when boarding is complete to deactivate active boarding state
  React.useEffect(() => {
    if (boardedCount >= passengers.length && isBoardingActive) {
      setIsBoardingActive(false);
    }
  }, [boardedCount, passengers.length, isBoardingActive]);

  // Reset boarding whenever entering PreEmbarque phase
  React.useEffect(() => {
    if (currentState === FlightState.PreEmbarque) {
      setBoardedCount(0);
      setIsBoardingActive(false);
      setBoardingStarted(false);
      setShowCancelConfirm(false);
    }
  }, [currentState]);

  const handleEventConfigChange = (key: string, value: "off" | "pack" | "IA") => {
    setEventConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const eventGroups = [
    { id: "immersion", label: "Inmersión (7)" },
    { id: "fase1", label: "Embarque (3)" },
    { id: "fase2", label: "Pre-Vuelo (5)" },
    { id: "fase3", label: "Rodaje (5)" },
    { id: "fase4", label: "Crucero (7)" },
    { id: "fase5", label: "Descenso (6)" },
    { id: "fase6", label: "Rodaje a Puerta (3)" },
    { id: "fase7", label: "Plataforma (2)" },
    { id: "transversal", label: "Transversales (2)" }
  ];

  const getFilteredEvents = (): EventDefinition[] => {
    return eventDefinitionList.filter(item => item.phaseId === activeGroupTab);
  };

  // Sub-stages state alignment according to user specs
  const [currentSubStage, setCurrentSubStage] = useState<string>(() => {
    if (currentState === FlightState.NoIniciado) return "No iniciado";
    if (currentState === FlightState.PreEmbarque) return "Embarque";
    if (currentState === FlightState.EnVuelo) return "Crucero";
    return "Rodaje a Puerta";
  });

  const simplifiedPhases = [
    { label: "Embarque", state: FlightState.PreEmbarque },
    { label: "Pre-vuelo", state: FlightState.PreEmbarque },
    { label: "Rodaje", state: FlightState.PreEmbarque },
    { label: "Crucero", state: FlightState.EnVuelo },
    { label: "Descenso", state: FlightState.EnVuelo },
    { label: "Rodaje a Puerta", state: FlightState.Aterrizado },
    { label: "Plataforma", state: FlightState.Aterrizado }
  ];

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

  // 10 seconds auto-advance for phases 2 to 7
  React.useEffect(() => {
    if (!isPhase2To7) return;

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

  // 30 seconds auto-advance after boarding is complete ("listo para cerrar puertas")
  React.useEffect(() => {
    if (boardedCount >= passengers.length && passengers.length > 0 && currentState === FlightState.PreEmbarque && currentSubStage === "Embarque") {
      const autoAdvanceTimer = setTimeout(() => {
        // Advance sub-stage to "Pre-vuelo" (Phase 2)
        setCurrentSubStage("Pre-vuelo");
      }, 30000); // 30 seconds
      return () => clearTimeout(autoAdvanceTimer);
    }
  }, [boardedCount, passengers.length, currentState, currentSubStage]);

  const displayTotalPassengers = 142;
  const displayBoardedCount = boardedCount === passengers.length ? 142 : Math.round((boardedCount / passengers.length) * 142);

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
  const p26Announcement = mockInfo ? mockInfo.announcement : lastAnnouncement;

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
            onClick={() => alert("Simulación de Importación: Elige un archivo ZIP o JSON con el manifest del Sound Pack.")}
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
                            alert(`Probando sonido asociado: ${track.file}. Escuchando retroalimentación de altavoz de techo...`);
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
                              alert(`Se ha reasociado el evento '${track.event}' al archivo '${newName}' de forma satisfactoria.`);
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
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2 font-mono text-[#45AFFF] font-extrabold text-xs uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-[#43E600] animate-pulse" />
              <span>Etapas de Vuelo</span>
            </div>
            <div className="text-[10px] font-mono text-white/55 uppercase">
              Fase Activa: <span className="text-[#43E600] font-black">{currentSubStage}</span>
            </div>
          </div>

          {/* Linear Stepper Track */}
          <div className="relative flex flex-col md:flex-row items-stretch justify-between gap-3 md:gap-1 pl-1 pr-1 pt-1.5 pb-1">
            {/* Connecting line for desktop background */}
            <div className="absolute top-[18px] left-[20px] right-[20px] h-[2px] bg-white/5 hidden md:block z-0" />
            
            {/* Active Progress line for desktop */}
            <div 
              className="absolute top-[18px] left-[20px] h-[2px] bg-[#45AFFF]/60 hidden md:block z-0 transition-all duration-500"
              style={{ 
                width: `${(activeIndex / (simplifiedPhases.length - 1)) * 95}%`,
                maxWidth: "calc(100% - 40px)"
              }}
            />

            {simplifiedPhases.map((phase, idx) => {
              const isPassedOrActive = idx <= activeIndex;
              const isActive = idx === activeIndex;
              
              return (
                <button
                  key={phase.label}
                  type="button"
                  onClick={() => {
                    setCurrentSubStage(phase.label);
                    onStateChange(phase.state);
                  }}
                  className={`relative flex md:flex-col items-center gap-3 md:gap-2 flex-1 text-left md:text-center z-10 transition-all focus:outline-none cursor-pointer group ${
                    isPassedOrActive ? "opacity-100" : "opacity-35 hover:opacity-70"
                  }`}
                >
                  {/* Step Circle with conditional styling */}
                  <div 
                    className={`w-9 h-9 rounded-full flex items-center justify-center border font-mono text-xs font-bold transition-all duration-300 shrink-0 ${
                      isActive 
                        ? "bg-[#43E600] text-black border-[#43E600] shadow-[0_0_12px_rgba(67,230,0,0.5)] ring-4 ring-[#43E600]/10 animate-pulse scale-105"
                        : isPassedOrActive
                          ? "bg-[#002746] text-[#45AFFF] border-[#3B7EB2]/60 hover:border-[#45AFFF]"
                          : "bg-[#001224] text-white/30 border-white/10"
                    }`}
                  >
                    {idx + 1}
                  </div>

                  {/* Step Text Label */}
                  <div className="flex flex-col md:items-center min-w-0">
                    <span 
                      className={`font-sans text-[11px] font-semibold tracking-tight transition-all duration-300 leading-snug break-words hyphens-auto ${
                        isActive 
                          ? "text-[#43E600] font-black"
                          : isPassedOrActive
                            ? "text-[#45AFFF] font-medium"
                            : "text-white/40 font-normal"
                      }`}
                    >
                      {phase.label}
                    </span>
                    
                    {/* Small sub-indicator for additional polish */}
                    <span className="text-[7.5px] font-mono text-white/20 tracking-wider uppercase mt-0.5 hidden lg:block">
                      {phase.state === FlightState.NoIniciado ? "TIERRA" : phase.state === FlightState.PreEmbarque ? "PRE-FLT" : phase.state === FlightState.EnVuelo ? "EN VUELO" : "ARRIV"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW HEADER & PHASE TAG */}
      {currentState === FlightState.NoIniciado ? (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-[#3B7EB2]/50 pb-4 gap-4">
          <div>
            <h1 className="font-display font-extrabold text-3xl tracking-tight text-[#45AFFF]">
              {isFlightSettingsOpen ? "Ajustes del Vuelo" : "Vuelo Actual: No iniciado"}
            </h1>
          </div>
          {/* Action Buttons inside header for instant usability */}
          {!isFlightSettingsOpen && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Tooltip Wrapper for Import button */}
              <div className="relative group inline-block">
                <button
                  id="btn-import-simbrief-header"
                  type="button"
                  onClick={() => {
                    onTriggerBriefImport();
                    setIsBriefImported(true);
                    setCanStartFlight(true);
                  }}
                  className={`px-5 py-2.5 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] ${
                    !isBriefImported
                      ? "bg-[#43E600]/10 hover:bg-[#43E600]/20 text-[#43E600] border border-[#43E600] shadow-[0_0_15px_rgba(67,230,0,0.25)]"
                      : "bg-[#45AFFF]/15 hover:bg-[#45AFFF]/30 text-[#45AFFF] border border-[#45AFFF]/40 shadow"
                  }`}
                >
                  <Download className="w-4 h-4" />
                  Importar desde SimBrief
                </button>
                {/* Tooltip Popup */}
                <div className="absolute right-0 top-full mt-2 hidden group-hover:block w-72 p-3 bg-[#00172e] border border-[#3B7EB2] text-white text-xs rounded shadow-2xl z-50 animate-fadeIn pointer-events-none">
                  <p className="font-sans font-medium text-white/90 leading-relaxed text-left text-[11px]">
                    Crea y genera el plan de vuelo en SimBrief e impórtalo en Announce para comenzar de forma automatizada. El simulador detectará tu última sesión y cargará la información operativa de inmediato.
                  </p>
                  {/* Arrow pointing up */}
                  <div className="absolute bottom-full right-10 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-b-4 border-b-[#3B7EB2]"></div>
                </div>
              </div>

              <button 
                id="btn-cargar-vuelo-header"
                type="button"
                onClick={() => {
                  alert("Restaurando estado del simulador... Se cargó la sesión anterior de pasajeros.");
                  setCanStartFlight(true);
                  onStateChange(FlightState.EnVuelo);
                }}
                className="bg-[#e68b00]/15 hover:bg-[#e68b00]/30 text-[#ffb03a] border border-[#e68b00]/50 px-5 py-2.5 rounded-[5px] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow hover:scale-[1.01] active:scale-[0.99]"
              >
                <Save className="w-4 h-4" />
                Cargar Vuelo
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#001d35]/75 border border-[#3B7EB2]/40 rounded-[5px] p-5 shadow-xl animate-fadeIn flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 w-full">
          {/* Horizontal route details */}
          <div className="flex flex-col sm:flex-row flex-wrap items-center gap-6 flex-1 w-full md:w-auto">
            {/* Airline & Flight */}
            <div className="flex flex-col text-center sm:text-left shrink-0">
              <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                AEROLÍNEA Y VUELO
              </span>
              <span className="text-sm font-sans font-black text-white mt-1 uppercase">
                {airline || "Aerolínea Real"} • <span className="text-[#43E600]">{flightCode}</span>
              </span>
            </div>

            <div className="h-8 w-[1px] bg-white/10 hidden sm:block shrink-0" />

            {/* Origin */}
            <div className="flex flex-col text-center sm:text-left">
              <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                ORIGEN
              </span>
              <span className="text-sm font-sans font-black text-white mt-1 uppercase flex flex-col justify-center sm:justify-start">
                <span className="text-white">{originICAO}</span>
                <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{routeDetails.orgCity}, {routeDetails.orgCountry}</span>
                <span className="text-[10px] text-white/40 font-mono font-normal normal-case mt-0.5">({routeDetails.orgName})</span>
              </span>
            </div>

            {/* Arrow */}
            <div className="text-white/30 hidden sm:block mt-2">
              <ArrowRight className="w-4 h-4 text-[#45AFFF]" />
            </div>

            {/* Destination */}
            <div className="flex flex-col text-center sm:text-left">
              <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                DESTINO
              </span>
              <span className="text-sm font-sans font-black mt-1 uppercase flex flex-col justify-center sm:justify-start">
                <span className="text-[#43E600]">{destICAO}</span>
                <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{routeDetails.destCity}, {routeDetails.destCountry}</span>
                <span className="text-[10px] text-white/40 font-mono font-normal normal-case mt-0.5">({routeDetails.destName})</span>
              </span>
            </div>

            <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

            {/* Additional operational details */}
            <div className="grid grid-cols-2 gap-x-5 text-[10px] font-mono text-white/70 flex-1 pl-0 lg:pl-1 mt-1 sm:mt-0 w-full lg:w-auto">
              <div>
                <span className="text-white/40 block">AVIÓN COMERCIAL:</span>
                <span className="text-white font-bold">{simBriefData.avion || "Airbus A320"}</span>
              </div>
              <div>
                <span className="text-white/40 block">PASAJEROS:</span>
                <span className="text-sm font-sans font-black text-[#43E600]">{simBriefData.pasajerosCount || 142} PAX</span>
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
              currentState === FlightState.PreEmbarque && (
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

                  {boardedCount < passengers.length ? (
                    <button 
                      id="header-btn-toggle-boarding"
                      onClick={() => {
                        setIsBoardingActive(!isBoardingActive);
                        setBoardingStarted(true);
                      }}
                      className={`font-mono font-bold px-4 py-2 rounded-[5px] text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] shadow-md h-9 shrink-0 ${
                        isBoardingActive 
                          ? "bg-amber-500 hover:bg-amber-600 text-black shadow-[0_0_12px_rgba(245,158,11,0.2)]" 
                          : "bg-[#43E600] hover:bg-[#3bcc00] text-black shadow-[0_0_15px_rgba(67,230,0,0.3)] animate-pulse"
                      }`}
                    >
                      {isBoardingActive ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping" />
                          <Pause className="w-3.5 h-3.5" />
                          PAUSAR EMBARQUE
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-black" />
                          COMENZAR EMBARQUE
                        </>
                      )}
                    </button>
                  ) : (
                    <div 
                      id="header-label-listo-puertas"
                      className="bg-[#002440]/85 border border-[#43E600]/80 text-[#43E600] font-mono font-black px-4 py-2 rounded-[5px] text-xs flex items-center justify-center gap-2 h-9 shrink-0 shadow-[0_0_15px_rgba(67,230,0,0.2)] select-none"
                    >
                      <span className="w-2 h-2 rounded-full bg-[#43E600] animate-pulse" />
                      LISTO PARA CERRAR PUERTAS
                    </div>
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
          {isFlightSettingsOpen ? (
            <div id="pantalla-ajustes-vuelo" className="space-y-6 animate-fadeIn pb-8">
              
              {/* Horizontal route details banner maintained at the top */}
              {canStartFlight && (
                <div className="bg-[#001d35]/75 border border-[#3B7EB2]/40 rounded-[5px] p-5 shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 w-full">
                  {/* Horizontal route details */}
                  <div className="flex flex-col sm:flex-row flex-wrap items-center gap-6 flex-1 w-full md:w-auto">
                    {/* Airline & Flight */}
                    <div className="flex flex-col text-center sm:text-left shrink-0">
                      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                        AEROLÍNEA Y VUELO
                      </span>
                      <span className="text-sm font-sans font-black text-white mt-1 uppercase">
                        {airline || "Aerolínea Real"} • <span className="text-[#43E600]">{flightCode}</span>
                      </span>
                    </div>

                    <div className="h-8 w-[1px] bg-white/10 hidden sm:block shrink-0" />

                    {/* Origin */}
                    <div className="flex flex-col text-center sm:text-left">
                      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                        ORIGEN
                      </span>
                      <span className="text-sm font-sans font-black text-white mt-1 uppercase flex flex-col justify-center sm:justify-start">
                        <span className="text-white">{originICAO}</span>
                        <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{routeDetails.orgCity}, {routeDetails.orgCountry}</span>
                        <span className="text-[10px] text-white/40 font-mono font-normal normal-case mt-0.5">({routeDetails.orgName})</span>
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="text-white/30 hidden sm:block mt-2">
                      <ArrowRight className="w-4 h-4 text-[#45AFFF]" />
                    </div>

                    {/* Destination */}
                    <div className="flex flex-col text-center sm:text-left">
                      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                        DESTINO
                      </span>
                      <span className="text-sm font-sans font-black mt-1 uppercase flex flex-col justify-center sm:justify-start">
                        <span className="text-[#43E600]">{destICAO}</span>
                        <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{routeDetails.destCity}, {routeDetails.destCountry}</span>
                        <span className="text-[10px] text-white/40 font-mono font-normal normal-case mt-0.5">({routeDetails.destName})</span>
                      </span>
                    </div>

                    <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

                    {/* Additional operational details */}
                    <div className="grid grid-cols-2 gap-x-5 text-[10px] font-mono text-white/70 flex-1 pl-0 lg:pl-1 mt-1 sm:mt-0 w-full lg:w-auto">
                      <div>
                        <span className="text-white/40 block">AVIÓN COMERCIAL:</span>
                        <span className="text-white font-bold">{simBriefData.avion || "Airbus A320"}</span>
                      </div>
                      <div>
                        <span className="text-white/40 block">PASAJEROS:</span>
                        <span className="text-sm font-sans font-black text-[#43E600]">{simBriefData.pasajerosCount || 142} PAX</span>
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

                    <button
                      type="button"
                      onClick={() => {
                        setIsFlightSettingsOpen(false);
                        onStateChange(FlightState.PreEmbarque);
                      }}
                      className="bg-[#43E600] hover:bg-[#3cd000] text-black font-black px-5 py-2 rounded-[5px] text-xs font-mono flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(67,230,0,0.3)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
                    >
                      <Play className="w-3.5 h-3.5 fill-black" strokeWidth={3} />
                      Iniciar
                    </button>
                  </div>
                </div>
              )}

              {/* BLOQUE 1: Configuración de Voces, Idiomas, Acentos y Editables */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Voices Block - occupies 2 columns */}
                <div className="md:col-span-2 bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-5">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                    <Volume2 className="w-5 h-5 text-[#45AFFF]" />
                    <h3 className="font-display font-bold text-base text-[#45AFFF]">
                      Tripulación y Cabina
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    
                    {/* Comandante Column */}
                    <div className="space-y-4 bg-black/20 p-4 rounded border border-white/5">
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#43E600] uppercase block border-b border-white/5 pb-1">
                        Comandante de Vuelo
                      </span>
                      
                      <div>
                        <label className="block text-[11px] font-mono text-white/70 mb-1">VOZ DEL CAPITÁN:</label>
                        <select 
                          value={captainVoice}
                          onChange={(e) => setCaptainVoice(e.target.value)}
                          className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                        >
                          <option value="Alejandro (Voz IA)">Alejandro (Voz IA)</option>
                          <option value="Marcos (Voz IA)">Marcos (Voz IA)</option>
                          <option value="Gabriel (Voz IA)">Gabriel (Voz IA)</option>
                          <option value="Carlos (Voz IA)">Carlos (Voz IA)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono text-white/70 mb-1">IDIOMA PRIMARIO:</label>
                        <select 
                          value={captainLanguage}
                          onChange={(e) => setCaptainLanguage(e.target.value)}
                          className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                        >
                          <option value="Español (ES)">Español (ES)</option>
                          <option value="Español (AR)">Español (AR)</option>
                          <option value="Inglés (US)">Inglés (US)</option>
                          <option value="Inglés (UK)">Inglés (UK)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono text-white/70 mb-1">ACENTO DEL CAPITÁN:</label>
                        <select 
                          value={captainAccent}
                          onChange={(e) => setCaptainAccent(e.target.value)}
                          className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                        >
                          <option value="Rioplatense (AR)">Rioplatense (AR)</option>
                          <option value="Penínsular (ES)">Penínsular (ES)</option>
                          <option value="Neutro (LATAM)">Neutro (LATAM)</option>
                          <option value="Castellano standard">Castellano standard</option>
                          <option value="Americano (US)">Americano (US)</option>
                          <option value="Británico (UK)">Británico (UK)</option>
                        </select>
                      </div>
                    </div>

                    {/* Tripulación de Cabina Column */}
                    <div className="space-y-4 bg-black/20 p-4 rounded border border-white/5">
                      <span className="text-[10px] font-mono font-extrabold tracking-widest text-[#45AFFF] uppercase block border-b border-white/5 pb-1">
                        Servicio y Cabina (TCP)
                      </span>

                      <div>
                        <label className="block text-[11px] font-mono text-white/70 mb-1">VOZ DE TRIPULACIÓN:</label>
                        <select 
                          value={crewVoice}
                          onChange={(e) => setCrewVoice(e.target.value)}
                          className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none"
                        >
                          <option value="Sofía (Voz IA)">Sofía (Voz IA)</option>
                          <option value="Mariana (Voz IA)">Mariana (Voz IA)</option>
                          <option value="Camila (Voz IA)">Camila (Voz IA)</option>
                          <option value="Laura (Voz IA)">Laura (Voz IA)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono text-white/70 mb-1">IDIOMA SECUNDARIO:</label>
                        <select 
                          value={crewLanguage}
                          onChange={(e) => setCrewLanguage(e.target.value)}
                          className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                        >
                          <option value="Ninguno">Ninguno</option>
                          <option value="Español (ES)">Español (ES)</option>
                          <option value="Español (AR)">Español (AR)</option>
                          <option value="Inglés (US)">Inglés (US)</option>
                          <option value="Inglés (UK)">Inglés (UK)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono text-white/70 mb-1">ACENTO DE TRIPULACIÓN:</label>
                        <select 
                          value={crewAccent}
                          onChange={(e) => setCrewAccent(e.target.value)}
                          className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF]"
                        >
                          <option value="Rioplatense (AR)">Rioplatense (AR)</option>
                          <option value="Penínsular (ES)">Penínsular (ES)</option>
                          <option value="Neutro (LATAM)">Neutro (LATAM)</option>
                          <option value="Castellano standard">Castellano standard</option>
                          <option value="Americano (US)">Americano (US)</option>
                          <option value="Británico (UK)">Británico (UK)</option>
                        </select>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Editables Block - occupies 1 column */}
                <div className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                      <Plane className="w-5 h-5 text-[#45AFFF]" />
                      <h3 className="font-display font-bold text-base text-[#45AFFF]">
                        Identificaciones
                      </h3>
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1 uppercase">Aerolínea:</label>
                      <input 
                        type="text"
                        value={airline}
                        onChange={(e) => setAirline(e.target.value)}
                        placeholder="P.e: Aerolíneas Argentinas"
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1 uppercase">Ciudad de Origen:</label>
                      <input 
                        type="text"
                        value={originCityName}
                        onChange={(e) => setOriginCityName(e.target.value)}
                        placeholder="P.e: Buenos Aires"
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-white/70 mb-1 uppercase">Ciudad de Destino:</label>
                      <input 
                        type="text"
                        value={destCityName}
                        onChange={(e) => setDestCityName(e.target.value)}
                        placeholder="P.e: Córdoba"
                        className="w-full bg-[#00345C] border border-[#3B7EB2] text-white rounded-[5px] p-2 text-xs focus:outline-none focus:border-[#45AFFF] placeholder-white/20 font-bold"
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* BLOQUE 2: Eventos Especiales */}
              <div className="bg-[#00172e]/85 border border-[#3B7EB2]/45 rounded-[8px] p-5 shadow-lg space-y-4">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <Sparkles className="w-5 h-5 text-[#45AFFF]" />
                  <h3 className="font-display font-bold text-base text-[#45AFFF]">
                    Eventos Especiales en Cabina
                  </h3>
                </div>

                <div className="space-y-2">
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
                    placeholder="Escribe algún acontecimiento imprevisto o evento que deba anunciarse a bordo..."
                    className="w-full bg-[#002440]/60 border border-[#3B7EB2]/60 rounded-[5px] p-3 text-xs text-white placeholder-white/30 font-sans focus:outline-none resize-none leading-relaxed focus:border-[#45AFFF]"
                  />
                  <p className="text-[11px] text-[#45AFFF]/70 italic leading-snug bg-black/20 p-2 border border-white/5 rounded">
                    <strong className="text-[#43E600] not-italic font-mono uppercase tracking-wider text-[9px] mr-1 border border-[#43E600]/30 px-1 py-0.5 rounded bg-[#43E600]/5">Hint:</strong> 
                    Hoy nos acompaña en el vuelo el reciente campeon del master mil de roma. Demosle nuestras felicitaciones.
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
              <div className="flex flex-col sm:flex-row flex-wrap items-center gap-6 flex-1 w-full md:w-auto">
                {/* Airline & Flight */}
                <div className="flex flex-col text-center sm:text-left shrink-0">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                    AEROLÍNEA Y VUELO
                  </span>
                  <span className="text-sm font-sans font-black text-white mt-1 uppercase">
                    {airline || "Aerolínea Real"} • <span className="text-[#43E600]">{flightCode}</span>
                  </span>
                </div>

                <div className="h-8 w-[1px] bg-white/10 hidden sm:block shrink-0" />

                {/* Origin */}
                <div className="flex flex-col text-center sm:text-left">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                    ORIGEN
                  </span>
                  <span className="text-sm font-sans font-black text-white mt-1 uppercase flex flex-col justify-center sm:justify-start">
                    <span className="text-white">{originICAO}</span>
                    <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{routeDetails.orgCity}, {routeDetails.orgCountry}</span>
                    <span className="text-[10px] text-white/40 font-mono font-normal normal-case mt-0.5">({routeDetails.orgName})</span>
                  </span>
                </div>

                {/* Arrow */}
                <div className="text-white/30 hidden sm:block mt-2">
                  <ArrowRight className="w-4 h-4 text-[#45AFFF]" />
                </div>

                {/* Destination */}
                <div className="flex flex-col text-center sm:text-left">
                  <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
                    DESTINO
                  </span>
                  <span className="text-sm font-sans font-black mt-1 uppercase flex flex-col justify-center sm:justify-start">
                    <span className="text-[#43E600]">{destICAO}</span>
                    <span className="text-[11px] text-[#45AFFF] normal-case font-semibold">{routeDetails.destCity}, {routeDetails.destCountry}</span>
                    <span className="text-[10px] text-white/40 font-mono font-normal normal-case mt-0.5">({routeDetails.destName})</span>
                  </span>
                </div>

                <div className="h-8 w-[1px] bg-white/10 hidden lg:block shrink-0" />

                {/* Additional operational details */}
                <div className="grid grid-cols-2 gap-x-5 text-[10px] font-mono text-white/70 flex-1 pl-0 lg:pl-1 mt-1 sm:mt-0 w-full lg:w-auto">
                  <div>
                    <span className="text-white/40 block">AVIÓN COMERCIAL:</span>
                    <span className="text-white font-bold">{simBriefData.avion || "Airbus A320"}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">PASAJEROS:</span>
                    <span className="text-sm font-sans font-black text-[#43E600]">{simBriefData.pasajerosCount || 142} PAX</span>
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
                  Iniciar Vuelo
                </button>
                <button
                  onClick={() => {
                    onTriggerBriefImport();
                    setIsBriefImported(true);
                    setCanStartFlight(true);
                  }}
                  className="text-[10px] text-[#45AFFF] hover:underline flex items-center gap-1 cursor-pointer font-mono font-bold"
                >
                  <Download className="w-3 h-3" />
                  Volver a importar
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
                  Configurar Eventos
                </h3>
              </div>
              <div id="package-selector-container" className="flex items-center gap-3 bg-black/30 border border-white/10 rounded-[5px] px-3 py-1.5 shrink-0 max-w-full overflow-x-auto">
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
                <button
                  type="button"
                  onClick={() => setShowPackageManager(true)}
                  className="text-[#45AFFF] hover:text-[#43E600] text-[10px] font-mono font-bold hover:underline cursor-pointer border-l border-white/10 pl-2 shrink-0 transition-colors"
                >
                  [ Administrar ]
                </button>
              </div>
            </div>

            <p className="text-xs text-white/80 leading-relaxed">
              Selecciona el tipo de anunciador para cada evento regulado que ocurrirá durante el vuelo:
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
                  {group.label}
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
                      title={item.deep}
                      className={`group relative bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col sm:flex-row justify-between gap-4 transition-all ${
                        item.key === "play_boarding_music" && currentValue ? "sm:items-start" : "sm:items-center"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0 pr-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-sans font-bold text-white leading-normal tracking-wide">
                            {item.brief}
                          </span>
                          <span className="text-[#45AFFF] hover:text-[#43E600] transition-colors cursor-help shrink-0 relative">
                            <Info className="w-3.5 h-3.5" />
                            {/* Hover Tooltip bubble inside the group - rendered cleanly downwards so it never slips behind the persistent group tabs container */}
                            <div className="invisible group-hover:visible absolute top-full left-1/2 -translate-x-1/2 mt-2.5 w-64 p-3 bg-[#01172e] border border-[#3B7EB2] text-[11px] text-white/90 leading-relaxed font-sans rounded shadow-2xl z-50 pointer-events-none font-normal">
                              <span className="text-[#43E600] font-bold block mb-1 uppercase text-[9px] tracking-wider">Detalles de Inmersión</span>
                              {item.deep}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-b-4 border-b-[#3B7EB2]"></div>
                            </div>
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-white/45 uppercase block tracking-wider">
                          Def: <strong className="text-[#43E600]/80">Activo (Sí)</strong>
                        </span>
                        {item.key === "play_boarding_music" && currentValue && (
                          <div className="mt-3 space-y-1" onClick={(e) => e.stopPropagation()}>
                            <label className="block text-[10px] font-mono text-white/70 uppercase tracking-wider">
                              Tema a reproducir:
                            </label>
                            <select
                              value={boardingMusicTrack}
                              onChange={(e) => setBoardingMusicTrack(e.target.value)}
                              className="w-full max-w-[240px] bg-[#00172e] border border-[#3B7EB2]/50 text-white rounded-[4px] px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#45AFFF]"
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
                          Sí
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
                          No
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                getFilteredEvents().map((item) => {
                  const currentValue = eventConfig[item.key] || "IA";

                  return (
                    <div 
                      key={item.key} 
                      className="bg-[#002440]/45 hover:bg-[#002440]/75 border border-[#3B7EB2]/20 hover:border-[#3B7EB2]/40 p-4 rounded-[6px] flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all"
                    >
                      <div className="space-y-1 my-1 flex-1 min-w-0 pr-1">
                        <span className="text-[12.5px] font-sans font-medium text-white/95 leading-normal block">
                          {item.desc}
                        </span>
                        {/* Narrator Display below description */}
                        <div className="flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-wider text-white/50 mt-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${item.narrator === "Capitán" ? "bg-[#e68b00]" : "bg-[#45AFFF]"}`}></span>
                          <span>NARRADOR: <strong className={item.narrator === "Capitán" ? "text-[#ffb340]" : "text-[#45AFFF]"}>{item.narrator}</strong></span>
                        </div>
                      </div>

                      {/* Selector Mode Pill */}
                      <div className="flex bg-black/60 border border-white/15 rounded-[4px] p-0.5 shrink-0 h-fit max-w-[150px] w-full justify-between">
                        {(["off", "pack", "IA"] as const).map((mode) => {
                          const isSelected = currentValue === mode;
                          const isPackModeDisabled = mode === "pack" && !selectedPackage;
                          let activeStyle = "text-white/30 border-transparent hover:text-white/60 text-[9px]";
                          if (isSelected) {
                            if (mode === "off") activeStyle = "bg-red-500/20 text-red-300 border-red-500/35 font-extrabold shadow-sm text-[9px]";
                            if (mode === "pack") activeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40 font-extrabold shadow-sm text-[9px]";
                            if (mode === "IA") activeStyle = "bg-sky-500/20 text-sky-400 border-[#45AFFF]/35 font-extrabold shadow-sm text-[9px]";
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
                    <span>MSFS GATE MONITOR</span>
                    <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-white/70 font-mono tracking-normal">
                      {showSecondaryLang ? (crewLanguage || "Ninguno").toUpperCase() : (captainLanguage || "Español (ES)").toUpperCase()}
                    </span>
                  </span>
                  <span className="text-[#43E600] flex items-center gap-1.5 font-sans">
                    <span className="w-2 h-2 rounded-full bg-[#43E600] animate-pulse" />
                    {getBoardingText("EMBARQUE ABIERTO", "BOARDING OPEN")}
                  </span>
                  <span>{new Date().toLocaleDateString('es-ES', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}</span>
                </div>
                
                {/* Fila 2: Origen / Destino */}
                <div className="grid grid-cols-3 gap-4 border-b border-white/20 py-3 flex-1 items-center">
                  <div className="col-span-2">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5">
                      {getBoardingText("SALIENDO HACIA:", "DEPARTING TO:")}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-sans font-black tracking-tight text-white uppercase">{routeDetails.destCity}</h2>
                    <span className="text-[10px] text-white/60 font-mono tracking-wider">({destICAO}) • {routeDetails.destCountry}</span>
                  </div>
                  <div className="border-l border-white/20 pl-4">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5">
                      {getBoardingText("VUELO:", "FLIGHT:")}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-mono font-black text-amber-400">{flightCode}</h2>
                    <span className="text-[10px] text-white/60 font-mono tracking-wider">{airline}</span>
                  </div>
                </div>

                {/* Fila 3: Estado de Embarque / Temperatura */}
                <div className="grid grid-cols-3 gap-4 border-b border-white/20 py-2.5 flex-1 items-center">
                  <div className="col-span-2">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5">
                      {getBoardingText("ESTADO:", "STATUS:")}
                    </span>
                    <h3 className={`text-xl sm:text-2xl font-sans font-black tracking-tight ${isBoardingActive ? "text-amber-400 animate-pulse" : boardedCount >= passengers.length ? "text-[#43E600]" : "text-[#45AFFF]"}`}>
                      {isBoardingActive 
                        ? getBoardingText("EMBARCANDO", "BOARDING") 
                        : boardedCount >= passengers.length 
                          ? getBoardingText("EMBARQUE CERRADO", "BOARDING CLOSED") 
                          : getBoardingText("A TIEMPO / LISTO", "ON TIME / READY")}
                    </h3>
                  </div>
                  <div className="border-l border-white/20 pl-4">
                    <span className="block text-[8px] font-mono text-white/50 tracking-widest uppercase font-extrabold truncate mb-0.5">
                      {getBoardingText("CLIMA EN", "WEATHER IN")} {routeDetails.destCity.toUpperCase()}:
                    </span>
                    <div className="text-[10px] font-mono text-white/95 mt-1">
                      <div className="flex justify-between gap-1">
                        <span>{getBoardingText("DESPEJADO:", "FAIR:")}</span> 
                        <span className="text-[#43E600] font-bold">18°C</span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span>{getBoardingText("VIENTO:", "WIND:")}</span> 
                        <span>8 KT W</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fila 4: Horarios */}
                <div className="grid grid-cols-3 gap-4 pt-2.5 items-center">
                  <div className="col-span-2">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5">
                      {getBoardingText("SALIDA ESTIMADA:", "ESTIMATED DEPARTURE:")}
                    </span>
                    <strong className="text-sm sm:text-base font-mono tracking-wider text-white">
                      12:45 UTC <span className="text-white/40 font-normal">
                        ({simBriefData.blockTime ? (getBoardingText("ETA EN ", "ETA IN ") + simBriefData.blockTime) : "75 MIN"})
                      </span>
                    </strong>
                  </div>
                  <div className="border-l border-white/20 pl-4">
                    <span className="block text-[9px] font-mono text-white/50 tracking-widest uppercase font-extrabold mb-0.5">
                      {getBoardingText("PASAJEROS:", "PASSENGERS:")}
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
                {passengers.map((p, idx) => {
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
                  <span className={`w-1.5 h-1.5 rounded-full ${lastAnnouncement?.reproduciendo ? 'bg-[#43E600]' : 'bg-white/20'}`} />
                  <span className="text-[8px] font-mono text-white/30">{lastAnnouncement?.reproduciendo ? 'ON AIR' : 'MUTED'}</span>
                </div>
                
                <p className="text-white/95 italic leading-relaxed pt-1.5">
                  "{lastAnnouncement ? lastAnnouncement.texto : 'Seleccione o simule un anuncio para emitirlo a los altavoces de la cabina.'}"
                </p>
                
                <div className="mt-3 pt-2.5 border-t border-white/15 flex justify-between items-center text-[9.5px] font-mono text-white/50">
                  {(() => {
                    const isCaptain = lastAnnouncement && ["bienvenida", "turbulencia", "descenso", "aterrizaje"].includes(lastAnnouncement.tipo);
                    const name = lastAnnouncement 
                      ? (isCaptain ? (simBriefData.nombrePiloto || "N. Sassano") : "Sofía Martínez") 
                      : (simBriefData.nombrePiloto || "N. Sassano");
                    const role = lastAnnouncement 
                      ? (isCaptain ? "Capitán" : "Tripulación de Cabina") 
                      : "Capitán";
                    
                    return (
                      <>
                        <span>NARRACIÓN: <strong className="text-white font-bold">{name}</strong></span>
                        <span className="text-[#45AFFF] uppercase font-black text-[8px] tracking-wider bg-[#45AFFF]/10 px-1.5 py-0.5 rounded border border-[#45AFFF]/20">{role}</span>
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
                  const isCaptainSpeaking = lastAnnouncement && lastAnnouncement.reproduciendo && 
                    (lastAnnouncement.tipo === "bienvenida" || lastAnnouncement.tipo === "turbulencia" || lastAnnouncement.tipo === "descenso" || lastAnnouncement.tipo === "aterrizaje");
                  
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
                            {simBriefData.nombrePiloto || "N. Sassano"}
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
                  const isCrewSpeaking = lastAnnouncement && lastAnnouncement.reproduciendo && 
                    (lastAnnouncement.tipo === "seguridad" || lastAnnouncement.tipo === "desembarque");
                  
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
                            Sofía Martínez
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
                    <span>TEMA: {boardingMusicTrack}</span>
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
            
            {/* Último Anuncio Inteligente */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-3">
              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-1.5 font-bold">
                  <Radio className="w-4 h-4 text-[#43E600]" /> Último anuncio
                </h3>
              </div>
              
              <div className="bg-black/45 p-3.5 rounded-[5px] border border-[#3B7EB2]/30 text-xs font-sans relative overflow-hidden">
                <div className="absolute top-1 right-2 animate-pulse flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${p26Announcement?.reproduciendo ? 'bg-[#43E600]' : 'bg-white/20'}`} />
                  <span className="text-[8px] font-mono text-white/30">{p26Announcement?.reproduciendo ? 'ON AIR' : 'MUTED'}</span>
                </div>
                
                <p className="text-white/95 italic leading-relaxed pt-1.5 font-medium">
                  "{p26Announcement ? p26Announcement.texto : 'Seleccione o simule un anuncio para emitirlo a los altavoces de la cabina.'}"
                </p>
                
                <div className="mt-3 pt-2.5 border-t border-white/15 flex justify-between items-center text-[9.5px] font-mono text-white/50">
                  {(() => {
                    const isCaptain = p26Announcement && ["bienvenida", "turbulencia", "descenso", "aterrizaje"].includes(p26Announcement.tipo);
                    const name = p26Announcement 
                      ? (isCaptain ? (simBriefData.nombrePiloto || "N. Sassano") : "Sofía Martínez") 
                      : (simBriefData.nombrePiloto || "N. Sassano");
                    const role = p26Announcement 
                      ? (isCaptain ? "Capitán" : "Tripulación de Cabina") 
                      : "Capitán";
                    
                    return (
                      <>
                        <span>NARRACIÓN: <strong className="text-white font-bold">{name}</strong></span>
                        <span className="text-[#45AFFF] uppercase font-black text-[8px] tracking-wider bg-[#45AFFF]/10 px-1.5 py-0.5 rounded border border-[#45AFFF]/20">{role}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Tripulación al Mando */}
            <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-4 text-white">
              <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2 font-bold">
                Canales de Voz de Tripulación
              </h3>
              
              <div className="space-y-3">
                {/* Captain Card */}
                {(() => {
                  const isCaptainSpeaking = p26Announcement && p26Announcement.reproduciendo && 
                    (p26Announcement.tipo === "bienvenida" || p26Announcement.tipo === "turbulencia" || p26Announcement.tipo === "descenso" || p26Announcement.tipo === "aterrizaje");
                  
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
                            {simBriefData.nombrePiloto || "N. Sassano"}
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
                  const isCrewSpeaking = p26Announcement && p26Announcement.reproduciendo && 
                    (p26Announcement.tipo === "seguridad" || p26Announcement.tipo === "desembarque");
                  
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
                          <span className="text-[10px] font-mono text-white/45 block uppercase font-bold">Jefe de Tripulación</span>
                          <span className={`text-[12px] font-sans font-black tracking-wide ${isCrewSpeaking ? 'text-[#43E600]' : 'text-white'}`}>
                            Sofía Martínez
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
        />
      )}

    </div>
  );
}
