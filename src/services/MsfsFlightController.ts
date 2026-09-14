/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MsfsFlightController — implementación real para MSFS vía SimConnect (Tauri).
 * Usa la lista completa de SimVars y mapea a TelemetrySnapshot.
 */

import type { FlightController } from "./FlightController";
import type { TelemetrySnapshot } from "../types/telemetry";
import { config } from "../config";
import { fileLogger } from "./FileLogger";

// Tauri API se importa estáticamente (dependencia real). En entorno no-Tauri
// (Vite dev en browser) las funciones lanzan un error que el consumidor
// (VueloActualView) usa para hacer fallback a MockFlightController.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Detectar si estamos en entorno Tauri (evaluado en cada llamada)
function isTauriEnv(): boolean {
  return isTauri();
}

// invoke con fallback para entorno no-Tauri
const invokeFn: typeof invoke = (async (...args: Parameters<typeof invoke>) => {
  if (isTauriEnv()) return (invoke as any)(...args);
  console.warn("[MsfsFlightController] Tauri no disponible, usando fallback");
  throw new Error("Tauri no disponible");
}) as any;

// listen con fallback
const listenFn: typeof listen = (async (...args: Parameters<typeof listen>) => {
  if (isTauriEnv()) return (listen as any)(...args);
  console.warn("[MsfsFlightController] Tauri no disponible, listen fallback");
  throw new Error("Tauri no disponible");
}) as any;

// ── 1. Lista completa de SimVars ────────────────────────────────────────

export const SIMVAR_LIST = [
  // Posición y movimiento
  "PLANE_ALTITUDE",
  "GROUND_VELOCITY",
  "VERTICAL_SPEED",
  "PLANE_HEADING_DEGREES_GYRO",
  "PLANE_LATITUDE",
  "PLANE_LONGITUDE",
  "AIRSPEED_INDICATED",
  "AIRSPEED_TRUE",
  "PLANE_PITCH_DEGREES",
  "PLANE_BANK_DEGREES",

  // Motores
  "GENERAL_ENG_COMBUSTION:1",
  "ENG_N1_RPM:1",
  "ENG_N2_RPM:1",

  // Frenos y puertas
  "BRAKE_PARKING_POSITION",
  "EXIT_OPEN:1",

  // Cinturones
  "SEATBELT_SWITCH",

  // Pushback
  "PUSHBACK_ACTIVE",

  // Fase de vuelo
  "SIMULATION_FLIGHT_PHASE",

  // Parking / ground (para preflight_capt_delay_parked)
  "ATC_ON_PARKING_SPOT",
  "SIM_ON_GROUND",
  "PLANE_IN_PARKING_STATE",
  // Autorización ATC (para transition_to_takeoff)
  "ATC_CLEARED_TAKEOFF",
  // Posición en pista (para transición a TAKEOFF)
  "ON_ANY_RUNWAY",
  // Compat: también con espacios (SimConnect nativo)
  "ATC ON PARKING SPOT",
  "SIM ON GROUND",
  "PLANE IN PARKING STATE",
  "ATC CLEARED TAKEOFF",
  "ON ANY RUNWAY",
  "ZULU TIME",

  // Tiempo
  "ZULU_TIME",
  "LOCAL_TIME",
  // "ESTIMATED CRUISE TIME REMAINING" NO es un SimVar válido: suscribirlo en
  // el backend provoca NAME_UNRECOGNIZED(7) y corta TODA la telemetría.
  // "ESTIMATED_CRUISE_TIME_REMAINING",

  // Clima
  "AMBIENT_TEMPERATURE",
  "AMBIENT_WIND_SPEED",
  "AMBIENT_WIND_DIRECTION",

  // Ruta (opcional)
  "FLIGHT_PLAN_WAYPOINT_NAME",

  // Descenso / aproximación (fase DESCENT)
  "RADIO HEIGHT",
  "GEAR HANDLE POSITION",
  // Compat: también con guiones bajos
  "RADIO_HEIGHT",
  "GEAR_HANDLE_POSITION",
] as const;

