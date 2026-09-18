import { FlightPhase } from "../engine/FlightEngine";
import { RuleEngine } from "./RuleEngine";
import { TimerManager } from "./TimerManager";
import { FlightContext } from "./FlightContext";
import { AnnouncementQueue } from "./AnnouncementQueue";
import { EventDispatcher } from "../dispatcher/EventDispatcher";
import { EventCatalogService } from "../events/EventCatalogService";
import { FlightScenario } from "../scenarios/FlightScenario";
import { ScenarioFactory } from "../scenarios/ScenarioFactory";
import { NarrativeTransition } from "../scenarios/narrative/NarrativeTransition";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { NarrativeEngine } from "../narrative/NarrativeEngine";
import { NarrativeOrchestrator } from "../narrative/NarrativeOrchestrator";
import { ScenarioResolver, ExecutionMode } from "./ScenarioResolver";
import { ScreenResolver } from "./ScreenResolver";
import { ScreenType } from "../types/flightPhase";
import { MusicController } from "./MusicController";
import type { ScenarioDefinition } from "../scenarios/definitions/ScenarioDefinition";
import {
  FIXED_PHASES,
  DEFAULT_FLIGHT_SEQUENCE,
} from "../config/defaultPhaseMapping";
import type { TelemetrySnapshot } from "../types/telemetry";
import { fileLogger } from "./FileLogger";
import type { FlightStartPreferences } from "./FlightContext";
import { ScenarioConfigService } from "./ScenarioConfigService";

// Eventos de demora cuyo umbral (default_delay_ms) puede ser reparametrizado
// en el Backoffice (tabla events) y debe reflejarse en el Desktop.
const DELAY_DETECTION_EVENT_KEYS = [
  "preflight_capt_delay_parked",
  "preflight_capt_delay_taxi",
  "preflight_capt_delay_takeoff",
];

// Re-export para compatibilidad con imports existentes desde Scheduler.
export type { TelemetrySnapshot } from "../types/telemetry";

/** Normaliza los valores del enum FlightPhase a las claves canónicas del mapeo. */
function normalizePhaseKey(phase: FlightPhase | string): string {
  switch (phase) {
    case FlightPhase.APPROACH:
      return "DESCENT";
    case FlightPhase.TAXI_IN:
      return "TAXI_TO_GATE";
    case FlightPhase.FLIGHT_COMPLETED:
      return "AT_GATE";
    default:
      return phase;
  }
}

/** Origen de una transición de fase (para diagnóstico en el monitor). */
export type TransitionSource = 'simulator' | 'user' | 'auto' | 'fallback' | 'doors';

export interface TransitionInfo {
  phase: string;
  from: string | null;
  source: TransitionSource | string;
  label: string;
  time: string;
}

export class Scheduler {
  /**
   * Secuencia canónica de fases de vuelo para el avance automático.
   * GATE y BOARDING quedan fuera: se controlan manualmente (botones de UI /
   * cierre de puertas). A partir de PRE_FLIGHT el vuelo progresa solo.
   */
  private static readonly FLIGHT_SEQUENCE: FlightPhase[] = [
    FlightPhase.PRE_FLIGHT,
    FlightPhase.TAXI,
    FlightPhase.TAKEOFF,
    FlightPhase.CLIMB,
    FlightPhase.CRUISE,
    FlightPhase.DESCENT,
    FlightPhase.LANDING,
    FlightPhase.TAXI_IN,
    FlightPhase.AT_GATE,
  ];

  private ruleEngine: RuleEngine;
  private timerManager: TimerManager;
  private dispatcher: EventDispatcher;
  private flightContext: FlightContext;
  private queue: AnnouncementQueue;
  private currentScenario: FlightScenario | null = null;
  private readonly narrativeEngine: NarrativeEngine;
  private readonly narrativeOrchestrator: NarrativeOrchestrator;
  private readonly scenarioResolver: ScenarioResolver;
  private readonly screenResolver: ScreenResolver;
  private currentMode: ExecutionMode = "normal";
  private currentPhase: string | null = null;
  private doorsClosed = false;
  private boardingStepsCompleted = false;
  private flightStartPreferences: FlightStartPreferences | null = null;
  private forceScenarioRefresh = false;
  private phaseAutoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private specialEventTimerId: string | null = null;
  private readonly SPECIAL_EVENT_DELAY = 30000; // 30 segundos
  private gateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly GATE_ANNOUNCEMENT_DELAY = 10000; // 10 segundos
  private callId = 0;
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private readonly musicController: MusicController;
  // Lock de transición: evita la carrera async donde dos llamadas (startBoarding +
  // fsm.transition → enterPhase) pasan el guard de currentPhase antes de que se
  // actualice tras el await, cargando el escenario dos veces (duplica anuncios).
  private transitionLock = false;
  private delayThresholdsSynced = false;
  // ── Origen de la última transición (diagnóstico para el monitor) ──
  private lastTransitionSource: string = '❓ Desconocido';
  private lastTransitionInfo: TransitionInfo | null = null;

  private getSourceLabel(source: string): string {
    switch (source) {
      case 'simulator': return '🌐 FlightPhaseDetector';
      case 'user': return '👤 Usuario';
      case 'auto': return '📖 Narrativa';
      case 'fallback': return '⏱️ FALLBACK (timer)';
      case 'doors': return '🚪 Puertas cerradas';
      default: return '❓ Desconocido';
    }
  }

  private recordTransition(phase: FlightPhase, from: string | null, source: TransitionSource | string): void {
    const label = source === 'fallback'
      ? '⏱️ FALLBACK (timer de seguridad)'
      : this.getSourceLabel(source);
    this.lastTransitionSource = label;
    this.lastTransitionInfo = {
      phase: normalizePhaseKey(phase),
      from,
      source,
      label,
      time: new Date().toLocaleString('es-ES'),
    };
  }

  /** Origen legible de la última transición exitosa (para el DebugMonitor). */
  getLastTransitionSource(): string {
    return this.lastTransitionSource;
  }

  /** Detalle completo de la última transición exitosa (para el DebugMonitor). */
  getLastTransitionInfo(): TransitionInfo | null {
    return this.lastTransitionInfo;
  }

