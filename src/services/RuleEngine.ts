import { FlightPhase } from "../engine/FlightEngine";
import { EventCatalogService } from "../events/EventCatalogService";
import { TriggerEvaluatorFactory } from "../triggers/TriggerEvaluatorFactory";
import { FlightContext } from "./FlightContext";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { secondsToHHMM } from "../utils/timeUtils";

interface AnnouncementAction {
  type: "announcement";
  event: string;
}

interface TimerAction {
  type: "timer";
  id: string;
  delayMs: number;
  event: string;
}

export type RuleAction = AnnouncementAction | TimerAction;

export class RuleEngine {
  private timerCounter = 0;

  // Compatibilidad con spec: permite inyección opcional para isDelayThresholdExceeded sin parámetro
  private flightContext?: FlightContext;
  private eventCatalog: typeof EventCatalogService = EventCatalogService as any;

  // One-shot: max_once_per_flight — evita re-disparo dentro del mismo vuelo
  private executedEvents = new Set<string>();

  // Estado independiente por evento de demora (one-shot + última evaluación)
  private delayEventState: Map<string, { triggered: boolean; lastEvaluation: number; thresholdMs: number }> = new Map();

  constructor(flightContext?: FlightContext, eventCatalog?: typeof EventCatalogService) {
    if (flightContext) this.flightContext = flightContext;
    if (eventCatalog) this.eventCatalog = eventCatalog as any;
  }

  /** Permite inyectar el contexto si se usó constructor sin argumentos (compat spec). */
  setFlightContext(ctx: FlightContext): void {
    this.flightContext = ctx;
  }

  /**
   * Proveedor opcional de la fase de vuelo actual (p. ej. Scheduler.getCurrentPhase
   * → "PRE_FLIGHT"). La condición `fsm` de delay_detection se refiere a la FASE,
   * mientras que FlightContext.getFSM() devuelve el FlightState de UI ("A".."D"):
   * sin este proveedor, `fsm: "PRE_FLIGHT"` no podría cumplirse nunca.
   */
  private phaseProvider?: () => string | null;
  setPhaseProvider(fn: () => string | null): void {
    this.phaseProvider = fn;
  }
  private currentFlightPhase(): string | null {
    try {
      return this.phaseProvider?.() ?? null;
    } catch {
      return null;
    }
  }

  setEventCatalog(catalog: typeof EventCatalogService): void {
    this.eventCatalog = catalog as any;
  }

  /** Limpia el registro one-shot (p. ej. al iniciar nuevo vuelo). */
  resetOneShot(): void {
    this.executedEvents.clear();
    this.delayEventState.clear();
  }

  /** Consulta si un evento ya se ejecutó (one-shot). */
  hasExecuted(eventKey: string): boolean {
    return this.executedEvents.has(eventKey);
  }

  /** Marca un evento como ejecutado para max_once_per_flight. */
  markExecuted(eventKey: string): void {
    this.executedEvents.add(eventKey);
    const st = this.getDelayEventState(eventKey);
    st.triggered = true;
    st.lastEvaluation = Date.now();
  }

  // Mapa de estado por evento (requerido por spec)
  public getDelayEventState(eventKey: string): { triggered: boolean; lastEvaluation: number; thresholdMs: number } {
    if (!this.delayEventState.has(eventKey)) {
      this.delayEventState.set(eventKey, {
        triggered: this.executedEvents.has(eventKey),
        lastEvaluation: 0,
        thresholdMs: this.getEventThreshold(eventKey),
      });
    }
    const s = this.delayEventState.get(eventKey)!;
    // Mantener threshold sincronizado por si cambia el catálogo/override por vuelo
    s.thresholdMs = this.resolveThresholdMs(eventKey, this.flightContext);
    // Sincronizar triggered con Set
    s.triggered = this.executedEvents.has(eventKey) || s.triggered;
    return s;
  }

  /** Compat spec DebugMonitor: indica si un evento se está evaluando. */
  isEvaluating(eventKey: string, context?: FlightContext): boolean {
    // Se considera "evaluando" si no se ha disparado (one-shot) y las precondiciones de
    // tiempo están próximas a evaluarse (o ya superadas). Sin FlightContext no se puede
    // determinar, se retorna false para no marcar activo en vacío.
    if (this.executedEvents.has(eventKey)) return false;
    const ctx = context ?? this.flightContext;
    if (!ctx) return false;
    try {
      // Reutiliza la evaluación de umbral; si hay datos insuficientes retorna false
      return this.isDelayThresholdExceeded(eventKey, ctx);
    } catch {
      return false;
    }
  }

  /**
   * Resuelve el umbral (ms) para un evento con la MISMA precedencia que la
   * evaluación real:
   *   1) override por vuelo (FlightContext.delayOverrides, ej. cargado desde
   *      `events.default_delay_ms` de la DB cuando el usuario lo reparametriza);
   *   2) `events.default_delay_ms` del catálogo (código);
   *   3) default 600000 (10 min).
   */
  private resolveThresholdMs(eventKey: string, ctx?: FlightContext): number {
    const c: FlightContext | undefined = ctx ?? this.flightContext;
    try {
      const override = c?.getDelayOverride?.(eventKey);
      if (typeof override === "number" && !Number.isNaN(override) && override > 0) return override;
    } catch {}
    const catalog: any = (this.eventCatalog as any)?.get ? this.eventCatalog : EventCatalogService;
    const event: any = catalog.get(eventKey);
    return event?.default_delay_ms || 600000;
  }

  /** Expuesto para DebugMonitor: obtiene threshold en ms (con override por vuelo si ctx). */
  getEventThreshold(eventKey: string, ctx?: FlightContext): number {
    return this.resolveThresholdMs(eventKey, ctx);
  }

  /** Expuesto para DebugMonitor: verifica demora (wrapper público). */
  isDelayExceeded(eventKey: string, context?: FlightContext): boolean {
    return this.isDelayThresholdExceeded(eventKey, context);
  }

