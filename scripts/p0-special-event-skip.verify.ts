/**
 * Verificación P0 — captain_special_event opcional en CRUISE.
 *
 * Casos:
 *  1. specialEventEnabled=false → skip automático, sin bloqueo.
 *  2. specialEventEnabled=true + texto → ejecución normal.
 *  3. Guard genérico WAIT: con progreso insuficiente hace polling (no dispatch,
 *     no skip); al cumplirse, dispatchea.
 *  4. Regresión delay_detection y phase_transition: comportamiento intacto.
 *  5. Error de audio en WAIT opcional genérico → skip + avance (P0-3).
 *  6. Secuencia CRUISE completa sin bloqueo (service_info + general_info).
 *
 * Uso: npx tsx scripts/p0-special-event-skip.verify.ts
 */
import { NarrativeEngine } from "../src/narrative/NarrativeEngine";
import { NarrativeOrchestrator } from "../src/narrative/NarrativeOrchestrator";
import { NarrativeStep } from "../src/scenarios/narrative/NarrativeStep";
import { NarrativeTransition } from "../src/scenarios/narrative/NarrativeTransition";
import { FlightContext } from "../src/services/FlightContext";
import { EventCatalogService } from "../src/events/EventCatalogService";
import { RuleEngine } from "../src/services/RuleEngine";
import { FlightPhaseDetector } from "../src/services/FlightPhaseDetector";
import { FlightPhase } from "../src/engine/FlightEngine";

// ── Fakes ────────────────────────────────────────────────────────────