  /**
   * Sincroniza los umbrales de demora (events.default_delay_ms) desde el
   * Backoffice a FlightContext.delayOverrides. Así el monitor y RuleEngine
   * (que consultan getDelayOverride) usan el MISMO valor reparametrizado.
   */
  private async syncDelayEventThresholds(): Promise<void> {
    if (this.delayThresholdsSynced) return;
    this.delayThresholdsSynced = true;
    try {
      const thresholds = await ScenarioConfigService.loadDelayThresholds(DELAY_DETECTION_EVENT_KEYS);
      for (const [eventKey, ms] of Object.entries(thresholds)) {
        const existing = this.flightContext.getDelayOverride(eventKey);
        if (existing === undefined || existing !== ms) {
          console.log(`[Scheduler] Umbral de demora ${eventKey}: ${ms}ms (${(ms / 60000).toFixed(1)} min) aplicado desde DB`);
          this.flightContext.setDelayOverride(eventKey, ms);
        }
      }
    } catch (err) {
      console.warn("[Scheduler] syncDelayEventThresholds error:", err);
      this.delayThresholdsSynced = false;
    }
  }

  private acquireTransition(phase: FlightPhase, source: TransitionSource | string): boolean {
    if (this.transitionLock) {
      const msg = `[Scheduler] Transición ya en progreso; ignorando ${phase} (${source})`;
      console.warn(msg);
      fileLogger.warn(msg, { phase, source, currentPhase: this.currentPhase });
      return false;
    }
    this.transitionLock = true;
    return true;
  }

  private releaseTransition(): void {
    this.transitionLock = false;
  }

  constructor(
    ruleEngine: RuleEngine,
    timerManager: TimerManager,
    dispatcher: EventDispatcher,
    flightContext: FlightContext,
    queue: AnnouncementQueue,
    scenarioResolver: ScenarioResolver,
    musicController: MusicController
  ) {
    this.ruleEngine = ruleEngine;
    this.timerManager = timerManager;
    this.dispatcher = dispatcher;
    this.flightContext = flightContext;
    this.queue = queue;
    this.scenarioResolver = scenarioResolver;
    this.musicController = musicController;
    this.screenResolver = new ScreenResolver();
    // Vincular el FlightContext al RuleEngine para que lea overrides de umbral
    // (events.default_delay_ms reparametrizado) aunque lo consulte sin ctx.
    try { (this.ruleEngine as any).setFlightContext?.(flightContext); } catch {}
    // Exponer la fase actual al RuleEngine: la condición `fsm` de
    // delay_detection nombra fases ("PRE_FLIGHT"), no el FlightState de UI.
    try { (this.ruleEngine as any).setPhaseProvider?.(() => this.getCurrentPhase()); } catch {}
    this.narrativeEngine = new NarrativeEngine({ scenario: "", steps: [] });
    this.narrativeOrchestrator = new NarrativeOrchestrator(
      this.narrativeEngine,
      EventCatalogService,
      this.dispatcher,
      this.flightContext,
      queue,
      this.timerManager,
      this.ruleEngine
    );

    // El escenario (p. ej. BOARDING) completó todos sus pasos narrativos.
    this.narrativeOrchestrator.on("scenario:completed", () => {
      this.boardingStepsCompleted = true;
      console.log(
        "[Scheduler] Escenario completado: pasos de embarque/pre-vuelo finalizados."
      );
      // Desembarque completado en AT_GATE → detener la música ambiental.
      if (this.currentPhase === "AT_GATE") {
        console.log("[Scheduler] Desembarque completado -> deteniendo música (fade 2s)");
        this.musicController.stopMusic();
      }
      // GATE y BOARDING se controlan manualmente (botón de la UI / cierre de
      // puertas). A partir de PRE_FLIGHT el vuelo avanza a la fase siguiente.
      if (
        this.currentPhase &&
        this.currentPhase !== "GATE" &&
        this.currentPhase !== "BOARDING"
      ) {
        this.advanceAfterNarrative(this.currentPhase);
      }
    });
  }

  async startFlight(mode: ExecutionMode = "normal"): Promise<void> {
    this.currentMode = mode;
    this.doorsClosed = false;
    this.boardingStepsCompleted = false;
    this.clearSpecialEventTimer();
    // Al iniciar un vuelo nuevo la música ambiental de un vuelo anterior se
    // detiene (fade out) hasta que comience el embarque/desembarque.
    this.musicController.stopMusic();
    // Al iniciar un vuelo se fuerza la recarga del escenario desde el Backoffice
    // (se invalida cualquier versión en caché del Desktop).
    this.forceScenarioRefresh = true;
    this.clearPhaseAutoAdvance();
    ScenarioFactory.clearCache();
    // One-shot reset: nuevo vuelo limpia max_once_per_flight en RuleEngine y NarrativeEngine
    try { (this.ruleEngine as any).resetOneShot?.(); } catch {}
    try { (this.narrativeEngine as any).resetFired?.(); } catch {}
    // Sincronizar umbrales de demora reparametrizados en Backoffice (events.default_delay_ms)
    this.delayThresholdsSynced = false;
    this.lastTransitionSource = '❓ Desconocido';
    this.lastTransitionInfo = null;
    await this.syncDelayEventThresholds();
    this.narrativeOrchestrator.setManualMode(mode === "test");
    this.flightContext.setTestMode(mode === "test");
    console.log(`[Scheduler] Vuelo iniciado en modo: ${mode} (forceRefresh: ${this.forceScenarioRefresh})`);

    // Recomponer el funcionamiento según el escenario: el primer paso de puerta
    // (gate_crew_start_soon) se dispara según su AFTER_DELAY medido desde el
    // inicio de la ejecución del escenario (ya no con timer fijo de 10s).
    // this.scheduleGateAnnouncement();
  }

  /**
   * Aplica las preferencias de inicio elegidas en FlightStartPopup.
   * - cold_and_dark → GATE (flujo completo)
   * - gate_engines_on → GATE (con opción de saltar BOARDING)
   * - runway → TAKEOFF (el caller embarca a todos y salta la pantalla de embarque)
   */
  applyFlightStart(preferences: FlightStartPreferences): void {
    this.flightStartPreferences = preferences;
    try {
      this.flightContext.setFlightStartPreferences(preferences);
    } catch {}
    fileLogger.log('[Scheduler] ✈️ Preferencias de inicio aplicadas', preferences);
    console.log('[Scheduler] Preferencias de inicio', preferences);
    if (preferences.initialState === 'gate_engines_on' && !preferences.includeBoarding) {
      this.boardingStepsCompleted = true;
    }
    if (preferences.initialState === 'runway') {
      this.doorsClosed = true;
      this.boardingStepsCompleted = true;
    }
  }

  getFlightStartPreferences(): FlightStartPreferences | null {
    return this.flightStartPreferences;
  }

