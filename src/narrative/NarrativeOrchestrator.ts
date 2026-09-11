import { EventCatalogService } from "../events/EventCatalogService";
import { EventDispatcher } from "../dispatcher/EventDispatcher";
import { FlightContext } from "../services/FlightContext";
import { AnnouncementQueue } from "../services/AnnouncementQueue";
import { TimerManager } from "../services/TimerManager";
import { NarrativeEngine } from "./NarrativeEngine";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { NarrativeTransition } from "../scenarios/narrative/NarrativeTransition";
import { EventDefinition } from "../events/types";
import { fileLogger } from "../services/FileLogger";

// Tiempo máximo de espera por la finalización del audio de un paso antes de
// avanzar la narrativa. Es un safety net; debe cubrir el audio más largo del
// sistema (p. ej. taxi_crew_safety_brief ≈ 90 s).
const AUDIO_TIMEOUT = 120000; // 120 segundos (2 minutos)

export interface StepPendingEvent {
  step: NarrativeStep;
  index: number;
  total: number;
}

export interface StepExecutedEvent {
  step: NarrativeStep;
  index: number;
  mode: "manual" | "auto";
}

export interface StepSkippedEvent {
  step: NarrativeStep;
  index: number;
}

export interface ScenarioCompletedEvent {
  totalSteps: number;
}

export type NarrativeOrchestratorEvent =
  | StepPendingEvent
  | StepExecutedEvent
  | StepSkippedEvent
  | ScenarioCompletedEvent;

/** Traza temporal del ancla transition_to_taxi (panel "Diagnóstico del Ancla"). */
export interface AnchorTraceEntry {
  action: 'evaluando' | 'bloqueado' | 'completado_sin_evaluacion' | 'completado_por_condicion';
  origin: string;
  timestamp: string;
  evaluated: boolean;
  met: boolean | null;
  stack: string[];
}

export class NarrativeOrchestrator {
  private readonly narrativeEngine: NarrativeEngine;
  private readonly eventCatalog: typeof EventCatalogService;
  private readonly dispatcher: EventDispatcher;
  private readonly flightContext: FlightContext;
  private readonly timerManager: TimerManager;
  private readonly pendingTimers = new Set<string>();
  private readonly pendingUserSteps = new Set<string>();
  private readonly pendingExternalSteps = new Set<string>();
  private readonly eventListeners = new Map<string, Set<(payload: any) => void>>();
  private currentProducer = "scheduler";
  private execCounter = 0;
  private isTestMode = false;
  private pendingStep: NarrativeStep | null = null;
  private waitingForAudio = false;
  private manualAudioWaitTimer: ReturnType<typeof setTimeout> | null = null;
  // Época del escenario: se incrementa en cada resetManualState (cambio de fase).
  // Permite descartar "announcement completed" obsoletos de la fase anterior que
  // podrían avanzar la narrativa de la fase nueva.
  private scenarioEpoch = 0;
  private waitingEpoch = -1;
  // RuleEngine inyectado para evaluar WAIT_CONDITION delay_detection de forma independiente por evento
  private ruleEngine?: any;
  // Eventos de demora conocidos (guard robusto aunque preconditions llegue con otra forma)
  private static readonly DELAY_DETECTION_EVENTS = new Set([
    "preflight_capt_delay_parked",
    "preflight_capt_delay_taxi",
  ]);

  constructor(
    narrativeEngine: NarrativeEngine,
    eventCatalog: typeof EventCatalogService,
    dispatcher: EventDispatcher,
    flightContext: FlightContext,
    queue: AnnouncementQueue,
    timerManager: TimerManager,
    ruleEngine?: any
  ) {
    this.narrativeEngine = narrativeEngine;
    this.eventCatalog = eventCatalog;
    this.dispatcher = dispatcher;
    this.flightContext = flightContext;
    this.timerManager = timerManager;
    this.ruleEngine = ruleEngine;

    queue.on("completed", this.handleAnnouncementCompleted);
    queue.on("error", this.handleAnnouncementError);
  }

  on(event: string, callback: (payload: any) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    return () => {
      this.eventListeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, payload: any): void {
    this.eventListeners.get(event)?.forEach((cb) => cb(payload));
  }

  private handleAnnouncementCompleted = (completedEventKey?: string): void => {
    // Época obsoleta: la fase/escenario cambió; ignorar completion de la fase anterior.
    if (this.waitingEpoch !== -1 && this.waitingEpoch !== this.scenarioEpoch) {
      console.warn(
        `[NarrativeOrchestrator] Completion obsoleto (época ${this.waitingEpoch} vs ${this.scenarioEpoch}) ignorado: ${completedEventKey ?? "?"}`
      );
      fileLogger.warn('[NarrativeOrchestrator] Completion obsoleto ignorado', { completedEventKey, waitingEpoch: this.waitingEpoch, scenarioEpoch: this.scenarioEpoch });
      this.waitingForAudio = false;
      return;
    }

    const step = this.narrativeEngine.currentStep();
    if (!step) {
      console.log("[NARRATIVE TRACE]");
      console.log("action: handleAnnouncementCompleted");
      console.log("executionId: " + this.execCounter);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: null");
      console.log("transition: null");
      console.log("reason: no-active-step");
      console.log("completedEventKey: " + (completedEventKey ?? "undefined"));
      console.log("[NARRATIVE]");
      console.log("No active step");
      console.log("Ignoring completion");
      return;
    }

    console.log("[NARRATIVE TRACE]");
    console.log("action: handleAnnouncementCompleted");
    console.log("executionId: " + this.execCounter);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + step.eventKey);
    console.log("transition: " + NarrativeTransition[step.transition]);
    console.log("reason: completed-event");
    console.log("completedEventKey: " + (completedEventKey ?? "undefined"));

    console.log("[NARRATIVE]");
    console.log("Completed event received");
    console.log("Event: " + (completedEventKey ?? "(unknown)"));
    console.log("Current Step: " + step.eventKey);

    if (completedEventKey && completedEventKey !== step.eventKey) {
      console.log("Match: NO");
      console.log("Ignoring completion");
      return;
    }

    console.log("Match: YES");

    // Bajo la semántica actual, AFTER_DELAY ya se reprodujo (su delay fue
    // PREVIO a la reproducción); al completarse el audio se avanza al siguiente.
    // AFTER_COMPLETION avanza al completarse el audio. WAIT_CONDITION (ej.
    // preflight_capt_delay_parked opcional) también debe avanzar tras el audio,
    // de lo contrario BOARDING queda bloqueada y "Cerrar Puertas" nunca se habilita.
    // En modo pruebas (`waitingForAudio`) cualquier transición avanza al completar el audio.
    if (
      step.transition === NarrativeTransition.AFTER_COMPLETION ||
      step.transition === NarrativeTransition.AFTER_DELAY ||
      step.transition === NarrativeTransition.WAIT_CONDITION ||
      this.waitingForAudio
    ) {
      console.log(`[NarrativeOrchestrator] ✅ Audio completado para: ${step.eventKey}`);
      // Log de auditoría WAIT_CONDITION
      if (step.transition === NarrativeTransition.WAIT_CONDITION) {
        console.log('[NarrativeEngine] Estado del paso:', {
          eventKey: step.eventKey,
          isCompleted: this.narrativeEngine.isStepCompleted(step.eventKey),
          currentIndex: this.narrativeEngine.currentIndex(),
          totalSteps: this.narrativeEngine.getTotalSteps(),
          nextStep: (this.narrativeEngine as any).definition?.steps?.[this.narrativeEngine.currentIndex() + 1]?.eventKey ?? null,
        });
      }
      this.advanceNarrative("announcement-completed");
    }
  };