  /**
   * Restricción informativa `preferred_condition: "is_night_flight"`.
   * Determina si el vuelo es nocturno según la hora programada de salida
   * (20:00–06:00). No bloquea la ejecución: solo informa al diseñador en el
   * monitor si la condición preferida se cumple.
   */
  isNightFlight(context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return false;

    const rawFlight: any = ctx.getFlight?.() ?? {};
    const simbrief: any = ctx.getSimBriefData?.() ?? null;

    // Hora de salida (segundos del día, HH:MM local o UTC).
    let hourOfDay: number | null = null;
    let source = "";

    // 1) departureTimeLocal (HH:MM) — hora local del aeropuerto de origen.
    const local = rawFlight.departureTimeLocal ?? rawFlight.departureTime;
    if (typeof local === "string" && local.trim() !== "") {
      const hmMatch = /^(\d{1,2}):(\d{2})/.exec(local.trim());
      if (hmMatch) {
        hourOfDay = Number(hmMatch[1]);
        source = "departureTimeLocal (HH:MM local)";
      }
    }

    // 2) scheduledTakeoffTime (segundos del día UTC, normalizado).
    if (hourOfDay === null) {
      const sched = rawFlight.scheduledTakeoffTime ?? rawFlight.scheduled_takeoff_time;
      if (typeof sched === "number" && !Number.isNaN(sched)) {
        let secs = sched;
        if (secs > 86400 && secs < 4102444800) secs = secs % 86400; // epoch → seg del día
        hourOfDay = Math.floor(secs / 3600);
        source = "scheduledTakeoffTime";
      }
    }

    // 3) SimBrief general.sched_out / est_out como timestamp o HH:MM (UTC).
    if (hourOfDay === null && simbrief?.general) {
      const g: any = simbrief.general;
      const raw = g.sched_out ?? g.est_out ?? g.orig_time;
      if (raw != null && raw !== "") {
        const asNum = Number(raw);
        if (!Number.isNaN(asNum) && asNum > 0) {
          const d = new Date(asNum * 1000);
          if (!Number.isNaN(d.getTime())) {
            hourOfDay = d.getUTCHours();
            source = "SimBrief sched_out (UTC)";
          }
        } else if (typeof raw === "string") {
          const hmMatch = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
          if (hmMatch) {
            hourOfDay = Number(hmMatch[1]);
            source = "SimBrief sched_out (HH:MM)";
          }
        }
      }
    }

    if (hourOfDay === null) {
      console.log("[RuleEngine] is_night_flight: sin hora de salida disponible; false", { flight: rawFlight });
      return false;
    }

    // Normalizar 24:xx (medianoche) a 00:xx.
    if (hourOfDay === 24) hourOfDay = 0;

    // 20:00 – 06:00 (vuelo nocturno).
    const isNight = hourOfDay >= 20 || hourOfDay < 6;
    console.log("[RuleEngine] is_night_flight:", {
      source,
      hourOfDay,
      formatted: `${String(hourOfDay).padStart(2, "0")}:00`,
      isNightFlight: isNight,
    });
    return isNight;
  }

  /**
   * Devuelve el progreso del crucero de 0.0 a 1.0.
   * elapsed = telemetry.zuluTime - flight.cruiseEntryTime (ambos en segundos
   * UTC); se divide por flight.cruiseTimeSeconds (SimBrief `times.cruise_time`).
   * Fuera de CRUISE o sin datos devuelve 0.
   */
  public getCruiseProgress(context?: FlightContext): number {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return 0;
    const flight: any = ctx.getFlight?.() ?? {};
    const telemetry: any = ctx.getTelemetry?.() ?? {};

    if (!flight.cruiseTimeSeconds || !flight.cruiseEntryTime) return 0;

    // La fase de vuelo la provee el Scheduler (inyectado vía setPhaseProvider).
    // Fallback: FlightContext.getFSM().currentState (estado UI "A".."D" o fase).
    const phase = this.currentFlightPhase();
    if (phase !== null) {
      if (phase !== "CRUISE") return 0;
    } else {
      try {
        const fsm: any = ctx.getFSM?.() ?? {};
        const current = fsm?.currentState ?? fsm?.getCurrentState?.() ?? null;
        if (current !== null && current !== "CRUISE") return 0;
      } catch {}
    }

    const zuluTime = Number(telemetry.zuluTime ?? telemetry.zulu_time);
    const entry = Number(flight.cruiseEntryTime);
    const total = Number(flight.cruiseTimeSeconds);
    if (Number.isNaN(zuluTime) || Number.isNaN(entry) || Number.isNaN(total) || total <= 0) return 0;

    const elapsed = zuluTime - entry;
    const progress = elapsed / total;

    return Math.min(Math.max(progress, 0), 1);
  }

  /**
   * Determina el modo para dormir de los pasajeros
   * (entre el 25% y el 80% del crucero, y en horario nocturno local 23:00–06:00).
   */
  public isPassengersSleeping(context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    const progress = this.getCruiseProgress(ctx);

    if (progress < 0.25 || progress >= 0.80) return false;

    const telemetry: any = ctx?.getTelemetry?.() ?? {};
    const localTime = Number(telemetry.localTime);
    if (Number.isNaN(localTime)) return false;

    const localHour = Math.floor((localTime % 86400) / 3600);
    return localHour >= 23 || localHour < 6;
  }

  /**
   * Determina si el vuelo es internacional
   * (valor calculado al importar SimBrief).
   */
  public isInternationalFlight(context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return false;
    const flight: any = ctx.getFlight?.() ?? {};
    return flight.isInternational === true;
  }

  enterPhase(
    phase: FlightPhase,
    context: FlightContext,
    steps?: readonly NarrativeStep[]
  ): RuleAction[] {
    const events = EventCatalogService.getByPhase(phase);
    const stepByEvent = new Map<string, NarrativeStep>();
    if (steps) {
      for (const step of steps) {
        stepByEvent.set(step.eventKey, step);
      }
    }

    const actions: RuleAction[] = [];

    for (const ev of events) {
      const step = stepByEvent.get(ev.eventKey);
      // One-shot guard: si el paso tiene max_once_per_flight y ya se ejecutó, no evaluar
      if (step?.restrictions?.max_once_per_flight && this.executedEvents.has(ev.eventKey)) {
        console.log(`[RuleEngine] Skipping ${ev.eventKey}: max_once_per_flight ya ejecutado`);
        continue;
      }
      const isTriggered = step
        ? this.evaluateStep(step, context)
        : TriggerEvaluatorFactory.get(ev.triggerType).evaluate(ev, context);

      console.log("[RULE ENGINE]");
      console.log("Evaluating:");
      console.log(ev.eventKey);
      console.log("↓");
      if (step) {
        console.log("Source: NarrativeStep.scheduler_rule");
        console.log("SchedulerRule: " + (step.scheduler_rule ?? "(none, fallback trigger)"));
        if ((step as any).preconditions) {
          console.log("Preconditions: " + JSON.stringify((step as any).preconditions));
        }
      } else {
        console.log(evaluatorName(ev.triggerType));
      }
      console.log("↓");
      console.log(isTriggered ? "TRUE" : "FALSE");

      if (isTriggered) {
        // NO marcar one-shot aquí: la evaluación no es ejecución. Para pasos
        // narrativos el Scheduler descarta esta acción ("Skipping ruleEngine
        // dispatch for narrative event") y la dispara el NarrativeOrchestrator;
        // marcar aquí consumía el max_once_per_flight sin reproducir el anuncio
        // y el paso quedaba bloqueado para siempre (caso preflight_capt_delay_taxi).
        // El one-shot narrativo lo gestiona NarrativeEngine.markFired al completarse.
        if (ev.priority === 10) {
          actions.push({ type: "announcement", event: ev.eventKey });
        } else if (ev.priority === 20) {
          const id = ev.eventKey + "-" + this.timerCounter++;
          actions.push({ type: "timer", id, delayMs: 60000, event: ev.eventKey });
        } else {
          // prioridad distinta: fallback a announcement
          actions.push({ type: "announcement", event: ev.eventKey });
        }
      }
    }

    return actions;
  }

