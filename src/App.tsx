/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  FlightState, 
  Pasajero, 
  VueloReciente, 
  Logro, 
  SimBriefData, 
  ConfigVoces, 
  ConfigAudio, 
  UltimoAnuncio,
  Incidencia
} from "./types";
import { 
  vuelosRecientes as initialVuelos, 
  listaLogros as initialLogros, 
  pasajerosMock as initialPassengers, 
  defaultSimBrief, 
  defaultVocesConfig, 
  defaultAudioConfig, 
  anunciosSimulados 
} from "./mockData";

import Sidebar from "./components/Sidebar";
import HubView from "./components/HubView";
import ConfigView from "./components/ConfigView";
import VueloActualView from "./components/VueloActualView";
// TEMPORAL sandbox rediseño FLY (/fly-v2 → "vuelo-v2"). No usar en producción.
import FlyPageV2 from "./pages/FlyPageV2";
import { useToast } from "./components/Toast";
import i18n from "./lib/i18n";
import { checkForUpdatesCached } from "./services/AppUpdaterService";
import { handleAuthDeepLink, isDesktop } from "./services/desktopAuth";

export default function App() {
  // Navigation & Simulation states
  const [currentView, setCurrentView] = useState<string>("hub"); // Default is Hub View ("Hub del Usuario") to showcase the custom mock login first
  const [currentState, setCurrentState] = useState<FlightState>(FlightState.NoIniciado); // Default is No Iniciado for the refined flow
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false); // Start prototype in Disconnected Mode (Estado Desconectado) as requested
  // Sidebar colapsada por defecto al entrar a "Vuelo Actual" (más espacio al vuelo).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  // `vuelo` = vista estable (/fly). `vuelo-v2` = sandbox temporal (/fly-v2).
  const isVueloView = currentView === "vuelo" || currentView === "vuelo-v2";

  useEffect(() => {
    if (currentView === "vuelo" || currentView === "vuelo-v2") {
      setSidebarCollapsed(true);
    }
  }, [currentView]);
  
  // Keep-alive de la vista de vuelo: una vez visitada se mantiene montada y
  // solo se oculta (display:none) al navegar a otra vista. Sin esto, ir a
  // Config desmontaba VueloActualView y destruía todos los motores (pasajeros,
  // scheduler, telemetría...); al volver se remontaba virgen sin rehidratar
  // y todo quedaba en nulos ("sin muestra activa").
  const [vueloAlive, setVueloAlive] = useState(false);
  useEffect(() => {
    if (currentView === "vuelo") {
      setVueloAlive(true);
    }
  }, [currentView]);
  // TEMPORAL sandbox (/fly-v2): keep-alive independiente para no interferir
  // con los motores de la vista estable `vuelo`.
  const [vueloV2Alive, setVueloV2Alive] = useState(false);
  useEffect(() => {
    if (currentView === "vuelo-v2") {
      setVueloV2Alive(true);
    }
  }, [currentView]);
  
  const { showToast } = useToast();

  // Deep links de escritorio (Tauri): `announs://auth/callback?code=...`
  // tras el login con Google en el navegador externo. Se escucha en
  // caliente (onOpenUrl) y se revisa el arranque en frío (getCurrent).
  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const onUrl = async (url: string | string[]) => {
      const urls = Array.isArray(url) ? url : [url];
      for (const u of urls) {
        if (await handleAuthDeepLink(u)) {
          if (!cancelled) {
            setIsLoggedIn(true);
            setCurrentView("hub");
          }
          break;
        }
      }
    };
    void (async () => {
      try {
        const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        unlisten = await onOpenUrl(onUrl);
      } catch {
        return;
      }
      try {
        const { getCurrent } = await import("@tauri-apps/plugin-deep-link");
        const initial = await getCurrent();
        if (initial) await onUrl(initial);
      } catch {
        // Sin URL inicial: arranque normal.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Verificación silenciosa de actualizaciones al arrancar (solo escritorio):
  // si hay una versión nueva, aviso sutil vía toast; sin red o sin endpoint
  // configurado no se muestra nada.
  useEffect(() => {
    let cancelled = false;
    void checkForUpdatesCached()
      .then((res) => {
        if (!cancelled && res) {
          showToast(i18n.t("config.updater_available_toast", { version: res.availableVersion }), "info");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Storage states
  const [vuelos, setVuelos] = useState<VueloReciente[]>(initialVuelos);
  const [logros, setLogros] = useState<Logro[]>(initialLogros);
  const [passengers, setPassengers] = useState<Pasajero[]>(initialPassengers);
  const [simBrief, setSimBrief] = useState<SimBriefData>(defaultSimBrief);
  // OFP crudo de SimBrief: lo necesitan el monitor, la detección de crucero,
  // los horarios y el setup de Fly v2. Viaja junto al `SimBriefData` mapeado
  // y se limpia con él.
  const [simbriefRaw, setSimbriefRaw] = useState<any>(null);
  const [voicesConfig, setVoicesConfig] = useState<ConfigVoces>(defaultVocesConfig);
  const [audioConfig, setAudioConfig] = useState<ConfigAudio>(defaultAudioConfig);
  const [copilotVolume, setCopilotVolume] = useState<number>(defaultVocesConfig.volumenVoz);
  
  // Live simulated alerts & announcements
  const [lastAnnouncement, setLastAnnouncement] = useState<UltimoAnuncio | null>(null);
  const [selectedPasajero, setSelectedPasajero] = useState<Pasajero | null>(null);
  const [landingFpm, setLandingFpm] = useState<number>(-125); // fpm rate
  const [isConnected, setIsConnected] = useState<boolean>(true);
  // Vuelo recién finalizado pendiente de mostrar en su pantalla de detalle
  // (Hub). Se consume una sola vez al abrir el detalle.
  const [pendingDetailFlight, setPendingDetailFlight] = useState<VueloReciente | null>(null);
  // Pestaña con la que debe abrir el Hub (overview por defecto; "account"
  // cuando se viene del aviso de Pilot ID de SimBrief).
  const [hubInitialTab, setHubInitialTab] = useState<"overview" | "stats" | "passport" | "campaigns" | "account">("overview");

  /** Va al Hub directo a la pestaña de cuenta (Pilot ID de SimBrief, perfil). */
  const goHubAccount = () => {
    setHubInitialTab("account");
    setCurrentView("hub");
  };

  // Force Hub view if pilot logs out or session is disconnected.
  // Misma protección de autenticación para `vuelo` (/fly) y `vuelo-v2` (/fly-v2).
  useEffect(() => {
    if (!isLoggedIn) {
      setCurrentView("hub");
      // Sin sesión no hay vuelo vivo: soltar el keep-alive también.
      setVueloAlive(false);
      setVueloV2Alive(false);
    }
  }, [isLoggedIn]);

  // Sync volume with voices parameter changes
  useEffect(() => {
    setCopilotVolume(voicesConfig.volumenVoz);
  }, [voicesConfig.volumenVoz]);

  const handleCopilotVolumeChange = (v: number) => {
    setCopilotVolume(v);
    setVoicesConfig(prev => ({ ...prev, volumenVoz: v }));
  };

  // Automated announcements simulated scheduler
  const triggerAnnouncement = (tipo: "bienvenida" | "seguridad" | "turbulencia" | "descenso" | "aterrizaje") => {
    const anuncioTemplate = anunciosSimulados.find(a => a.tipo === tipo);
    if (anuncioTemplate) {
      const nuevoAnuncio: UltimoAnuncio = {
        ...anuncioTemplate,
        reproduciendo: true
      };
      setLastAnnouncement(nuevoAnuncio);

      // Play sound effects logically or simulate audio finish
      setTimeout(() => {
        setLastAnnouncement(prev => prev && prev.tipo === tipo ? { ...prev, reproduciendo: false } : prev);
      }, anuncioTemplate.duracion * 1000);
      
      // Auto-unlock SimBrief achievements upon welcoming
      if (tipo === "bienvenida") {
        setLogros(prev => prev.map(l => l.id === "l-4" ? { ...l, unlocked: true } : l));
      }
    }
  };

  // Simulates cabin stressors and services live to modify passenger biométrica states
  const handleSimulateAction = (action: string) => {
    const timestamp = "00:" + Math.floor(Math.random() * 20 + 5).toString().padStart(2, "0");
    
    setPassengers(prev => prev.map(p => {
      let miedoDiff = 0;
      let satisfaccionDiff = 0;
      let hambreDiff = 0;
      let banoDiff = 0;
      let incident: Incidencia | null = null;

      if (action === "turbulencia") {
        // High panic, low satisfaction
        miedoDiff = Math.floor(Math.random() * 20 + 15); // +15% to 35%
        satisfaccionDiff = -Math.floor(Math.random() * 15 + 10); // -10% to 25%
        incident = {
          id: `inc-${p.id}-${Date.now()}`,
          tiempo: timestamp,
          tipo: "turbulencia",
          titulo: "Turbulencia / Pozo de Aire",
          descripcion: "Un bache térmico brusco sacudió el fuselaje, provocando derrames de líquidos y pánico moderado.",
          impactoMiedo: miedoDiff,
          impactoSatisfaccion: satisfaccionDiff
        };
      } else if (action === "servicio_comida") {
        // Satisfies hunger, high satisfaction
        hambreDiff = -Math.floor(Math.random() * 40 + 30); // hunger falls by 30-70%
        satisfaccionDiff = Math.floor(Math.random() * 15 + 10); // +10% to 25%
        incident = {
          id: `inc-${p.id}-${Date.now()}`,
          tiempo: timestamp,
          tipo: "servicio",
          titulo: "Servicio de Coche (Café / Catering)",
          descripcion: "La tripulación ofreció café caliente y alfajores de maicena en miniatura gratuitos.",
          impactoMiedo: -5,
          impactoSatisfaccion: satisfaccionDiff
        };
      } else if (action === "bano") {
        // Solves urgent bathroom issues
        banoDiff = -Math.floor(Math.random() * 50 + 40); // urgency reduced
        satisfaccionDiff = 8;
        incident = {
          id: `inc-${p.id}-${Date.now()}`,
          tiempo: timestamp,
          tipo: "satisfaccion",
          titulo: "Habilitación de Sanitarios",
          descripcion: "Se habilitó la señal del baño delantero y trasero, disminuyendo el malestar corporal.",
          impactoMiedo: 0,
          impactoSatisfaccion: 8
        };
      } else if (action === "reasegurar") {
        // Captain addresses passengers, reduce panic significantly
        miedoDiff = -Math.floor(Math.random() * 25 + 15); // -15% to 40%
        satisfaccionDiff = 6;
        incident = {
          id: `inc-${p.id}-${Date.now()}`,
          tiempo: timestamp,
          tipo: "info",
          titulo: "Discurso del Comandante",
          descripcion: "El comandante transmitió tranquilidad explicando los vientos de cola estables de manera clara.",
          impactoMiedo: miedoDiff,
          impactoSatisfaccion: satisfaccionDiff
        };
      }

      // Calculate final clamped values
      const postMiedo = Math.max(0, Math.min(100, p.miedo + miedoDiff));
      const postSat = Math.max(0, Math.min(100, p.satisfaccion + satisfaccionDiff));
      const postHambre = Math.max(0, Math.min(100, p.hambre + hambreDiff));
      const postBano = Math.max(0, Math.min(100, p.bano + banoDiff));

      return {
        ...p,
        miedo: postMiedo,
        satisfaccion: postSat,
        hambre: postHambre,
        bano: postBano,
        incidencias: incident ? [incident, ...p.incidencias] : p.incidencias
      };
    }));

    // Unlock an achievement if someone gets exceptionally calm after panic
    if (action === "reasegurar") {
      setLogros(prev => prev.map(l => l.id === "l-6" ? { ...l, unlocked: true } : l));
    }
  };

  // SimBrief Dynamic dispatch import simulation
  const handleTriggerBriefImport = (realData?: any, rawData?: any) => {
    if (realData) {
      setSimBrief(realData);
      // Sin crudo (p. ej. importación de la vista estable) se invalida el
      // anterior para no mezclar horarios de otro plan.
      setSimbriefRaw(rawData ?? null);
    } else {
      // Sin plan real: volver al estado vacío (no hay vuelo de demo).
      setSimBrief(defaultSimBrief);
      setSimbriefRaw(null);
    }
    // Trigger achievement "Primer Oficial de SimBrief"
    setLogros(prev => prev.map(l => l.id === "l-4" ? { ...l, unlocked: true, fechaDesbloqueo: "05 Jun 2026" } : l));
  };

  // Reset core simulation loop. Si se recibe el vuelo recién finalizado
  // (con `flightId`), se navega a su pantalla de detalle en el Hub; si no,
  // se vuelve al inicio de "volar" como antes.
  const handleResetSimulation = (finishedFlight?: VueloReciente | null) => {
    setPassengers(initialPassengers);
    setLandingFpm(-125);
    setCurrentState(FlightState.NoIniciado);
    setLastAnnouncement(null);
    // Soltar el keep-alive: la próxima visita a "vuelo" remonta en fresco
    // (motores/buffers reseteados), como antes del keep-alive.
    setVueloAlive(false);
    if (finishedFlight?.flightId) {
      setPendingDetailFlight(finishedFlight);
      setCurrentView("hub");
    } else {
      setCurrentView("vuelo");
    }
  };

  return (
    <div className="flex bg-[#00345C] min-h-screen text-white select-none">
      
      {/* 1. LEFT NAVIGATION SIDEBAR */}
      <Sidebar 
        currentView={currentView}
        onViewChange={(view) => {
          if (view === "hub") setHubInitialTab("overview");
          setCurrentView(view);
          // If viewing passengers, make sure we close the slide-over
          setSelectedPasajero(null);
        }}
        isConnected={isConnected}
        activeFlightCode={simBrief.vueloCodigo}
        copilotVolume={copilotVolume}
        isLoggedIn={isLoggedIn}
        collapsed={isVueloView ? sidebarCollapsed : false}
        onToggleCollapsed={isVueloView ? () => setSidebarCollapsed(v => !v) : undefined}
      />

      {/* 2. RIGHT MAIN CONTENT FRAMEWORK WITH OVERFLOW AND SMOOTH PADDING.
          Sandbox fly-v2 a ancho completo (del sidebar al borde derecho, sin
          max-width ni padding del marco: cada pantalla del sandbox trae su
          propio spacing). El resto de vistas conserva el marco original. */}
      <main
        id="main-frame-right"
        className={
          currentView === "vuelo-v2"
            ? "flex-1 overflow-y-auto w-full min-w-0"
            : "flex-1 p-6 lg:p-8 overflow-y-auto max-w-7xl mx-auto w-full"
        }
      >
        
        {/* Dynamic viewport rendering based on Navigation tab states */}
        {currentView === "hub" && (
          <HubView 
            vuelos={vuelos}
            logros={logros}
            onStartFlightShortcut={() => setCurrentView("vuelo")}
            isLoggedIn={isLoggedIn}
            onLogin={() => setIsLoggedIn(true)}
            onLogout={() => setIsLoggedIn(false)}
            initialSubView={hubInitialTab}
            pendingDetailFlight={pendingDetailFlight}
            onDetailFlightConsumed={() => setPendingDetailFlight(null)}
          />
        )}

        {vueloAlive && (
          <div
            id="vuelo-keepalive"
            style={{ display: currentView === "vuelo" ? undefined : "none" }}
          >
          <VueloActualView 
            currentState={currentState}
            onStateChange={(state) => {
              setCurrentState(state);
              // Trigger automatic announcement cues
              if (state === FlightState.PreEmbarque) {
                triggerAnnouncement("bienvenida");
              } else if (state === FlightState.Aterrizado) {
                triggerAnnouncement("aterrizaje");
                // Auto append flight to vuelos list
                const nuevoVuelo: VueloReciente = {
                  id: `v-${vuelos.length + 1}`,
                  codigo: simBrief.vueloCodigo,
                  origen: simBrief.origen,
                  origenCiudad: "Buenos Aires (Aeroparque)",
                  destino: simBrief.destino,
                  destinoCiudad: "Córdoba (Ambrosio Taravella)",
                  fecha: "Hoy (MSFS)",
                  fpmLanding: landingFpm,
                  satisfaccionMedia: Math.round(passengers.reduce((sum, p) => sum + p.satisfaccion, 0) / passengers.length),
                  puntuacion: Math.abs(landingFpm) <= 150 ? 5000 : 3800,
                  duracion: simBrief.blockTime,
                  aerolinea: simBrief.aerolinea
                };
                setVuelos(prev => [nuevoVuelo, ...prev]);

                // Unlock achievements of landing
                if (Math.abs(landingFpm) <= 100) {
                  setLogros(prev => prev.map(l => l.id === "l-2" ? { ...l, unlocked: true, fechaDesbloqueo: "Hoy" } : l));
                }
              }
            }}
            simBriefData={simBrief}
            voicesConfig={voicesConfig}
            audioConfig={audioConfig}
            copilotVolume={copilotVolume}
            onCopilotVolumeChange={handleCopilotVolumeChange}
            passengers={passengers}
            onPassengerClick={(p) => {
              setSelectedPasajero(p);
            }}
            lastAnnouncement={lastAnnouncement}
            onTriggerAnnouncement={triggerAnnouncement}
            onSimulateAction={handleSimulateAction}
            landingFpm={landingFpm}
            onLandingFpmChange={setLandingFpm}
            onResetSimulation={handleResetSimulation}
            onTriggerBriefImport={handleTriggerBriefImport}
            onNavigateToAccount={goHubAccount}
          />
          </div>
        )}

        {/*
          TEMPORAL sandbox rediseño FLY: /fly-v2 → currentView "vuelo-v2".
          - Misma protección auth que /fly: solo navegable con isLoggedIn
            (Sidebar solo lo muestra logueado + guard !isLoggedIn → hub).
          - Bloque estable `vuelo` (/fly) intacto arriba: no tocar.
        */}
        {vueloV2Alive && isLoggedIn && (
          <div
            id="vuelo-v2-keepalive"
            style={{ display: currentView === "vuelo-v2" ? undefined : "none" }}
          >
          <FlyPageV2
            currentState={currentState}
            onStateChange={(state) => {
              setCurrentState(state);
              // Trigger automatic announcement cues (idéntico a vista estable)
              if (state === FlightState.PreEmbarque) {
                triggerAnnouncement("bienvenida");
              } else if (state === FlightState.Aterrizado) {
                triggerAnnouncement("aterrizaje");
                // Auto append flight to vuelos list
                const nuevoVuelo: VueloReciente = {
                  id: `v-${vuelos.length + 1}`,
                  codigo: simBrief.vueloCodigo,
                  origen: simBrief.origen,
                  origenCiudad: "Buenos Aires (Aeroparque)",
                  destino: simBrief.destino,
                  destinoCiudad: "Córdoba (Ambrosio Taravella)",
                  fecha: "Hoy (MSFS)",
                  fpmLanding: landingFpm,
                  satisfaccionMedia: Math.round(passengers.reduce((sum, p) => sum + p.satisfaccion, 0) / passengers.length),
                  puntuacion: Math.abs(landingFpm) <= 150 ? 5000 : 3800,
                  duracion: simBrief.blockTime,
                  aerolinea: simBrief.aerolinea
                };
                setVuelos(prev => [nuevoVuelo, ...prev]);

                // Unlock achievements of landing
                if (Math.abs(landingFpm) <= 100) {
                  setLogros(prev => prev.map(l => l.id === "l-2" ? { ...l, unlocked: true, fechaDesbloqueo: "Hoy" } : l));
                }
              }
            }}
            simBriefData={simBrief}
            simbriefRawData={simbriefRaw}
            voicesConfig={voicesConfig}
            audioConfig={audioConfig}
            copilotVolume={copilotVolume}
            onCopilotVolumeChange={handleCopilotVolumeChange}
            passengers={passengers}
            onPassengerClick={(p) => {
              setSelectedPasajero(p);
            }}
            lastAnnouncement={lastAnnouncement}
            onTriggerAnnouncement={triggerAnnouncement}
            onSimulateAction={handleSimulateAction}
            landingFpm={landingFpm}
            onLandingFpmChange={setLandingFpm}
            onResetSimulation={handleResetSimulation}
            onTriggerBriefImport={handleTriggerBriefImport}
            onNavigateToAccount={goHubAccount}
          />
          </div>
        )}

        {currentView === "config" && (
          <ConfigView 
            simBriefData={simBrief}
            voicesConfig={voicesConfig}
            audioConfig={audioConfig}
            onSimBriefUpdate={(data) => setSimBrief(prev => ({ ...prev, ...data }))}
            onVoicesUpdate={(data) => setVoicesConfig(prev => ({ ...prev, ...data }))}
            onAudioUpdate={(data) => setAudioConfig(prev => ({ ...prev, ...data }))}
          />
        )}

      </main>

    </div>
  );
}
