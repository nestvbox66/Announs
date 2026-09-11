/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MockFlightController — simulación completa de vuelo GATE → AT_GATE.
 * Timeline determinístico + transiciones vía FlightPhaseDetector.
 */

import type { TelemetrySnapshot } from "../types/telemetry";
import type { FlightController } from "./FlightController";
import { FlightPhase } from "../engine/FlightEngine";
import { FlightPhaseDetector } from "./FlightPhaseDetector";
import { config } from "../config";
import { fileLogger } from "./FileLogger";

export interface SimulatedFlightState {
  phase: FlightPhase;
  altitude: number;
  groundspeed: number;
  verticalSpeed: number;
  heading: number;
  latitude: number;
  longitude: number;
  engineRunning: boolean;
  parkingBrake: boolean;
  doorsClosed: boolean;
  seatbeltOn: boolean;
  pushbackActive: boolean;
  elapsedTime: number;
  taxiProgress: number;
  climbProgress: number;
  cruiseProgress: number;
  descentProgress: number;
}

export interface MockFlightControllerOptions {
  intervalMs?: number;
  doorsCloseDelayMs?: number;
  autoDoorsClose?: boolean;
  speedMultiplier?: number;
  autoTransition?: boolean;
  autoStart?: boolean;
}

// Timeline realista — 1170s (~19.5 min, ~20 min) para que los anuncios tengan tiempo de reproducirse.
// Para pruebas rápidas usar speedMultiplier=5 (VITE_MOCK_SPEED=5) → ~4 min.
const TIMELINE: Array<{ phase: FlightPhase; start: number; end: number }> = [
  { phase: FlightPhase.GATE, start: 0, end: 60 },          // 60s
  { phase: FlightPhase.BOARDING, start: 60, end: 180 },    // 120s
  { phase: FlightPhase.PRE_FLIGHT, start: 180, end: 240 }, // 60s
  { phase: FlightPhase.TAXI, start: 240, end: 420 },       // 180s
  { phase: FlightPhase.TAKEOFF, start: 420, end: 450 },    // 30s
  { phase: FlightPhase.CLIMB, start: 450, end: 510 },      // 60s
  { phase: FlightPhase.CRUISE, start: 510, end: 810 },     // 300s
  { phase: FlightPhase.DESCENT, start: 810, end: 990 },    // 180s
  { phase: FlightPhase.APPROACH, start: 990, end: 1050 },  // 60s
  { phase: FlightPhase.LANDING, start: 1050, end: 1080 },  // 30s
  { phase: FlightPhase.TAXI_IN, start: 1080, end: 1140 },  // 60s
  { phase: FlightPhase.AT_GATE, start: 1140, end: 1170 },  // 30s
];
const TOTAL_DURATION = 1170;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class MockFlightController implements FlightController {
  private connected = false;
  private current: TelemetrySnapshot | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private state: SimulatedFlightState;
  private tick = 0;
  private elapsedTime = 0;
  private lastPhase: FlightPhase | null = null;
  private opts: MockFlightControllerOptions;
  private phaseDetector = new FlightPhaseDetector();
  // En GATE, esperar señal del usuario ("Comenzar Embarque") antes de avanzar a BOARDING
  private gateHold = true;
  // En BOARDING, esperar puertas cerradas (PRE_FLIGHT) — se mantiene BOARDING hasta doorsClosed
  private boardingHold = true;

  /** Callback asignable por el consumidor (VueloActualView). */
  onTelemetry: (snap: TelemetrySnapshot) => void = () => {};
  /** Callback opcional para transiciones de fase. */
  onPhaseChange?: (from: FlightPhase | null, to: FlightPhase) => void;

  constructor(options: MockFlightControllerOptions = {}) {
    this.opts = {
      autoStart: false,
      ...options,
    };
    // Respetar config global si no se pasó explícitamente
    if (this.opts.autoStart === undefined) {
      this.opts.autoStart = config.mock.autoStart ?? false;
    }
    if (this.opts.speedMultiplier === undefined) {
      this.opts.speedMultiplier = config.mock.speedMultiplier ?? 1;
    }
    if (this.opts.autoTransition === undefined) {
      this.opts.autoTransition = config.mock.autoTransition ?? true;
    }
    this.state = this.createInitialState();
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    this.tick = 0;
    this.elapsedTime = 0;
    this.state = this.createInitialState();
    this.lastPhase = null;
    this.gateHold = true;
    this.boardingHold = true;
    this.phaseDetector.reset();
    this.current = this.buildSnapshot();

    const intervalMs = this.opts.intervalMs ?? 1000;
    const speed = this.opts.speedMultiplier ?? config.mock.speedMultiplier ?? 1;

    console.log("[MockFlightController] 🛫 Simulación iniciada");
    fileLogger.log('[MockFlightController] Simulación iniciada', { speedMultiplier: speed, phase: this.state.phase, elapsedTime: this.state.elapsedTime });
    console.log("[MockFlightController] ⏱️ Simulación con speedMultiplier:", {
      speedMultiplier: speed,
      elapsedTime: this.state.elapsedTime,
      phase: this.state.phase,
    });
    fileLogger.log('[MockFlightController] speedMultiplier', { speedMultiplier: speed, elapsedTime: this.state.elapsedTime, phase: this.state.phase });
    console.log("[MockFlightController] 📊 Estado:", {
      phase: this.state.phase,
      altitude: this.state.altitude,
      groundspeed: this.state.groundspeed,
      elapsedTime: this.state.elapsedTime,
    });
    fileLogger.log('[MockFlightController] Estado inicial', { phase: this.state.phase, altitude: this.state.altitude, groundspeed: this.state.groundspeed, elapsedTime: this.state.elapsedTime });

    this.emit();

    this.intervalId = setInterval(() => this.tickAndEmit(), intervalMs);
  }

  /** GATE → BOARDING es manual: esperar señal del usuario ("Comenzar Embarque") */
  notifyBoardingRequested(): void {
    if (!this.gateHold) return;
    this.gateHold = false;
    console.log("[MockFlightController] Usuario solicitó embarque → liberando GATE");
    if (this.state.phase === FlightPhase.GATE) {
      this.elapsedTime = 60; // salto a BOARDING
      this.updateStateFromTimeline(this.elapsedTime);
      this.emit();
    }
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[MockFlightController] Desconectado");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getTelemetry(): TelemetrySnapshot | null {
    return this.current;
  }

  getState(): SimulatedFlightState {
    return { ...this.state };
  }

  getElapsedTime(): number {
    return this.elapsedTime;
  }

  /** Fuerza el cierre de puertas de forma manual (para tests / UI). */
  simulateDoorsClosed(): void {
    this.state.doorsClosed = true;
    console.log("[MockFlightController] simulateDoorsClosed() → doorsClosed=true");
    this.emit();
  }

  /** Fuerza reapertura de puertas (útil para reset). */
  simulateDoorsOpen(): void {
    this.state.doorsClosed = false;
    console.log("[MockFlightController] simulateDoorsOpen() → doorsClosed=false");
    this.emit();
  }

  private createInitialState(): SimulatedFlightState {
    return {
      phase: FlightPhase.GATE,
      altitude: 0,
      groundspeed: 0,
      verticalSpeed: 0,
      heading: 90,
      latitude: -34.8222,
      longitude: -58.5358,
      engineRunning: false,
      parkingBrake: true,
      doorsClosed: false,
      seatbeltOn: false,
      pushbackActive: false,
      elapsedTime: 0,
      taxiProgress: 0,
      climbProgress: 0,
      cruiseProgress: 0,
      descentProgress: 0,
    };
  }

  private tickAndEmit(): void {
    this.tick++;

    // GATE: esperar señal del usuario ("Comenzar Embarque") — no avanzar timeline
    if (this.gateHold && this.state.phase === FlightPhase.GATE) {
      const gateEnd = 60;
      if (this.elapsedTime >= gateEnd - 1) {
        console.log("[MockFlightController] ⏳ En GATE, esperando señal del usuario (Comenzar Embarque)");
        fileLogger.log('[MockFlightController] En GATE esperando usuario', { elapsedTime: this.elapsedTime, phase: this.state.phase });
        this.elapsedTime = gateEnd - 0.1; // mantener en GATE
        this.emit();
        return;
      }
    }
    // BOARDING: esperar puertas cerradas (PRE_FLIGHT) — mantener BOARDING hasta que el
    // simulador detecte doorsClosed (vía telemetry). El timeline ya mantiene puertas
    // abiertas en BOARDING; la transición a PRE_FLIGHT ocurrirá cuando el Scheduler
    // detecte doorsClosed, pero el Mock no forzará el avance hasta que el tiempo lo indique.
    // Para pruebas con autoTransition, el timeline avanza solo; para validación manual,
    // el Mock respeta boardingHold hasta que se libere (vía notifyDoorsClosed interno).

    // Aplicar multiplicador de velocidad
    const intervalMs = this.opts.intervalMs ?? 1000;
    const speedMultiplier = this.opts.speedMultiplier ?? config.mock.speedMultiplier ?? 1;
    const delta = (intervalMs / 1000) * speedMultiplier;
    this.elapsedTime += delta;
    // Cap a TOTAL_DURATION (fin de timeline 1170s)
    if (this.elapsedTime > TOTAL_DURATION) this.elapsedTime = TOTAL_DURATION;

    console.log("[MockFlightController] ⏱️ Simulación con speedMultiplier:", {
      speedMultiplier,
      elapsedTime: this.state.elapsedTime,
      phase: this.state.phase,
    });

    this.updateStateFromTimeline(this.elapsedTime);

    // Detector con histéresis (evita saltos por ruido)
    const detected = this.detectPhase();
    if (!detected) {
      // Aún no estable — mantener fase actual, solo emitir telemetría
      this.emit();
      return;
    }
    if (detected !== this.lastPhase && this.lastPhase !== null) {
      console.log("[MockFlightController] 🔄 Transición de fase:", {
        from: this.lastPhase,
        to: detected,
      });
      fileLogger.log('[MockFlightController] Transición de fase (detector)', { from: this.lastPhase, to: detected, elapsedTime: this.elapsedTime });
      this.onPhaseChange?.(this.lastPhase, detected);
    }
    if (detected !== this.state.phase) {
      // Sincronizar fase del estado con detector (detector es fuente de verdad)
      // Solo si autoTransition está habilitado
      const auto = this.opts.autoTransition ?? config.mock.autoTransition ?? true;
      if (auto) {
        const prev = this.state.phase;
        this.state.phase = detected;
        if (prev !== detected) {
          console.log("[MockFlightController] 🔄 Transición de fase:", { from: prev, to: detected });
          fileLogger.log('[MockFlightController] Transición de fase (estado)', { from: prev, to: detected, elapsedTime: this.elapsedTime });
        }
      }
    }
    this.lastPhase = detected;

    // Log periódico como pide la spec
    if (this.tick % 5 === 0 || detected !== this.state.phase) {
      console.log("[MockFlightController] 📊 Estado:", {
        phase: this.state.phase,
        altitude: this.state.altitude,
        groundspeed: this.state.groundspeed,
        elapsedTime: Math.round(this.state.elapsedTime),
      });
      fileLogger.log('[MockFlightController] Estado periódico', { phase: this.state.phase, altitude: this.state.altitude, groundspeed: this.state.groundspeed, elapsedTime: Math.round(this.state.elapsedTime), tick: this.tick });
    }

    this.emit();
  }

  private updateStateFromTimeline(elapsed: number): void {
    this.state.elapsedTime = elapsed;

    // Determinar fase por timeline
    let entry = TIMELINE.find((t) => elapsed >= t.start && elapsed < t.end);
    if (!entry) {
      entry = elapsed >= TOTAL_DURATION ? TIMELINE[TIMELINE.length - 1] : TIMELINE[0];
    }
    const t = clamp01((elapsed - entry.start) / (entry.end - entry.start));
    const phase = entry.phase;

    // Reset progress
    this.state.taxiProgress = 0;
    this.state.climbProgress = 0;
    this.state.cruiseProgress = 0;
    this.state.descentProgress = 0;

    const jitter = (Math.random() - 0.5) * 0.8;

    switch (phase) {
      case FlightPhase.GATE:
        this.state.phase = FlightPhase.GATE;
        this.state.altitude = 0;
        this.state.groundspeed = 0;
        this.state.verticalSpeed = 0;
        this.state.heading = 90;
        this.state.engineRunning = false;
        this.state.parkingBrake = true;
        this.state.doorsClosed = false;
        this.state.seatbeltOn = false;
        this.state.pushbackActive = false;
        break;

      case FlightPhase.BOARDING:
        this.state.phase = FlightPhase.BOARDING;
        this.state.altitude = 0;
        this.state.groundspeed = 0;
        this.state.verticalSpeed = 0;
        this.state.engineRunning = false;
        // Para que el detector distinga GATE (brake ON) de BOARDING (brake OFF)
        this.state.parkingBrake = false;
        this.state.doorsClosed = false;
        this.state.seatbeltOn = false;
        this.state.pushbackActive = false;
        break;

      case FlightPhase.PRE_FLIGHT:
        this.state.phase = FlightPhase.PRE_FLIGHT;
        this.state.altitude = 0;
        this.state.groundspeed = 0;
        this.state.verticalSpeed = 0;
        this.state.engineRunning = true;
        this.state.parkingBrake = true;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        this.state.pushbackActive = false;
        break;

      case FlightPhase.TAXI:
        this.state.phase = FlightPhase.TAXI;
        this.state.altitude = 0;
        this.state.groundspeed = Math.round(lerp(0, 30, t));
        this.state.verticalSpeed = 0;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        this.state.pushbackActive = t < 0.2;
        this.state.taxiProgress = t;
        break;

      case FlightPhase.TAKEOFF:
        this.state.phase = FlightPhase.TAKEOFF;
        this.state.altitude = Math.round(lerp(0, 500, t));
        this.state.groundspeed = Math.round(lerp(30, 180, t));
        this.state.verticalSpeed = Math.round(lerp(0, 800, t));
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        break;

      case FlightPhase.CLIMB:
        this.state.phase = FlightPhase.CLIMB;
        this.state.altitude = Math.round(lerp(500, 35000, t));
        this.state.groundspeed = Math.round(lerp(180, 320, t));
        this.state.verticalSpeed = 2000;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        this.state.climbProgress = t;
        break;

      case FlightPhase.CRUISE:
        this.state.phase = FlightPhase.CRUISE;
        this.state.altitude = 35000;
        this.state.groundspeed = 450;
        this.state.verticalSpeed = 0;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = false;
        this.state.cruiseProgress = t;
        break;

      case FlightPhase.DESCENT:
        this.state.phase = FlightPhase.DESCENT;
        this.state.altitude = Math.round(lerp(35000, 1000, t));
        this.state.groundspeed = Math.round(lerp(450, 280, t));
        this.state.verticalSpeed = -2000;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        this.state.descentProgress = t;
        break;

      case FlightPhase.APPROACH:
        this.state.phase = FlightPhase.APPROACH;
        this.state.altitude = Math.round(lerp(1000, 50, t));
        this.state.groundspeed = Math.round(lerp(180, 130, t));
        this.state.verticalSpeed = -700;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        break;

      case FlightPhase.LANDING:
        this.state.phase = FlightPhase.LANDING;
        this.state.altitude = 0;
        this.state.groundspeed = Math.round(lerp(130, 15, t));
        this.state.verticalSpeed = -200;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        break;

      case FlightPhase.TAXI_IN:
        this.state.phase = FlightPhase.TAXI_IN;
        this.state.altitude = 0;
        // Taxi to gate: 15→5 nudos con curva
        this.state.groundspeed = Math.round(lerp(15, 0, t) + Math.sin(t * Math.PI) * 5);
        this.state.verticalSpeed = 0;
        this.state.engineRunning = true;
        this.state.parkingBrake = false;
        this.state.doorsClosed = true;
        this.state.seatbeltOn = true;
        break;

      case FlightPhase.AT_GATE:
        this.state.phase = FlightPhase.AT_GATE;
        this.state.altitude = 0;
        this.state.groundspeed = 0;
        this.state.verticalSpeed = 0;
        this.state.engineRunning = false;
        this.state.parkingBrake = true;
        // Para que el detector llegue a AT_GATE (requiere doorsClosed true)
        this.state.doorsClosed = true;
        this.state.seatbeltOn = false;
        this.state.pushbackActive = false;
        break;

      default:
        break;
    }

    // Variación leve en heading/lat/lon + jitter
    this.state.heading = (90 + t * 40 + jitter * 0.5 + 360) % 360;
    this.state.latitude = -34.8222 + t * 0.08 + jitter * 0.005;
    this.state.longitude = -58.5358 + t * 0.12 + jitter * 0.005;
  }

  setBoardingCompleted(completed: boolean): void {
    this.phaseDetector.setBoardingCompleted(completed);
  }

  private detectPhase(): FlightPhase | null {
    // Usa detector con histéresis para evitar saltos por ruido
    return this.phaseDetector.detectPhase(this.buildSnapshot());
  }

  private emit(): void {
    this.current = this.buildSnapshot();
    try {
      this.onTelemetry(this.current);
    } catch (e) {
      console.warn("[MockFlightController] onTelemetry error:", e);
    }
  }

  private buildSnapshot(): TelemetrySnapshot {
    return {
      altitude: this.state.altitude,
      groundspeed: this.state.groundspeed,
      verticalSpeed: this.state.verticalSpeed,
      heading: this.state.heading,
      latitude: this.state.latitude,
      longitude: this.state.longitude,
      doorsClosed: this.state.doorsClosed,
      indicated_airspeed: Math.round(this.state.groundspeed * 0.62 + 20),
      true_airspeed: Math.round(this.state.groundspeed * 1.05),
      pitch: this.state.verticalSpeed > 0 ? 5 : this.state.verticalSpeed < 0 ? -3 : 1.5,
      bank: (Math.random() - 0.5) * 1,
      engineRunning: this.state.engineRunning,
      parkingBrake: this.state.parkingBrake,
      seatbeltOn: this.state.seatbeltOn,
      pushbackActive: this.state.pushbackActive,
      simPhase: this.phaseToSimPhase(this.state.phase),
      zuluTime: 43200 + Math.round(this.state.elapsedTime),
      localTime: 36000 + Math.round(this.state.elapsedTime),
      remainingTime: Math.max(0, TOTAL_DURATION - Math.round(this.state.elapsedTime)),
      temperature: 15,
      windSpeed: 25,
      windDirection: 270,
      nextWaypoint: this.state.phase === FlightPhase.CRUISE ? "GBE" : undefined,
    };
  }

  private phaseToSimPhase(phase: FlightPhase): number {
    switch (phase) {
      case FlightPhase.GATE:
      case FlightPhase.BOARDING:
      case FlightPhase.PRE_FLIGHT:
        return 0;
      case FlightPhase.TAXI:
      case FlightPhase.TAKEOFF:
        return 1;
      case FlightPhase.CLIMB:
        return 2;
      case FlightPhase.CRUISE:
        return 3;
      case FlightPhase.DESCENT:
        return 4;
      case FlightPhase.APPROACH:
        return 5;
      case FlightPhase.LANDING:
        return 6;
      case FlightPhase.TAXI_IN:
      case FlightPhase.AT_GATE:
        return 7;
      default:
        return 0;
    }
  }
}