  /**
   * Reemplaza el `delayMs` del paso `gate_crew_started` (y su par
   * `gate_crew_start_soon`) con el delay elegido por el usuario en el slider,
   * SOLO si el paso tiene `transition: AFTER_DELAY`. Si no lo tiene, se ignora.
   */
  private applyUserDelayOverrides(def: ScenarioDefinition): ScenarioDefinition {
    const userDelayMs = this.flightContext.getDelayOverride("gate_crew_started");
    if (userDelayMs === undefined || userDelayMs <= 0) return def;

    let changed = false;

    const steps = def.steps.map((s) => {
      // Bajo la semántica "delay antes de reproducir", el delay de
      // gate_crew_start_soon se mide desde el inicio del escenario y el de
      // gate_crew_started desde que finalizó el evento anterior. El slider del
      // usuario apunta al segundo evento (respecto del anterior).
      if (s.eventKey !== "gate_crew_started") return s;

      if (s.transition !== NarrativeTransition.AFTER_DELAY) {
        console.log(`[Scheduler] gate_crew_started no tiene AFTER_DELAY; ignorando delay del usuario`);
        fileLogger.log('[Scheduler] gate_crew_started sin AFTER_DELAY; delay ignorado', { transition: NarrativeTransition[s.transition] });
        return s;
      }

      const patched = new NarrativeStep(
        s.id,
        s.eventKey,
        s.transition,
        s.blocking,
        s.optional,
        userDelayMs,
        s.conditions,
        s.parameters,
        s.preconditions,
        s.restrictions,
        s.producers,
        s.detection_strategy,
        s.decision_maker,
        s.scheduler_rule
      );
      changed = true;
      console.log(`[Scheduler] Aplicando delay a ${s.eventKey}:`, {
        stepExists: true,
        transition: NarrativeTransition[s.transition],
        userDelay: userDelayMs / 1000,
        finalDelayMs: userDelayMs,
      });
      fileLogger.log('[Scheduler] Aplicando delay a gate_crew_started', { transition: NarrativeTransition[s.transition], delayMs: userDelayMs, phase: this.currentPhase });
      return patched;
    });

    if (!changed) return def;
    return { ...def, steps };
  }

  setMode(mode: ExecutionMode): void {
    this.currentMode = mode;
    this.narrativeOrchestrator.setManualMode(mode === "test");
    this.flightContext.setTestMode(mode === "test");
    console.log(`[Scheduler] Modo de ejecución: ${mode}`);
  }

  getMode(): ExecutionMode {
    return this.currentMode;
  }

  /**
   * Clave de escenario efectiva según el modo y el escenario del vuelo.
   * - Modo pruebas → `test_scenario`.
   * - Modo normal → el `scenario_key` del vuelo (leído de FlightContext), con
   *   fallback a `standard_commercial_flight`.
   */
  private resolveFlightScenarioKey(): string {
    return this.scenarioResolver.resolveScenarioKey(
      this.currentMode,
      this.flightContext.getScenarioKey()
    );
  }

  async startScenario(name: string): Promise<void> {
    // Lock compartido para evitar cargas concurrentes de escenario
    if (!this.acquireTransition(FlightPhase.GATE, 'user')) return;
    this.callId++;
    const callId = this.callId;

    try {
      console.log("[SCHEDULER TRACE]");
      console.log("action: startScenario");
      console.log("phase: " + "n/a");
      console.log("scenarioBefore: " + (this.currentScenario?.name ?? "null"));
      console.log("scenarioAfter: " + name);
      console.log("reason: ui-boarding-button");
      console.log("callId: " + callId);

      const scenarioKey = this.resolveFlightScenarioKey();
      console.log(`[Scheduler] startScenario (modo: ${this.currentMode}, scenarioKey: ${scenarioKey})`);
      const scenario = await ScenarioFactory.getByName(name, scenarioKey, this.forceScenarioRefresh);
      this.switchScenario(scenario);
    } finally {
      this.releaseTransition();
    }
  }

  async startBoarding(): Promise<void> {
    // Evitar duplicados: si ya estamos en BOARDING, ignorar (el botón también
    // llama fsm.transition(BOARDING) que re-entra a enterPhase).
    if (this.currentPhase === normalizePhaseKey(FlightPhase.BOARDING)) {
      console.warn("[Scheduler] Ya estamos en fase: BOARDING");
      return;
    }
    if (!this.acquireTransition(FlightPhase.BOARDING, 'user')) return;
    this.callId++;
    const callId = this.callId;

    try {
      console.log("[SCHEDULER TRACE]");
      console.log("action: startBoarding");
      console.log("phase: " + "n/a");
      console.log("scenarioBefore: " + (this.currentScenario?.name ?? "null"));
      console.log("reason: ui-boarding-button");
      console.log("callId: " + callId);

      const scenarioKey = this.resolveFlightScenarioKey();
      console.log(`[Scheduler] startBoarding (modo: ${this.currentMode}, scenarioKey: ${scenarioKey}, forceRefresh: ${this.forceScenarioRefresh})`);
      const scenario = await ScenarioFactory.getByName("boarding", scenarioKey, this.forceScenarioRefresh);

      // Re-check tras el await (evita doble carga por carrera)
      if (this.currentPhase === normalizePhaseKey(FlightPhase.BOARDING)) {
        console.warn("[Scheduler] Ya estamos en fase: BOARDING (tras carga)");
        return;
      }

      this.switchScenario(scenario);
      this.currentPhase = normalizePhaseKey(FlightPhase.BOARDING);
      fileLogger.log('[Scheduler] 🔄 Cambio de fase', { from: normalizePhaseKey(FlightPhase.GATE), to: FlightPhase.BOARDING, source: 'user', callId });
      this.emitPhaseEvent(FlightPhase.BOARDING);
      this.emit("phase:changed", { phase: this.currentPhase });
      // Embarque iniciado → reproducir la música ambiental seleccionada.
      console.log("[Scheduler] Embarque iniciado -> iniciando música ambiental");
      void this.musicController.startMusic();
    } finally {
      this.releaseTransition();
    }
  }

