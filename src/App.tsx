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

export default function App() {
  // Navigation & Simulation states
  const [currentView, setCurrentView] = useState<string>("hub"); // Default is Hub View ("Hub del Usuario") to showcase the custom mock login first
  const [currentState, setCurrentState] = useState<FlightState>(FlightState.NoIniciado); // Default is No Iniciado for the refined flow
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false); // Start prototype in Disconnected Mode (Estado Desconectado) as requested
  
  // Storage states
  const [vuelos, setVuelos] = useState<VueloReciente[]>(initialVuelos);
  const [logros, setLogros] = useState<Logro[]>(initialLogros);
  const [passengers, setPassengers] = useState<Pasajero[]>(initialPassengers);
  const [simBrief, setSimBrief] = useState<SimBriefData>(defaultSimBrief);
  const [voicesConfig, setVoicesConfig] = useState<ConfigVoces>(defaultVocesConfig);
  const [audioConfig, setAudioConfig] = useState<ConfigAudio>(defaultAudioConfig);
  const [copilotVolume, setCopilotVolume] = useState<number>(defaultVocesConfig.volumenVoz);
  
  // Live simulated alerts & announcements
  const [lastAnnouncement, setLastAnnouncement] = useState<UltimoAnuncio | null>(null);
  const [selectedPasajero, setSelectedPasajero] = useState<Pasajero | null>(null);
  const [landingFpm, setLandingFpm] = useState<number>(-125); // fpm rate
  const [isConnected, setIsConnected] = useState<boolean>(true);

  // Force Hub view if pilot logs out or session is disconnected
  useEffect(() => {
    if (!isLoggedIn) {
      setCurrentView("hub");
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
  const handleTriggerBriefImport = (realData?: any) => {
    if (realData) {
      setSimBrief(realData);
    } else {
      setSimBrief({
        username: "capitán_msfs2024",
        nombrePiloto: "N. Sassano",
        vueloCodigo: "AR1842",
        origen: "SABE",
        destino: "SACO",
        aerolinea: "Aerolíneas Argentinas",
        avion: "Boeing 737-800 NG",
        cruisingAltitude: "FL320 (32,000 pies)",
        blockTime: "75 minutos",
        pasajerosCount: 142
      });
    }
    // Trigger achievement "Primer Oficial de SimBrief"
    setLogros(prev => prev.map(l => l.id === "l-4" ? { ...l, unlocked: true, fechaDesbloqueo: "05 Jun 2026" } : l));
  };

  // Reset core simulation loop
  const handleResetSimulation = () => {
    setPassengers(initialPassengers);
    setLandingFpm(-125);
    setCurrentState(FlightState.NoIniciado);
    setLastAnnouncement(null);
    setCurrentView("vuelo");
  };

  return (
    <div className="flex bg-[#00345C] min-h-screen text-white select-none">
      
      {/* 1. LEFT NAVIGATION SIDEBAR */}
      <Sidebar 
        currentView={currentView}
        onViewChange={(view) => {
          setCurrentView(view);
          // If viewing passengers, make sure we close the slide-over
          setSelectedPasajero(null);
        }}
        isConnected={isConnected}
        activeFlightCode={simBrief.vueloCodigo}
        copilotVolume={copilotVolume}
        isLoggedIn={isLoggedIn}
      />

      {/* 2. RIGHT MAIN CONTENT FRAMEWORK WITH OVERFLOW AND SMOOTH PADDING */}
      <main id="main-frame-right" className="flex-1 p-6 lg:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        
        {/* Dynamic viewport rendering based on Navigation tab states */}
        {currentView === "hub" && (
          <HubView 
            vuelos={vuelos}
            logros={logros}
            onStartFlightShortcut={() => setCurrentView("vuelo")}
            isLoggedIn={isLoggedIn}
            onLogin={() => setIsLoggedIn(true)}
            onLogout={() => setIsLoggedIn(false)}
          />
        )}

        {currentView === "vuelo" && (
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
            onNavigateToAccount={() => setCurrentView("hub")}
          />
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