  // La regla de programación se lee desde el NarrativeStep, no desde el EventDefinition.
  evaluateStep(step: NarrativeStep, context: FlightContext): boolean {
    try {
      console.log('[RuleEngine] 📦 Evaluando paso:', {
        eventKey: step.eventKey,
        hasPreconditions: !!(step as any).preconditions,
        hasSchedulerRule: !!(step as any).scheduler_rule,
        preconditions: (step as any).preconditions ?? null,
        schedulerRule: (step as any).scheduler_rule ?? null,
      });
    } catch {}
    // Guard one-shot
    if ((step as any).restrictions?.max_once_per_flight && this.executedEvents.has(step.eventKey)) {
      console.log(`[RuleEngine] evaluateStep bloqueado por max_once_per_flight: ${step.eventKey}`);
      return false;
    }

    // Si tiene preconditions tipo delay_detection, evaluarlas (WAIT_CONDITION logic)
    const preconditions: any = (step as any).preconditions;
    if (preconditions) {
      const preResult = this.evaluatePreconditions(step, context);
      // Si el tipo era delay_detection, evaluatePreconditions ya decidió; respetar su resultado
      if (preconditions.type === "delay_detection") {
        const triggered = this.executedEvents.has(step.eventKey) || this.getDelayEventState(step.eventKey).triggered;
        console.log(`[RuleEngine] Evaluando ${step.eventKey}:`, {
          eventKey: step.eventKey,
          isDelayed: preResult,
          triggered,
          decision: preResult && !triggered ? "EJECUTAR" : "OMITIR",
        });
        return preResult;
      }
      // Para otros tipos, si retorna false no disparar
      if (!preResult) return false;
    }

    const rule = step.scheduler_rule;

    if (!rule) {
      // Fallback al comportamiento hardcodeado: evaluación por trigger del evento.
      const event = EventCatalogService.get(step.eventKey);
      if (!event) return false;
      return TriggerEvaluatorFactory.get(event.triggerType).evaluate(event, context);
    }

    return this.evaluateSchedulerRule(rule, context, step.eventKey);
  }

  /**
   * Evalúa si se ha superado el umbral de demora para un evento.
   * Obtiene threshold de events.default_delay_ms o 600000 ms por defecto.
   * Compara hora UTC actual (zuluTime) vs hora programada de salida.
   */
  private isDelayThresholdExceeded(eventKey: string, context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    // Resolver catálogo: preferencia instancia inyectada, fallback EventCatalogService
    const catalog: any = (this.eventCatalog as any)?.get ? this.eventCatalog : EventCatalogService;
    const event: any = catalog.get(eventKey);
    if (!event) {
      console.log(`[RuleEngine] isDelayThresholdExceeded: evento no encontrado ${eventKey}`);
      return false;
    }

    if (!ctx) {
      console.log(`[RuleEngine] isDelayThresholdExceeded: sin FlightContext para ${eventKey}`);
      return false;
    }

    // Umbral con la MISMA precedencia que el monitor: override por vuelo (DB) primero,
    // luego events.default_delay_ms del catálogo, default 600000.
    let thresholdMs: number = this.resolveThresholdMs(eventKey, ctx);
    let thresholdSource = "event.default_delay_ms (catálogo)";
    try {
      const overrideDb = ctx.getDelayOverride?.(eventKey);
      if (typeof overrideDb === "number" && !Number.isNaN(overrideDb) && overrideDb > 0) {
        thresholdMs = overrideDb;
        thresholdSource = "override por vuelo (DB delayOverrides)";
      }
    } catch {}

    // Obtener la hora actual del simulador (UTC) — zuluTime en segundos
    const rawTelemetry: any = (ctx as any).getTelemetry?.() ?? {};
    const currentTime: number | undefined =
      rawTelemetry.zuluTime ?? rawTelemetry.zulu_time ?? rawTelemetry["ZULU TIME"] ?? rawTelemetry["ZULU_TIME"];

    // Obtener hora programada de salida: prioridad scheduledTakeoffTime, fallback departureTime HH:MM
    const rawFlight: any = (ctx as any).getFlight?.() ?? {};
    let scheduledTime: number | undefined = rawFlight.scheduledTakeoffTime ?? rawFlight.scheduled_takeoff_time;
    let scheduledSource: string | undefined;

    // Log de origen de scheduledTakeoffTime (SimBrief)
    console.log(`[RuleEngine] 📋 scheduledTakeoffTime:`, {
      eventKey,
      value: rawFlight.scheduledTakeoffTime ?? rawFlight.scheduled_takeoff_time ?? null,
      formatted: (() => {
        const v = rawFlight.scheduledTakeoffTime ?? rawFlight.scheduled_takeoff_time;
        return typeof v === "number" && !Number.isNaN(v) ? secondsToHHMM(v) : "--:--";
      })(),
      source: rawFlight.scheduledTakeoffTime
        ? "de SimBrief/flight.scheduledTakeoffTime"
        : "NO DEFINIDO -> se usará departureTime (fallback HH:MM). Si ambos faltan NO dispara.",
    });

    if (scheduledTime != null) {
      scheduledSource = "flight.scheduledTakeoffTime";
    } else if (typeof rawFlight.departureTime === "string" && rawFlight.departureTime.trim() !== "") {
      const dep = rawFlight.departureTime.trim();
      scheduledSource = "flight.departureTime (fallback HH:MM)";
      // Intentar parsear HH:MM como segundos del día
      const hmMatch = /^(\d{1,2}):(\d{2})$/.exec(dep);
      if (hmMatch) {
        const h = Number(hmMatch[1]);
        const m = Number(hmMatch[2]);
        if (!isNaN(h) && !isNaN(m)) {
          scheduledTime = h * 3600 + m * 60;
        }
      } else {
        // Intentar ISO / timestamp
        const asDate = Date.parse(dep);
        if (!Number.isNaN(asDate)) {
          // Si es fecha completa, usar segundos del día UTC
          const d = new Date(asDate);
          scheduledTime = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
        } else {
          const asNum = Number(dep);
          if (!Number.isNaN(asNum) && asNum > 0) {
            // Asumir segundos epoch o segundos del día
            scheduledTime = asNum > 86400 ? asNum % 86400 : asNum;
          }
        }
      }
    }

    if (currentTime == null || scheduledTime == null) {
      console.log(`[RuleEngine] isDelayThresholdExceeded: datos insuficientes para ${eventKey}`, {
        currentTime,
        scheduledTime,
        scheduledSource,
        currentTimeSource: "telemetry.zuluTime",
        consequence: "NO SE DISPARA (condición de tiempo no puede evaluarse)",
      });
      return false;
    }

    let ct = Number(currentTime);
    let st = Number(scheduledTime);
    if (Number.isNaN(ct) || Number.isNaN(st)) return false;
    // Normalización defensiva: si scheduledTakeoffTime vino como epoch (s desde 1970,
    // p.ej. SimBrief sched_out), convertir a segundos del día UTC para comparar
    // contra zuluTime (segundos desde medianoche).
    if (st > 86400 && st < 4102444800) {
      st = st % 86400;
      console.log(`[RuleEngine] scheduledTakeoffTime normalizado epoch→segundos del día para ${eventKey}: ${st}`);
    }

    // Calcular el tiempo restante hasta la salida programada
    const thresholdSeconds = thresholdMs / 1000;
    const timeUntilTakeoff = st - ct;

    // Si el tiempo restante es menor o igual al umbral, la demora se ha superado
    const isDelayed = timeUntilTakeoff <= thresholdSeconds; // Convertir a segundos

    // Actualizar estado independiente por evento
    const state = this.getDelayEventState(eventKey);
    state.lastEvaluation = Date.now();
    // No marcar triggered aquí; solo al ejecutar el anuncio (markExecuted)

    // ── LOG DETALLADO (criterio de aceptación) ────────────────────────────────
    console.log(`[RuleEngine] ⏱️ Evaluando demora para ${eventKey}:`, {
      // Entradas
      currentTime: {
        value: ct,
        source: "telemetry.zuluTime",
        raw: rawTelemetry.zuluTime ?? rawTelemetry.zulu_time ?? null,
        formatted: secondsToHHMM(ct),
      },
      scheduledTime: {
        value: st,
        source: scheduledSource ?? "desconocido",
        raw: rawFlight.scheduledTakeoffTime ?? rawFlight.departureTime ?? null,
        formatted: secondsToHHMM(st),
      },
      thresholdMs: {
        value: thresholdMs,
        source: thresholdSource,
        formatted: `${(thresholdMs / 60000).toFixed(1)} min`,
      },
      // Cálculo
      thresholdSeconds,
      timeUntilTakeoff,
      // Comparación
      isDelayed: isDelayed,
      // Resultado
      triggerEvent: isDelayed ? "✅ REPRODUCIR" : "❌ OMITIR",
    });

    // Log específico por evento requerido por spec (compacto)
    console.log(`[RuleEngine] Evaluando ${eventKey}:`, {
      eventKey,
      thresholdMs: this.getEventThreshold(eventKey, ctx),
      currentTime: ct,
      scheduledTime: st,
      timeUntilTakeoff,
      isDelayed,
      triggered: state.triggered,
    });

    return isDelayed;
  }

