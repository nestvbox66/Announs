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
import { NarrativeEngine } from "../narrative/NarrativeEngine";
import { NarrativeOrchestrator } from "../narrative/NarrativeOrchestrator";

export interface TelemetrySnapshot {
  groundspeed: number;
  altitude: number;
  verticalSpeed: number;
  heading: number;
  latitude: number;
  longitude: number;
}

export class Scheduler {
  private ruleEngine: RuleEngine;
  private timerManager: TimerManager;
  private dispatcher: EventDispatcher;
  private flightContext: FlightContext;
  private currentScenario: FlightScenario | null = null;
  private readonly narrativeEngine: NarrativeEngine;
  private readonly narrativeOrchestrator: NarrativeOrchestrator;
  private callId = 0;

  constructor(
    ruleEngine: RuleEngine,
    timerManager: TimerManager,
    dispatcher: EventDispatcher,
    flightContext: FlightContext,
    queue: AnnouncementQueue
  ) {
    this.ruleEngine = ruleEngine;
    this.timerManager = timerManager;
    this.dispatcher = dispatcher;
    this.flightContext = flightContext;
    this.narrativeEngine = new NarrativeEngine({ scenario: "", steps: [] });
    this.narrativeOrchestrator = new NarrativeOrchestrator(
      this.narrativeEngine,
      EventCatalogService,
      this.dispatcher,
      this.flightContext,
      queue,
      this.timerManager
    );
  }

  startScenario(name: string): void {
    this.callId++;
    const callId = this.callId;

    console.log("[SCHEDULER TRACE]");
    console.log("action: startScenario");
    console.log("phase: " + "n/a");
    console.log("scenarioBefore: " + (this.currentScenario?.name ?? "null"));
    console.log("scenarioAfter: " + name);
    console.log("reason: ui-boarding-button");
    console.log("callId: " + callId);

    this.switchScenario(ScenarioFactory.getByName(name));
  }

  enterPhase(phase: FlightPhase): void {
    this.callId++;
    const callId = this.callId;

    console.log("[SCHEDULER TRACE]");
    console.log("action: enterPhase");
    console.log("phase: " + phase);
    console.log("scenarioBefore: " + (this.currentScenario?.name ?? "null"));
    console.log("scenarioAfter: " + (ScenarioFactory.getForPhase(phase)?.name ?? "null"));
    console.log("reason: fsm-transition");
    console.log("callId: " + callId);

    this.switchScenario(ScenarioFactory.getForPhase(phase));
    this.runPhaseRules(phase);
  }

  private switchScenario(scenario: FlightScenario | null): void {
    this.callId++;
    const callId = this.callId;
    const before = this.currentScenario?.name ?? "null";
    const after = scenario?.name ?? "null";

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

    this.currentScenario = scenario;
    this.currentScenario?.onEnter(this.flightContext);

    if (!this.currentScenario) return;

    const def = this.currentScenario.definition;
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

    this.narrativeEngine.load(def);

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

    const actions = this.ruleEngine.enterPhase(phase, this.flightContext);
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
        this.dispatcher.dispatch(eventDef, this.flightContext).catch(() => {});
      }
    }
  }

  leavePhase(_phase: FlightPhase): void {
    // reserved for future use
  }

  notifyEvent(_event: string): void {
    // reserved for future use
  }

  notifyTelemetry(_data: TelemetrySnapshot): void {
    // reserved for future use
  }
}