  // Si el audio falla mientras se espera el avance manual (generación o
  // reproducción), se avanza igualmente con una advertencia para no bloquear
  // la narrativa. En modo normal `waitingForAudio` es false y se ignora.
  private handleAnnouncementError = (msg?: string): void => {
    const step = this.narrativeEngine.currentStep();
    const isDelayOptionalStep = !!step && this.isDelayDetectionWaitStep(step) && step.optional;

    if (!this.waitingForAudio && !isDelayOptionalStep) return;
    if (!msg) return;

    console.warn(
      `[NarrativeOrchestrator] Error de audio durante ${this.waitingForAudio ? "avance manual" : "paso de demora opcional"}: ${msg}`
    );
    fileLogger.warn('[NarrativeOrchestrator] Error de audio', {
      msg,
      waitingForAudio: this.waitingForAudio,
      step: step?.eventKey ?? null,
      isDelayOptionalStep,
    });
    // Si el paso de demora opcional no tiene audio disponible (p. ej. evento
    // nuevo sin audio_raw ni prompt IA publicado), NO bloquear la fase: se
    // omite y la narrativa continúa (mismo criterio que cerrar puertas con
    // delay opcional pendiente).
    if (isDelayOptionalStep) {
      this.emit("step:skipped", {
        step,
        index: this.narrativeEngine.currentIndex(),
      } as StepSkippedEvent);
    }
    this.advanceNarrative(isDelayOptionalStep ? "delay-step-no-audio" : "announcement-error");
  };

  executeCurrentStep(reason?: string, force = false): void {
    this.execCounter++;
    const executionId = this.execCounter;
    fileLogger.log('[NarrativeOrchestrator] executeCurrentStep', { reason: reason ?? 'unknown', force, executionId, scenario: this.narrativeEngine.getScenarioName(), step: this.narrativeEngine.currentStep()?.eventKey ?? null, isTestMode: this.isTestMode });

    // Guard (Stage 18D): a completed scenario must never execute another step.
    if (this.narrativeEngine.isCompleted()) {
      console.log("[NARRATIVE TRACE]");
      console.log("action: executeCurrentStep");
      console.log("executionId: " + executionId);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: null");
      console.log("transition: null");
      console.log("reason: scenario-completed-guard");
      return;
    }

    const step = this.narrativeEngine.currentStep();
    if (!step) {
      console.log("[NARRATIVE TRACE]");
      console.log("action: executeCurrentStep");
      console.log("executionId: " + executionId);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: null");
      console.log("transition: null");
      console.log("reason: " + (reason ?? "unknown"));
      return;
    }

    console.log("[NARRATIVE TRACE]");
    console.log("action: executeCurrentStep");
    console.log("executionId: " + executionId);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + step.eventKey);
    console.log("transition: " + NarrativeTransition[step.transition]);
    console.log("reason: " + (reason ?? "unknown"));

    console.log(
      `[NarrativeOrchestrator] Ejecutando paso ${step.eventKey} (modo: ${
        this.isTestMode ? "pruebas" : "normal"
      })`
    );

    console.log("[NarrativeOrchestrator] Evaluando paso:", {
      eventKey: step.eventKey,
      decision_maker: step.decision_maker,
      detection_strategy: step.detection_strategy,
      isManualMode: this.isTestMode,
    });

    // One-shot guard: max_once_per_flight — si ya se disparó, saltar al siguiente paso
    if ((step as any).restrictions?.max_once_per_flight && this.narrativeEngine.hasFired(step.eventKey)) {
      console.log(`[NarrativeOrchestrator] Skipping ${step.eventKey}: max_once_per_flight ya disparado`);
      fileLogger.log('[NarrativeOrchestrator] max_once_per_flight skip', { eventKey: step.eventKey });
      this.advanceNarrative("max_once_per_flight");
      return;
    }

    // Condición nocturna: pasos con restrictions.preferred_condition =
    // "is_night_flight" solo se ejecutan de noche; de día se OMITEN (no
    // bloquean la secuencia). Ej.: taxi_crew_dimlights.
    if (!force && (step as any).restrictions?.preferred_condition === "is_night_flight") {
      let isNight = false;
      try {
        const engine: any = this.ruleEngine;
        if (typeof engine?.isNightFlight === "function") {
          isNight = engine.isNightFlight(this.flightContext) === true;
        }
      } catch {
        isNight = false;
      }
      if (!isNight) {
        console.log(`[NarrativeOrchestrator] 🌙 Omitiendo ${step.eventKey}: requiere vuelo nocturno y es de día`);
        fileLogger.log('[NarrativeOrchestrator] Paso diurno omitido (requiere noche)', { eventKey: step.eventKey });
        this.emit("step:skipped", {
          step,
          index: this.narrativeEngine.currentIndex(),
        } as StepSkippedEvent);
        this.advanceNarrative("not-night-skipped");
        return;
      }
    }

    // Modo pruebas: un paso con decisión de usuario o detección manual se pone
    // en espera para que el usuario lo avance paso a paso desde la UI. Los
    // pasos automáticos siguen ejecutándose sin intervención.
    if (!force && this.isTestMode && this.isManualStep(step)) {
      this.holdForManualAction(step, executionId);
      return;
    }

    if (!force && this.isTestMode) {
      console.log(
        `[NarrativeOrchestrator] Paso automático en modo pruebas: ${step.eventKey}`
      );
    }

    // Stage 19C: validar que el productor actual esté permitido para este paso.
    // En modo pruebas no se valida el productor: los pasos manuales esperan y
    // los automáticos se ejecutan directamente.
    if (!force && !this.isTestMode && step.producers && step.producers.length > 0 && !step.producers.includes(this.currentProducer)) {
      console.log(`[NarrativeOrchestrator] Productor ${this.currentProducer} no permitido para este paso`);
      console.log("[NARRATIVE TRACE]");
      console.log("action: skipStep");
      console.log("executionId: " + executionId);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: " + step.eventKey);
      console.log("transition: " + NarrativeTransition[step.transition]);
      console.log("reason: producer-not-allowed");
      return;
    }

    console.log("[NARRATIVE]");
    console.log("Step activated");
    console.log("↓");
    console.log(step.eventKey);
    console.log("↓");
    console.log("Transition: " + NarrativeTransition[step.transition]);
    if (step.delayMs !== undefined) {
      console.log("Delay: " + step.delayMs + "ms");
    }
    console.log("↓");
    console.log("Resolving EventDefinition");
    console.log("↓");

