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
import { logger } from "../utils/logger";

// Tiempo máximo de espera por la finalización del audio de un paso antes de
// avanzar la narrativa. Es un safety net; debe cubrir el audio más largo del
// sistema (p. ej. taxi_crew_safety_brief ≈ 90 s).
const AUDIO_TIMEOUT = 120000; // 120 segundos (2 minutos)

// Red de seguridad de completion en modo normal (ver audioCompletionTimers):
// AFTER_DELAY / AFTER_COMPLETION / IMMEDIATE avanzan al completarse audios
// cortos; WAIT_CONDITION ya cumplido también espera su audio, con más margen.
const AUDIO_COMPLETION_TIMEOUT_MS = 90000; // 90 segundos
const WAIT_AUDIO_COMPLETION_TIMEOUT_MS = 300000; // 5 minutos (WAIT ya cumplido)

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
  // Red de seguridad de completion de audio (modo normal): si un audio
  // despachado nunca reporta completed/error, la narrativa quedaba muerta en
  // silencio (caso real: AFTER_DELAY esperando completion eternamente).
  // Al vencer, se avanza con warning. Solo cubre la espera POST-dispatch: los
  // WAIT que aún no cumplen condiciones jamás llegan a executeStep y por ende
  // nunca arman este timer (siguen esperando indefinidamente, como corresponde).
  private audioCompletionTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; epoch: number }>();
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

    // El paso WAIT_CONDITION debe esperar indefinidamente hasta que se cumpla
    // la condición o el usuario intervenga manualmente. No hay timeout automático.
    logger.narrative('[NarrativeOrchestrator] ✅ Timeout de transición revertido. Los pasos WAIT_CONDITION esperan indefinidamente.');
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
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: handleAnnouncementCompleted");
      logger.narrative("executionId: " + this.execCounter);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: null");
      logger.narrative("transition: null");
      logger.narrative("reason: no-active-step");
      logger.narrative("completedEventKey: " + (completedEventKey ?? "undefined"));
      logger.narrative("[NARRATIVE]");
      logger.narrative("No active step");
      logger.narrative("Ignoring completion");
      return;
    }

    logger.narrative("[NARRATIVE TRACE]");
    logger.narrative("action: handleAnnouncementCompleted");
    logger.narrative("executionId: " + this.execCounter);
    logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
    logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
    logger.narrative("event: " + step.eventKey);
    logger.narrative("transition: " + NarrativeTransition[step.transition]);
    logger.narrative("reason: completed-event");
    logger.narrative("completedEventKey: " + (completedEventKey ?? "undefined"));

    logger.narrative("[NARRATIVE]");
    logger.narrative("Completed event received");
    logger.narrative("Event: " + (completedEventKey ?? "(unknown)"));
    logger.narrative("Current Step: " + step.eventKey);

    if (completedEventKey && completedEventKey !== step.eventKey) {
      logger.narrative("Match: NO");
      logger.narrative("Ignoring completion");
      return;
    }

    logger.narrative("Match: YES");

    // Registro focalizado PERMANENTE: avance real de la narrativa.
    logger.audio(`✅ Paso completado: ${step.eventKey}`, {
      nextStep: this.narrativeEngine.getNextStep()?.eventKey ?? null,
    });

    // Bajo la semántica actual, AFTER_DELAY ya se reprodujo (su delay fue
    // PREVIO a la reproducción); al completarse el audio se avanza al siguiente.
    // AFTER_COMPLETION avanza al completarse el audio. WAIT_CONDITION (ej.
    // preflight_capt_delay_parked opcional) también debe avanzar tras el audio,
    // de lo contrario BOARDING queda bloqueada y "Cerrar Puertas" nunca se habilita.
    // IMMEDIATE (P1, p. ej. climb_crew_upcoming_service en CRUISE) también avanza
    // al completarse el audio; antes se ignoraba y la narrativa quedaba
    // bloqueada en modo normal.
    // En modo pruebas (`waitingForAudio`) cualquier transición avanza al completar el audio.
    if (
      step.transition === NarrativeTransition.AFTER_COMPLETION ||
      step.transition === NarrativeTransition.AFTER_DELAY ||
      step.transition === NarrativeTransition.WAIT_CONDITION ||
      step.transition === NarrativeTransition.IMMEDIATE ||
      this.waitingForAudio
    ) {
      logger.narrative(`[NarrativeOrchestrator] ✅ Audio completado para: ${step.eventKey}`);
      this.clearAudioCompletionNet(step.eventKey);
      // P1: confirmación de avance (nextStep capturado ANTES de avanzar).
      try {
        logger.narrative('[NarrativeOrchestrator] ✅ Avanzando narrativa para transición:', {
          eventKey: step.eventKey,
          transition: NarrativeTransition[step.transition],
          nextStep: this.narrativeEngine.getNextStep()?.eventKey ?? null,
        });
      } catch {}
      // Log de auditoría WAIT_CONDITION
      if (step.transition === NarrativeTransition.WAIT_CONDITION) {
        logger.narrative('[NarrativeEngine] Estado del paso:', {
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
  // la narrativa. En modo normal `waitingForAudio` es false y se ignora,
  // SALVO para pasos WAIT_CONDITION opcionales (P0-3): un opcional sin audio
  // disponible (p. ej. evento nuevo sin audio_raw ni prompt IA publicado, o
  // captain_special_event sin configurar) NO debe bloquear la fase.
  private handleAnnouncementError = (msg?: string): void => {
    const step = this.narrativeEngine.currentStep();
    const isDelayOptionalStep = !!step && this.isDelayDetectionWaitStep(step) && step.optional;
    // P0-3: generalización — cualquier WAIT_CONDITION opcional (delay,
    // phase_transition, cruise_progress u otros) avanza ante error de audio.
    // `isDelayOptionalStep` se conserva para el motivo de avance específico.
    const isOptionalWaitStep =
      !!step &&
      (step as any).transition === NarrativeTransition.WAIT_CONDITION &&
      step.optional === true;

    if (!this.waitingForAudio && !isOptionalWaitStep) return;
    if (!msg) return;

    console.warn(
      `[NarrativeOrchestrator] Error de audio durante ${this.waitingForAudio ? "avance manual" : "paso opcional en espera"}: ${msg}`
    );
    fileLogger.warn('[NarrativeOrchestrator] Error de audio', {
      msg,
      waitingForAudio: this.waitingForAudio,
      step: step?.eventKey ?? null,
      isDelayOptionalStep,
      isOptionalWaitStep,
    });
    // Si el paso opcional no tiene audio disponible, NO bloquear la fase: se
    // omite y la narrativa continúa (mismo criterio que cerrar puertas con
    // delay opcional pendiente).
    if (step) this.clearAudioCompletionNet(step.eventKey);
    if (isOptionalWaitStep) {
      this.emit("step:skipped", {
        step,
        index: this.narrativeEngine.currentIndex(),
      } as StepSkippedEvent);
    }
    this.advanceNarrative(
      isDelayOptionalStep
        ? "delay-step-no-audio"
        : isOptionalWaitStep
          ? "optional-wait-step-no-audio"
          : "announcement-error"
    );
  };

  executeCurrentStep(reason?: string, force = false): void {
    this.execCounter++;
    const executionId = this.execCounter;
    fileLogger.log('[NarrativeOrchestrator] executeCurrentStep', { reason: reason ?? 'unknown', force, executionId, scenario: this.narrativeEngine.getScenarioName(), step: this.narrativeEngine.currentStep()?.eventKey ?? null, isTestMode: this.isTestMode });

    // Guard (Stage 18D): a completed scenario must never execute another step.
    if (this.narrativeEngine.isCompleted()) {
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: executeCurrentStep");
      logger.narrative("executionId: " + executionId);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: null");
      logger.narrative("transition: null");
      logger.narrative("reason: scenario-completed-guard");
      return;
    }

    const step = this.narrativeEngine.currentStep();
    if (!step) {
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: executeCurrentStep");
      logger.narrative("executionId: " + executionId);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: null");
      logger.narrative("transition: null");
      logger.narrative("reason: " + (reason ?? "unknown"));
      return;
    }

    logger.narrative("[NARRATIVE TRACE]");
    logger.narrative("action: executeCurrentStep");
    logger.narrative("executionId: " + executionId);
    logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
    logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
    logger.narrative("event: " + step.eventKey);
    logger.narrative("transition: " + NarrativeTransition[step.transition]);
    logger.narrative("reason: " + (reason ?? "unknown"));

    logger.narrative(
      `[NarrativeOrchestrator] Ejecutando paso ${step.eventKey} (modo: ${
        this.isTestMode ? "pruebas" : "normal"
      })`
    );

    logger.narrative("[NarrativeOrchestrator] Evaluando paso:", {
      eventKey: step.eventKey,
      decision_maker: step.decision_maker,
      detection_strategy: step.detection_strategy,
      isManualMode: this.isTestMode,
    });

    // One-shot guard: max_once_per_flight — si ya se disparó, saltar al siguiente paso
    if ((step as any).restrictions?.max_once_per_flight && this.narrativeEngine.hasFired(step.eventKey)) {
      logger.narrative(`[NarrativeOrchestrator] Skipping ${step.eventKey}: max_once_per_flight ya disparado`);
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
        logger.narrative(`[NarrativeOrchestrator] 🌙 Omitiendo ${step.eventKey}: requiere vuelo nocturno y es de día`);
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
      logger.narrative(
        `[NarrativeOrchestrator] Paso automático en modo pruebas: ${step.eventKey}`
      );
    }

    // Stage 19C: validar que el productor actual esté permitido para este paso.
    // En modo pruebas no se valida el productor: los pasos manuales esperan y
    // los automáticos se ejecutan directamente.
    if (!force && !this.isTestMode && step.producers && step.producers.length > 0 && !step.producers.includes(this.currentProducer)) {
      logger.narrative(`[NarrativeOrchestrator] Productor ${this.currentProducer} no permitido para este paso`);
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: skipStep");
      logger.narrative("executionId: " + executionId);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: " + step.eventKey);
      logger.narrative("transition: " + NarrativeTransition[step.transition]);
      logger.narrative("reason: producer-not-allowed");
      return;
    }

    logger.narrative("[NARRATIVE]");
    logger.narrative("Step activated");
    logger.narrative("↓");
    logger.narrative(step.eventKey);
    logger.narrative("↓");
    logger.narrative("Transition: " + NarrativeTransition[step.transition]);
    if (step.delayMs !== undefined) {
      logger.narrative("Delay: " + step.delayMs + "ms");
    }
    logger.narrative("↓");
    logger.narrative("Resolving EventDefinition");
    logger.narrative("↓");

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
      logger.narrative('[NarrativeOrchestrator] ¿Es phase_transition?:', {
        eventKey: step.eventKey,
        transition: NarrativeTransition[step.transition],
        preconditionsType: (step as any).preconditions?.type ?? null,
        isPhaseTransition: this.isPhaseTransitionWaitStep(step),
      });
      this.logWaitConditionEvaluation(step, shouldExecute);
      const gateOrigin = reason?.startsWith("wait-poll:") ? "polling" : "executeCurrentStep";
      this.recordAnchor(step, 'evaluando', gateOrigin, true, shouldExecute);
      if (!shouldExecute) {
        // Línea permanente: el gate temprano también puede retener el paso en
        // silencio (si pasara, handleStepActivation re-evalúa y loguea ahí).
        this.logWaitEval(step, shouldExecute);
        this.recordAnchor(step, 'bloqueado', gateOrigin, true, false);
        // Adelantamiento: un transversal opcional no cumplido (p. ej.
        // common_crew_seatbelt) no debe retener un ancla posterior ya cumplida
        // (p. ej. transition_to_cruise). Solo salta pasos opcionales.
        if (step.optional && this.maybeOvertakeToAnchor()) {
          this.executeCurrentStep("overtake-to-anchor");
          return;
        }
        this.scheduleWaitConditionPoll(step);
        return;
      }
      if (!this.eventCatalog.get(step.eventKey)) {
        logger.narrative(`[NarrativeOrchestrator] ✅ Ancla ${step.eventKey}: condiciones cumplidas, completando sin audio`);
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
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: skipStep");
      logger.narrative("executionId: " + executionId);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: " + step.eventKey);
      logger.narrative("transition: " + NarrativeTransition[step.transition]);
      logger.narrative("reason: event-not-in-catalog");

      this.advanceNarrative("event-not-in-catalog");
      return;
    }

    // Stage 19B: decide EXECUTE vs SKIP based on the enabledSwitch config.
    if (!this.isStepEnabled(eventDefinition)) {
      logger.narrative("[NARRATIVE]");
      logger.narrative("Event disabled");
      logger.narrative("↓");
      logger.narrative(step.eventKey);
      logger.narrative("↓");
      logger.narrative("enabledSwitch: " + (eventDefinition.enabledSwitch ?? "(none)"));
      logger.narrative("Config: " + this.switchConfigValue(eventDefinition.enabledSwitch));
      logger.narrative("↓");
      logger.narrative("Skipping");
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: skipStep");
      logger.narrative("executionId: " + executionId);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: " + step.eventKey);
      logger.narrative("transition: " + NarrativeTransition[step.transition]);
      logger.narrative("reason: step-disabled");

      this.advanceNarrative("step-disabled");
      return;
    }

    // P0-2: skip explícito del evento especial no configurado por el usuario.
    // Va ANTES de handleStepActivation para que ningún subtipo WAIT lo
    // dispatchee (un dispatch sin texto fallaría en audio-get y bloquearía la
    // fase). `force` (avance manual explícito) sí lo permite.
    if (!force && this.shouldSkipUnconfiguredSpecialEvent(step)) {
      const flight: any = this.flightContext?.getFlight?.() ?? {};
      logger.narrative(`[NarrativeOrchestrator] ⏩ Omitiendo ${step.eventKey}: evento especial no configurado por el usuario (specialEventEnabled=${String(flight?.specialEventEnabled ?? false)}, texto=${flight?.specialEvent ? "presente" : "vacío"})`);
      fileLogger.log('[NarrativeOrchestrator] Evento especial no configurado, paso omitido', {
        eventKey: step.eventKey,
        optional: step.optional,
        specialEventEnabled: flight?.specialEventEnabled ?? false,
        hasText: typeof flight?.specialEvent === "string" && flight.specialEvent.trim() !== "",
      });
      this.emit("step:skipped", {
        step,
        index: this.narrativeEngine.currentIndex(),
      } as StepSkippedEvent);
      this.advanceNarrative("special-event-not-configured");
      return;
    }

    logger.narrative("[NARRATIVE]");
    logger.narrative("Event enabled");
    logger.narrative("↓");
    logger.narrative(step.eventKey);
    logger.narrative("↓");
    logger.narrative("enabledSwitch: " + (eventDefinition.enabledSwitch ?? "(none)"));
    logger.narrative("Config: " + this.switchConfigValue(eventDefinition.enabledSwitch));
    logger.narrative("↓");

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
   * Un WAIT_CONDITION es ancla de transición de fase SOLO si declara
   * `preconditions.type === "phase_transition"` o su eventKey es
   * `transition_to_*`. Antes bastaba con que la scheduler_rule mencionara
   * telemetría, lo que clasificaba como ancla pasos comunes (p. ej.
   * `common_capt_seatbelt` con `SEATBELT_SWITCH == 1`) y los sacaba de la vía
   * genérica + los convertía en candidatos de overtake.
   */
  private isPhaseTransitionWaitStep(step: NarrativeStep): boolean {
    if ((step as any).transition !== NarrativeTransition.WAIT_CONDITION) return false;
    const pre: any = (step as any).preconditions;
    const result =
      pre?.type === "phase_transition" ||
      (typeof step.eventKey === "string" && step.eventKey.startsWith("transition_to_"));
    logger.narrative('[NarrativeOrchestrator] isPhaseTransitionWaitStep:', {
      eventKey: step.eventKey,
      transition: NarrativeTransition[(step as any).transition],
      preconditionsType: pre?.type ?? null,
      isPhaseTransition: result,
    });
    return result;
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
      logger.narrative('[NarrativeOrchestrator] 🔍 Evaluando WAIT_CONDITION:', {
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

  /**
   * Línea PERMANENTE por evaluación del paso actual (una cada ~2s): eventKey +
   * resultado + familia de compuerta. Es lo único que permite distinguir "se
   * evaluó y dio false" de "no se evaluó" sin activar flags de debug.
   */
  private logWaitEval(step: NarrativeStep, result: boolean): void {
    const line =
      `[NarrativeOrchestrator] Eval ${step.eventKey} ` +
      `[${(step as any).preconditions?.type ?? 'sin-type'}]: ${result ? 'TRUE' : 'FALSE'}`;
    console.log(line);
    try {
      fileLogger.log(line, { eventKey: step.eventKey });
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
        logger.narrative(`[NarrativeOrchestrator] ⏩ Omitiendo opcional ${cur.eventKey}: ancla ${anchor.eventKey} ya cumplida`);
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
    logger.polling(`[NarrativeOrchestrator] WAIT_CONDITION ${step.eventKey} no cumple precondiciones, re-evaluando en ${delayMs}ms`);
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
        logger.polling(`[NarrativeOrchestrator] Re-evaluando WAIT_CONDITION ${step.eventKey}`);
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
      this.logWaitEval(step, shouldExecute);
      // Log de diagnóstico: insumos exactos usados por RuleEngine (mismas fuentes que el monitor)
      try {
        const ctx: any = this.flightContext;
        const tel: any = ctx?.getTelemetry?.() ?? {};
        const fl: any = ctx?.getFlight?.() ?? {};
        const fsmInfo: any = ctx?.getFSM?.() ?? {};
        const overrideMs = ctx?.getDelayOverride?.(step.eventKey) ?? null;
        logger.narrative(`[NarrativeOrchestrator] WAIT_CONDITION evaluado ${step.eventKey}: ${shouldExecute ? "TRUE" : "FALSE"}`, {
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
      this.logWaitEval(step, shouldExecute);
      try {
        const ctx: any = this.flightContext;
        const tel: any = ctx?.getTelemetry?.() ?? {};
        logger.narrative('[NarrativeOrchestrator] Evaluando fase:', {
          phase: this.getCurrentPhase(),
          currentStep: step.eventKey,
          transition: NarrativeTransition[step.transition],
          blocking: (step as any).blocking,
          optional: step.optional,
          isCompleted: this.narrativeEngine.isStepCompleted(step.eventKey),
        });
        logger.narrative(`[NarrativeOrchestrator] WAIT_CONDITION phase_transition evaluado ${step.eventKey}: ${shouldExecute ? "TRUE" : "FALSE"}`, {
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
        // Adelantamiento: un transversal opcional no cumplido (p. ej.
        // common_crew_seatbelt) no debe retener un ancla posterior ya cumplida
        // (p. ej. transition_to_cruise). Solo salta pasos opcionales.
        if (step.optional && this.maybeOvertakeToAnchor()) {
          this.executeCurrentStep("overtake-to-anchor");
          return;
        }
        this.scheduleWaitConditionPoll(step, eventDefinition);
        return;
      }
      this.executeStep(step, eventDefinition, "auto");
      return;
    }

    // P0-1: WAIT_CONDITION genérico (p. ej. cruise_progress). Las vías de
    // delay_detection y phase_transition ya retornaron arriba y NO se tocan:
    // aquí solo llegan los demás tipos, que antes se dispatcheaban sin
    // evaluar precondiciones (caída a polling → dispatch inmediato).
    if (step.transition === NarrativeTransition.WAIT_CONDITION) {
      const shouldExecute = this.evaluateGenericWaitCondition(step);
      this.logWaitConditionEvaluation(step, shouldExecute);
      this.logWaitEval(step, shouldExecute);
      logger.narrative(`[NarrativeOrchestrator] WAIT_CONDITION genérico evaluado ${step.eventKey}: ${shouldExecute ? "TRUE" : "FALSE"}`, {
        eventKey: step.eventKey,
        optional: step.optional,
        preconditions: (step as any).preconditions ?? null,
        restrictions: (step as any).restrictions ?? null,
        scheduler_rule: (step as any).scheduler_rule ?? null,
      });
      if (!shouldExecute) {
        // Causa definitiva o restricción activa (p. ej. flota/duración que no
        // cambiará, o exclude_if_night de noche): omitir el opcional en vez
        // de esperar. El progreso cruise SÍ puede cambiar → polling.
        // (Un diurno excluido de noche se omite: esperar el alba bloquearía
        // la fase en vuelos cortos; en vuelos largos diurnos se ejecuta.)
        if (step.optional && (this.isDefinitivelyInapplicable(step) || this.isRestrictedOut(step))) {
          logger.narrative(`[NarrativeOrchestrator] ⏩ Omitiendo ${step.eventKey}: opcional no aplicable/excluido en este vuelo`);
          fileLogger.log('[NarrativeOrchestrator] Paso opcional no aplicable omitido', { eventKey: step.eventKey });
          this.emit("step:skipped", {
            step,
            index: this.narrativeEngine.currentIndex(),
          } as StepSkippedEvent);
          this.advanceNarrative("optional-not-applicable");
          return;
        }
        if (step.optional && this.maybeOvertakeToAnchor()) {
          this.executeCurrentStep("overtake-to-anchor");
          return;
        }
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
        this.registerCallback(step, eventDefinition, "callback");
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

    logger.narrative("[NARRATIVE]");
    logger.narrative("AFTER_DELAY: retrasando reproducción");
    logger.narrative("↓");
    logger.narrative(step.eventKey);
    logger.narrative("↓");
    logger.narrative(delayMs + "ms");

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
    // P0-1: WAIT genérico (ni delay ni phase). Se evalúa una sola vez para el
    // log y el guard definitivo de abajo.
    const isGenericWaitStep =
      !isDelayStep &&
      !isPhaseStep &&
      (step as any).transition === NarrativeTransition.WAIT_CONDITION;
    const genericOk: boolean | null = isGenericWaitStep ? this.evaluateGenericWaitCondition(step) : null;

    // ── LOG de rastreo en CADA llamada a executeStep (muestra el caller) ──
    try {
      const ctx: any = this.flightContext;
      const tel: any = ctx?.getTelemetry?.() ?? {};
      const fl: any = ctx?.getFlight?.() ?? {};
      logger.narrative(`[NarrativeOrchestrator] 🔍 executeStep llamado para ${step.eventKey}:`, {
        caller: new Error().stack,
        transition: NarrativeTransition[(step as any).transition],
        eventKey: step.eventKey,
        isDelayDetectionWaitStep: isDelayStep,
        isDelayed: delayOk === null ? "N/A" : delayOk,
        isGenericWaitStep,
        genericWaitOk: genericOk === null ? "N/A" : genericOk,
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
      logger.narrative(`[NarrativeOrchestrator] ✅ WAIT_CONDITION ${step.eventKey}: condición cumplida, procede el dispatch`);
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
      logger.narrative(`[NarrativeOrchestrator] ✅ WAIT_CONDITION phase_transition ${step.eventKey}: condición cumplida, procede el dispatch`);
    }

    // ── GUARD P0-2 (defensa): nunca dispatchear el evento especial sin
    // configuración de usuario, ni siquiera por llamadas directas a
    // executeStep (p. ej. Scheduler.triggerSpecialEvent). El avance manual
    // explícito (mode "manual") sí se permite.
    if (isGenericWaitStep && mode !== "manual" && this.shouldSkipUnconfiguredSpecialEvent(step)) {
      const cur = this.narrativeEngine.currentStep();
      if (cur && cur.eventKey === step.eventKey) {
        logger.narrative(`[NarrativeOrchestrator] ⏩ Omitiendo ${step.eventKey} en executeStep: evento especial no configurado`);
        fileLogger.log('[NarrativeOrchestrator] Evento especial no configurado (executeStep), paso omitido', { eventKey: step.eventKey });
        this.emit("step:skipped", {
          step,
          index: this.narrativeEngine.currentIndex(),
        } as StepSkippedEvent);
        this.advanceNarrative("special-event-not-configured");
      } else {
        console.warn(`[NarrativeOrchestrator] ⛔ Ignorando dispatch directo de ${step.eventKey}: no configurado y no es el paso actual`);
      }
      return;
    }

    // ── GUARD P0-1 (definitivo) para WAIT_CONDITION genérico: sin
    // precondiciones cumplidas no hay dispatch (misma filosofía que los
    // guards de delay_detection y phase_transition). Solo modo normal y no
    // manual; en pruebas se permite el avance paso a paso.
    if (isGenericWaitStep && !this.isTestMode && mode !== "manual") {
      if (genericOk !== true) {
        const cur = this.narrativeEngine.currentStep();
        const isCurrent = !!cur && cur.eventKey === step.eventKey;
        if (step.optional && (this.isDefinitivelyInapplicable(step) || this.isRestrictedOut(step)) && isCurrent) {
          logger.narrative(`[NarrativeOrchestrator] ⏩ Omitiendo ${step.eventKey} en executeStep: opcional definitivamente no aplicable`);
          fileLogger.log('[NarrativeOrchestrator] Paso opcional no aplicable omitido (executeStep)', { eventKey: step.eventKey });
          this.emit("step:skipped", {
            step,
            index: this.narrativeEngine.currentIndex(),
          } as StepSkippedEvent);
          this.advanceNarrative("optional-not-applicable");
          return;
        }
        console.warn(`[NarrativeOrchestrator] ⛔ Bloqueando dispatch de ${step.eventKey} (WAIT_CONDITION genérico=false). Solo se ejecuta al cumplirse las precondiciones.`);
        // Programar re-evaluación solo si es el paso actual (las llamadas
        // directas fuera de secuencia no deben programar polls).
        if (isCurrent) this.scheduleWaitConditionPoll(step, eventDefinition);
        return;
      }
      logger.narrative(`[NarrativeOrchestrator] ✅ WAIT_CONDITION genérico ${step.eventKey}: condición cumplida, procede el dispatch`);
    }

    logger.narrative("[NARRATIVE]");
    logger.narrative("Dispatching");
    // Log de trazabilidad: preparación del evento que va a la cola de anuncios
    // → AnnouncementService → Edge Function audio-get.
    logger.narrative("[NarrativeOrchestrator] Preparando evento para Edge Function:", {
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
    this.dispatcher.dispatch(eventDefinition, this.flightContext).catch((err) => {
      console.error('[NarrativeOrchestrator] ❌ dispatch fallido:', { eventKey: step.eventKey, error: (err as Error)?.message ?? String(err) });
      fileLogger.error('[NarrativeOrchestrator] dispatch fallido', { eventKey: step.eventKey, error: (err as Error)?.message ?? String(err) });
    });

    logger.narrative(
      `[NarrativeOrchestrator] Paso ejecutado ${step.eventKey} (modo: ${mode})`
    );

    // Corrección WAIT_CONDITION: el avance real ocurre en handleAnnouncementCompleted
    // (incluye WAIT_CONDITION). Aquí solo se loguea el estado para auditoría y se
    // deja el onStepCompleted diferido al completar el audio, evitando doble avance.
    if (step.transition === NarrativeTransition.WAIT_CONDITION) {
      logger.narrative('[NarrativeEngine] Estado del paso:', {
        eventKey: step.eventKey,
        isCompleted: this.narrativeEngine.isStepCompleted(step.eventKey),
        currentIndex: this.narrativeEngine.currentIndex(),
        totalSteps: this.narrativeEngine.getTotalSteps(),
        nextStep: (this.narrativeEngine as any).definition?.steps?.[this.narrativeEngine.currentIndex() + 1]?.eventKey ?? null,
      });
      logger.narrative(`[NarrativeOrchestrator] WAIT_CONDITION ${step.eventKey} ejecutado, esperando handleAnnouncementCompleted para avanzar`);
    }

    this.emit("step:executed", {
      step,
      index: this.narrativeEngine.currentIndex(),
      mode,
    } as StepExecutedEvent);
    // Registro focalizado PERMANENTE: un paso ejecutado (disparo de audio).
    // Los polls que no ejecutan no loguean: el log vuelve a ser legible.
    logger.audio(`🎯 Paso ejecutado: ${step.eventKey}`, {
      transition: NarrativeTransition[(step as any).transition],
      mode,
    });
    // Red de seguridad: si este audio nunca reporta completed/error, avanzar
    // con warning al vencer (solo modo normal; en pruebas manda lo manual).
    this.scheduleAudioCompletionNet(step);
  }

  // decision_maker === "user": el paso espera una acción del usuario.
  private waitForUserAction(step: NarrativeStep): void {
    this.pendingUserSteps.add(step.eventKey);
    logger.narrative("[NarrativeOrchestrator] Esperando acción del usuario para el paso: " + step.eventKey);
  }

  // detection_strategy === "manual": el paso solo se ejecuta por acción manual.
  private registerManualStep(step: NarrativeStep): void {
    this.pendingUserSteps.add(step.eventKey);
    logger.narrative("[NarrativeOrchestrator] Paso manual pendiente de activación: " + step.eventKey);
  }

  // detection_strategy === "event_listener" / "callback": espera un evento externo.
  private listenForEvent(step: NarrativeStep, eventDefinition: EventDefinition): void {
    this.registerCallback(step, eventDefinition, "event_listener");
  }

  /**
   * Indica si existe un emisor capaz de resolver el paso (timer programado
   * con ese evento, p. ej. el timer del evento especial). Sin emisor, un paso
   * opcional con event_listener/callback esperaría indefinidamente porque nada
   * llamará a notifyExternalEvent.
   */
  private hasRegisteredEmitter(stepKey: string): boolean {
    try {
      const tm: any = (this as any).timerManager;
      if (typeof tm?.getPendingTimers !== "function") return false;
      const pending: Array<{ event?: string }> = tm.getPendingTimers() ?? [];
      return pending.some((t) => t?.event === stepKey);
    } catch {
      return false;
    }
  }

  private registerCallback(step: NarrativeStep, eventDefinition: EventDefinition, strategy = "event_listener"): void {
    const hasEmitter = this.hasRegisteredEmitter(step.eventKey);
    const action = hasEmitter ? 'esperando' : (step.optional && !this.isTestMode ? 'saltando' : 'esperando');
    logger.narrative('[NarrativeOrchestrator] Evento event_listener:', {
      eventKey: step.eventKey,
      strategy,
      optional: step.optional,
      hasEmitter,
      action,
    });
    // Opcional sin emisor: saltar para no bloquear la secuencia (p. ej.
    // captain_special_event sin texto configurado, cuyo timer nunca se
    // programa). En modo pruebas se espera (avance manual disponible).
    if (!hasEmitter && step.optional && !this.isTestMode) {
      logger.narrative(`[NarrativeOrchestrator] ⏩ Omitiendo ${step.eventKey}: opcional con ${strategy} sin emisor registrado`);
      fileLogger.log('[NarrativeOrchestrator] Paso opcional sin emisor omitido', { eventKey: step.eventKey, strategy });
      this.emit("step:skipped", {
        step,
        index: this.narrativeEngine.currentIndex(),
      } as StepSkippedEvent);
      this.advanceNarrative("no-emitter-skipped");
      return;
    }
    this.pendingExternalSteps.add(step.eventKey);
    logger.narrative("[NarrativeOrchestrator] Esperando evento externo para el paso: " + step.eventKey);
  }

  setCurrentProducer(producer: string): void {
    this.currentProducer = producer;
  }

  setTestMode(enabled: boolean): void {
    this.isTestMode = enabled;
    logger.narrative(
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
      logger.narrative("[NarrativeOrchestrator] Paso " + stepKey + " no estaba esperando acción del usuario");
      return;
    }
    if (this.pendingStep?.eventKey === stepKey) {
      this.pendingStep = null;
    }
    logger.narrative("[NarrativeOrchestrator] Acción del usuario confirmada para el paso: " + stepKey);
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

    logger.narrative(
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
    logger.narrative(
      `[NarrativeOrchestrator] ⏳ Esperando finalización de audio para: ${stepKey}`
    );
    logger.narrative(
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

  // ── Red de seguridad de completion (modo normal) ──────────────────────

  /** Arma (o reemplaza) el timeout de completion para un audio despachado. */
  private scheduleAudioCompletionNet(step: NarrativeStep): void {
    if (this.isTestMode) return; // en pruebas manda el avance manual
    const tr = (step as any).transition;
    const isWait = tr === NarrativeTransition.WAIT_CONDITION;
    const isAuto =
      tr === NarrativeTransition.AFTER_DELAY ||
      tr === NarrativeTransition.AFTER_COMPLETION ||
      tr === NarrativeTransition.IMMEDIATE ||
      isWait;
    if (!isAuto) return;
    this.clearAudioCompletionNet(step.eventKey);
    const timeoutMs = isWait ? WAIT_AUDIO_COMPLETION_TIMEOUT_MS : AUDIO_COMPLETION_TIMEOUT_MS;
    const epoch = this.scenarioEpoch;
    const eventKey = step.eventKey;
    logger.narrative('[NarrativeOrchestrator] ⏱️ Red de seguridad armada:', { eventKey, timeoutMs: `${timeoutMs / 1000}s`, epoch });
    const timer = setTimeout(() => {
      this.audioCompletionTimers.delete(eventKey);
      if (epoch !== this.scenarioEpoch) return; // fase cambiada: obsoleto
      if (this.narrativeEngine.isCompleted()) return;
      const cur = this.narrativeEngine.currentStep();
      if (!cur || cur.eventKey !== eventKey) return; // ya se avanzó por otra vía
      console.warn('[NarrativeOrchestrator] ⏰ Timeout de audio, avanzando con warning:', {
        eventKey,
        timeoutMs,
        epoch,
      });
      fileLogger.warn('[NarrativeOrchestrator] Timeout de audio: avance forzado', { eventKey, timeoutMs });
      this.advanceNarrative("audio-completion-timeout");
    }, timeoutMs);
    this.audioCompletionTimers.set(eventKey, { timer, epoch });
  }

  /** Desarma el timeout de completion (completó, falló, cambió de fase o re-dispatch). */
  private clearAudioCompletionNet(eventKey?: string): void {
    if (eventKey !== undefined) {
      const rec = this.audioCompletionTimers.get(eventKey);
      if (rec) {
        clearTimeout(rec.timer);
        this.audioCompletionTimers.delete(eventKey);
      }
      return;
    }
    for (const rec of this.audioCompletionTimers.values()) clearTimeout(rec.timer);
    this.audioCompletionTimers.clear();
  }

  private logOrchestratorState(context: string): void {
    logger.narrative("[NarrativeOrchestrator] Estado actual:", {
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

    logger.narrative(`[NarrativeOrchestrator] Paso omitido: ${step.eventKey}`);
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
    this.clearAudioCompletionNet();
    logger.narrative(`[NarrativeOrchestrator] Estado manual reiniciado (época ${this.scenarioEpoch})`);
    this.emit("step:clear", null);
  }

  private isManualStep(step: NarrativeStep): boolean {
    return step.decision_maker === "user" || step.detection_strategy === "manual";
  }

  private holdForManualAction(step: NarrativeStep, executionId: number): void {
    this.pendingStep = step;
    this.pendingUserSteps.add(step.eventKey);
    this.pendingExternalSteps.delete(step.eventKey);

    logger.narrative(
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
      logger.narrative("[NarrativeOrchestrator] Paso " + stepKey + " no estaba esperando evento externo");
      return;
    }
    logger.narrative("[NarrativeOrchestrator] Evento externo recibido para el paso: " + stepKey);
    this.executeCurrentStep("external-event", true);
  }

  // ── P0: evento especial en cabina / WAIT genérico ────────────────────

  /** Paso narrativo del evento especial en cabina (CRUISE, opcional). */
  private static readonly SPECIAL_EVENT_KEY = "captain_special_event";

  /**
   * ¿Configuró el usuario el evento especial? Requiere flag activo Y texto
   * no vacío. Vive en `flight` (no en `settings.eventConfig`), por eso
   * `isStepEnabled()` no lo cubre y se evalúa aquí de forma explícita.
   */
  private isSpecialEventConfigured(): boolean {
    try {
      const flight: any = this.flightContext?.getFlight?.() ?? {};
      return (
        flight?.specialEventEnabled === true &&
        typeof flight?.specialEvent === "string" &&
        flight.specialEvent.trim() !== ""
      );
    } catch {
      return false;
    }
  }

  /** ¿Debe omitirse el paso por falta de configuración del usuario? */
  private shouldSkipUnconfiguredSpecialEvent(step: NarrativeStep): boolean {
    if (step.eventKey !== NarrativeOrchestrator.SPECIAL_EVENT_KEY) return false;
    return !this.isSpecialEventConfigured();
  }

  /**
   * Evalúa un WAIT_CONDITION genérico (cualquier `preconditions.type` que NO
   * sea `delay_detection` ni `phase_transition`, cuyas vías están intactas)
   * delegando en `RuleEngine.evaluateStep` (progreso cruise, restricciones…).
   * Sin RuleEngine → `true` (fail-open: conserva el comportamiento previo).
   */
  private evaluateGenericWaitCondition(step: NarrativeStep): boolean {
    try {
      const engine: any = this.ruleEngine;
      if (engine && typeof engine.evaluateStep === "function") {
        const result = engine.evaluateStep(step, this.flightContext) === true;
        // Evaluación concisa por ciclo (desactivada por defecto; ver flags).
        logger.ruleEvaluation(`Evaluando ${step.eventKey}`, {
          type: (step as any).preconditions?.type ?? null,
          conditions: (step as any).preconditions?.conditions ?? null,
          result,
        });
        return result;
      }
    } catch (e) {
      console.warn(`[NarrativeOrchestrator] evaluateGenericWaitCondition error for ${step.eventKey}`, e);
    }
    return true;
  }

  /**
   * ¿El paso opcional es definitivamente inaplicable en este vuelo?
   * Solo causas que NO cambiarán a mitad de vuelo (evento sin configurar,
   * widebody, duración mínima, internacional). El progreso cruise o la noche
   * SÍ pueden cambiar → esos van por polling, nunca por skip.
   */
  private isDefinitivelyInapplicable(step: NarrativeStep): boolean {
    if (this.shouldSkipUnconfiguredSpecialEvent(step)) return true;
    try {
      const engine: any = this.ruleEngine;
      const r: any = (step as any).restrictions ?? {};
      if (
        r.aircraft_is_widebody === true &&
        typeof engine?.isWidebodyAircraft === "function" &&
        !engine.isWidebodyAircraft(this.flightContext)
      ) {
        return true;
      }
      if (
        r.flight_duration_minutes != null &&
        typeof engine?.getFlightDurationMinutes === "function" &&
        engine.getFlightDurationMinutes(this.flightContext) < Number(r.flight_duration_minutes)
      ) {
        return true;
      }
      if (
        r.requires_international_flight === true &&
        typeof engine?.isInternationalFlight === "function" &&
        !engine.isInternationalFlight(this.flightContext)
      ) {
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * ¿El paso está excluido por restricciones ahora mismo? (noche, flota,
   * duración, internacional). Sin RuleEngine o sin método → false (polling,
   * comportamiento previo). Solo se usa para omitir pasos OPCIONALES; los
   * no-opcionales siguen esperando.
   */
  private isRestrictedOut(step: NarrativeStep): boolean {
    try {
      const engine: any = this.ruleEngine;
      if (engine && typeof engine.isRestrictedOut === "function") {
        return engine.isRestrictedOut(step, this.flightContext) === true;
      }
    } catch {}
    return false;
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
    logger.narrative("[NARRATIVE TRACE]");
    logger.polling("action: cancelPendingTimers");
    logger.narrative("executionId: " + this.execCounter);
    logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
    logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
    logger.narrative("event: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));
    logger.narrative("transition: " + (this.narrativeEngine.currentStep() ? NarrativeTransition[this.narrativeEngine.currentStep()!.transition] : "null"));
    logger.polling("reason: pending-timers-cleared");

    for (const id of this.pendingTimers) {
      this.timerManager.cancel(id);
    }
    this.pendingTimers.clear();
    this.clearAudioCompletionNet();
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

    logger.narrative("[NARRATIVE TRACE]");
    logger.narrative("action: advanceNarrative");
    logger.narrative("executionId: " + this.execCounter);
    logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
    logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
    logger.narrative("event: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));
    logger.narrative("transition: " + (this.narrativeEngine.currentStep() ? NarrativeTransition[this.narrativeEngine.currentStep()!.transition] : "null"));
    logger.narrative("reason: " + (reason ?? "unknown"));

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
      logger.narrative("[NARRATIVE TRACE]");
      logger.narrative("action: advanceNarrative");
      logger.narrative("executionId: " + this.execCounter);
      logger.narrative("scenario: " + this.narrativeEngine.getScenarioName());
      logger.narrative("stepIndex: " + this.narrativeEngine.currentIndex());
      logger.narrative("event: null");
      logger.narrative("transition: null");
      logger.narrative("reason: scenario-completed-guard");

      this.pendingStep = null;
      this.emit("scenario:completed", {
        totalSteps: this.narrativeEngine.getTotalSteps(),
      } as ScenarioCompletedEvent);
      return;
    }

    const step = this.narrativeEngine.currentStep();
    if (!step) return;

    logger.narrative("Next Step");
    logger.narrative("↓");
    logger.narrative(step.eventKey);

    this.executeCurrentStep(reason);
  }
}