  private isValidTransition(from: string | null, to: FlightPhase): boolean {
    if (!from) return true;
    const orderedNormalized: string[] = [
      FlightPhase.GATE,
      FlightPhase.BOARDING,
      FlightPhase.PRE_FLIGHT,
      FlightPhase.TAXI,
      FlightPhase.TAKEOFF,
      FlightPhase.CLIMB,
      FlightPhase.CRUISE,
      normalizePhaseKey(FlightPhase.DESCENT),
      FlightPhase.LANDING,
      normalizePhaseKey(FlightPhase.TAXI_IN),
      normalizePhaseKey(FlightPhase.AT_GATE),
    ];
    const toNorm = normalizePhaseKey(to);
    const fromIdx = orderedNormalized.indexOf(from);
    const toIdx = orderedNormalized.indexOf(toNorm);
    if (fromIdx === -1 || toIdx === -1) return true; // si no está en lista, permitir (fases custom)
    if (toIdx === fromIdx + 1) return true;
    // Transiciones de "recuperación" (espejo de FlightFSM.RECOVERY_TRANSITIONS,
    // en claves normalizadas): el avión puede adelantarse a la narrativa
    // (p. ej. aterriza con el scheduler aún en DESCENT). Sin esto, el
    // Scheduler quedaba clavado tras el aterrizaje aunque el FSM aceptara.
    const recovery = new Set([
      "DESCENT\0LANDING",
      "DESCENT\0TAXI",
      "DESCENT\0TAXI_TO_GATE",
      "LANDING\0TAXI_TO_GATE",
    ]);
    if (recovery.has(from + "\0" + toNorm)) {
      console.log(`[Scheduler] Transición de recuperación aceptada: ${from} → ${toNorm}`);
      return true;
    }
    return false;
  }

  async enterPhase(phase: FlightPhase, source: TransitionSource = 'auto'): Promise<void> {
    console.log('[Scheduler] 🔄 enterPhase llamado:', {
      phase,
      source,
      currentPhase: this.currentPhase,
      stack: new Error().stack,
    });
    if (source === 'fallback') {
      console.warn('[Scheduler] ⚠️ Transición forzada por fallback a', phase);
    }
    const prevPhase = this.currentPhase;

    // Control de fuente: GATE solo simulador, BOARDING solo usuario, PRE_FLIGHT no usuario
    if (phase === FlightPhase.GATE && source !== 'simulator') {
      const msg = '[Scheduler] GATE solo puede ser activada por el simulador';
      console.warn(msg);
      fileLogger.warn(msg, { phase, source });
      return;
    }
    if (phase === FlightPhase.BOARDING && source !== 'user') {
      const msg = '[Scheduler] BOARDING solo puede ser activada por el usuario';
      console.warn(msg);
      fileLogger.warn(msg, { phase, source });
      return;
    }
    // PRE_FLIGHT puede ser activada por el simulador (doorsClosed) o por el usuario vía "Cerrar Puertas"
    // cuando BOARDING está completo. Se permite source 'user' para el botón manual.
    // No bloquear PRE_FLIGHT por source 'user'.

    // Evitar transiciones redundantes (síncrono)
    if (this.currentPhase === normalizePhaseKey(phase)) {
      const msg = `[Scheduler] Ya estamos en fase: ${phase}`;
      console.warn(msg);
      fileLogger.warn(msg, { phase, source, currentPhase: this.currentPhase });
      return;
    }
    if (!this.isValidTransition(this.currentPhase, phase)) {
      const msg = `[Scheduler] Transición inválida: ${this.currentPhase} → ${phase}`;
      console.warn(msg);
      fileLogger.warn(msg, { from: this.currentPhase, to: phase, source });
      return;
    }

    // Lock de transición (evita la carrera async de doble carga de escenario)
    if (!this.acquireTransition(phase, source)) return;

    try {
      this.callId++;
      const callId = this.callId;
      this.clearPhaseAutoAdvance();

      const scenarioKey = this.resolveFlightScenarioKey();
      console.log(
        `[Scheduler] Resolviendo escenario para fase ${phase} (modo: ${this.currentMode}, scenarioKey: ${scenarioKey}, forceRefresh: ${this.forceScenarioRefresh})`
      );
      const scenario = await ScenarioFactory.getForPhase(phase, scenarioKey, this.forceScenarioRefresh);
      const scenarioName = scenario?.name ?? "null";
      const stepsCount = scenario?.definition.steps.length ?? 0;

      // Re-check tras el await: otra llamada pudo completar la misma fase
      if (this.currentPhase === normalizePhaseKey(phase)) {
        console.warn(`[Scheduler] Ya estamos en fase: ${phase} (tras carga)`);
        fileLogger.warn('[Scheduler] Ya en fase tras await', { phase, source });
        return;
      }

      console.log("[SCHEDULER TRACE]");
      console.log("action: enterPhase");
      console.log("phase: " + phase);
      console.log("scenarioBefore: " + (this.currentScenario?.name ?? "null"));
      console.log("scenarioAfter: " + scenarioName);
      console.log("reason: fsm-transition");
      console.log("callId: " + callId);

      console.log("[Scheduler] 🔄 Entrando en fase:", {
        phase,
        hasScenario: !!scenario,
        scenarioKey: scenario?.definition.scenario ?? null,
        steps: stepsCount,
      });
      fileLogger.log('[Scheduler] 🔄 Cambio de fase', { from: prevPhase, to: phase, source, callId });

      this.switchScenario(scenario);
      this.currentPhase = normalizePhaseKey(phase);
      // Guardar el origen de la última transición exitosa (diagnóstico)
      this.recordTransition(phase, prevPhase, source);

      // Fallback de progreso: si una fase de vuelo (PRE_FLIGHT en adelante) no
      // tiene escenario publicado ni pasos narrativos, se avanza automáticamente
      // tras un breve plazo para que el vuelo no quede bloqueado sin opciones.
      if (
        this.currentPhase !== "GATE" &&
        this.currentPhase !== "BOARDING" &&
        stepsCount === 0
      ) {
        console.log(
          `[Scheduler] Fase ${this.currentPhase} sin pasos narrativos; avance automático en 5s`
        );
        this.schedulePhaseAutoAdvance(this.currentPhase, 5000);
      }

      // Sincronizar umbrales de demora desde Backoffice (events.default_delay_ms)
      try { await this.syncDelayEventThresholds(); } catch {}

      this.runPhaseRules(phase);
      this.emitPhaseEvent(phase);
      this.emit("phase:changed", { phase: this.currentPhase });

      // Música ambiental: se inicia en el embarque (BOARDING), en el desembarque
      // (AT_GATE) y se detiene al finalizar el vuelo (FLIGHT_COMPLETED).
      if (phase === FlightPhase.BOARDING) {
        console.log("[Scheduler] Embarque -> iniciando música ambiental");
        void this.musicController.startMusic();
      } else if (phase === FlightPhase.AT_GATE) {
        console.log("[Scheduler] Desembarque (AT_GATE) -> iniciando música ambiental");
        void this.musicController.startMusic();
      } else if (phase === FlightPhase.FLIGHT_COMPLETED) {
        console.log("[Scheduler] Vuelo finalizado -> deteniendo música (fade 2s)");
        this.musicController.stopMusic();
      }

      // Registrar el inicio del crucero para getCruiseProgress() (RuleEngine):
      // zuluTime = segundos desde medianoche UTC; cruise_time de SimBrief
      // está en segundos, por lo que elapsed = zuluTime - cruiseEntryTime.
      if (phase === FlightPhase.CRUISE) {
        try {
          const zuluTime = this.flightContext.getTelemetry().zuluTime;
          const cruiseTimeSeconds = this.flightContext.getFlight().cruiseTimeSeconds;
          console.log('[Scheduler] Registrando cruiseEntryTime:', {
            zuluTime,
            cruiseTimeSeconds,
          });
          if (typeof zuluTime === "number" && !Number.isNaN(zuluTime)) {
            this.flightContext.updateFlight({ cruiseEntryTime: zuluTime });
            console.log("[Scheduler] cruiseEntryTime registrado:", zuluTime);
          } else {
            console.warn("[Scheduler] cruiseEntryTime NO registrado: zuluTime sin dato", { zuluTime });
          }
        } catch (err) {
          console.warn("[Scheduler] cruiseEntryTime NO registrado:", err);
        }
      }

      // Evento especial en cabina: programar solo al entrar en CRUISE
      if (phase === FlightPhase.CRUISE) {
        this.scheduleSpecialEvent();
      } else if (this.specialEventTimerId) {
        console.log("[Scheduler] Cancelando evento especial pendiente al salir de CRUISE");
        this.clearSpecialEventTimer();
      }
    } finally {
      this.releaseTransition();
    }
  }