// ── 2. Mapeo a TelemetrySnapshot ────────────────────────────────────────

export function mapSimVarsToTelemetry(simVars: Record<string, any>): TelemetrySnapshot {
  // Diagnóstico seatbelt (inversión reportada): el SimVar canónico es
  // `CABIN SEATBELTS ALERT SWITCH` (SDK MSFS: True = cinturones ON, Bool).
  // Este mapeo legacy usa `SEATBELT_SWITCH === 1` con la misma polaridad.
  // NO negar sin evidencia: confirmar con estos logs + `seatbelt_raw` del
  // backend Rust (path vivo: snapshot Rust → evento Tauri `telemetry`).
  // NOTA: esta función hoy no es el path vivo (solo definición; el backend
  // emite TelemetrySnapshot directo). Se mantiene por compatibilidad/tests.
  console.log('[MsfsFlightController] seatbelt raw value:', {
    simVarName: 'SEATBELT_SWITCH',
    rawValue: simVars['SEATBELT_SWITCH'],
    mappedTo: simVars['SEATBELT_SWITCH'] === 1,
  });
  // Diagnóstico altitud (discrepancia reportada app 23.100 vs sim 23.600 ft):
  // la app usa PLANE ALTITUDE (verdadera MSL); el panel muestra INDICATED
  // (baro). Con QNH ≠ STD o atmósfera no ISA difieren cientos de pies: normal.
  // Conclusión: NO cambiar de SimVar; la tolerancia ±500 ft lo absorbe.
  console.log('[MsfsFlightController] Altitude vars:', {
    PLANE_ALTITUDE: simVars['PLANE ALTITUDE'] ?? simVars['PLANE_ALTITUDE'],
    INDICATED_ALTITUDE: simVars['INDICATED ALTITUDE'] ?? simVars['INDICATED_ALTITUDE'],
    PRESSURE_ALTITUDE: simVars['PRESSURE ALTITUDE'] ?? simVars['PRESSURE_ALTITUDE'],
    PLANE_ALT_ABOVE_GROUND: simVars['PLANE ALT ABOVE GROUND'] ?? simVars['PLANE_ALT_ABOVE_GROUND'],
  });
  return {
    // Básicos
    altitude: simVars["PLANE_ALTITUDE"] ?? 0,
    groundspeed: simVars["GROUND_VELOCITY"] ?? 0,
    verticalSpeed: simVars["VERTICAL_SPEED"] ?? 0,
    heading: simVars["PLANE_HEADING_DEGREES_GYRO"] ?? 0,
    latitude: simVars["PLANE_LATITUDE"] ?? 0,
    longitude: simVars["PLANE_LONGITUDE"] ?? 0,

    // Extendidos
    indicated_airspeed: simVars["AIRSPEED_INDICATED"] ?? 0,
    true_airspeed: simVars["AIRSPEED_TRUE"] ?? 0,
    pitch: simVars["PLANE_PITCH_DEGREES"] ?? 0,
    bank: simVars["PLANE_BANK_DEGREES"] ?? 0,

    // Motores
    engineRunning: simVars["GENERAL_ENG_COMBUSTION:1"] === 1,
    engN1: simVars["ENG_N1_RPM:1"] ?? 0,
    engN2: simVars["ENG_N2_RPM:1"] ?? 0,

    // Frenos y puertas
    parkingBrake: simVars["BRAKE_PARKING_POSITION"] === 1,
    doorsClosed: simVars["EXIT_OPEN:1"] === 0,

    // Cinturones
    seatbeltOn: simVars["SEATBELT_SWITCH"] === 1,
    atcOnParkingSpot: (simVars["ATC ON PARKING SPOT"] ?? simVars["ATC_ON_PARKING_SPOT"]) === 1,
    atcClearedTakeoff: (simVars["ATC CLEARED TAKEOFF"] ?? simVars["ATC_CLEARED_TAKEOFF"]) === 1,
    onAnyRunway: (simVars["ON ANY RUNWAY"] ?? simVars["ON_ANY_RUNWAY"]) === 1,
    simOnGround: (simVars["SIM ON GROUND"] ?? simVars["SIM_ON_GROUND"]) === 1,
    planeInParkingState: (simVars["PLANE IN PARKING STATE"] ?? simVars["PLANE_IN_PARKING_STATE"]) === 1,

    // Pushback
    pushbackActive: simVars["PUSHBACK_ACTIVE"] === 1,

    // Fase de vuelo
    simPhase: simVars["SIMULATION_FLIGHT_PHASE"] ?? 0,

    // Tiempo
    zuluTime: (simVars["ZULU TIME"] ?? simVars["ZULU_TIME"] ?? 0),
    localTime: simVars["LOCAL_TIME"] ?? 0,
    remainingTime: simVars["ESTIMATED_CRUISE_TIME_REMAINING"] ?? 0,

    // Clima
    temperature: simVars["AMBIENT_TEMPERATURE"] ?? 0,
    windSpeed: simVars["AMBIENT_WIND_SPEED"] ?? 0,
    windDirection: simVars["AMBIENT_WIND_DIRECTION"] ?? 0,

    // Ruta
    nextWaypoint: simVars["FLIGHT_PLAN_WAYPOINT_NAME"] ?? undefined,

    // Descenso / aproximación (RADIO HEIGHT solo válida < ~2500 ft AGL)
    radioHeight: simVars["RADIO HEIGHT"] ?? simVars["RADIO_HEIGHT"] ?? 0,
    gearDown: (simVars["GEAR HANDLE POSITION"] ?? simVars["GEAR_HANDLE_POSITION"]) === 1,
  };
}