  /**
   * Evalúa la precondición `phase_transition` (ancla `transition_to_taxi`).
   * Replica la lógica de FlightPhaseDetector para PRE_FLIGHT → TAXI con
   * alias snake/camel y de compatibilidad (numberOfEngines/numEngines,
   * engineCombustionN/engCombustionN/engineRunning).
   */
  private evaluatePhaseTransition(conditions: any, step?: NarrativeStep, context?: FlightContext): boolean {
    const detail = this.getPhaseTransitionDetail(conditions, context);
    console.log('[RuleEngine] Evaluando phase_transition:', {
      eventKey: step?.eventKey ?? 'transition_to_taxi',
      targetPhase: detail.targetPhase,
      conditions: detail.items.length > 0
        ? Object.fromEntries(detail.items.map((it) => [it.key, { ok: it.ok, value: it.value }]))
        : {
          simOnGround: detail.raw.simOnGround,
          groundspeed: detail.raw.groundspeed,
          parkingBrake: detail.raw.parkingBrake,
          atcOnParkingSpot: detail.raw.atcOnParkingSpot,
          allEnginesRunning: detail.allEnginesRunning,
        },
      result: detail.allConditionsMet,
    });
    return detail.allConditionsMet;
  }

  /**
   * Desglose público de la transición a TAXI para el DebugMonitor.
   * No dispara nada: solo calcula el estado actual de cada condición.
   */
  getPhaseTransitionDetail(conditions?: any, context?: FlightContext): {
    isOnGround: boolean;
    isMoving: boolean;
    isParkingBrakeOff: boolean;
    isNotAtParkingSpot: boolean;
    allEnginesRunning: boolean;
    allConditionsMet: boolean;
    groundspeedThreshold: number;
    targetPhase: string;
    /** Desglose dinámico según las conditions configuradas (vacío = receta clásica TAXI). */
    items: { key: string; label: string; ok: boolean; value: string }[];
    raw: {
      simOnGround: unknown;
      groundspeed: unknown;
      parkingBrake: unknown;
      atcOnParkingSpot: unknown;
      numEngines: unknown;
      engineCombustion: Record<number, unknown>;
      atcClearedTakeoff: unknown;
      onAnyRunway: unknown;
      altitude: unknown;
    };
  } {
    const conds: any = conditions ?? {};
    const ctx: any = context ?? this.flightContext;
    const tel: any = ctx?.getTelemetry?.() ?? {};
    const groundspeedThreshold =
      Number(conds.groundspeed_gt ?? conds.ground_velocity_gt ?? conds.groundspeedGt ?? 5) || 5;
    const targetPhase: string = String(conds.target_phase ?? conds.targetPhase ?? 'TAXI');

    const simOnGround = tel.simOnGround ?? tel.sim_on_ground;
    const groundspeed = tel.groundspeed ?? tel.ground_speed ?? tel['GROUND VELOCITY'] ?? 0;
    const parkingBrake = tel.parkingBrake ?? tel.parking_brake;
    const atcOnParkingSpot = tel.atcOnParkingSpot ?? tel.atc_on_parking_spot;
    const atcClearedTakeoff = tel.atcClearedTakeoff;
    const onAnyRunway = tel.onAnyRunway;
    const altitude = Number(tel.altitude ?? tel.plane_altitude ?? tel['PLANE ALTITUDE'] ?? 0) || 0;
    const numEnginesRaw = tel.numberOfEngines ?? tel.numEngines ?? tel.number_of_engines;

    const isOnGround = simOnGround === true;
    const isMoving = (Number(groundspeed) || 0) > groundspeedThreshold;
    const isParkingBrakeOff = parkingBrake === false;
    const isNotAtParkingSpot = atcOnParkingSpot === false;

    // TODOS los motores en combustión (misma semántica que FlightPhaseDetector:
    // numEngines === 0 → false; sin dato → solo motor 1 para no romper parciales).
    const isEngineOn = (index: number): boolean => {
      if (index === 1) {
        return (tel.engineCombustion1 ?? tel.engCombustion1 ?? tel.engineRunning) === true;
      }
      return (tel[`engineCombustion${index}`] ?? tel[`engCombustion${index}`]) === true;
    };
    let allEnginesRunning: boolean;
    if (numEnginesRaw === 0) {
      allEnginesRunning = false;
    } else if (typeof numEnginesRaw !== 'number' || !Number.isFinite(numEnginesRaw) || numEnginesRaw <= 0) {
      allEnginesRunning = isEngineOn(1);
    } else {
      allEnginesRunning = true;
      for (let i = 1; i <= numEnginesRaw; i++) {
        if (!isEngineOn(i)) {
          allEnginesRunning = false;
          break;
        }
      }
    }

    const engineCombustion: Record<number, unknown> = {};
    for (let i = 1; i <= 4; i++) {
      engineCombustion[i] =
        tel[`engineCombustion${i}`] ?? tel[`engCombustion${i}`] ?? (i === 1 ? tel.engineRunning : undefined);
    }

    // Desglose dinámico: solo las conditions presentes en la configuración.
    // Sin conditions → receta clásica TAXI (compatibilidad con anclas antiguas).
    const fmtGs = (v: unknown): string => {
      if (typeof v === 'number') return `${Number.isInteger(v) ? v : v.toFixed(2)} nudos`;
      return `${String(v ?? '—')} nudos`;
    };
    const items: { key: string; label: string; ok: boolean; value: string }[] = [];
    const has = (k: string): boolean => (conds as any)[k] !== undefined;
    if (has('sim_on_ground') || has('simOnGround')) {
      const expected = (conds.sim_on_ground ?? conds.simOnGround) !== false;
      items.push({ key: 'sim_on_ground', label: 'SIM ON GROUND', ok: (simOnGround === true) === expected, value: String(simOnGround ?? '—') });
    }
    if (has('groundspeed_gt') || has('ground_velocity_gt') || has('groundspeedGt')) {
      items.push({ key: 'groundspeed_gt', label: `GROUND SPEED > ${groundspeedThreshold}`, ok: isMoving, value: fmtGs(groundspeed) });
    }
    if (has('parking_brake') || has('parkingBrake') || has('parking_brake_off') || has('parkingBrakeOff')) {
      const expected = conds.parking_brake ?? conds.parkingBrake ?? !(conds.parking_brake_off ?? conds.parkingBrakeOff ?? true);
      const off = parkingBrake === false;
      items.push({ key: 'parking_brake', label: expected === false ? 'PARKING BRAKE OFF' : 'PARKING BRAKE ON', ok: off === (expected === false), value: parkingBrake === undefined ? '—' : parkingBrake ? 'puesto (true)' : 'liberado (false)' });
    }
    if (has('atc_on_parking_spot') || has('atcOnParkingSpot')) {
      const expected = conds.atc_on_parking_spot ?? conds.atcOnParkingSpot;
      items.push({ key: 'atc_on_parking_spot', label: expected === false ? 'NOT AT PARKING SPOT' : 'AT PARKING SPOT', ok: (atcOnParkingSpot === true) === (expected === true), value: String(atcOnParkingSpot ?? '—') });
    }
    if (has('all_engines_running') || has('allEnginesRunning')) {
      const expected = (conds.all_engines_running ?? conds.allEnginesRunning) !== false;
      items.push({ key: 'all_engines_running', label: 'ALL ENGINES RUNNING', ok: allEnginesRunning === expected, value: numEnginesRaw === undefined ? `motor1=${String((engineCombustion as any)?.[1] ?? '—')}` : `N=${String(numEnginesRaw)}` });
    }
    if (has('on_any_runway') || has('onAnyRunway')) {
      const expected = (conds.on_any_runway ?? conds.onAnyRunway) !== false;
      items.push({ key: 'on_any_runway', label: 'ON ANY RUNWAY', ok: (onAnyRunway === true) === expected, value: String(onAnyRunway ?? '—') });
    }
    if (has('atc_cleared_takeoff') || has('atcClearedTakeoff')) {
      const expected = (conds.atc_cleared_takeoff ?? conds.atcClearedTakeoff) !== false;
      items.push({ key: 'atc_cleared_takeoff', label: 'ATC CLEARED TAKEOFF', ok: (atcClearedTakeoff === true) === expected, value: String(atcClearedTakeoff ?? '—') });
    }
    if (has('altitude_gt') || has('altitudeGt')) {
      const threshold = Number(conds.altitude_gt ?? conds.altitudeGt) || 0;
      const alt = Number(altitude) || 0;
      items.push({ key: 'altitude_gt', label: `ALTITUDE > ${threshold} ft`, ok: alt > threshold, value: `${Number.isInteger(alt) ? alt : alt.toFixed(1)} ft` });
    }
    if (has('altitude_lt') || has('altitudeLt')) {
      const threshold = Number(conds.altitude_lt ?? conds.altitudeLt) || 0;
      const alt = Number(altitude) || 0;
      items.push({ key: 'altitude_lt', label: `ALTITUDE < ${threshold} ft`, ok: alt < threshold, value: `${Number.isInteger(alt) ? alt : alt.toFixed(1)} ft` });
    }

    const allConditionsMet =
      items.length > 0
        ? items.every((it) => it.ok)
        : isOnGround && isMoving && isParkingBrakeOff && isNotAtParkingSpot && allEnginesRunning;

    return {
      isOnGround,
      isMoving,
      isParkingBrakeOff,
      isNotAtParkingSpot,
      allEnginesRunning,
      allConditionsMet,
      groundspeedThreshold,
      targetPhase,
      items,
      raw: {
        simOnGround,
        groundspeed,
        parkingBrake,
        atcOnParkingSpot,
        numEngines: numEnginesRaw,
        engineCombustion,
        atcClearedTakeoff,
        onAnyRunway,
        altitude,
      },
    };
  }