    // Ancla de transición (p. ej. transition_to_taxi): WAIT_CONDITION bloqueante
    // normalmente SIN audio en el catálogo. Debe evaluarse ANTES de exigir
    // catálogo: si no cumple, espera con polling; si cumple y no hay audio,
    // el ancla se completa sin dispatch. Sin este gate, el paso se saltaba
    // inmediatamente por "event-not-in-catalog" sin evaluar nada.
    // Ancla vacía (sin preconditions ni scheduler_rule): bloquear de forma
    // preventiva en vez de omitir por falta de catálogo. Sin esto, el paso se
    // completaba inmediatamente por "event-not-in-catalog" sin evaluar nada.
    if (!force && this.isBareTaxiAnchor(step)) {
      const gateOrigin = reason?.startsWith("wait-poll:") ? "polling" : "executeCurrentStep";
      console.warn(`[NarrativeOrchestrator] ⛔ Ancla ${step.eventKey} sin condiciones configuradas: bloqueo preventivo hasta publicar preconditions/scheduler_rule`);
      this.recordAnchor(step, 'evaluando', gateOrigin, false, false);
      this.recordAnchor(step, 'bloqueado', gateOrigin, false, false);
      this.scheduleWaitConditionPoll(step);
      return;
    }
    if (!force && this.isPhaseTransitionWaitStep(step)) {
      const shouldExecute = this.evaluatePhaseTransitionStep(step);
      this.logWaitConditionEvaluation(step, shouldExecute);
      const gateOrigin = reason?.startsWith("wait-poll:") ? "polling" : "executeCurrentStep";
      this.recordAnchor(step, 'evaluando', gateOrigin, true, shouldExecute);
      if (!shouldExecute) {
        this.recordAnchor(step, 'bloqueado', gateOrigin, true, false);
        this.scheduleWaitConditionPoll(step);
        return;
      }
      if (!this.eventCatalog.get(step.eventKey)) {
        console.log(`[NarrativeOrchestrator] ✅ Ancla ${step.eventKey}: condiciones cumplidas, completando sin audio`);
        this.advanceNarrative("phase-transition-met");
        return;
      }
      // Con audio publicado: seguir al flujo normal (handleStepActivation
      // re-evalúa antes del dispatch).
    }

    const eventDefinition = this.eventCatalog.get(step.eventKey);
    if (!eventDefinition) {
      console.warn(
        `[NarrativeOrchestrator] Evento ${step.eventKey} no existe en el catálogo; se omite el paso`
      );
      console.log("[NARRATIVE TRACE]");
      console.log("action: skipStep");
      console.log("executionId: " + executionId);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: " + step.eventKey);
      console.log("transition: " + NarrativeTransition[step.transition]);
      console.log("reason: event-not-in-catalog");

      this.advanceNarrative("event-not-in-catalog");
      return;
    }

    // Stage 19B: decide EXECUTE vs SKIP based on the enabledSwitch config.
    if (!this.isStepEnabled(eventDefinition)) {
      console.log("[NARRATIVE]");
      console.log("Event disabled");
      console.log("↓");
      console.log(step.eventKey);
      console.log("↓");
      console.log("enabledSwitch: " + (eventDefinition.enabledSwitch ?? "(none)"));
      console.log("Config: " + this.switchConfigValue(eventDefinition.enabledSwitch));
      console.log("↓");
      console.log("Skipping");
      console.log("[NARRATIVE TRACE]");
      console.log("action: skipStep");
      console.log("executionId: " + executionId);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: " + step.eventKey);
      console.log("transition: " + NarrativeTransition[step.transition]);
      console.log("reason: step-disabled");

      this.advanceNarrative("step-disabled");
      return;
    }

    console.log("[NARRATIVE]");
    console.log("Event enabled");
    console.log("↓");
    console.log(step.eventKey);
    console.log("↓");
    console.log("enabledSwitch: " + (eventDefinition.enabledSwitch ?? "(none)"));
    console.log("Config: " + this.switchConfigValue(eventDefinition.enabledSwitch));
    console.log("↓");