// ── 3. MsfsFlightController ─────────────────────────────────────────────
//
// Watchdog de salud: monitorea que la telemetría fluya con frescura. Si la
// conexión quedó "verde" pero no llegan datos (SimConnect caído / sim pausado
// / quit silencioso), marca desconectado (el estado de conexión pasa a rojo)
// e intenta reconectar automáticamente con backoff.

const WATCHDOG_INTERVAL_MS = 3000;
const TELEMETRY_STALE_MS = 8000;
const RECONNECT_DELAY_MS = 2000;

export class MsfsFlightController implements FlightController {
  private connected = false;
  private telemetry: TelemetrySnapshot | null = null;
  private unlistenFn: (() => void) | null = null;
  private pollInterval: number | null = null;
  private watchdogInterval: number | null = null;
  private lastTelemetryAt = 0;
  private reconnectInProgress = false;

  public onTelemetry: (snap: TelemetrySnapshot) => void = () => {};

  async connect(): Promise<void> {
    return this.doConnect();
  }

  private async doConnect(): Promise<void> {
    console.log('[MsfsFlightController] 🔍 INICIO de conexión');
    fileLogger.log('[MsfsFlightController] 🔍 INICIO de conexión');
    console.log('[MsfsFlightController] 📡 Verificando entorno Tauri...');

    const runningInTauri = isTauri();
    console.log('[MsfsFlightController] 📡 isTauri:', runningInTauri);
    fileLogger.log('[MsfsFlightController] 📡 isTauri', { isTauri: runningInTauri });

    if (!runningInTauri) {
      console.warn('[MsfsFlightController] ⚠️ Tauri no disponible, usando fallback');
      fileLogger.warn('[MsfsFlightController] Tauri no disponible, usando fallback');
      throw new Error('Tauri no disponible');
    }

    try {
      console.log('[MsfsFlightController] 📡 Llamando a simconnect_connect...');
      fileLogger.log('[MsfsFlightController] 📡 Llamando a simconnect_connect...');
      const result = await invokeFn("simconnect_connect");
      console.log('[MsfsFlightController] ✅ simconnect_connect resultado:', result);
      fileLogger.log('[MsfsFlightController] ✅ simconnect_connect resultado', { result });

      this.connected = true;
      this.lastTelemetryAt = Date.now();
      console.log('[MsfsFlightController] ✅ Conectado a SimConnect');
      fileLogger.log('[MsfsFlightController] ✅ Conectado a SimConnect');

      console.log('[MsfsFlightController] 📡 Configurando listener de telemetría...');
      this.unlistenFn = await listenFn("telemetry", (event: any) => {
        console.log('[MsfsFlightController] 📡 Telemetría recibida:', event.payload);
        const snap = event.payload as TelemetrySnapshot;
        fileLogger.log('[MsfsFlightController] 📡 Telemetría recibida', { snap });
        this.lastTelemetryAt = Date.now();
        this.telemetry = snap;
        this.onTelemetry(snap);
      });
      console.log('[MsfsFlightController] ✅ Listener configurado');

      console.log('[MsfsFlightController] 📡 Iniciando polling...');
      this.pollInterval = window.setInterval(async () => {
        if (this.connected) {
          try {
            const pollResult = (await invokeFn("simconnect_poll")) as TelemetrySnapshot | null;
            if (pollResult) {
              // El poll también refresca la frescura y los datos (fallback si el evento no llega).
              this.lastTelemetryAt = Date.now();
              this.telemetry = pollResult;
              this.onTelemetry(pollResult);
            }
          } catch (error) {
            console.warn('[MsfsFlightController] ⚠️ Error en poll:', error);
            fileLogger.log('[MsfsFlightController] ⚠️ Error en poll', { error: String(error) });
          }
        }
      }, 100);
      console.log('[MsfsFlightController] ✅ Polling iniciado');

      this.startWatchdog();
    } catch (error) {
      console.error('[MsfsFlightController] ❌ Error en connect:', error);
      fileLogger.log('[MsfsFlightController] ❌ Error en connect', { error: String(error) });
      this.connected = false;
      throw error;
    }
  }