  /**
   * Añade la fila de condición nocturna al desglose (solo informativa aquí;
   * la omisión real la aplica NarrativeOrchestrator). Sin efectos secundarios.
   */
  private withNightRow(
    step: NarrativeStep,
    context: FlightContext | undefined,
    result: { met: boolean | null; kind: string; rows: { label: string; ok: boolean; value: string }[]; summary: string }
  ): { met: boolean | null; kind: string; rows: { label: string; ok: boolean; value: string }[]; summary: string } {
    try {
      if ((step as any).restrictions?.preferred_condition === 'is_night_flight') {
        const night = this.isNightFlight(context ?? this.flightContext);
        result.rows.push({ label: 'VUELO NOCTURNO (solo noche)', ok: night === true, value: night ? 'noche' : 'día' });
        if (!night && result.met === true) {
          result.summary += ' · se omitirá (diurno)';
        }
      }
    } catch {}
    return result;
  }

  /**
   * Detalle de evaluación de un paso WAIT_CONDITION para el DebugMonitor.
   * Sin efectos secundarios (no escribe logs ni muta estado): solo calcula
   * el estado actual de cada precondición con la telemetría viva.
   */
  evaluateWaitConditionDetail(
    step: NarrativeStep,
    context?: FlightContext
  ): {
    met: boolean | null;
    kind: string;
    rows: { label: string; ok: boolean; value: string }[];
    summary: string;
  } {
    const pre: any = (step as any).preconditions;
    if (!pre) {
      // Fallback: si no hay preconditions pero sí scheduler_rule de telemetría,
      // evaluar la regla como alternativa (caso transition_to_taxi sin snapshot).
      const rule = (step as any).scheduler_rule as string | null | undefined;
      if (rule && this.isTelemetryExpression(rule)) {
        const d = this.getSchedulerRuleDetail(rule, context);
        return this.withNightRow(step, context, {
          met: d.met,
          kind: 'scheduler_rule',
          rows: d.rows,
          summary: d.met === true ? 'Condiciones cumplidas (scheduler_rule)' : 'Condiciones NO cumplidas (scheduler_rule)',
        });
      }
      return this.withNightRow(step, context, { met: true, kind: 'none', rows: [], summary: 'Sin precondiciones' });
    }
    const kind = String(pre.type ?? 'unknown');
    if (pre.type === 'phase_transition') {
      const d = this.getPhaseTransitionDetail(pre.conditions ?? pre, context);
      // Si la configuración trae conditions propias (p. ej. TAKEOFF con
      // on_any_runway), mostrar exactly esas; si no, receta clásica TAXI.
      const rows = d.items.length > 0
        ? d.items.map((it) => ({ label: it.label, ok: it.ok, value: it.value }))
        : [
          { label: 'SIM ON GROUND', ok: d.isOnGround, value: String(d.raw.simOnGround ?? '—') },
          { label: `GROUND SPEED > ${d.groundspeedThreshold}`, ok: d.isMoving, value: typeof d.raw.groundspeed === 'number' ? `${Number.isInteger(d.raw.groundspeed) ? d.raw.groundspeed : d.raw.groundspeed.toFixed(2)} nudos` : `${String(d.raw.groundspeed ?? '—')} nudos` },
          { label: 'PARKING BRAKE OFF', ok: d.isParkingBrakeOff, value: d.raw.parkingBrake === undefined ? '—' : d.raw.parkingBrake ? 'puesto (true)' : 'liberado (false)' },
          { label: 'NOT AT PARKING SPOT', ok: d.isNotAtParkingSpot, value: String(d.raw.atcOnParkingSpot ?? '—') },
          { label: 'ALL ENGINES RUNNING', ok: d.allEnginesRunning, value: d.raw.numEngines === undefined ? `motor1=${String((d.raw.engineCombustion as any)?.[1] ?? '—')}` : `N=${String(d.raw.numEngines)}` },
        ];
      return this.withNightRow(step, context, {
        met: d.allConditionsMet,
        kind: `${kind}:${d.targetPhase}`,
        rows,
        summary: d.allConditionsMet ? `Condiciones cumplidas (${d.targetPhase})` : `Condiciones NO cumplidas (${d.targetPhase})`,
      });
    }
    if (pre.type === 'delay_detection') {
      const c: any = pre.conditions ?? {};
      const ctx: any = context ?? this.flightContext;
      const tel: any = ctx?.getTelemetry?.() ?? {};
      const rows: { label: string; ok: boolean; value: string }[] = [];
      let met: boolean | null = null;
      try {
        const thresholdMs = this.resolveThresholdMs(step.eventKey, ctx);
        const ct = Number(tel.zuluTime ?? tel.zulu_time ?? NaN);
        const fl: any = ctx?.getFlight?.() ?? {};
        const stRaw = fl.scheduledTakeoffTime ?? fl.scheduled_takeoff_time;
        const st = Number(stRaw ?? NaN);
        const timeOk = !Number.isNaN(ct) && !Number.isNaN(st) ? st - ct <= thresholdMs / 1000 : null;
        rows.push({ label: 'UMBRAL DEMORA SUPERADO', ok: timeOk === true, value: timeOk === null ? 'sin datos de tiempo' : `${thresholdMs}ms` });
        met = timeOk;
      } catch {
        met = null;
      }
      if (c.fsm) rows.push({ label: `FSM = ${String(c.fsm)}`, ok: true, value: 'ver sección Demora' });
      return this.withNightRow(step, context, { met, kind, rows, summary: met === true ? 'Condiciones cumplidas' : met === false ? 'Condiciones NO cumplidas' : 'Sin datos suficientes' });
    }
    return this.withNightRow(step, context, { met: null, kind, rows: [], summary: `Tipo '${kind}' sin desglose` });
  }