class FakeQueue {
  private handlers = new Map<string, Array<(...a: any[]) => void>>();
  on(event: string, cb: (...a: any[]) => void): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(cb);
    return () => {};
  }
  fire(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

class FakeTimers {
  pending: Array<{ id: string; delayMs: number; event: string; onFire?: (id: string) => void }> = [];
  schedule(a: { id: string; delayMs: number; event: string; onFire?: (id: string) => void }): void {
    if (this.pending.some((t) => t.id === a.id)) return;
    this.pending.push(a);
  }
  cancel(id: string): void {
    this.pending = this.pending.filter((t) => t.id !== id);
  }
  cancelAll(): void {
    this.pending = [];
  }
  getPendingTimers(): Array<{ id: string; event: string; remainingMs: number }> {
    return this.pending.map((t) => ({ id: t.id, event: t.event, remainingMs: t.delayMs }));
  }
  fire(id: string): boolean {
    const t = this.pending.find((x) => x.id === id);
    if (!t) return false;
    this.pending = this.pending.filter((x) => x !== t);
    t.onFire?.(id);
    return true;
  }
}

class FakeDispatcher {
  calls: string[] = [];
  async dispatch(event: { eventKey: string }): Promise<void> {
    this.calls.push(event.eventKey);
  }
}

/** RuleEngine mínimo: progreso cruise controlable + delay/phase en falso. */
class FakeRules {
  progress = 1;
  delayResult = false;
  phaseResult = false;
  evaluateStep(step: any): boolean {
    const pre = step?.preconditions;
    if (pre?.type === "cruise_progress") {
      return this.progress >= Number(pre?.conditions?.min_progress ?? 0);
    }
    if (pre?.type === "delay_detection") return this.delayResult;
    if (pre?.type === "phase_transition") return this.phaseResult;
    return true;
  }
  isWidebodyAircraft(): boolean {
    return true;
  }
  getFlightDurationMinutes(): number {
    return 999;
  }
  isInternationalFlight(): boolean {
    return true;
  }
}

// ── Builders ─────────────────────────────────────────────────────────

function cruiseStep(
  id: number,
  eventKey: string,
  transition: NarrativeTransition,
  optional: boolean,
  blocking: boolean,
  minProgress: number
): NarrativeStep {
  return new NarrativeStep(
    id,
    eventKey,
    transition,
    blocking,
    optional,
    0,
    undefined,
    undefined,
    { type: "cruise_progress", conditions: { allow_night: true, min_progress: minProgress } },
    { max_once_per_flight: true },
    ["scheduler"],
    "polling",
    "scheduler",
    null
  );
}

/** Escenario CRUISE reducido (órdenes 1-4 del publicado v44, fiel:
 * orden 1 = IMMEDIATE como en el snapshot).
 */
function cruiseDefinition(): any {
  return {
    scenario: "CRUISE",
    steps: [
      new NarrativeStep(
        1, "climb_crew_upcoming_service", NarrativeTransition.IMMEDIATE,
        false, false, 0, undefined, undefined, undefined,
        { max_once_per_flight: true }, ["scheduler"], "polling", "scheduler", null
      ),
      cruiseStep(2, "captain_special_event", NarrativeTransition.WAIT_CONDITION, true, false, 0.05),
      cruiseStep(3, "cruise_crew_service_info", NarrativeTransition.WAIT_CONDITION, false, false, 0.15),
      cruiseStep(4, "cruise_capt_general_info", NarrativeTransition.WAIT_CONDITION, false, true, 0.4),
    ],
  };
}

interface Harness {
  orch: NarrativeOrchestrator;
  engine: NarrativeEngine;
  queue: FakeQueue;
  timers: FakeTimers;
  dispatcher: FakeDispatcher;
  rules: FakeRules;
  skipped: string[];
}

function makeHarness(opts: { specialEnabled: boolean; specialText: string; progress: number }): Harness {
  const flightContext = new FlightContext({
    flight: { specialEventEnabled: opts.specialEnabled, specialEvent: opts.specialText } as any,
  });
  const engine = new NarrativeEngine(cruiseDefinition());
  const queue = new FakeQueue();
  const timers = new FakeTimers();
  const dispatcher = new FakeDispatcher();
  const rules = new FakeRules();
  rules.progress = opts.progress;
  const orch = new NarrativeOrchestrator(
    engine,
    EventCatalogService,
    dispatcher as any,
    flightContext,
    queue as any,
    timers as any,
    rules as any
  );
  const skipped: string[] = [];
  orch.on("step:skipped", (p: any) => skipped.push(p.step.eventKey));
  return { orch, engine, queue, timers, dispatcher, rules, skipped };
}

// ── Asserts ──────────────────────────────────────────────────────────

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Caso 1: no configurado → skip automático, secuencia completa ──────

{
  const h = makeHarness({ specialEnabled: false, specialText: "", progress: 1 });
  h.orch.executeCurrentStep("verify:t1");
  check("T1 climb dispatcheado al entrar", h.dispatcher.calls.join() === "climb_crew_upcoming_service", h.dispatcher.calls.join());
  h.queue.fire("completed", "climb_crew_upcoming_service");
  check("T1 special omitido (skip)", h.skipped.join() === "captain_special_event", h.skipped.join());
  check(
    "T1 service_info dispatcheado tras el skip",
    h.dispatcher.calls.join() === "climb_crew_upcoming_service,cruise_crew_service_info",
    h.dispatcher.calls.join()
  );
  check("T1 narrativa en service_info", h.engine.currentStep()?.eventKey === "cruise_crew_service_info");
  h.queue.fire("completed", "cruise_crew_service_info");
  check(
    "T1 general_info dispatcheado sin bloqueo",
    h.dispatcher.calls.includes("cruise_capt_general_info"),
    h.dispatcher.calls.join()
  );
  h.queue.fire("completed", "cruise_capt_general_info");
  check("T1 escenario completado", h.engine.isCompleted());
}

// ── Caso 2: configurado → ejecución normal de los 4 ───────────────────

{
  const h = makeHarness({ specialEnabled: true, specialText: "Boda a bordo", progress: 1 });
  h.orch.executeCurrentStep("verify:t2");
  h.queue.fire("completed", "climb_crew_upcoming_service");
  check(
    "T2 special dispatcheado (configurado)",
    h.dispatcher.calls.join() === "climb_crew_upcoming_service,captain_special_event",
    h.dispatcher.calls.join()
  );
  check("T2 sin skips", h.skipped.length === 0, h.skipped.join());
  h.queue.fire("completed", "captain_special_event");
  h.queue.fire("completed", "cruise_crew_service_info");
  h.queue.fire("completed", "cruise_capt_general_info");
  check(
    "T2 secuencia completa en orden",
    h.dispatcher.calls.join() ===
      "climb_crew_upcoming_service,captain_special_event,cruise_crew_service_info,cruise_capt_general_info",
    h.dispatcher.calls.join()
  );
  check("T2 escenario completado", h.engine.isCompleted());
}

// ── Caso 3: progreso insuficiente → polling; al cumplirse → dispatch ──

{
  const h = makeHarness({ specialEnabled: true, specialText: "Boda a bordo", progress: 0 });
  h.orch.executeCurrentStep("verify:t3");
  h.queue.fire("completed", "climb_crew_upcoming_service");
  check("T3 sin dispatch con progreso 0", h.dispatcher.calls.join() === "climb_crew_upcoming_service", h.dispatcher.calls.join());
  check("T3 sigue en special", h.engine.currentStep()?.eventKey === "captain_special_event");
  check(
    "T3 poll programado",
    h.timers.getPendingTimers().some((t) => t.id === "wait:captain_special_event"),
    JSON.stringify(h.timers.getPendingTimers())
  );
  h.rules.progress = 1;
  check("T3 re-evaluación del poll", h.timers.fire("wait:captain_special_event"));
  check(
    "T3 special dispatcheado tras cumplirse",
    h.dispatcher.calls.includes("captain_special_event"),
    h.dispatcher.calls.join()
  );
}

// ── Caso 4: regresión delay_detection / phase_transition ──────────────

{
  // Delay opcional sin condición → polling, sin dispatch ni skip.
  const flightContext = new FlightContext({ flight: {} as any });
  const delayStep = new NarrativeStep(
    1, "preflight_capt_delay_parked", NarrativeTransition.WAIT_CONDITION,
    false, true, 0, undefined, undefined,
    { type: "delay_detection", conditions: {} },
    { max_once_per_flight: true }, ["scheduler"], "polling", "scheduler", null
  );
  const engine = new NarrativeEngine({ scenario: "BOARDING", steps: [delayStep] } as any);
  const queue = new FakeQueue();
  const timers = new FakeTimers();
  const dispatcher = new FakeDispatcher();
  const rules = new FakeRules();
  const orch = new NarrativeOrchestrator(engine, EventCatalogService, dispatcher as any, flightContext, queue as any, timers as any, rules as any);
  const skipped: string[] = [];
  orch.on("step:skipped", (p: any) => skipped.push(p.step.eventKey));
  orch.executeCurrentStep("verify:t4-delay");
  check("T4 delay sin dispatch (condición falsa)", dispatcher.calls.length === 0, dispatcher.calls.join());
  check("T4 delay sin skip", skipped.length === 0, skipped.join());
  check("T4 delay en polling", timers.getPendingTimers().some((t) => t.id === "wait:preflight_capt_delay_parked"));
  check("T4 delay sigue actual", engine.currentStep()?.eventKey === "preflight_capt_delay_parked");
}

{
  // Phase transition (ancla con preconditions) sin cumplir → polling.
  const flightContext = new FlightContext({ flight: {} as any });
  const anchor = new NarrativeStep(
    1, "transition_to_taxi", NarrativeTransition.WAIT_CONDITION,
    true, false, 0, undefined, undefined,
    { type: "phase_transition", conditions: {} },
    undefined, ["scheduler"], "polling", "scheduler", "SIM_ON_GROUND"
  );
  const engine = new NarrativeEngine({ scenario: "TAXI", steps: [anchor] } as any);
  const queue = new FakeQueue();
  const timers = new FakeTimers();
  const dispatcher = new FakeDispatcher();
  const rules = new FakeRules();
  const orch = new NarrativeOrchestrator(engine, EventCatalogService, dispatcher as any, flightContext, queue as any, timers as any, rules as any);
  orch.executeCurrentStep("verify:t4-phase");
  check("T4 phase sin dispatch (condición falsa)", dispatcher.calls.length === 0, dispatcher.calls.join());
  check("T4 phase en polling", timers.getPendingTimers().some((t) => t.id === "wait:transition_to_taxi"));
  check("T4 phase sigue actual", engine.currentStep()?.eventKey === "transition_to_taxi");
}

// ── Caso 5: error de audio en WAIT opcional genérico → skip + avance ──

{
  const h = makeHarness({ specialEnabled: true, specialText: "Boda a bordo", progress: 1 });
  h.orch.executeCurrentStep("verify:t5");
  h.queue.fire("completed", "climb_crew_upcoming_service");
  check("T5 special en vuelo", h.dispatcher.calls.includes("captain_special_event"));
  h.queue.fire("error", "audio-get boom");
  check("T5 special omitido tras error", h.skipped.join() === "captain_special_event", h.skipped.join());
  check(
    "T5 service_info dispatcheado tras error",
    h.dispatcher.calls.includes("cruise_crew_service_info"),
    h.dispatcher.calls.join()
  );
  check("T5 narrativa en service_info", h.engine.currentStep()?.eventKey === "cruise_crew_service_info");
}

// ── Caso 6 (P1): IMMEDIATE avanza al completar en modo normal ────────

{
  const h = makeHarness({ specialEnabled: false, specialText: "", progress: 1 });
  h.orch.executeCurrentStep("verify:t6");
  check("T6 climb IMMEDIATE dispatcheado", h.dispatcher.calls.join() === "climb_crew_upcoming_service", h.dispatcher.calls.join());
  h.queue.fire("completed", "climb_crew_upcoming_service");
  check("T6 IMMEDIATE avanza al completar", h.engine.currentStep()?.eventKey === "cruise_crew_service_info", h.engine.currentStep()?.eventKey ?? "null");
  check("T6 special omitido tras el avance", h.skipped.join() === "captain_special_event", h.skipped.join());
  check(
    "T6 getNextStep coherente",
    h.engine.getNextStep()?.eventKey === "cruise_capt_general_info",
    h.engine.getNextStep()?.eventKey ?? "null"
  );
}

// ── Casos T7 (motor REAL): fallback sin scheduler_rule ─────────────────
// Datos espejo de la sesión MSFS real: crucero de 650 s, entrada 57899.
const REAL_CRUISE = { total: 650, entry: 57899 };

function realContext(opts: { zulu: number; local: number; specialEnabled?: boolean; specialText?: string }): { fc: FlightContext; rules: RuleEngine } {
  const fc = new FlightContext({
    flight: {
      cruiseTimeSeconds: REAL_CRUISE.total,
      cruiseEntryTime: REAL_CRUISE.entry,
      specialEventEnabled: opts.specialEnabled ?? false,
      specialEvent: opts.specialText ?? "",
    } as any,
    telemetry: { zuluTime: opts.zulu, localTime: opts.local } as any,
  });
  const rules = new RuleEngine(fc);
  rules.setPhaseProvider(() => "CRUISE");
  return { fc, rules };
}

function cruiseWaitStep(id: number, eventKey: string, optional: boolean, minProgress: number, restrictions?: any): NarrativeStep {
  return new NarrativeStep(
    id, eventKey, NarrativeTransition.WAIT_CONDITION, false, optional, 0,
    undefined, undefined,
    { type: "cruise_progress", conditions: { allow_night: true, min_progress: minProgress } },
    restrictions ?? { max_once_per_flight: true },
    ["scheduler"], "polling", "scheduler", null
  );
}

// Progreso 0.5 exacto: 57899 + 325 = 58224.
const ZULU_HALF = REAL_CRUISE.entry + REAL_CRUISE.total * 0.5;
const NOON = 12 * 3600;
const NIGHT = 23 * 3600 + 1800;

{
  // T7a: phase_enter en catálogo (cruise_crew_service_info) sin regla → TRUE si progreso cumple.
  const { fc, rules } = realContext({ zulu: ZULU_HALF, local: NOON });
  const step = cruiseWaitStep(3, "cruise_crew_service_info", false, 0.15);
  check("T7a phase_enter sin regla + progreso 0.5 → TRUE", rules.evaluateStep(step, fc) === true);
}

{
  // T7b: condition en catálogo (captain_special_event) sin regla → TRUE si progreso cumple.
  const { fc, rules } = realContext({ zulu: ZULU_HALF, local: NOON });
  const step = cruiseWaitStep(2, "captain_special_event", true, 0.05);
  check("T7b condition sin regla + progreso 0.5 → TRUE", rules.evaluateStep(step, fc) === true);
}

{
  // T7c: sin preconditions ni regla → fallback trigger (stub false) se mantiene.
  const { fc, rules } = realContext({ zulu: ZULU_HALF, local: NOON });
  const step = new NarrativeStep(
    3, "cruise_crew_service_info", NarrativeTransition.WAIT_CONDITION,
    false, false, 0, undefined, undefined, undefined,
    { max_once_per_flight: true }, ["scheduler"], "polling", "scheduler", null
  );
  check("T7c sin preconditions ni regla → FALSE (stub preservado)", rules.evaluateStep(step, fc) === false);
}

{
  // T7d: exclude_if_night — de día ejecuta, de noche no.
  const day = realContext({ zulu: ZULU_HALF, local: NOON });
  const night = realContext({ zulu: ZULU_HALF, local: NIGHT });
  const mk = () => cruiseWaitStep(4, "cruise_capt_general_info", false, 0.4, { exclude_if_night: true, max_once_per_flight: true });
  check("T7d día + progreso 0.5 → TRUE", day.rules.evaluateStep(mk(), day.fc) === true);
  check("T7d noche + progreso 0.5 → FALSE", night.rules.evaluateStep(mk(), night.fc) === false);
  check("T7d noche marcada como restringida", night.rules.isRestrictedOut(mk(), night.fc) === true);
  check("T7d día no restringido", day.rules.isRestrictedOut(mk(), day.fc) === false);
}

// ── Caso T8 (e2e motor REAL, día): secuencia completa ─────────────────

function makeRealHarness(opts: { zulu: number; local: number; generalOptional: boolean }): Omit<Harness, "rules"> & { rules: RuleEngine } {
  const flightContext = new FlightContext({
    flight: {
      cruiseTimeSeconds: REAL_CRUISE.total,
      cruiseEntryTime: REAL_CRUISE.entry,
      specialEventEnabled: false,
      specialEvent: "",
    } as any,
    telemetry: { zuluTime: opts.zulu, localTime: opts.local } as any,
  });
  const steps = [
    new NarrativeStep(
      1, "climb_crew_upcoming_service", NarrativeTransition.IMMEDIATE,
      false, false, 0, undefined, undefined, undefined,
      { max_once_per_flight: true }, ["scheduler"], "polling", "scheduler", null
    ),
    cruiseWaitStep(2, "captain_special_event", true, 0.05),
    cruiseWaitStep(3, "cruise_crew_service_info", false, 0.15),
    cruiseWaitStep(
      4, "cruise_capt_general_info", false, 0.4,
      opts.generalOptional
        ? { exclude_if_night: true, max_once_per_flight: true, optional: true }
        : { exclude_if_night: true, max_once_per_flight: true }
    ),
  ];
  // generalOptional modela el fix de escenario (paso 4 opcional).
  if (opts.generalOptional) (steps[3] as any).optional = true;
  const engine = new NarrativeEngine({ scenario: "CRUISE", steps } as any);
  const queue = new FakeQueue();
  const timers = new FakeTimers();
  const dispatcher = new FakeDispatcher();
  const rules = new RuleEngine(flightContext);
  rules.setPhaseProvider(() => "CRUISE");
  const orch = new NarrativeOrchestrator(
    engine, EventCatalogService, dispatcher as any, flightContext,
    queue as any, timers as any, rules as any
  );
  const skipped: string[] = [];
  orch.on("step:skipped", (p: any) => skipped.push(p.step.eventKey));
  return { orch, engine, queue, timers, dispatcher, rules, skipped };
}

{
  const h = makeRealHarness({ zulu: ZULU_HALF, local: NOON, generalOptional: false });
  h.orch.executeCurrentStep("verify:t8");
  h.queue.fire("completed", "climb_crew_upcoming_service");
  h.queue.fire("completed", "cruise_crew_service_info");
  h.queue.fire("completed", "cruise_capt_general_info");
  check(
    "T8 e2e día motor real: orden completo",
    h.dispatcher.calls.join() === "climb_crew_upcoming_service,cruise_crew_service_info,cruise_capt_general_info",
    h.dispatcher.calls.join()
  );
  check("T8 special omitido", h.skipped.join() === "captain_special_event", h.skipped.join());
  check("T8 escenario completado", h.engine.isCompleted());
}

// ── Caso T9 (e2e motor REAL, noche, escenario fixeado): sin bloqueo ───

{
  const h = makeRealHarness({ zulu: ZULU_HALF, local: NIGHT, generalOptional: true });
  h.orch.executeCurrentStep("verify:t9");
  h.queue.fire("completed", "climb_crew_upcoming_service");
  // service_info (sin restricción nocturna) debe ejecutarse de noche.
  check("T9 service_info ejecuta de noche", h.dispatcher.calls.includes("cruise_crew_service_info"), h.dispatcher.calls.join());
  h.queue.fire("completed", "cruise_crew_service_info");
  // general_info (diurno, opcional tras fix) debe omitirse, no bloquear.
  check("T9 general_info omitido de noche", h.skipped.includes("cruise_capt_general_info"), `skipped=[${h.skipped.join()}] calls=[${h.dispatcher.calls.join()}]`);
  check("T9 sin poll pendiente bloqueante", !h.timers.getPendingTimers().some((t) => t.id === "wait:cruise_capt_general_info"));
  check("T9 escenario completado", h.engine.isCompleted());
}

// ── Casos T10-T13 (descenso: parser, regla, detector, localTime) ──────
// Regla publicada de transition_to_descent (v44).
const DESCENT_RULE = "(PLANE_ALTITUDE - FLIGHT_LEVEL) <= -1000 AND CRUISE_PROGRESS >= 0.95 AND VERTICAL_SPEED < -500";
// Progreso 0.96: 57899 + 624 = 58523.
const ZULU_LATE = REAL_CRUISE.entry + REAL_CRUISE.total * 0.96;

function descentContext(opts: { altitude: number; flightLevel: number; vs: number; zulu: number; local?: number; phase?: string; durationMin?: number; schedTakeoff?: number; radioHeight?: number }): { fc: FlightContext; rules: RuleEngine } {
  const tel: any = { altitude: opts.altitude, verticalSpeed: opts.vs, zuluTime: opts.zulu, groundspeed: 280 };
  if (opts.local !== undefined) tel.localTime = opts.local;
  if (opts.radioHeight !== undefined) tel.radioHeight = opts.radioHeight;
  const fl: any = { cruiseTimeSeconds: REAL_CRUISE.total, cruiseEntryTime: REAL_CRUISE.entry, cruiseAltitude: opts.flightLevel };
  if (opts.durationMin !== undefined) fl.durationMinutes = opts.durationMin;
  if (opts.schedTakeoff !== undefined) fl.scheduledTakeoffTime = opts.schedTakeoff;
  const fc = new FlightContext({ flight: fl, telemetry: tel });
  const rules = new RuleEngine(fc);
  const phase = opts.phase ?? "CRUISE";
  rules.setPhaseProvider(() => phase);
  return { fc, rules };
}

function descentStep(): NarrativeStep {
  return new NarrativeStep(
    10, "transition_to_descent", NarrativeTransition.WAIT_CONDITION,
    false, false, 0, undefined, undefined, undefined,
    { no_audio: true, max_once_per_flight: true },
    ["scheduler"], "polling", "scheduler", DESCENT_RULE
  );
}

{
  // T10: el parser ya conoce CRUISE_PROGRESS (antes: "Variable desconocida" → false).
  const { fc, rules } = descentContext({ altitude: 15000, flightLevel: 16000, vs: -700, zulu: ZULU_LATE, local: NOON });
  const d = rules.getSchedulerRuleDetail(DESCENT_RULE, fc);
  check("T10 regla descenso evaluable (isExpression)", d.isExpression === true);
  check("T10 regla descenso TRUE descendiendo", d.met === true, JSON.stringify(d.rows));
  check(
    "T10 CRUISE_PROGRESS con valor (no '-')",
    d.rows.some((r) => r.label.includes("CRUISE_PROGRESS") && !r.value.includes("—")),
    JSON.stringify(d.rows)
  );
  const early = descentContext({ altitude: 15900, flightLevel: 16000, vs: 0, zulu: ZULU_HALF, local: NOON });
  check(
    "T10 regla descenso FALSE en crucero nivelado",
    early.rules.getSchedulerRuleDetail(DESCENT_RULE, early.fc).met === false
  );
}

{
  // T11: evaluateStep(transition_to_descent) con vs vivo vs congelado.
  const live = descentContext({ altitude: 15000, flightLevel: 16000, vs: -700, zulu: ZULU_LATE, local: NOON });
  check("T11 evaluateStep TRUE con vs=-700", live.rules.evaluateStep(descentStep(), live.fc) === true);
  const frozen = descentContext({ altitude: 15000, flightLevel: 16000, vs: 0, zulu: ZULU_LATE, local: NOON });
  check("T11 evaluateStep FALSE con vs=0 (síntoma Rust)", frozen.rules.evaluateStep(descentStep(), frozen.fc) === false);
}

{
  // T12: detector de fase con vs vivo vs congelado (vía estática inmediata).
  const vs = (alt: number, vspeed: number) =>
    FlightPhaseDetector.detectPhase({ altitude: alt, verticalSpeed: vspeed, groundspeed: 280 } as any);
  check("T12 detector DESCENT con vs=-1500", vs(15900, -1500) === FlightPhase.DESCENT, String(vs(15900, -1500)));
  check("T12 detector NO desciende con vs=0", vs(15900, 0) !== FlightPhase.DESCENT, String(vs(15900, 0)));
}

{
  // T13: localTime nulo → se asume noche (documenta por qué urge el fix Rust).
  const { fc, rules } = descentContext({ altitude: 15000, flightLevel: 16000, vs: -700, zulu: ZULU_LATE });
  check("T13 localTime nulo → isNightNow true (fail-closed actual)", rules.isNightNow(fc) === true);
  const noon = descentContext({ altitude: 15000, flightLevel: 16000, vs: -700, zulu: ZULU_LATE, local: NOON });
  check("T13 localTime mediodía → isNightNow false", noon.rules.isNightNow(noon.fc) === false);
}

// ── Caso T14 (guardián Rust): sin SimVars inválidos en código activo ──
// "ESTIMATED CRUISE TIME REMAINING" no existe en el SDK: suscribirlo provoca
// NAME_UNRECOGNIZED(7) y corta TODA la telemetría (objects=0, emits=0).
{
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(root, "src-tauri", "src", "simconnect.rs"), "utf-8");
  const active = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
  const BAD = ["ESTIMATED CRUISE TIME REMAINING"];
  for (const name of BAD) {
    check(`T14 SimVar inválido ausente en Rust activo: "${name}"`, !active.includes(name));
  }
  for (const name of ['"VERTICAL SPEED"', '"LOCAL TIME"']) {
    check(`T14 SimVar vivo presente en Rust activo: ${name}`, active.includes(`name = ${name}`));
  }
  // El loop de dispatch no debe morir ante un Err (rompía el hilo en silencio).
  check("T14 loop dispatch tolera Err (continue)", /Err\(e\)\s*=>\s*\{[\s\S]*?continue;/s.test(active));
}

// ── Casos T15 (parser: FSM, REMAINING_TIME, literales) ─────────────────

{
  const base = { altitude: 15000, flightLevel: 16000, vs: -1500, zulu: ZULU_LATE, local: NOON };
  const desc = descentContext({ ...base, phase: "DESCENT" });
  const cruise = descentContext({ ...base, phase: "CRUISE" });
  // FSM == 'DESCENT' con comillas simples.
  check("T15 FSM=='DESCENT' true en DESCENT", desc.rules.getSchedulerRuleDetail("FSM == 'DESCENT'", desc.fc).met === true);
  check("T15 FSM=='DESCENT' false en CRUISE", cruise.rules.getSchedulerRuleDetail("FSM == 'DESCENT'", cruise.fc).met === false);
  // Comillas dobles + !=.
  check('T15 FSM=="DESCENT" (dobles) true', desc.rules.getSchedulerRuleDetail('FSM == "DESCENT"', desc.fc).met === true);
  check("T15 FSM!='CRUISE' true en DESCENT", desc.rules.getSchedulerRuleDetail("FSM != 'CRUISE'", desc.fc).met === true);
  // Regla publicada de upcoming_actions: antes falsa siempre, ahora vive.
  const UPCOMING_RULE = "VERTICAL_SPEED < -1000 AND FSM == 'DESCENT'";
  check("T15 upcoming_rule TRUE descendiendo", desc.rules.getSchedulerRuleDetail(UPCOMING_RULE, desc.fc).met === true);
  const level = descentContext({ altitude: 2992, flightLevel: 16000, vs: 26, zulu: ZULU_LATE, local: NOON, phase: "DESCENT" });
  check("T15 upcoming_rule FALSE nivelado (vs=+26)", level.rules.getSchedulerRuleDetail(UPCOMING_RULE, level.fc).met === false);
  // REMAINING_TIME con SimBrief: restante = 33 - (zulu-sched)/60.
  const sched = ZULU_LATE - 31 * 60; // elapsed 31 min → restan 2.
  const withSb = descentContext({ ...base, phase: "DESCENT", durationMin: 33, schedTakeoff: sched, radioHeight: 5000 });
  const LANDING_RULE = "(REMAINING_TIME <= 5) OR (RADIO_HEIGHT <= 2000)";
  check("T15 remaining 2min → TRUE por primer brazo", withSb.rules.getSchedulerRuleDetail(LANDING_RULE, withSb.fc).met === true);
  // Sin SimBrief (NaN) + radio bajo → TRUE por segundo brazo (no espurio).
  const noSbLow = descentContext({ ...base, phase: "DESCENT", radioHeight: 1500 });
  const dLow = noSbLow.rules.getSchedulerRuleDetail(LANDING_RULE, noSbLow.fc);
  check("T15 sin SimBrief + radio 1500 → TRUE por radio", dLow.met === true, JSON.stringify(dLow.rows));
  // Sin SimBrief + radio alto → FALSE (NaN no dispara).
  const noSbHigh = descentContext({ ...base, phase: "DESCENT", radioHeight: 5000 });
  check("T15 sin SimBrief + radio 5000 → FALSE", noSbHigh.rules.getSchedulerRuleDetail(LANDING_RULE, noSbHigh.fc).met === false);
}

// ── Casos T16 (monitor: desglose scheduler_rule, fin de "sin desglose") ─

function descentTypeStep(id: number, eventKey: string, preconditions: any, rule: string | null): NarrativeStep {
  return new NarrativeStep(
    id, eventKey, NarrativeTransition.WAIT_CONDITION, false, false, 0,
    undefined, undefined, preconditions,
    { max_once_per_flight: true }, ["scheduler"], "polling", "scheduler", rule
  );
}

{
  const { fc, rules } = descentContext({ altitude: 2992, flightLevel: 16000, vs: 26, zulu: ZULU_LATE, local: NOON, phase: "DESCENT" });
  const upcoming = descentTypeStep(2, "descent_crew_upcoming_actions",
    { type: "descent_condition", conditions: {} }, "VERTICAL_SPEED < -1000 AND FSM == 'DESCENT'");
  const d1 = rules.evaluateWaitConditionDetail(upcoming, fc);
  check("T16 descent_condition con desglose scheduler_rule", d1.kind === "scheduler_rule" && d1.rows.length > 0 && !d1.summary.includes("sin desglose"), d1.summary);
  const landing = descentTypeStep(4, "descent_crew_landing_fewmin",
    { type: "landing_condition", conditions: {} }, "(REMAINING_TIME <= 5) OR (RADIO_HEIGHT <= 2000)");
  const d2 = rules.evaluateWaitConditionDetail(landing, fc);
  check("T16 landing_condition con desglose scheduler_rule", d2.kind === "scheduler_rule" && d2.rows.length > 0, d2.summary);
  const feet = descentTypeStep(3, "descent_capt_10kfeet",
    { fsm: "DESCENT", altitude_below: 10000, vertical_speed_lt: 0 }, "ALTITUDE <= 10000 AND VERTICAL_SPEED < 0");
  const d3 = rules.evaluateWaitConditionDetail(feet, fc);
  check("T16 preconditions sin type con desglose (no 'unknown')", d3.kind === "scheduler_rule" && !d3.summary.includes("sin desglose"), d3.summary);
  // Sin regla ni handler (landing_condition): se preserva el mensaje honesto.
  const bare = descentTypeStep(9, "x", { type: "landing_condition", conditions: {} }, null);
  const d4 = rules.evaluateWaitConditionDetail(bare, fc);
  check("T16 sin regla ni handler mantiene 'sin desglose'", d4.summary.includes("sin desglose"));
}

// ── Caso T17 (guardián de versiones frontend/backend) ─────────────────

{
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf-8");
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf-8"));
  const cargoVer = /^\s*version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? "(?)";
  check("T17 package.json == Cargo.toml", pkg.version === cargoVer, `${pkg.version} vs ${cargoVer}`);
  check("T17 package.json == tauri.conf.json", pkg.version === conf.version, `${pkg.version} vs ${conf.version}`);
}

// ── Casos T18-T21 (descent_condition sostenido) ────────────────────────

function descentCondStep(id: number, eventKey: string, conditions: any): NarrativeStep {
  return new NarrativeStep(
    id, eventKey, NarrativeTransition.WAIT_CONDITION, false, false, 0,
    undefined, undefined,
    { type: "descent_condition", conditions },
    { max_once_per_flight: true }, ["scheduler"], "polling", "scheduler", null
  );
}

function vsContext(vs: number, zulu: number): { fc: FlightContext; rules: RuleEngine } {
  const fc = new FlightContext({ telemetry: { verticalSpeed: vs, zuluTime: zulu } as any });
  return { fc, rules: new RuleEngine(fc) };
}

{
  // T18: sin duración → directo.
  const a = vsContext(-1500, 50000);
  const b = vsContext(-500, 50000);
  const step = descentCondStep(2, "descent_crew_upcoming_actions", { vertical_speed_lt: -1000 });
  check("T18 directo TRUE con vs=-1500", a.rules.evaluateStep(step, a.fc) === true);
  check("T18 directo FALSE con vs=-500", b.rules.evaluateStep(step, b.fc) === false);
}

{
  // T19: ventana 60 s con reloj controlado + reset + resetOneShot.
  const { fc, rules } = vsContext(-1500, 1000);
  const step = descentCondStep(2, "descent_crew_upcoming_actions",
    { vertical_speed_lt: -1000, duration_above_threshold_sec: 60 });
  const at = (vs: number, zulu: number): boolean => {
    fc.updateTelemetry({ verticalSpeed: vs, zuluTime: zulu } as any);
    return rules.evaluateStep(step, fc);
  };
  check("T19 t+0 abre ventana → false", at(-1500, 1000) === false);
  check("T19 t+30 → false", at(-1500, 1030) === false);
  check("T19 t+59 → false", at(-1500, 1059) === false);
  check("T19 t+60 → true", at(-1500, 1060) === true);
  check("T19 spike resetea → false", at(0, 1070) === false);
  check("T19 reinicia tras reset → false", at(-1500, 1071) === false);
  check("T19 +60 tras reinicio → true", at(-1500, 1131) === true);
  rules.resetOneShot();
  check("T19 resetOneShot limpia ventana → false", at(-1500, 1132) === false);
}

{
  // T20: puerta fsm (provider) con duración 0.
  const mk = () => descentCondStep(2, "descent_crew_upcoming_actions",
    { fsm: "DESCENT", vertical_speed_lt: -1000 });
  const ok = vsContext(-1500, 50000);
  ok.rules.setPhaseProvider(() => "DESCENT");
  check("T20 fase DESCENT + vs → true", ok.rules.evaluateStep(mk(), ok.fc) === true);
  const wrong = vsContext(-1500, 50000);
  wrong.rules.setPhaseProvider(() => "CRUISE");
  check("T20 fase CRUISE → false", wrong.rules.evaluateStep(mk(), wrong.fc) === false);
  const none = vsContext(-1500, 50000);
  check("T20 sin provider (fsm letra A) → false", none.rules.evaluateStep(mk(), none.fc) === false);
}

{
  // T21: desglose de monitor para descent_condition sin regla.
  const { fc, rules } = vsContext(-1500, 50000);
  const step = descentCondStep(2, "descent_crew_upcoming_actions",
    { vertical_speed_lt: -1000, duration_above_threshold_sec: 60 });
  const d = rules.evaluateWaitConditionDetail(step, fc);
  check("T21 kind descent_condition (no 'sin desglose')",
    d.kind === "descent_condition" && d.rows.length >= 3 && !d.summary.includes("sin desglose"), d.summary);
  // Peek no muta: la ventana sigue cerrada tras solo mostrar.
  const d2 = rules.evaluateWaitConditionDetail(step, fc);
  check("T21 peek sin efectos (repite desglose)", d2.kind === "descent_condition" && d2.rows.length >= 3);
}

// ── Resultado ────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} verificación(es) FALLIDA(S)`);
  process.exit(1);
} else {
  console.log("\nTodas las verificaciones P0 superadas.");
}