  on(event: string, callback: (...args: any[]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  private emitPhaseEvent(phase: FlightPhase): void {
    if (phase === FlightPhase.GATE) {
      console.log("[Scheduler] Fase 0 (GATE) entrada -> fase:gate:entered");
      this.emit("phase:gate:entered", { phase: "GATE" });
    } else if (phase === FlightPhase.BOARDING) {
      console.log("[Scheduler] Embarque iniciado -> fase:boarding:started");
      this.emit("phase:boarding:started", { phase: "BOARDING" });
    }
  }

  private switchScenario(scenario: FlightScenario | null): void {
    this.callId++;
    const callId = this.callId;
    const before = this.currentScenario?.name ?? "null";
    const after = scenario?.name ?? "null";
    this.clearPhaseAutoAdvance();

    console.log("[SCHEDULER TRACE]");
    console.log("action: switchScenario");
    console.log("phase: " + "n/a");
    console.log("scenarioBefore: " + before);
    console.log("scenarioAfter: " + after);
    console.log("reason: scenario-switch");
    console.log("callId: " + callId);

    this.currentScenario?.onExit(this.flightContext);

    if (this.currentScenario) {
      console.log("[NARRATIVE]");
      console.log("Cancelling pending transition");
      console.log("↓");
      console.log(this.currentScenario.name);
      this.narrativeOrchestrator.cancelPendingTimers();
    }

    // Cancelar timers de reglas de la fase anterior (ej. GATE priority=20 que
    // dispararían durante BOARDING). Los timers de narrativa ya se cancelaron arriba.
    this.timerManager.cancelAll();
    // Si había un evento especial pendiente y se cambió de fase antes de disparar,
    // limpiar el id para evitar cancelaciones dobles
    if (this.specialEventTimerId) {
      // cancelAll ya lo eliminó; solo resetear el id
      this.specialEventTimerId = null;
    }
    fileLogger.log('[Scheduler] Timers de fase anterior cancelados', { scenarioBefore: before, scenarioAfter: after });

    this.currentScenario = scenario;
    this.currentScenario?.onEnter(this.flightContext);

    // Cada escenario nuevo comienza con sus pasos sin completar.
    this.boardingStepsCompleted = false;

    // Siempre se limpia el estado manual, incluso si el escenario es null
    // (fase sin publicación): evita que pasos pendientes de la fase anterior
    // queden activos en la UI.
    this.narrativeOrchestrator.resetManualState();
    // Limpiar cola para evitar eventos de fase anterior (GATE) en nueva fase (BOARDING)
    this.queue.clear();

    if (!this.currentScenario) {
      console.log("[Scheduler] Sin escenario para esta fase; no se ejecuta narrativa.");
      return;
    }

    this.validateScenarioPhases();

    const def = this.currentScenario.definition;

    // Log de fase al entrar: primer paso y todos los pasos (diagnóstico)
    console.log('[Scheduler] Entrando en fase:', {
      phase: this.currentPhase,
      firstStep: def.steps[0]?.eventKey,
      allSteps: def.steps.map((s) => s.eventKey),
    });

    // Configuración de pasos WAIT_CONDITION (preconditions/restrictions/orden).
    // Incluye TODOS los WAIT para detectar eventos inesperados que se ejecuten
    // (p.ej. preflight_capt_delay si aparece publicado aunque no se use).
    for (const s of def.steps) {
      if (s.transition === NarrativeTransition.WAIT_CONDITION) {
        console.log(`[Scenario] Configuración WAIT_CONDITION ${s.eventKey}:`, {
          eventKey: s.eventKey,
          order: s.id,
          transition: NarrativeTransition[s.transition],
          optional: s.optional,
          blocking: s.blocking,
          preconditions: (s as any).preconditions,
          restrictions: (s as any).restrictions,
          scheduler_rule: s.scheduler_rule,
          detection_strategy: (s as any).detection_strategy,
          decision_maker: (s as any).decision_maker,
        });
      }
    }

    console.log("[SCENARIO]");
    console.log("");
    console.log(def.scenario);
    console.log("↓");
    console.log("Definition loaded");
    console.log("↓");
    console.log(def.steps.length + " Narrative Steps");
    console.log("↓");
    def.steps.forEach((step, i) => {
      console.log("#" + step.id);
      console.log(step.eventKey);
      console.log("Transition: " + NarrativeTransition[step.transition]);
      if (i < def.steps.length - 1) {
        console.log("↓");
      }
    });

    // Reiniciar narrativa al entrar en fase (evita GATE repetidos en BOARDING)
    console.log('[NarrativeOrchestrator] Cargando fase:', {
      phase: this.currentPhase,
      firstStep: def.steps[0]?.eventKey,
      totalSteps: def.steps.length,
    });
    fileLogger.log('[Scheduler] Cargando fase', { phase: this.currentPhase, firstStep: def.steps[0]?.eventKey, totalSteps: def.steps.length });

    // Aplica el delay de gate_crew_started elegido por el usuario (si existe)
    // al paso del escenario ANTES de que la narrativa se ejecute.
    const defToLoad = this.applyUserDelayOverrides(def);
    this.narrativeEngine.load(defToLoad);
    this.narrativeEngine.reset();

    console.log("[NARRATIVE]");
    console.log("Scenario loaded");
    console.log("↓");
    console.log("Current Step");
    console.log("↓");
    console.log(this.narrativeEngine.currentStep()?.eventKey);

    console.log("[SCHEDULER TRACE]");
    console.log("action: switchScenario.afterLoad");
    console.log("phase: " + "n/a");
    console.log("scenarioBefore: " + before);
    console.log("scenarioAfter: " + after);
    console.log("reason: scenario-switch-completed");
    console.log("callId: " + callId);
    console.log("currentStepEvent: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));

    this.narrativeOrchestrator.executeCurrentStep("scheduler:switchScenario");
  }

  private runPhaseRules(phase: FlightPhase): void {
    const narrativeKeys = new Set(
      this.currentScenario?.definition.steps.map((s) => s.eventKey) ?? []
    );

    const actions = this.ruleEngine.enterPhase(
      phase,
      this.flightContext,
      this.currentScenario?.definition.steps
    );
    for (const action of actions) {
      if (narrativeKeys.has(action.event)) {
        console.log("[Scheduler] Skipping ruleEngine dispatch for narrative event: " + action.event);
        continue;
      }

      if (action.type === "timer") {
        console.log("[Scheduler] Scheduling " + action.event + " in " + action.delayMs + "ms (id=" + action.id + ")");
        this.timerManager.schedule({
          id: action.id,
          delayMs: action.delayMs,
          event: action.event,
        });
        continue;
      }

      const eventDef = EventCatalogService.get(action.event);
      if (eventDef) {
        this.dispatcher.dispatch(eventDef, this.flightContext).catch((err) => {
          console.error('[Scheduler] ❌ dispatch fallido (phase rules):', { event: action.event, error: (err as Error)?.message ?? String(err) });
        });
      }
    }
  }

  leavePhase(_phase: FlightPhase): void {
    // reserved for future use
  }

  confirmStep(stepKey: string): void {
    this.narrativeOrchestrator.confirmUserStep(stepKey);
  }

  nextManualStep(): boolean {
    return this.narrativeOrchestrator.nextManualStep();
  }

  skipStep(): boolean {
    return this.narrativeOrchestrator.skipStep();
  }

  getNarrativeOrchestrator(): NarrativeOrchestrator {
    return this.narrativeOrchestrator;
  }

  getNarrativeEngine(): NarrativeEngine {
    return this.narrativeEngine;
  }

  notifyEvent(_event: string): void {
    // reserved for future use
  }

  notifyTelemetry(data: TelemetrySnapshot): void {
    // Detección automática del cierre de puertas desde el simulador.
    if (data.doorsClosed) {
      this.notifyDoorsClosed();
    }
  }

  // ── Cierre de puertas (automático + manual) ──────────────────────

  /**
   * Cierre de puertas manual (fallback de la UI).
   * Solo tiene efecto si la fase actual es BOARDING y los pasos de
   * embarque están completados. Si hay un paso opcional WAIT_CONDITION
   * pendiente (ej. preflight_capt_delay_parked no disparado), se omite
   * para no bloquear el cierre — el delay es opcional.
   * Transiciona a PRE_FLIGHT (permitido desde 'user' tras el fix de enterPhase).
   */
  closeDoors(): void {
    if (this.currentPhase !== "BOARDING") {
      console.warn(
        `[Scheduler] Cierre de puertas ignorado: fase actual ${this.currentPhase ?? "n/a"} (se requiere BOARDING).`
      );
      return;
    }

    // El cierre solo exige el embarque de pasajeros completo (lo garantiza la
    // UI habilitando el botón). Los pasos OPCIONALES pendientes (demoras no
    // disparadas, sea cual sea su transición) se omiten automáticamente para
    // no bloquear el cierre. Solo los pasos NO opcionales bloquean.
    if (!this.boardingStepsCompleted) {
      try { this.narrativeOrchestrator.cancelPendingTimers(); } catch {}
      while (!this.narrativeEngine.isCompleted()) {
        const cur = this.narrativeEngine.currentStep();
        if (!cur || !cur.optional) break;
        console.log(`[Scheduler] Cierre de puertas: omitiendo paso opcional pendiente ${cur.eventKey} (${NarrativeTransition[cur.transition]})`);
        this.narrativeEngine.onStepCompleted();
      }
      if (this.narrativeEngine.isCompleted()) {
        this.boardingStepsCompleted = true;
        console.log("[Scheduler] BOARDING completado tras omitir opcionales, habilitando cierre");
      } else if (!this.narrativeEngine.hasPendingSteps()) {
        // Sin pendientes no opcionales: no bloquear indefinidamente.
        this.boardingStepsCompleted = true;
      } else {
        console.warn("[Scheduler] Cierre de puertas bloqueado: pasos de BOARDING no opcionales pendientes", {
          pendingSteps: this.narrativeEngine.getPendingSteps(),
        });
        return;
      }
    }

    this.doorsClosed = true;
    console.log("[Scheduler] Cierre de puertas (manual) -> PRE_FLIGHT");
    this.musicController.stopMusic();
    // PRE_FLIGHT ahora permitido desde 'user' (botón) o 'simulator' (puertas). Usar 'user' para traza.
    void this.enterPhase(FlightPhase.PRE_FLIGHT, 'user');
  }

  /**
   * Cierre de puertas automático detectado desde el simulador
   * (FlightController / telemetría). Transiciona a PRE_FLIGHT.
   * Solo si BOARDING está completado (evita transición temprana).
   * Si hay un WAIT_CONDITION opcional pendiente, se omite para no bloquear.
   */
  notifyDoorsClosed(): void {
    if (this.doorsClosed || this.currentPhase !== "BOARDING") return;

    if (!this.boardingStepsCompleted) {
      // Mismo criterio que el cierre manual: omitir opcionales pendientes.
      try { this.narrativeOrchestrator.cancelPendingTimers(); } catch {}
      while (!this.narrativeEngine.isCompleted()) {
        const cur = this.narrativeEngine.currentStep();
        if (!cur || !cur.optional) break;
        console.log(`[Scheduler] notifyDoorsClosed: omitiendo opcional ${cur.eventKey} para PRE_FLIGHT`);
        this.narrativeEngine.onStepCompleted();
      }
      if (this.narrativeEngine.isCompleted() || !this.narrativeEngine.hasPendingSteps()) {
        this.boardingStepsCompleted = true;
      }
      if (!this.boardingStepsCompleted) {
        const msg = "[Scheduler] Puertas cerradas (simulador) pero BOARDING no completado; ignorado";
        console.warn(msg);
        fileLogger.warn(msg, { currentPhase: this.currentPhase, boardingStepsCompleted: this.boardingStepsCompleted });
        return;
      }
    }

    this.doorsClosed = true;
    console.log("[Scheduler] Cierre de puertas detectado desde el simulador -> PRE_FLIGHT");
    fileLogger.log('[Scheduler] Cierre de puertas (simulador) -> PRE_FLIGHT', { boardingStepsCompleted: this.boardingStepsCompleted });
    this.musicController.stopMusic();
    void this.enterPhase(FlightPhase.PRE_FLIGHT, 'doors');
  }

  isBoardingStepsCompleted(): boolean {
    return this.boardingStepsCompleted;
  }

  areDoorsClosed(): boolean {
    return this.doorsClosed;
  }

  // ── Avance automático de fase ────────────────────────────────────

  /**
   * Avanza a la fase siguiente de la secuencia canónica cuando la narrativa
   * de la fase actual se completa (scenario:completed).
   */
  private advanceAfterNarrative(phase: string, source: TransitionSource = 'auto'): void {
    const seq = Scheduler.FLIGHT_SEQUENCE;
    const normalized = normalizePhaseKey(phase);
    const idx = seq.findIndex((p) => normalizePhaseKey(p) === normalized);
    if (idx < 0 || idx >= seq.length - 1) {
      console.log(`[Scheduler] Fase ${normalized} sin siguiente fase (fin de secuencia)`);
      return;
    }
    try {
      console.log('[Scheduler] 🔄 Verificando finalización de fase:', {
        phase: this.currentPhase,
        allStepsCompleted: this.narrativeEngine.isPhaseComplete(),
        hasPendingWaitConditions: this.narrativeEngine.hasPendingWaitConditions(),
        pendingSteps: this.narrativeEngine.getPendingSteps(),
      });
    } catch {}
    // Guard: no avanzar si quedan WAIT_CONDITION no opcionales pendientes
    // (evita saltar transition_to_taxi antes de cumplir la telemetría).
    try {
      if (this.narrativeEngine.hasPendingWaitConditions()) {
        console.warn('[Scheduler] ⛔ No se puede avanzar: hay pasos WAIT_CONDITION pendientes', {
          phase: this.currentPhase,
          pendingSteps: this.narrativeEngine.getPendingSteps(),
        });
        return;
      }
    } catch {}
    const next = seq[idx + 1];
    console.log(`[Scheduler] 🚗 Avance automático de fase: ${normalized} -> ${normalizePhaseKey(next)} (${source})`);
    void this.enterPhase(next, source);
  }

  /** Programa un avance automático de fase para fases sin escenario publicada. */
  private schedulePhaseAutoAdvance(phase: string, delayMs: number): void {
    this.clearPhaseAutoAdvance();
    this.phaseAutoAdvanceTimer = setTimeout(() => {
      this.phaseAutoAdvanceTimer = null;
      console.log(`[Scheduler] Fallback: avanzando desde ${phase} sin escenario`);
      this.advanceAfterNarrative(phase, 'fallback');
    }, delayMs);
  }

  private clearPhaseAutoAdvance(): void {
    if (this.phaseAutoAdvanceTimer) {
      clearTimeout(this.phaseAutoAdvanceTimer);
      this.phaseAutoAdvanceTimer = null;
    }
  }

  // ── Aviso de puerta automático (gate_crew_start_soon, 10s tras inicio) ──
  //
  // Se dispara 10s después de que el vuelo comienza (sin importar la fase
  // inicial) salvo que:
  //   1. El vuelo comenzó en cabecera de pista (initialState === 'runway').
  //   2. El avión está en tierra pero NO en una puerta de embarque
  //      (simOnGround = true y atcOnParkingSpot = false).

  private scheduleGateAnnouncement(): void {
    this.clearGateTimer();
    const telemetry = this.flightContext.getTelemetry();
    const prefs = this.flightContext.getFlightStartPreferences();

    // 1. Omitir si comenzó en cabecera de pista
    if (prefs?.initialState === 'runway') {
      console.log('[Scheduler] Omitiendo gate_crew_start_soon (inicio en pista)');
      fileLogger.log('[Scheduler] Omitiendo gate_crew_start_soon (inicio en pista)', { initialState: prefs.initialState });
      return;
    }

    // 2. Omitir si está en tierra pero no en una puerta de embarque
    if (telemetry.simOnGround === true && telemetry.atcOnParkingSpot === false) {
      console.log('[Scheduler] Omitiendo gate_crew_start_soon (fuera de puerta)');
      fileLogger.log('[Scheduler] Omitiendo gate_crew_start_soon (fuera de puerta)', {
        simOnGround: telemetry.simOnGround,
        atcOnParkingSpot: telemetry.atcOnParkingSpot,
      });
      return;
    }

    console.log(`[Scheduler] ⏱️ Programando gate_crew_start_soon en ${this.GATE_ANNOUNCEMENT_DELAY / 1000} segundos`);
    fileLogger.log('[Scheduler] Programando gate_crew_start_soon', { delayMs: this.GATE_ANNOUNCEMENT_DELAY });

    this.gateTimer = setTimeout(() => {
      this.gateTimer = null;
      console.log('[Scheduler] 🎯 Ejecutando gate_crew_start_soon');
      fileLogger.log('[Scheduler] Ejecutando gate_crew_start_soon');
      this.triggerGateAnnouncement();
    }, this.GATE_ANNOUNCEMENT_DELAY);
  }

  private triggerGateAnnouncement(): void {
    const step = this.narrativeEngine.findStepByEventKey("gate_crew_start_soon");
    const def = EventCatalogService.get("gate_crew_start_soon");
    if (!def) {
      console.warn('[Scheduler] gate_crew_start_soon no está en el catálogo');
      return;
    }
    if (step) {
      console.log('[Scheduler] 🎯 Disparando paso narrative gate_crew_start_soon');
      this.narrativeOrchestrator.executeStep(step, def, "auto");
    } else {
      console.log('[Scheduler] 🎯 Dispatch fallback gate_crew_start_soon vía dispatcher');
      this.dispatcher.dispatch(def, this.flightContext).catch((err) => {
        console.error('[Scheduler] ❌ dispatch fallido (gate fallback):', { event: def.eventKey, error: (err as Error)?.message ?? String(err) });
      });
    }
  }

  private clearGateTimer(): void {
    if (this.gateTimer !== null) {
      clearTimeout(this.gateTimer);
      this.gateTimer = null;
    }
  }

  // ── Evento especial en cabina (CRUISE + 30s) ──────────────────────

  private scheduleSpecialEvent(): void {
    const flight = this.flightContext.getFlight();

    // Solo si está habilitado y hay texto
    if (!flight?.specialEventEnabled || !flight?.specialEvent || flight.specialEvent.trim() === "") {
      console.log("[Scheduler] Evento especial no habilitado o sin texto");
      return;
    }

    console.log(`[Scheduler] ⏱️ Programando evento especial en ${this.SPECIAL_EVENT_DELAY / 1000} segundos`);
    console.log(`[Scheduler] 📝 Texto: "${flight.specialEvent}"`);

    // Cancelar timer previo si existe
    this.clearSpecialEventTimer();

    const id = `special-event:${Date.now()}`;
    this.specialEventTimerId = id;
    this.timerManager.schedule({
      id,
      delayMs: this.SPECIAL_EVENT_DELAY,
      event: "captain_special_event",
      onFire: () => {
        this.specialEventTimerId = null;
        console.log("[Scheduler] 🎉 Ejecutando evento especial");
        this.triggerSpecialEvent();
      },
    });
  }

  private triggerSpecialEvent(): void {
    const flight = this.flightContext.getFlight();
    if (!flight?.specialEvent || !flight?.specialEventEnabled) {
      console.warn("[Scheduler] Evento especial no disponible");
      return;
    }

    console.log("[Scheduler] 🎉 Ejecutando evento especial con texto:", flight.specialEvent);

    const step = this.narrativeEngine.findStepByEventKey("captain_special_event");
    if (step) {
      const def = EventCatalogService.get(step.eventKey);
      if (def) {
        console.log("[Scheduler] 🎉 Disparando paso narrative captain_special_event");
        this.narrativeOrchestrator.executeStep(step, def, "auto");
      } else {
        console.warn("[Scheduler] Evento especial definición no encontrada en catálogo para:", step.eventKey);
        // Fallback: intentar dispatch directo
        const fallbackDef = EventCatalogService.get("captain_special_event");
        if (fallbackDef) {
          this.dispatcher.dispatch(fallbackDef, this.flightContext).catch((err) => {
            console.error('[Scheduler] ❌ dispatch fallido (special event):', { event: fallbackDef.eventKey, error: (err as Error)?.message ?? String(err) });
          });
        }
      }
    } else {
      console.warn("[Scheduler] Evento especial no encontrado en el escenario");
      // Fallback: dispatch directo si el escenario no contiene el paso pero el catálogo sí
      const fallbackDef = EventCatalogService.get("captain_special_event");
      if (fallbackDef) {
        console.log("[Scheduler] 🎉 Dispatch fallback captain_special_event vía dispatcher");
        this.dispatcher.dispatch(fallbackDef, this.flightContext).catch((err) => {
          console.error('[Scheduler] ❌ dispatch fallido (special event fallback):', { event: fallbackDef.eventKey, error: (err as Error)?.message ?? String(err) });
        });
      }
    }
  }

  private clearSpecialEventTimer(): void {
    if (this.specialEventTimerId) {
      this.timerManager.cancel(this.specialEventTimerId);
      this.specialEventTimerId = null;
    }
  }

  /**
   * Fases del stepper, construidas a partir del escenario cargado.
   *
   * Reglas:
   *  1. GATE y BOARDING siempre están presentes (fijas), en ese orden.
   *  2. La secuencia canónica de vuelo define el ORDEN de progresión (estable,
   *     independiente de la fase actual).
   *  3. Las fases adicionales que defina el escenario (personalizadas) se
   *     agregan al final, sin alterar la secuencia canónica.
   *
   * Nota: cada fase se carga como un escenario propio (con `phases: [fase]`),
   * por lo que NO se usa el orden del escenario actual para ordenar el stepper:
   * hacerlo reordenaría las fases cada vez que cambia la fase activa.
   */
  getScenarioPhases(): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    // 1. Fases fijas (GATE, BOARDING), siempre al inicio y en ese orden.
    for (const fixed of FIXED_PHASES) {
      if (!seen.has(fixed)) {
        result.push(fixed);
        seen.add(fixed);
      }
    }

    // 2. Secuencia canónica de vuelo: orden de progresión.
    for (const phase of DEFAULT_FLIGHT_SEQUENCE) {
      if (!seen.has(phase)) {
        result.push(phase);
        seen.add(phase);
      }
    }

    // 3. Fases extra del escenario (personalizadas) al final, en su orden.
    const scenarioPhases = this.currentScenario?.phases ?? [];
    for (const phase of scenarioPhases) {
      if (!seen.has(phase)) {
        result.push(phase);
        seen.add(phase);
      }
    }

    return result;
  }

  getCurrentPhase(): string | null {
    return this.currentPhase;
  }

  resolveScreenType(phaseKey: string): ScreenType {
    return this.screenResolver.resolveScreenType(phaseKey);
  }

  isFixedPhase(phaseKey: string): boolean {
    return this.screenResolver.isFixedPhase(phaseKey);
  }

  isRequiredPhase(phaseKey: string): boolean {
    return this.screenResolver.isRequiredPhase(phaseKey);
  }

  getScreenResolver(): ScreenResolver {
    return this.screenResolver;
  }

  /**
   * Verifica que las fases fijas/obligatorias existan en el escenario cargado.
   * Si no existen, la UI sigue funcionando mostrando las pantallas por defecto
   * (sin eventos asociados).
   */
  private validateScenarioPhases(): void {
    const scenarioPhases = this.currentScenario?.phases ?? [];

    if (!scenarioPhases.includes("GATE")) {
      console.warn(
        "[ScreenResolver] Fase GATE no encontrada en el escenario. Usando fallback."
      );
      console.warn(
        "[Scheduler] Fase GATE no encontrada en el escenario. La UI mostrará pre-embarque sin eventos."
      );
    }

    if (!scenarioPhases.includes("BOARDING")) {
      console.warn(
        "[ScreenResolver] Fase BOARDING no encontrada en el escenario. Usando fallback."
      );
      console.warn(
        "[Scheduler] Fase BOARDING no encontrada en el escenario. La UI mostrará embarque sin eventos."
      );
    }
  }
}