  /**
   * Evalúa las precondiciones de un paso. Para delay_detection usa isDelayThresholdExceeded
   * y además verifica conditions.fsm, sim_on_ground, atc_on_parking_spot y ground_velocity_lt.
   * Para phase_transition delega en evaluatePhaseTransition (ancla transition_to_taxi).
   */
  private evaluatePreconditions(step: NarrativeStep, context: FlightContext): boolean {
    const preconditions: any = (step as any).preconditions;
    if (!preconditions) return true;

    if (preconditions.type === 'phase_transition') {
      const conditions = preconditions.conditions ?? preconditions;
      return this.evaluatePhaseTransition(conditions, step, context);
    }

    if (preconditions.type === "delay_detection") {
      const conditions = preconditions.conditions || {};
      const ctx: any = context ?? this.flightContext;
      const tel: any = ctx?.getTelemetry?.() ?? {};
      const fsmInfo: any = ctx?.getFSM?.() ?? {};
      const currentState: string | undefined =
        fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.() ?? undefined;
      const simOnGround = tel.simOnGround ?? tel.sim_on_ground;
      const atcOnParkingSpot = tel.atcOnParkingSpot ?? tel.atc_on_parking_spot;
      const groundspeed = tel.groundspeed ?? tel.ground_speed ?? tel["GROUND VELOCITY"] ?? 0;

      // Log específico para taxi delay (criterio de aceptación)
      if (step.eventKey === "preflight_capt_delay_taxi") {
        try {
          const fl: any = ctx?.getFlight?.() ?? {};
          console.log('[RuleEngine] Evaluando taxi delay:', {
            eventKey: 'preflight_capt_delay_taxi',
            phase: currentState,
            atcOnParkingSpot,
            groundspeed,
            currentTime: tel.zuluTime ?? tel.zulu_time,
            scheduledTime: fl.scheduledTakeoffTime ?? fl.scheduled_takeoff_time ?? fl.departureTime,
            thresholdMs: this.resolveThresholdMs('preflight_capt_delay_taxi', context ?? this.flightContext),
            overrideThresholdMs: (()=>{try{return ctx?.getDelayOverride?.('preflight_capt_delay_taxi') ?? null}catch{return null}})(),
          });
        } catch {}
      }

      // ── LOG de condiciones adicionales ──────────────────────────────────────
      console.log(`[RuleEngine] 📋 Condiciones para ${step.eventKey}:`, {
        fsm: currentState,
        flightPhase: this.currentFlightPhase(),
        expectedFsm: conditions.fsm,
        fsmMatch: conditions.fsm ? String(currentState) === String(conditions.fsm) || this.currentFlightPhase() === String(conditions.fsm) : true,
        simOnGround,
        expectedSimOnGround: conditions.sim_on_ground,
        atcOnParkingSpot,
        expectedAtcOnParkingSpot: conditions.atc_on_parking_spot ?? conditions.atcOnParkingSpot,
        groundspeed,
        expectedGroundVelocityLt: conditions.ground_velocity_lt ?? conditions.groundspeed_lt,
        conditionsRaw: conditions,
      });

      const tiempoCondicion = this.isDelayThresholdExceeded(step.eventKey, context);

      // Verificar condiciones adicionales (fsm, sim_on_ground, atc_on_parking_spot, ground_velocity_lt, etc.)
      let extraConditionsMet = true;

      if (conditions.fsm) {
        // `fsm` nombra la FASE de vuelo ("PRE_FLIGHT"); el FSM del contexto
        // guarda el FlightState de UI ("A".."D"), así que también se acepta
        // la fase del Scheduler (inyectada vía setPhaseProvider).
        const flightPhase = this.currentFlightPhase();
        const expected = String(conditions.fsm);
        const currentStateOk =
          String(currentState) === expected || (flightPhase !== null && flightPhase === expected);
        if (!currentStateOk) {
          console.log(`[RuleEngine] Precondición fsm no cumplida para ${step.eventKey}: esperado ${conditions.fsm}, actual fsm=${currentState} fase=${flightPhase ?? "—"}`);
          extraConditionsMet = false;
        }
      }
      if (conditions.sim_on_ground !== undefined) {
        const ok = simOnGround === conditions.sim_on_ground;
        if (!ok) {
          console.log(`[RuleEngine] Precondición sim_on_ground no cumplida para ${step.eventKey}: esperado ${conditions.sim_on_ground}, actual ${simOnGround}`);
          extraConditionsMet = false;
        }
      }
      if (conditions.atc_on_parking_spot !== undefined || conditions.atcOnParkingSpot !== undefined) {
        const expected = conditions.atc_on_parking_spot ?? conditions.atcOnParkingSpot;
        const ok = atcOnParkingSpot === expected;
        if (!ok) {
          console.log(`[RuleEngine] Precondición atc_on_parking_spot no cumplida para ${step.eventKey}: esperado ${expected}, actual ${atcOnParkingSpot}`);
          extraConditionsMet = false;
        }
      }
      if (conditions.ground_velocity_lt !== undefined) {
        const ok = groundspeed < conditions.ground_velocity_lt;
        if (!ok) {
          console.log(`[RuleEngine] Precondición ground_velocity_lt no cumplida para ${step.eventKey}: ${groundspeed} >= ${conditions.ground_velocity_lt}`);
          extraConditionsMet = false;
        }
      }
      // Alias snake/camel por compatibilidad
      if (conditions.groundspeed_lt !== undefined) {
        const ok = groundspeed < conditions.groundspeed_lt;
        if (!ok) {
          console.log(`[RuleEngine] Precondición groundspeed_lt no cumplida para ${step.eventKey}: ${groundspeed} >= ${conditions.groundspeed_lt}`);
          extraConditionsMet = false;
        }
      }

      // ── LOG resultado final ─────────────────────────────────────────────────
      const ejecutar = tiempoCondicion && extraConditionsMet;
      console.log(`[RuleEngine] 📋 Resultado para ${step.eventKey}:`, {
        tiempoCondicion,
        condicionesExtra: extraConditionsMet,
        ejecutar,
        decision: ejecutar ? "✅ EJECUTAR evento de demora" : "❌ NO ejecutar (condición no cumplida)",
      });

      return ejecutar;
    }

    // Otros tipos de precondiciones: por defecto pasar (extensible)
    return true;
  }