    this.handleStepActivation(step, eventDefinition, force);
  }

  // Permite inyección tardía de RuleEngine (para WAIT_CONDITION delay_detection)
  setRuleEngine(engine: any): void {
    this.ruleEngine = engine;
  }

  private getCurrentPhase(): string | null {
    try {
      const fsmInfo: any = this.flightContext?.getFSM?.();
      return fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Evalúa de forma robusta un paso de demora:
   *  - Si preconditions.type === 'delay_detection' delega a RuleEngine.evaluateStep
   *    (tiempo + condiciones extra exactas).
   *  - Fallback (por si el shape de preconditions difiere): evalúa la condición de
   *    tiempo con isDelayExceeded + condiciones extra leídas de preconditions.conditions.
   */
  private evaluateDelayStep(step: NarrativeStep): boolean {
    try {
      const engine: any = this.ruleEngine;
      if (!engine) return false;
      const pre: any = (step as any).preconditions;
      if (pre?.type === "delay_detection" && typeof engine.evaluateStep === "function") {
        return engine.evaluateStep(step, this.flightContext);
      }
      // Fallback robusto
      let timeOk = false;
      try {
        if (typeof engine.isDelayExceeded === "function") timeOk = engine.isDelayExceeded(step.eventKey, this.flightContext);
        else if (typeof engine.isDelayThresholdExceeded === "function") timeOk = engine.isDelayThresholdExceeded(step.eventKey, this.flightContext);
      } catch {}
      const cond: any = pre?.conditions ?? {};
      const ctx: any = this.flightContext;
      const tel: any = ctx?.getTelemetry?.() ?? {};
      const fsmInfo: any = ctx?.getFSM?.() ?? {};
      const currentState = fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.();
      const simOnGround = tel.simOnGround ?? tel.sim_on_ground;
      const atc = tel.atcOnParkingSpot ?? tel.atc_on_parking_spot;
      const gs = tel.groundspeed ?? tel.ground_speed ?? 0;
      if (cond.fsm && String(currentState) !== String(cond.fsm)) return false;
      if (cond.sim_on_ground !== undefined && simOnGround !== cond.sim_on_ground) return false;
      if (cond.atc_on_parking_spot !== undefined || cond.atcOnParkingSpot !== undefined) {
        const expected = cond.atc_on_parking_spot ?? cond.atcOnParkingSpot;
        if (atc !== expected) return false;
      }
      if (cond.ground_velocity_lt !== undefined && gs >= cond.ground_velocity_lt) return false;
      if (cond.groundspeed_lt !== undefined && gs >= cond.groundspeed_lt) return false;
      return timeOk;
    } catch (e) {
      console.warn(`[NarrativeOrchestrator] evaluateDelayStep error for ${step.eventKey}`, e);
      return false;
    }
  }

  private evaluateWaitCondition(step: NarrativeStep): boolean {
    return this.evaluateDelayStep(step);
  }

  /**
   * Un WAIT_CONDITION de transición de fase (ancla transition_to_taxi) bloquea
   * la narrativa hasta que la telemetría cumple las condiciones: preconditions
   * type phase_transition o scheduler_rule con expresión de telemetría.
   */
  private isPhaseTransitionWaitStep(step: NarrativeStep): boolean {
    if ((step as any).transition !== NarrativeTransition.WAIT_CONDITION) return false;
    const pre: any = (step as any).preconditions;
    if (pre?.type === "phase_transition") return true;
    const rule = (step as any).scheduler_rule as string | null | undefined;
    if (typeof rule === "string" && rule.trim() !== "") {
      try {
        const engine: any = this.ruleEngine;
        if (typeof engine?.getSchedulerRuleDetail === "function") {
          return engine.getSchedulerRuleDetail(rule).isExpression === true;
        }
      } catch { /* fallback por tokens */ }
      const upper = rule.toUpperCase();
      return ["SIM_ON_GROUND", "GROUND_VELOCITY", "GROUND_SPEED", "PARKING_BRAKE", "ATC_ON_PARKING_SPOT", "ALL_ENGINES_RUNNING"]
        .some((t) => upper.includes(t));
    }
    return false;
  }

  /**
   * Ancla sin condiciones configuradas (llega vacía del escenario). Por
   * semántica (blocking:true, optional:false, WAIT_CONDITION) debe BLOQUEAR
   * en vez de saltarse por "event-not-in-catalog": fallar cerrado, no abierto.
   */
  private isBareTaxiAnchor(step: NarrativeStep): boolean {
    if (step.eventKey !== NarrativeOrchestrator.ANCHOR_EVENT_KEY) return false;
    if ((step as any).transition !== NarrativeTransition.WAIT_CONDITION) return false;
    const pre: any = (step as any).preconditions;
    const rule = (step as any).scheduler_rule as string | null | undefined;
    return !pre && !(typeof rule === "string" && rule.trim() !== "");
  }

  /**
   * Log unificado de diagnóstico WAIT_CONDITION: muestra si el paso bloquea
   * o deja pasar, y por qué vía se evaluó (phase_transition vs delay).
   */
  private logWaitConditionEvaluation(step: NarrativeStep, result: boolean): void {
    try {
      console.log('[NarrativeOrchestrator] 🔍 Evaluando WAIT_CONDITION:', {
        eventKey: step.eventKey,
        transition: NarrativeTransition[step.transition],
        preconditions: (step as any).preconditions ?? null,
        schedulerRule: (step as any).scheduler_rule ?? null,
        isPhaseTransition: this.isPhaseTransitionWaitStep(step),
        isDelayDetection: this.isDelayDetectionWaitStep(step),
        evaluationResult: result,
        shouldBlock: !result,
      });
    } catch {}
  }

  private anchorTrace: AnchorTraceEntry[] = [];
  private static readonly ANCHOR_EVENT_KEY = "transition_to_taxi";
  private static readonly ANCHOR_TRACE_MAX = 20;

  private recordAnchor(
    step: NarrativeStep,
    action: AnchorTraceEntry['action'],
    origin: string,
    evaluated: boolean,
    met: boolean | null
  ): void {
    try {
      if (step.eventKey !== NarrativeOrchestrator.ANCHOR_EVENT_KEY) return;
      let stack: string[] = [];
      try {
        stack = (new Error().stack ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(2, 7);
      } catch {}
      this.anchorTrace.push({
        action,
        origin,
        timestamp: new Date().toLocaleString("es-ES"),
        evaluated,
        met,
        stack,
      });
      if (this.anchorTrace.length > NarrativeOrchestrator.ANCHOR_TRACE_MAX) {
        this.anchorTrace.splice(0, this.anchorTrace.length - NarrativeOrchestrator.ANCHOR_TRACE_MAX);
      }
    } catch {}
  }

  /** Instantánea del estado de espera (para el DebugMonitor, tiempo real). */
  getWaitSnapshot(): {
    waitingForAudio: boolean;
    pendingUserSteps: string[];
    pendingExternalSteps: string[];
    pendingTimerIds: string[];
    scheduledTimers: { id: string; event: string; remainingMs: number }[];
  } {
    let scheduledTimers: { id: string; event: string; remainingMs: number }[] = [];
    try {
      const tm: any = (this as any).timerManager;
      if (typeof tm?.getPendingTimers === "function") scheduledTimers = tm.getPendingTimers();
    } catch {}
    return {
      waitingForAudio: this.waitingForAudio,
      pendingUserSteps: Array.from(this.pendingUserSteps),
      pendingExternalSteps: Array.from(this.pendingExternalSteps),
      pendingTimerIds: Array.from(this.pendingTimers),
      scheduledTimers,
    };
  }

  /** Historial de procesamiento del ancla (para el DebugMonitor, tiempo real). */
  getAnchorTrace(): AnchorTraceEntry[] {
    return [...this.anchorTrace];
  }

  /** Última acción registrada sobre el ancla (para el DebugMonitor). */
  getLastAnchorAction(): AnchorTraceEntry | null {
    return this.anchorTrace.length > 0 ? this.anchorTrace[this.anchorTrace.length - 1] : null;
  }

  /**
   * Adelantamiento ("overtake"): si el paso actual es un WAIT opcional que no
   * se cumple, pero un ancla de transición posterior (transition_to_taxi) YA
   * está cumplida, se omiten los opcionales intermedios y se ejecuta el ancla.
   * Sin esto, un opcional nunca disparado (p. ej. aviso de demora sin demora)
   * actuaba como bloqueante y el ancla jamás llegaba a evaluarse.
   * Solo salta pasos opcionales; un no-opcional intermedio mantiene el orden.
   */
  private maybeOvertakeToAnchor(): boolean {
    try {
      const engine = this.narrativeEngine;
      const steps: NarrativeStep[] =
        typeof engine.getSteps === "function" ? engine.getSteps() : [];
      let anchorIdx = -1;
      for (let i = engine.currentIndex() + 1; i < steps.length; i++) {
        const s = steps[i];
        if (this.isPhaseTransitionWaitStep(s) || this.isBareTaxiAnchor(s)) {
          anchorIdx = i;
          break;
        }
      }
      if (anchorIdx < 0) return false;
      const anchor = steps[anchorIdx];
      // Un ancla vacía nunca "cumple" por telemetría: no hay a dónde adelantar.
      let met = false;
      try {
        met = this.evaluatePhaseTransitionStep(anchor);
      } catch {
        met = false;
      }
      if (!met) return false;
      while (!engine.isCompleted() && engine.currentIndex() < anchorIdx) {
        const cur = engine.currentStep();
        if (!cur || !cur.optional) return false;
        console.log(`[NarrativeOrchestrator] ⏩ Omitiendo opcional ${cur.eventKey}: ancla ${anchor.eventKey} ya cumplida`);
        this.emit("step:skipped", { step: cur, index: engine.currentIndex() } as StepSkippedEvent);
        engine.onStepCompleted();
      }
      return engine.currentStep()?.eventKey === anchor.eventKey;
    } catch {
      return false;
    }
  }

  private evaluatePhaseTransitionStep(step: NarrativeStep): boolean {
    try {
      const engine: any = this.ruleEngine;
      if (!engine) return false;
      if (typeof engine.evaluateStep === "function") {
        return engine.evaluateStep(step, this.flightContext);
      }
      return false;
    } catch (e) {
      console.warn(`[NarrativeOrchestrator] evaluatePhaseTransitionStep error for ${step.eventKey}`, e);
      return false;
    }
  }

  private isDelayDetectionWaitStep(step: NarrativeStep): boolean {
    if ((step as any).transition !== NarrativeTransition.WAIT_CONDITION) return false;
    const pre: any = (step as any).preconditions;
    if (pre?.type === "delay_detection") return true;
    // Evento de demora conocido (por nombre) aunque llegue sin type
    if (NarrativeOrchestrator.DELAY_DETECTION_EVENTS.has(step.eventKey)) return true;
    // Firma de demora en conditions (cubre cualquier evento que en el escenario
    // publicado use delay_detection aunque el key difiera, p.ej. preflight_capt_delay)
    const c: any = pre?.conditions ?? {};
    return (
      c.fsm !== undefined ||
      c.sim_on_ground !== undefined ||
      c.simOnGround !== undefined ||
      c.atc_on_parking_spot !== undefined ||
      c.atcOnParkingSpot !== undefined ||
      c.ground_velocity_lt !== undefined ||
      c.groundspeed_lt !== undefined
    );
  }

  private scheduleWaitConditionPoll(step: NarrativeStep, _eventDefinition?: EventDefinition): void {
    const id = `wait:${step.eventKey}`;
    if (this.pendingTimers.has(id)) return;
    this.pendingTimers.add(id);
    const delayMs = 2000;
    console.log(`[NarrativeOrchestrator] WAIT_CONDITION ${step.eventKey} no cumple precondiciones, re-evaluando en ${delayMs}ms`);
    this.timerManager.schedule({
      id,
      delayMs,
      event: step.eventKey,
      onFire: (timerId) => {
        this.pendingTimers.delete(timerId);
        // Re-intentar solo si sigue siendo el paso actual y no completado
        const cur = this.narrativeEngine.currentStep();
        if (!cur || cur.eventKey !== step.eventKey) return;
        if (this.narrativeEngine.isCompleted()) return;
        console.log(`[NarrativeOrchestrator] Re-evaluando WAIT_CONDITION ${step.eventKey}`);
        this.executeCurrentStep(`wait-poll:${step.eventKey}`);
      },
    });
  }

  // Stage 19C: respeta decision_maker y detection_strategy definidos en el paso.
  private handleStepActivation(
    step: NarrativeStep,
    eventDefinition: EventDefinition,
    force: boolean
  ): void {
    // Una ejecución forzada (confirmación manual o evento externo) debe
    // disparar el paso directamente, sin volver a dejarlo en espera.
    if (force) {
      this.executeStep(step, eventDefinition, "manual");
      return;
    }

    // WAIT_CONDITION con delay_detection: evaluar de forma independiente por evento
    if (this.isDelayDetectionWaitStep(step)) {
      const shouldExecute = this.evaluateWaitCondition(step);
      this.logWaitConditionEvaluation(step, shouldExecute);
      // Log de diagnóstico: insumos exactos usados por RuleEngine (mismas fuentes que el monitor)
      try {
        const ctx: any = this.flightContext;
        const tel: any = ctx?.getTelemetry?.() ?? {};
        const fl: any = ctx?.getFlight?.() ?? {};
        const fsmInfo: any = ctx?.getFSM?.() ?? {};
        const overrideMs = ctx?.getDelayOverride?.(step.eventKey) ?? null;
        console.log(`[NarrativeOrchestrator] WAIT_CONDITION evaluado ${step.eventKey}: ${shouldExecute ? "TRUE" : "FALSE"}`, {
          eventKey: step.eventKey,
          optional: step.optional,
          phase: fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.() ?? null,
          currentZulu: tel.zuluTime ?? tel.zulu_time ?? null,
          scheduledTakeoff: fl.scheduledTakeoffTime ?? fl.scheduled_takeoff_time ?? null,
          departureTime: fl.departureTime ?? null,
          overrideThresholdMs: overrideMs,
          thresholdUsedMs: this.ruleEngine?.getEventThreshold?.(step.eventKey, this.flightContext) ?? this.ruleEngine?.getEventThreshold?.(step.eventKey) ?? null,
          atcOnParkingSpot: tel.atcOnParkingSpot ?? null,
          simOnGround: tel.simOnGround ?? null,
          groundspeed: tel.groundspeed ?? null,
        });
      } catch {}
      if (!shouldExecute) {
        // Si es opcional y el ancla posterior ya está cumplida (p. ej. rodaje
        // detectado mientras la demora no aplica), adelantar hacia el ancla
        // en vez de retener la fase tras un opcional.
        if (step.optional && this.maybeOvertakeToAnchor()) {
          this.executeCurrentStep("overtake-to-anchor");
          return;
        }
        // Si es opcional y aún no se cumple, esperar y reintentar (polling).
        // Por ahora, si es opcional y no se cumple, programar re-evaluación y no ejecutar.
        if (step.optional) {
          this.scheduleWaitConditionPoll(step, eventDefinition);
          // No ejecutar ahora; el reintento decidirá si se dispara o se omite al finalizar fase
          return;
        } else {
          // No opcional: esperar también
          this.scheduleWaitConditionPoll(step, eventDefinition);
          return;
        }
      }
      // Si sí cumple, ejecutar normalmente
      this.executeStep(step, eventDefinition, "auto");
      return;
    }

    // WAIT_CONDITION de transición de fase: bloquear hasta cumplir telemetría
    if (this.isPhaseTransitionWaitStep(step)) {
      const shouldExecute = this.evaluatePhaseTransitionStep(step);
      this.recordAnchor(step, 'evaluando', 'handleStepActivation', true, shouldExecute);
      this.logWaitConditionEvaluation(step, shouldExecute);
      try {
        const ctx: any = this.flightContext;
        const tel: any = ctx?.getTelemetry?.() ?? {};
        console.log(`[NarrativeOrchestrator] WAIT_CONDITION phase_transition evaluado ${step.eventKey}: ${shouldExecute ? "TRUE" : "FALSE"}`, {
          eventKey: step.eventKey,
          optional: step.optional,
          simOnGround: tel.simOnGround ?? null,
          groundspeed: tel.groundspeed ?? null,
          parkingBrake: tel.parkingBrake ?? null,
          atcOnParkingSpot: tel.atcOnParkingSpot ?? null,
          scheduler_rule: (step as any).scheduler_rule ?? null,
          preconditions: (step as any).preconditions ?? null,
        });
      } catch {}
      if (!shouldExecute) {
        this.recordAnchor(step, 'bloqueado', 'handleStepActivation', true, false);
        this.scheduleWaitConditionPoll(step, eventDefinition);
        return;
      }
      this.executeStep(step, eventDefinition, "auto");
      return;
    }

    if (step.decision_maker === "user") {
      this.waitForUserAction(step);
      return;
    }

    if (step.decision_maker === "trigger" || step.decision_maker === "flight_controller") {
      this.registerCallback(step, eventDefinition);
      return;
    }

    const strategy = step.detection_strategy ?? "polling";
    switch (strategy) {
      case "polling":
        this.executeOrDelayStep(step, eventDefinition, "auto");
        break;
      case "event_listener":
        this.listenForEvent(step, eventDefinition);
        break;
      case "callback":
        this.registerCallback(step, eventDefinition);
        break;
      case "manual":
        this.registerManualStep(step);
        break;
      default:
        this.executeOrDelayStep(step, eventDefinition, "auto");
    }
  }

  // AFTER_DELAY = esperar delayMs desde que el paso queda activo y recién
  // reproducirlo. Para el primer paso del escenario el delay arranca con la
  // ejecución del escenario; para los siguientes, cuando finalizó el anterior.
  private executeOrDelayStep(
    step: NarrativeStep,
    eventDefinition: EventDefinition,
    mode: "manual" | "auto"
  ): void {
    const delayMs = this.delayForStep(step);
    if (step.transition === NarrativeTransition.AFTER_DELAY && delayMs > 0) {
      this.schedulePrePlayDelay(step, eventDefinition, mode, delayMs);
      return;
    }
    this.executeStep(step, eventDefinition, mode);
  }

  private delayForStep(step: NarrativeStep): number {
    const overrideMs = this.flightContext.getDelayOverride(step.eventKey);
    return overrideMs !== undefined ? overrideMs : step.delayMs ?? 0;
  }

  private schedulePrePlayDelay(
    step: NarrativeStep,
    eventDefinition: EventDefinition,
    mode: "manual" | "auto",
    delayMs: number
  ): void {
    const id = "preplay:" + this.timerId(step);
    if (this.pendingTimers.has(id)) return;
    this.pendingTimers.add(id);

    console.log("[NARRATIVE]");
    console.log("AFTER_DELAY: retrasando reproducción");
    console.log("↓");
    console.log(step.eventKey);
    console.log("↓");
    console.log(delayMs + "ms");

    this.timerManager.schedule({
      id,
      delayMs,
      event: step.eventKey,
      onFire: (timerId) => {
        this.pendingTimers.delete(timerId);
        this.executeStep(step, eventDefinition, mode);
      },
    });
  }

  // Público para Scheduler.triggerSpecialEvent
  public executeStep(
    step: NarrativeStep,
    eventDefinition: EventDefinition,
    mode: "manual" | "auto" = "auto"
  ): void {
    fileLogger.log('[NarrativeOrchestrator] executeStep', { eventKey: step.eventKey, mode, transition: NarrativeTransition[step.transition], decision_maker: (step as any).decision_maker, detection_strategy: (step as any).detection_strategy });

    const isDelayStep = this.isDelayDetectionWaitStep(step);
    // Evaluar una sola vez: usado en el log (stack) y en el guard
    const delayOk: boolean | null = isDelayStep ? this.evaluateWaitCondition(step) : null;
    const isPhaseStep = !isDelayStep && this.isPhaseTransitionWaitStep(step);
    const phaseOk: boolean | null = isPhaseStep ? this.evaluatePhaseTransitionStep(step) : null;

    // ── LOG de rastreo en CADA llamada a executeStep (muestra el caller) ──
    try {
      const ctx: any = this.flightContext;
      const tel: any = ctx?.getTelemetry?.() ?? {};
      const fl: any = ctx?.getFlight?.() ?? {};
      console.log(`[NarrativeOrchestrator] 🔍 executeStep llamado para ${step.eventKey}:`, {
        caller: new Error().stack,
        transition: NarrativeTransition[(step as any).transition],
        eventKey: step.eventKey,
        isDelayDetectionWaitStep: isDelayStep,
        isDelayed: delayOk === null ? "N/A" : delayOk,
        mode: this.isTestMode ? "manual" : "auto",
        phase: this.getCurrentPhase(),
        zuluTime: tel.zuluTime ?? null,
        scheduledTakeoffTime: fl.scheduledTakeoffTime ?? fl.scheduled_takeoff_time ?? null,
        departureTime: fl.departureTime ?? null,
        overrideThresholdMs: ctx?.getDelayOverride?.(step.eventKey) ?? null,
      });
    } catch {}

    // ── GUARD definitivo: un WAIT_CONDITION de delay_detection SOLO se ejecuta
    // cuando la condición de tiempo + condiciones extra son true. En modo
    // normal esto es fuente de verdad (evita reproducir con isDelayed=false).
    // En modo pruebas (isTestMode) se permite el avance manual paso a paso.
    if (isDelayStep && !this.isTestMode) {
      const isDelayed = delayOk === true;
      if (!isDelayed) {
        console.warn(`[NarrativeOrchestrator] ⛔ Bloqueando dispatch de ${step.eventKey} (isDelayed=false). Solo se ejecuta al cumplirse la condición de demora.`);
        // Programar re-evaluación para no dejar el paso colgado si algún flujo
        // llegó hasta aquí sin pasar por handleStepActivation.
        this.scheduleWaitConditionPoll(step, eventDefinition);
        return;
      }
      console.log(`[NarrativeOrchestrator] ✅ WAIT_CONDITION ${step.eventKey}: condición cumplida, procede el dispatch`);
    }

    // ── GUARD definitivo para phase_transition: sin telemetría cumplida no hay
    // dispatch (evita saltar transition_to_taxi). Solo modo normal; en pruebas
    // se permite el avance manual paso a paso.
    if (isPhaseStep && !this.isTestMode) {
      if (phaseOk !== true) {
        console.warn(`[NarrativeOrchestrator] ⛔ Bloqueando dispatch de ${step.eventKey} (phase_transition=false). Solo se ejecuta al cumplirse las condiciones de rodaje.`);
        this.recordAnchor(step, 'bloqueado', 'executeStep', true, false);
        this.scheduleWaitConditionPoll(step, eventDefinition);
        return;
      }
      console.log(`[NarrativeOrchestrator] ✅ WAIT_CONDITION phase_transition ${step.eventKey}: condición cumplida, procede el dispatch`);
    }

    console.log("[NARRATIVE]");
    console.log("Dispatching");
    // Log de trazabilidad: preparación del evento que va a la cola de anuncios
    // → AnnouncementService → Edge Function audio-get.
    console.log("[NarrativeOrchestrator] Preparando evento para Edge Function:", {
      eventKey: step.eventKey,
      transition: NarrativeTransition[step.transition],
      isPreRecorded: (eventDefinition as any).preRecorded === true,
      isDelayDetectionWaitStep: isDelayStep,
      optional: step.optional,
      speakerRole: (eventDefinition as any).speakerRole ?? null,
      triggerType: (eventDefinition as any).triggerType ?? null,
      phase: this.getCurrentPhase(),
      mode: this.isTestMode ? "manual" : "auto",
    });
    this.dispatcher.dispatch(eventDefinition, this.flightContext).catch(() => {});

    console.log(
      `[NarrativeOrchestrator] Paso ejecutado ${step.eventKey} (modo: ${mode})`
    );

    // Corrección WAIT_CONDITION: el avance real ocurre en handleAnnouncementCompleted
    // (incluye WAIT_CONDITION). Aquí solo se loguea el estado para auditoría y se
    // deja el onStepCompleted diferido al completar el audio, evitando doble avance.
    if (step.transition === NarrativeTransition.WAIT_CONDITION) {
      console.log('[NarrativeEngine] Estado del paso:', {
        eventKey: step.eventKey,
        isCompleted: this.narrativeEngine.isStepCompleted(step.eventKey),
        currentIndex: this.narrativeEngine.currentIndex(),
        totalSteps: this.narrativeEngine.getTotalSteps(),
        nextStep: (this.narrativeEngine as any).definition?.steps?.[this.narrativeEngine.currentIndex() + 1]?.eventKey ?? null,
      });
      console.log(`[NarrativeOrchestrator] WAIT_CONDITION ${step.eventKey} ejecutado, esperando handleAnnouncementCompleted para avanzar`);
    }

    this.emit("step:executed", {
      step,
      index: this.narrativeEngine.currentIndex(),
      mode,
    } as StepExecutedEvent);
  }

  // decision_maker === "user": el paso espera una acción del usuario.
  private waitForUserAction(step: NarrativeStep): void {
    this.pendingUserSteps.add(step.eventKey);
    console.log("[NarrativeOrchestrator] Esperando acción del usuario para el paso: " + step.eventKey);
  }

  // detection_strategy === "manual": el paso solo se ejecuta por acción manual.
  private registerManualStep(step: NarrativeStep): void {
    this.pendingUserSteps.add(step.eventKey);
    console.log("[NarrativeOrchestrator] Paso manual pendiente de activación: " + step.eventKey);
  }

  // detection_strategy === "event_listener" / "callback": espera un evento externo.
  private listenForEvent(step: NarrativeStep, eventDefinition: EventDefinition): void {
    this.registerCallback(step, eventDefinition);
  }

  private registerCallback(step: NarrativeStep, eventDefinition: EventDefinition): void {
    this.pendingExternalSteps.add(step.eventKey);
    console.log("[NarrativeOrchestrator] Esperando evento externo para el paso: " + step.eventKey);
  }

  setCurrentProducer(producer: string): void {
    this.currentProducer = producer;
  }

  setTestMode(enabled: boolean): void {
    this.isTestMode = enabled;
    console.log(
      `[NarrativeOrchestrator] Modo de ejecución: ${enabled ? "pruebas (manual)" : "normal"}`
    );
  }

  setManualMode(enabled: boolean): void {
    this.setTestMode(enabled);
  }

  isTestModeEnabled(): boolean {
    return this.isTestMode;
  }

  getCurrentProducer(): string {
    return this.currentProducer;
  }

  // Confirma un paso que esperaba acción del usuario y lo ejecuta.
  confirmUserStep(stepKey: string): void {
    if (!this.pendingUserSteps.delete(stepKey)) {
      console.log("[NarrativeOrchestrator] Paso " + stepKey + " no estaba esperando acción del usuario");
      return;
    }
    if (this.pendingStep?.eventKey === stepKey) {
      this.pendingStep = null;
    }
    console.log("[NarrativeOrchestrator] Acción del usuario confirmada para el paso: " + stepKey);
    this.executeCurrentStep("user-confirmed", true);
  }

  // Modo pruebas: avanza ejecutando el paso pendiente manualmente.
  //
  // El paso se ejecuta (se despacha y encola el audio) y luego el avance se
  // pospone hasta que el audio termina de generarse/reproducirse (evento
  // "completed" de la cola). Esto garantiza que el audio se escuche completo
  // antes de pasar al siguiente paso o fase. Si el audio falla o nunca
  // completa, un safety net avanza con una advertencia para no bloquear.
  nextManualStep(): boolean {
    if (!this.pendingStep) {
      console.warn("[NarrativeOrchestrator] No hay paso pendiente para ejecutar manualmente");
      return false;
    }

    this.logOrchestratorState("nextManualStep");

    const step = this.pendingStep;
    const stepKey = step.eventKey;

    // Limpiar el estado pendiente para evitar ejecución doble.
    this.pendingStep = null;
    this.pendingUserSteps.delete(stepKey);
    this.pendingExternalSteps.delete(stepKey);

    console.log(
      `[NarrativeOrchestrator] Avance manual: ejecutando paso ${step.eventKey}`
    );

    const eventDefinition = this.eventCatalog.get(stepKey);
    if (!eventDefinition) {
      console.warn(
        `[NarrativeOrchestrator] Evento ${stepKey} no existe en el catálogo; se omite el paso`
      );
      this.emit("step:skipped", {
        step,
        index: this.narrativeEngine.currentIndex(),
      } as StepSkippedEvent);
      this.advanceNarrative("event-not-in-catalog");
      return true;
    }

    if (!this.isStepEnabled(eventDefinition)) {
      console.warn(
        `[NarrativeOrchestrator] Evento ${stepKey} deshabilitado (enabledSwitch: ${eventDefinition.enabledSwitch ?? "(none)"} = ${this.switchConfigValue(eventDefinition.enabledSwitch)}); se omite el paso`
      );
      this.emit("step:skipped", {
        step,
        index: this.narrativeEngine.currentIndex(),
      } as StepSkippedEvent);
      this.advanceNarrative("step-disabled");
      return true;
    }

    this.executeStep(step, eventDefinition, "manual");

    // El avance tras el audio vale para AFTER_COMPLETION y AFTER_DELAY: el
    // delay de AFTER_DELAY ya fue previo a la reproducción.
    this.startManualAudioWait(stepKey);
    return true;
  }

  private startManualAudioWait(stepKey: string): void {
    this.clearManualAudioWait();
    this.waitingForAudio = true;
    this.waitingEpoch = this.scenarioEpoch;
    console.log(
      `[NarrativeOrchestrator] ⏳ Esperando finalización de audio para: ${stepKey}`
    );
    console.log(
      `[NarrativeOrchestrator] ⏱️ Esperando audio, timeout: ${AUDIO_TIMEOUT / 1000} segundos`
    );

    // Safety net: si el audio no completa (fallo de generación/red, etc.) se
    // avanza igualmente tras el plazo, para no bloquear la narrativa.
    this.manualAudioWaitTimer = setTimeout(() => {
      this.manualAudioWaitTimer = null;
      if (!this.waitingForAudio) return;
      const step = this.narrativeEngine.currentStep();
      if (step && step.eventKey === stepKey) {
        console.warn(
          `[NarrativeOrchestrator] ⚠️ Timeout esperando audio para ${stepKey}; se avanza igualmente`
        );
        this.advanceNarrative("manual-audio-timeout");
      }
    }, AUDIO_TIMEOUT);
  }

  private clearManualAudioWait(): void {
    if (this.manualAudioWaitTimer) {
      clearTimeout(this.manualAudioWaitTimer);
      this.manualAudioWaitTimer = null;
    }
  }

  private logOrchestratorState(context: string): void {
    console.log("[NarrativeOrchestrator] Estado actual:", {
      context,
      isManualMode: this.isTestMode,
      pendingStep: this.pendingStep?.eventKey ?? null,
      currentStep: this.narrativeEngine.currentStep()?.eventKey ?? null,
      currentIndex: this.narrativeEngine.currentIndex(),
      scenario: this.narrativeEngine.getScenarioName(),
    });
  }

  // Modo pruebas: salta el paso pendiente si es opcional.
  skipStep(): boolean {
    if (!this.pendingStep) {
      console.warn("[NarrativeOrchestrator] No hay paso pendiente para saltar");
      return false;
    }

    const step = this.pendingStep;
    if (!step.optional) {
      console.warn(
        `[NarrativeOrchestrator] El paso ${step.eventKey} no es opcional, no se puede saltar`
      );
      return false;
    }

    this.pendingStep = null;
    this.pendingUserSteps.delete(step.eventKey);

    console.log(`[NarrativeOrchestrator] Paso omitido: ${step.eventKey}`);
    this.emit("step:skipped", {
      step,
      index: this.narrativeEngine.currentIndex(),
    } as StepSkippedEvent);

    this.advanceNarrative("step-skipped");
    return true;
  }

  getPendingStep(): NarrativeStep | null {
    return this.pendingStep;
  }

  // Se invoca al cambiar de escenario para descartar el estado manual previo.
  resetManualState(): void {
    this.scenarioEpoch++;
    this.pendingStep = null;
    this.pendingUserSteps.clear();
    this.pendingExternalSteps.clear();
    this.waitingForAudio = false;
    this.waitingEpoch = -1;
    this.clearManualAudioWait();
    console.log(`[NarrativeOrchestrator] Estado manual reiniciado (época ${this.scenarioEpoch})`);
    this.emit("step:clear", null);
  }

  private isManualStep(step: NarrativeStep): boolean {
    return step.decision_maker === "user" || step.detection_strategy === "manual";
  }

  private holdForManualAction(step: NarrativeStep, executionId: number): void {
    this.pendingStep = step;
    this.pendingUserSteps.add(step.eventKey);
    this.pendingExternalSteps.delete(step.eventKey);

    console.log(
      `[NarrativeOrchestrator] Paso manual en espera: ${step.eventKey} (executionId: ${executionId})`
    );

    this.emit("step:pending", {
      step,
      index: this.narrativeEngine.currentIndex(),
      total: this.narrativeEngine.getTotalSteps(),
    } as StepPendingEvent);
  }

  // Notifica un evento externo (FlightController / callback) para pasos en espera.
  notifyExternalEvent(stepKey: string): void {
    if (!this.pendingExternalSteps.delete(stepKey)) {
      console.log("[NarrativeOrchestrator] Paso " + stepKey + " no estaba esperando evento externo");
      return;
    }
    console.log("[NarrativeOrchestrator] Evento externo recibido para el paso: " + stepKey);
    this.executeCurrentStep("external-event", true);
  }

  // Stage 19B: a step is ENABLED unless its enabledSwitch config value is "OFF".
  // Los valores de configuración viven en mayúsculas en runtime (OFF/PACK/IA).
  private isStepEnabled(eventDefinition: EventDefinition): boolean {
    const enabledSwitch = eventDefinition.enabledSwitch;
    if (!enabledSwitch) return true;

    const value = this.switchConfigValue(enabledSwitch);
    return value !== "OFF";
  }

  private switchConfigValue(enabledSwitch: string): string | undefined {
    const settings = this.flightContext.getSettings();
    return settings.eventConfig?.[enabledSwitch];
  }

  cancelPendingTimers(): void {
    console.log("[NARRATIVE TRACE]");
    console.log("action: cancelPendingTimers");
    console.log("executionId: " + this.execCounter);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));
    console.log("transition: " + (this.narrativeEngine.currentStep() ? NarrativeTransition[this.narrativeEngine.currentStep()!.transition] : "null"));
    console.log("reason: pending-timers-cleared");

    for (const id of this.pendingTimers) {
      this.timerManager.cancel(id);
    }
    this.pendingTimers.clear();
  }

  private scheduleNarrativeDelay(_step: NarrativeStep): void {
    // Deprecado: AFTER_DELAY ahora retrasa la reproducción (schedulePrePlayDelay)
    // y el avance ocurre al completarse el audio.
    return;
  }

  private handleNarrativeDelayCompleted = (_timerId: string): void => {
    return;
  };

  private timerId(step: NarrativeStep): string {
    return "narrative:" + this.narrativeEngine.getScenarioName() + ":" + step.id;
  }

  private advanceNarrative(reason?: string): void {
    // Al avanzar, cualquier espera de audio pendiente queda resuelta.
    this.waitingForAudio = false;
    this.clearManualAudioWait();

    console.log("[NARRATIVE TRACE]");
    console.log("action: advanceNarrative");
    console.log("executionId: " + this.execCounter);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));
    console.log("transition: " + (this.narrativeEngine.currentStep() ? NarrativeTransition[this.narrativeEngine.currentStep()!.transition] : "null"));
    console.log("reason: " + (reason ?? "unknown"));

    // Traza del ancla: clasificar el completado según la vía. Solo
    // "phase-transition-met" pasó por evaluación TRUE; el resto completa
    // el paso sin evaluar condiciones.
    try {
      const cur = this.narrativeEngine.currentStep();
      if (cur && cur.eventKey === NarrativeOrchestrator.ANCHOR_EVENT_KEY) {
        const viaCondition = reason === "phase-transition-met" || reason === "announcement-completed";
        this.recordAnchor(
          cur,
          viaCondition ? 'completado_por_condicion' : 'completado_sin_evaluacion',
          `advanceNarrative("${reason ?? "unknown"}")`,
          viaCondition,
          viaCondition ? true : null
        );
      }
    } catch {}

    this.narrativeEngine.onStepCompleted();

    // Guard (Stage 18D): once the scenario is completed, there is no
    // currentStep anymore. Never re-execute the last step after completion.
    if (this.narrativeEngine.isCompleted()) {
      console.log("[NARRATIVE TRACE]");
      console.log("action: advanceNarrative");
      console.log("executionId: " + this.execCounter);
      console.log("scenario: " + this.narrativeEngine.getScenarioName());
      console.log("stepIndex: " + this.narrativeEngine.currentIndex());
      console.log("event: null");
      console.log("transition: null");
      console.log("reason: scenario-completed-guard");

      this.pendingStep = null;
      this.emit("scenario:completed", {
        totalSteps: this.narrativeEngine.getTotalSteps(),
      } as ScenarioCompletedEvent);
      return;
    }

    const step = this.narrativeEngine.currentStep();
    if (!step) return;

    console.log("Next Step");
    console.log("↓");
    console.log(step.eventKey);

    this.executeCurrentStep(reason);
  }
}
