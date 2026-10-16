/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * XPlaneFlightController — implementación real para X-Plane 12 vía UDP/RREF
 * (backend Tauri `src-tauri/src/xplane.rs`, solo lectura).
 *
 * Espejo exacto del patrón de `MsfsFlightController`: mismo evento Tauri
 * `telemetry` con el mismo `TelemetrySnapshot` unificado (sin adaptadores),
 * ingesta con dedup anti-fantasma, polling de respaldo y watchdog con
 * reconexión automática.
 *
 * NOTA: el nombre de la clase es contrato — `ConnectionStatusService`
 * identifica el proveedor por `constructor.name === "XPlaneFlightController"`.
 * No renombrar sin actualizar el servicio.
 */

import type { FlightController } from "./FlightController";
import type { TelemetrySnapshot } from "../types/telemetry";
import { config } from "../config";
import { fileLogger } from "./FileLogger";
import { stripTelemetryNulls } from "./telemetryNulls";
import type { ParkingEvaluation, RunwayEvaluation } from "./RunwayProximityService";

// Tauri API se importa estáticamente (dependencia real). En entorno no-Tauri
// (Vite dev en browser) las funciones lanzan un error que el consumidor
// (VueloActualView) usa para hacer fallback a MockFlightController.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logger } from "../utils/logger";

// Detectar si estamos en entorno Tauri (evaluado en cada llamada)
function isTauriEnv(): boolean {
  return isTauri();
}

// invoke con fallback para entorno no-Tauri
const invokeFn: typeof invoke = (async (...args: Parameters<typeof invoke>) => {
  if (isTauriEnv()) return (invoke as any)(...args);
  console.warn("[XPlaneFlightController] Tauri no disponible, usando fallback");
  throw new Error("Tauri no disponible");
}) as any;

// listen con fallback
const listenFn: typeof listen = (async (...args: Parameters<typeof listen>) => {
  if (isTauriEnv()) return (listen as any)(...args);
  console.warn("[XPlaneFlightController] Tauri no disponible, listen fallback");
  throw new Error("Tauri no disponible");
}) as any;

/** Opciones de conexión UDP (todas opcionales; el backend aplica defaults). */
export interface XPlaneConnectOptions {
  /** Host de X-Plane (default `127.0.0.1`). */
  host?: string;
  /** Puerto RX de X-Plane (default `49000`). */
  rxPort?: number;
  /** Puerto UDP local de la app (default `49005`). */
  localPort?: number;
}

// ── XPlaneFlightController ──────────────────────────────────────────────
//
// Watchdog de salud: idéntico al de MSFS. Si la conexión quedó "verde" pero
// no llegan muestras distintas (X-Plane cerrado / red caída / sim pausado),
// marca desconectado (el estado pasa a rojo) e intenta reconectar con backoff.

const WATCHDOG_INTERVAL_MS = 3000;
const TELEMETRY_STALE_MS = 8000;
const RECONNECT_DELAY_MS = 2000;

/**
 * Proveedor de `onAnyRunway` por paridad (geometría/fallback). Se invoca por
 * muestra ya saneada; devuelve la evaluación o null si no hay nada que
 * adjuntar. Lo inyecta la vista (conoce el vuelo); sin proveedor no se toca
 * el snapshot.
 */
export type OnAnyRunwayProvider = (snap: TelemetrySnapshot) => RunwayEvaluation | null;

export interface RunwayAttachInfo {
  source: string;
  value: boolean | null;
  matchedDesignator: string | null;
  planMismatch: boolean;
  airportIcao: string | null;
}

export interface ParkingAttachInfo {
  source: string;
  value: boolean | null;
  standName: string | null;
  airportIcao: string | null;
}

export class XPlaneFlightController implements FlightController {
  private connected = false;
  private telemetry: TelemetrySnapshot | null = null;
  private unlistenFn: (() => void) | null = null;
  private pollInterval: number | null = null;
  private watchdogInterval: number | null = null;
  private lastTelemetryAt = 0;
  private reconnectInProgress = false;
  // Anti-fantasma: `xplane_poll` (Rust `latest()`) devuelve el último snapshot
  // cacheado aunque X-Plane haya dejado de emitir. Solo las muestras DISTINTAS
  // refrescan la frescura y se propagan (mismo razonamiento que en MSFS).
  private lastSampleKey: string | null = null;
  private identicalSampleCount = 0;
  // Guarda de conexión concurrente (ver connect()).
  private connectPromise: Promise<void> | null = null;
  private readonly options: XPlaneConnectOptions;
  private onAnyRunwayProvider: OnAnyRunwayProvider | null = null;
  private runwayInfo: RunwayAttachInfo | null = null;
  private runwayStatusProvider: (() => unknown) | null = null;
  private parkingProvider: ((snap: TelemetrySnapshot) => ParkingEvaluation | null) | null = null;
  private parkingInfo: ParkingAttachInfo | null = null;

  public onTelemetry: (snap: TelemetrySnapshot) => void = () => {};

  constructor(options?: XPlaneConnectOptions) {
    this.options = options ?? {};
  }