  /** Variables de telemetría disponibles en las expresiones de scheduler_rule. */
  private static readonly TELEMETRY_EXPR_TOKENS = [
    "SIM_ON_GROUND",
    "GROUND_VELOCITY",
    "GROUND_SPEED",
    "PARKING_BRAKE",
    "ATC_ON_PARKING_SPOT",
    "ALL_ENGINES_RUNNING",
    "ATC_CLEARED_TAKEOFF",
    "ON_ANY_RUNWAY",
    "PLANE_ALTITUDE",
    "ALTITUDE",
  ];

  private isTelemetryExpression(rule: string): boolean {
    const upper = rule.toUpperCase();
    return RuleEngine.TELEMETRY_EXPR_TOKENS.some((t) => upper.includes(t));
  }

  private getTelemetryExpressionContext(context?: FlightContext): {
    SIM_ON_GROUND: boolean;
    GROUND_VELOCITY: number;
    GROUND_SPEED: number;
    PARKING_BRAKE: number;
    ATC_ON_PARKING_SPOT: number;
    ALL_ENGINES_RUNNING: boolean;
    ATC_CLEARED_TAKEOFF: boolean;
    ON_ANY_RUNWAY: boolean;
    PLANE_ALTITUDE: number;
    ALTITUDE: number;
    _raw: { simOnGround: unknown; groundspeed: unknown; parkingBrake: unknown; atcOnParkingSpot: unknown; atcClearedTakeoff: unknown; onAnyRunway: unknown; altitude: unknown };
  } {
    const ctx: any = context ?? this.flightContext;
    const tel: any = ctx?.getTelemetry?.() ?? {};
    const simOnGround = tel.simOnGround ?? tel.sim_on_ground;
    const groundspeed = Number(tel.groundspeed ?? tel.ground_speed ?? tel["GROUND VELOCITY"] ?? 0) || 0;
    const parkingBrake = tel.parkingBrake ?? tel.parking_brake;
    const atcOnParkingSpot = tel.atcOnParkingSpot ?? tel.atc_on_parking_spot;
    const atcClearedTakeoff = tel.atcClearedTakeoff;
    const onAnyRunway = tel.onAnyRunway;
    const altitude = Number(tel.altitude ?? tel.plane_altitude ?? tel['PLANE ALTITUDE'] ?? 0) || 0;
    let allEnginesRunning = false;
    try {
      allEnginesRunning = this.getPhaseTransitionDetail(undefined, ctx as FlightContext).allEnginesRunning;
    } catch {
      allEnginesRunning = false;
    }
    return {
      SIM_ON_GROUND: simOnGround === true,
      GROUND_VELOCITY: groundspeed,
      GROUND_SPEED: groundspeed,
      PARKING_BRAKE: parkingBrake ? 1 : 0,
      ATC_ON_PARKING_SPOT: atcOnParkingSpot ? 1 : 0,
      ALL_ENGINES_RUNNING: allEnginesRunning === true,
      ATC_CLEARED_TAKEOFF: atcClearedTakeoff === true,
      ON_ANY_RUNWAY: onAnyRunway === true,
      PLANE_ALTITUDE: altitude,
      ALTITUDE: altitude,
      _raw: { simOnGround, groundspeed: tel.groundspeed ?? tel.ground_speed, parkingBrake, atcOnParkingSpot, atcClearedTakeoff, onAnyRunway, altitude: tel.altitude },
    };
  }

  /**
   * Evalúa expresiones booleanas de telemetría (ej. "SIM_ON_GROUND AND
   * GROUND_VELOCITY > 5 AND PARKING_BRAKE == 0 ..."). Soporta AND/OR/NOT,
   * paréntesis y comparaciones ==, !=, >, <, >=, <=. Sin eval(): parser propio.
   */
  private evaluateTelemetryExpression(rule: string, context?: FlightContext): boolean {
    const ctx = this.getTelemetryExpressionContext(context);
    const tokens = this.tokenizeTelemetryExpression(rule);
    if (tokens.length === 0) return false;
    try {
      const parser = new TelemetryExprParser(tokens, ctx as unknown as Record<string, boolean | number>);
      const result = parser.parse();
      console.log("[RuleEngine] Evaluando scheduler_rule:", {
        rule,
        context: {
          SIM_ON_GROUND: ctx.SIM_ON_GROUND,
          GROUND_VELOCITY: ctx.GROUND_VELOCITY,
          PARKING_BRAKE: ctx.PARKING_BRAKE,
          ATC_ON_PARKING_SPOT: ctx.ATC_ON_PARKING_SPOT,
          ALL_ENGINES_RUNNING: ctx.ALL_ENGINES_RUNNING,
          ATC_CLEARED_TAKEOFF: ctx.ATC_CLEARED_TAKEOFF,
          ON_ANY_RUNWAY: ctx.ON_ANY_RUNWAY,
          PLANE_ALTITUDE: ctx.PLANE_ALTITUDE,
        },
        result,
      });
      return result;
    } catch (err) {
      console.warn("[RuleEngine] scheduler_rule no evaluable:", { rule, error: String(err) });
      return false;
    }
  }

  /**
   * Desglose por condición de una scheduler_rule de telemetría para el monitor.
   * Dinámico: refleja los átomos reales de la regla configurada (no un set
   * fijo). Sin efectos secundarios.
   */
  getSchedulerRuleDetail(
    rule: string,
    context?: FlightContext
  ): {
    isExpression: boolean;
    met: boolean | null;
    rows: { label: string; ok: boolean; value: string }[];
  } {
    if (!this.isTelemetryExpression(rule)) return { isExpression: false, met: null, rows: [] };
    const ctx = this.getTelemetryExpressionContext(context);
    const vars = ctx as unknown as Record<string, boolean | number>;
    let met: boolean | null = null;
    try {
      met = new TelemetryExprParser(this.tokenizeTelemetryExpression(rule), vars).parse();
    } catch {
      met = false;
    }
    return { isExpression: true, met, rows: this.describeTelemetryExpression(rule, vars) };
  }