  disconnect(): void {
    this.connected = false;
    this.stopWatchdog();
    this.clearListeners();
    void invokeFn("simconnect_disconnect").catch(() => {});
    console.log('[MsfsFlightController] Desconectado de MSFS');
  }

  private clearListeners(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.unlistenFn) {
      try { this.unlistenFn(); } catch {}
      this.unlistenFn = null;
    }
  }

  private startWatchdog(): void {
    if (this.watchdogInterval !== null) return;
    this.watchdogInterval = window.setInterval(() => {
      void this.checkHealth();
    }, WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval !== null) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  private async checkHealth(): Promise<void> {
    if (!this.connected || this.reconnectInProgress) return;
    const ageMs = Date.now() - this.lastTelemetryAt;
    if (ageMs < TELEMETRY_STALE_MS) return;

    // Sin datos frescos: la conexión está "verde" pero no hay telemetría real.
    console.warn(`[MsfsFlightController] ⚠️ Sin telemetría fresca (${ageMs}ms); marcando desconectado y reconectando`);
    fileLogger.log('[MsfsFlightController] ⚠️ Sin telemetría fresca; reconectando', { ageMs });
    await this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectInProgress) return;
    this.reconnectInProgress = true;
    this.connected = false; // ConnectionStatusService pasará a "desconectado"
    this.clearListeners();

    try {
      await invokeFn("simconnect_disconnect");
    } catch (e) {
      fileLogger.log('[MsfsFlightController] disconnect en reconexión', { error: String(e) });
    }

    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));

    try {
      await this.doConnect();
      console.log('[MsfsFlightController] ✅ Reconexión exitosa');
      fileLogger.log('[MsfsFlightController] Reconexión exitosa');
    } catch (e) {
      console.warn('[MsfsFlightController] ❌ Reconexión falló (se reintentará)', e);
      fileLogger.log('[MsfsFlightController] Reconexión falló (se reintentará)', { error: String(e) });
    } finally {
      this.reconnectInProgress = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getTelemetry(): TelemetrySnapshot | null {
    return this.telemetry;
  }
}