  async connect(): Promise<void> {
    // Idempotente: el efecto de montaje y "Iniciar vuelo" pueden llamar a
    // connect() casi a la vez sobre el mismo objeto; sin esta guarda se
    // duplican el listener de telemetría y el intervalo de poll y cada muestra
    // se procesa dos veces.
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    logger.telemetry('🔍 INICIO de conexión X-Plane');
    fileLogger.log('[XPlaneFlightController] 🔍 INICIO de conexión', { options: this.options });
    logger.telemetry('📡 Verificando entorno Tauri...');

    const runningInTauri = isTauri();
    logger.telemetry('📡 isTauri:', runningInTauri);
    fileLogger.log('[XPlaneFlightController] 📡 isTauri', { isTauri: runningInTauri });

    if (!runningInTauri) {
      console.warn('[XPlaneFlightController] ⚠️ Tauri no disponible, usando fallback');
      fileLogger.warn('[XPlaneFlightController] Tauri no disponible, usando fallback');
      throw new Error('Tauri no disponible');
    }

    try {
      logger.telemetry('📡 Llamando a xplane_connect...');
      fileLogger.log('[XPlaneFlightController] 📡 Llamando a xplane_connect...');
      // `options: null` → Rust `Option::None` → defaults (127.0.0.1:49000).
      // Se envía el objeto tal cual cuando el usuario configuró host/puertos.
      const hasOptions =
        this.options.host !== undefined ||
        this.options.rxPort !== undefined ||
        this.options.localPort !== undefined;
      const result = await invokeFn("xplane_connect", {
        options: hasOptions
          ? {
              host: this.options.host ?? null,
              rx_port: this.options.rxPort ?? null,
              local_port: this.options.localPort ?? null,
            }
          : null,
      });
      logger.telemetry('✅ xplane_connect resultado:', result);
      fileLogger.log('[XPlaneFlightController] ✅ xplane_connect resultado', { result });

      this.connected = true;
      this.lastTelemetryAt = Date.now();
      this.lastSampleKey = null;
      this.identicalSampleCount = 0;
      logger.telemetry('✅ Conectado a X-Plane');
      fileLogger.log('[XPlaneFlightController] ✅ Conectado a X-Plane');

      logger.telemetry('📡 Configurando listener de telemetría...');
      this.unlistenFn = await listenFn("telemetry", (event: any) => {
        logger.telemetry('📡 Telemetría recibida:', event.payload);
        const snap = event.payload as TelemetrySnapshot;
        if (!this.ingestSample(snap, "event")) return;
        this.onTelemetry(snap);
      });
      logger.telemetry('✅ Listener configurado');

      logger.telemetry('📡 Iniciando polling...');
      const pollMs = config.sim.pollInterval > 0 ? config.sim.pollInterval : 100;
      this.pollInterval = window.setInterval(async () => {
        if (this.connected) {
          try {
            const pollResult = (await invokeFn("xplane_poll")) as TelemetrySnapshot | null;
            if (pollResult) {
              // El poll también refresca la frescura y los datos (fallback si
              // el evento no llega), pero SOLO si la muestra cambió: un clon
              // idéntico del caché Rust no prueba que el sim siga vivo.
              if (!this.ingestSample(pollResult, "poll")) return;
              this.onTelemetry(pollResult);
            }
          } catch (error) {
            console.warn('[XPlaneFlightController] ⚠️ Error en poll:', error);
            fileLogger.log('[XPlaneFlightController] ⚠️ Error en poll', { error: String(error) });
          }
        }
      }, pollMs);
      logger.telemetry('✅ Polling iniciado');

      this.startWatchdog();
    } catch (error) {
      console.error('[XPlaneFlightController] ❌ Error en connect:', error);
      fileLogger.log('[XPlaneFlightController] ❌ Error en connect', { error: String(error) });
      this.connected = false;
      throw error;
    }
  }

  disconnect(): void {
    this.connected = false;
    this.stopWatchdog();
    this.clearListeners();
    this.lastSampleKey = null;
    this.identicalSampleCount = 0;
    this.runwayInfo = null;
    this.parkingInfo = null;
    void invokeFn("xplane_disconnect").catch(() => {});
    logger.telemetry('Desconectado de X-Plane');
  }

  /**
   * Inyecta el proveedor de `onAnyRunway` (vía paridad con geometría). Lo
   * llama la vista al enlazar el controlador, con el vuelo ya conocido.
   */
  setOnAnyRunwayProvider(provider: OnAnyRunwayProvider | null): void {
    this.onAnyRunwayProvider = provider;
    this.runwayInfo = null;
  }

  /** Última info de paridad adjuntada (para el DebugMonitor). */
  getRunwayInfo(): RunwayAttachInfo | null {
    return this.runwayInfo;
  }

  /** Última info de parking adjuntada (para el DebugMonitor). */
  getParkingInfo(): ParkingAttachInfo | null {
    return this.parkingInfo;
  }

  /** Inyecta el proveedor de `atcOnParkingSpot` (paridad por rampas). */
  setParkingProvider(
    provider: ((snap: TelemetrySnapshot) => ParkingEvaluation | null) | null
  ): void {
    this.parkingProvider = provider;
    this.parkingInfo = null;
  }