  /**
   * Divide la regla en átomos de nivel superior (AND/OR, respetando
   * paréntesis) y evalúa cada uno con la telemetría viva. Lo que ves en el
   * monitor es exactamente lo configurado en el scenario designer.
   */
  private describeTelemetryExpression(
    rule: string,
    vars: Record<string, boolean | number>
  ): { label: string; ok: boolean; value: string }[] {
    const tokens = this.tokenizeTelemetryExpression(rule);
    const parts: { text: string; tokens: string[]; op: string | null }[] = [];
    let depth = 0;
    let cur: string[] = [];
    let curOp: string | null = null;
    const push = () => {
      if (cur.length > 0) {
        parts.push({ text: cur.join(" "), tokens: cur, op: curOp });
        cur = [];
      }
    };
    for (const t of tokens) {
      if (t === "(") {
        depth++;
        cur.push(t);
        continue;
      }
      if (t === ")") {
        depth--;
        cur.push(t);
        continue;
      }
      const u = t.toUpperCase();
      if (depth === 0 && (u === "AND" || u === "OR")) {
        push();
        curOp = u;
        continue;
      }
      cur.push(t);
    }
    push();
    return parts.map((p) => {
      let ok = false;
      try {
        ok = new TelemetryExprParser([...p.tokens], vars).parse() === true;
      } catch {
        ok = false;
      }
      return { label: `${p.op ? p.op + " " : ""}${p.text}`, ok, value: this.atomLiveValue(p.tokens, vars) };
    });
  }

  /** Valor vivo de la primera variable del átomo (para mostrar junto al resultado). */
  private atomLiveValue(tokens: string[], vars: Record<string, boolean | number>): string {
    for (const t of tokens) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) continue;
      const u = t.toUpperCase();
      if (u === "AND" || u === "OR" || u === "NOT" || u === "TRUE" || u === "FALSE") continue;
      const v = vars[u] ?? (vars as any)[t];
      if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
      if (typeof v === "boolean") return String(v);
      return String(v ?? "—");
    }
    return "—";
  }

  private tokenizeTelemetryExpression(rule: string): string[] {
    const out: string[] = [];
    const re = /\s*(==|!=|>=|<=|>|<|\(|\)|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rule)) !== null) out.push(m[1]);
    return out;
  }

  private evaluateSchedulerRule(rule: string, context: FlightContext, eventKey?: string): boolean {
    const normalized = rule.trim();

    // Expresiones de telemetría (scheduler_rule del Backoffice) antes que fechas/cron.
    if (this.isTelemetryExpression(normalized)) {
      const result = this.evaluateTelemetryExpression(normalized, context);
      let exprCtx: Record<string, unknown> = {};
      try {
        const c = this.getTelemetryExpressionContext(context);
        exprCtx = {
          SIM_ON_GROUND: c.SIM_ON_GROUND,
          GROUND_VELOCITY: c.GROUND_VELOCITY,
          PARKING_BRAKE: c.PARKING_BRAKE,
          ATC_ON_PARKING_SPOT: c.ATC_ON_PARKING_SPOT,
          ALL_ENGINES_RUNNING: c.ALL_ENGINES_RUNNING,
          ATC_CLEARED_TAKEOFF: c.ATC_CLEARED_TAKEOFF,
          ON_ANY_RUNWAY: c.ON_ANY_RUNWAY,
          PLANE_ALTITUDE: c.PLANE_ALTITUDE,
        };
      } catch {}
      console.log("[RuleEngine] 🔍 Evaluando scheduler_rule para:", {
        eventKey: eventKey ?? "(sin eventKey)",
        rule: normalized,
        context: exprCtx,
        result,
        decision: result ? "✅ CONDICIÓN CUMPLIDA" : "❌ BLOQUEADO (condición no cumplida)",
      });
      return result;
    }

    // Fecha/hora ISO o timestamp: dispara cuando now >= scheduled time.
    const asDate = Date.parse(normalized);
    if (!Number.isNaN(asDate)) {
      return Date.now() >= asDate;
    }

    // Hora de reloj "HH:MM": dispara cuando ya pasó la hora local.
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(normalized);
    if (timeMatch) {
      const now = new Date();
      const target = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
        0,
        0
      );
      return now.getTime() >= target.getTime();
    }

    // Cron-like: "minuto hora día-mes mes día-semana"
    const cronMatch = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(normalized);
    if (cronMatch) {
      const now = new Date();
      const [, minute, hour, dom, month, dow] = cronMatch;
      return (
        fieldMatches(minute, now.getMinutes()) &&
        fieldMatches(hour, now.getHours()) &&
        fieldMatches(dom, now.getDate()) &&
        fieldMatches(month, now.getMonth() + 1) &&
        fieldMatches(dow, now.getDay())
      );
    }

    console.log(`[RuleEngine] Regla de programación no reconocida: "${rule}"`);
    return false;
  }
}

function evaluatorName(triggerType: string): string {
  try {
    return TriggerEvaluatorFactory.get(triggerType).constructor.name;
  } catch {
    return triggerType;
  }
}

/** Parser recursivo para expresiones de scheduler_rule (AND/OR/NOT, comparaciones, paréntesis). */
class TelemetryExprParser {
  private pos = 0;

  constructor(
    private readonly tokens: string[],
    private readonly vars: Record<string, boolean | number>
  ) {}

  parse(): boolean {
    const result = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Token inesperado: ${this.tokens[this.pos]}`);
    }
    return result;
  }

  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peekUpper() === "OR") {
      this.pos++;
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.peekUpper() === "AND") {
      this.pos++;
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  private parseNot(): boolean {
    if (this.peekUpper() === "NOT") {
      this.pos++;
      return !this.parseNot();
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.parsePrimary();
    const op = this.peek();
    if (op === "==" || op === "!=" || op === ">" || op === "<" || op === ">=" || op === "<=") {
      this.pos++;
      const right = this.parsePrimary();
      const l = this.toNumber(left);
      const r = this.toNumber(right);
      switch (op) {
        case "==": return l === r;
        case "!=": return l !== r;
        case ">": return l > r;
        case "<": return l < r;
        case ">=": return l >= r;
        case "<=": return l <= r;
      }
    }
    return this.toBoolean(left);
  }

  private parsePrimary(): boolean | number {
    const tok = this.tokens[this.pos++];
    if (tok === undefined) throw new Error("Expresión incompleta");
    if (tok === "(") {
      const inner = this.parseOr();
      if (this.tokens[this.pos++] !== ")") throw new Error("Falta ')'");
      return inner;
    }
    const upper = tok.toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
    if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
      const v = this.vars[tok.toUpperCase()] ?? this.vars[tok];
      if (v === undefined) throw new Error(`Variable desconocida: ${tok}`);
      return v;
    }
    throw new Error(`Token no válido: ${tok}`);
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private peekUpper(): string | undefined {
    return this.tokens[this.pos]?.toUpperCase();
  }

  private toNumber(v: boolean | number): number {
    return typeof v === "boolean" ? (v ? 1 : 0) : v;
  }

  private toBoolean(v: boolean | number): boolean {
    return typeof v === "boolean" ? v : v !== 0;
  }
}

function fieldMatches(expr: string, value: number): boolean {
  if (expr === "*") return true;
  if (expr.includes("/")) {
    const [base, step] = expr.split("/");
    const start = base === "*" ? 0 : Number(base);
    return (value - start) % Number(step) === 0;
  }
  if (expr.includes("-")) {
    const [a, b] = expr.split("-").map(Number);
    return value >= a && value <= b;
  }
  if (expr.includes(",")) {
    return expr.split(",").map(Number).includes(value);
  }
  return Number(expr) === value;
}