  /** Estado del servicio de geometría (para el DebugMonitor). */
  setRunwayStatusProvider(provider: (() => unknown) | null): void {
    this.runwayStatusProvider = provider;
  }

  getRunwayStatus(): unknown {
    try {
      return this.runwayStatusProvider?.() ?? null;
    } catch {
      return null;
    }
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

  /**
   * Ingiere una muestra de telemetría (vía evento o poll).
   *
   * Devuelve true si la muestra es NUEVA: actualiza el caché, refresca
   * `lastTelemetryAt` (frescura del watchdog) y el llamador debe propagarla
   * con `onTelemetry`. Devuelve false si es idéntica a la anterior (caché Rust
   * congelado): no toca la frescura — así el watchdog detecta el
   * estancamiento en ~8s, marca desconectado e intenta reconectar.
   */
  private ingestSample(snap: TelemetrySnapshot, source: "event" | "poll"): boolean {
    // Paso 0 (borde): normalizar null → undefined (el backend emite null
    // JSON; el contrato distingue desconocido de medido). Aislado y testeado.
    stripTelemetryNulls(snap);
    // Vía paridad onAnyRunway: solo si el backend lo trae ausente (nunca se
    // pisa un valor medido). La evaluación ya saneada entra en la clave de
    // dedup, así que un cambio geometry→true se propaga como muestra nueva.
    if (snap.onAnyRunway === undefined || snap.onAnyRunway === null) {
      const evalResult = this.onAnyRunwayProvider?.(snap) ?? null;
      if (evalResult !== null && evalResult.value !== null) {
        (snap as Record<string, unknown>).onAnyRunway = evalResult.value;
        this.runwayInfo = {
          source: evalResult.source,
          value: evalResult.value,
          matchedDesignator: evalResult.matchedDesignator,
          planMismatch: evalResult.planMismatch,
          airportIcao: evalResult.airportIcao,
        };
      }
    }
    // Vía paridad atcOnParkingSpot (misma regla: solo si ausente).
    if (snap.atcOnParkingSpot === undefined || snap.atcOnParkingSpot === null) {
      const parkResult = this.parkingProvider?.(snap) ?? null;
      if (parkResult !== null && parkResult.value !== null) {
        (snap as Record<string, unknown>).atcOnParkingSpot = parkResult.value;
        this.parkingInfo = {
          source: parkResult.source,
          value: parkResult.value,
          standName: parkResult.standName,
          airportIcao: parkResult.airportIcao,
        };
      }
    }
    let key: string;
    try {
      key = JSON.stringify(snap);
    } catch {
      // Si no se puede serializar, tratarla como nueva (fail-open).
      this.lastTelemetryAt = Date.now();
      this.telemetry = snap;
      return true;
    }
    if (key === this.lastSampleKey) {
      this.identicalSampleCount++;
      // Throttle: evento y poll transportan el MISMO snapshot, así que un
      // duplicado aislado es el estado estacionario normal (no un freeze).
      // Solo avisar cuando el estancamiento persiste (~5s, ~10s, ...).
      if (this.identicalSampleCount % 50 === 0) {
        console.warn(
          `[XPlaneFlightController] ⚠️ Telemetría idéntica x${this.identicalSampleCount} (vía ${source}); posible X-Plane congelado — el watchdog marcará desconectado si persiste`
        );
        fileLogger.log('[XPlaneFlightController] Telemetría idéntica (posible freeze)', {
          count: this.identicalSampleCount,
          source,
        });
      }
      return false;
    }
    this.lastSampleKey = key;
    this.identicalSampleCount = 0;
    this.lastTelemetryAt = Date.now();
    this.telemetry = snap;
    return true;
  }

  private async checkHealth(): Promise<void> {
    if (!this.connected || this.reconnectInProgress) return;
    const ageMs = Date.now() - this.lastTelemetryAt;
    if (ageMs < TELEMETRY_STALE_MS) return;

    // Sin datos frescos: la conexión está "verde" pero no hay telemetría real.
    console.warn(`[XPlaneFlightController] ⚠️ Sin telemetría fresca (${ageMs}ms); marcando desconectado y reconectando`);
    fileLogger.log('[XPlaneFlightController] ⚠️ Sin telemetría fresca; reconectando', { ageMs });
    await this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectInProgress) return;
    this.reconnectInProgress = true;
    this.connected = false; // ConnectionStatusService pasará a "desconectado"
    this.clearListeners();

    try {
      await invokeFn("xplane_disconnect");
    } catch (e) {
      fileLogger.log('[XPlaneFlightController] disconnect en reconexión', { error: String(e) });
    }

    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));

    try {
      await this.doConnect();
      logger.telemetry('✅ Reconexión exitosa');
      fileLogger.log('[XPlaneFlightController] Reconexión exitosa');
    } catch (e) {
      console.warn('[XPlaneFlightController] ❌ Reconexión falló (se reintentará)', e);
      fileLogger.log('[XPlaneFlightController] Reconexión falló (se reintentará)', { error: String(e) });
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
