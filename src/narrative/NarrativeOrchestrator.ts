import { EventCatalogService } from "../events/EventCatalogService";
import { EventDispatcher } from "../dispatcher/EventDispatcher";
import { FlightContext } from "../services/FlightContext";
import { AnnouncementQueue } from "../services/AnnouncementQueue";
import { TimerManager } from "../services/TimerManager";
import { NarrativeEngine } from "./NarrativeEngine";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { NarrativeTransition } from "../scenarios/narrative/NarrativeTransition";

export class NarrativeOrchestrator {
  private readonly narrativeEngine: NarrativeEngine;
  private readonly eventCatalog: typeof EventCatalogService;
  private readonly dispatcher: EventDispatcher;
  private readonly flightContext: FlightContext;
  private readonly timerManager: TimerManager;
  private readonly pendingTimers = new Set<string>();
  private execCounter = 0;

  constructor(
    narrativeEngine: NarrativeEngine,
    eventCatalog: typeof EventCatalogService,
    dispatcher: EventDispatcher,
    flightContext: FlightContext,
    queue: AnnouncementQueue,
    timerManager: TimerManager
  ) {
    this.narrativeEngine = narrativeEngine;
    this.eventCatalog = eventCatalog;
    this.dispatcher = dispatcher;
    this.flightContext = flightContext;
    this.timerManager = timerManager;

    queue.on("completed", this.handleAnnouncementCompleted);
  }

  private handleAnnouncementCompleted = (completedEventKey?: string): void => {
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

    if (step.transition === NarrativeTransition.AFTER_DELAY) {
      console.log("[NARRATIVE]");
      console.log("Waiting for scheduled transition");
      return;
    }

    if (step.transition === NarrativeTransition.AFTER_COMPLETION) {
      this.advanceNarrative("announcement-completed");
    }
  };

  executeCurrentStep(reason?: string): void {
    this.execCounter++;
    const executionId = this.execCounter;

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

    const eventDefinition = this.eventCatalog.get(step.eventKey);
    if (!eventDefinition) return;

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
    console.log("Dispatching");
    this.dispatcher.dispatch(eventDefinition, this.flightContext).catch(() => {});

    if (step.transition === NarrativeTransition.AFTER_DELAY && (step.delayMs ?? 0) > 0) {
      this.scheduleNarrativeDelay(step);
    }
  }

  // Stage 19B: a step is ENABLED unless its enabledSwitch config value is "off".
  private isStepEnabled(eventDefinition: import("../events/types").EventDefinition): boolean {
    const enabledSwitch = eventDefinition.enabledSwitch;
    if (!enabledSwitch) return true;

    const value = this.switchConfigValue(enabledSwitch);
    return value !== "off";
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

  private scheduleNarrativeDelay(step: NarrativeStep): void {
    const id = this.timerId(step);
    if (this.pendingTimers.has(id)) return;

    this.pendingTimers.add(id);

    console.log("[NARRATIVE TRACE]");
    console.log("action: scheduleNarrativeDelay");
    console.log("executionId: " + this.execCounter);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + step.eventKey);
    console.log("transition: " + NarrativeTransition[step.transition]);
    console.log("reason: after-delay-step-activated");
    console.log("timerId: " + id);

    console.log("[NARRATIVE]");
    console.log("Delay scheduled");
    console.log("↓");
    console.log(step.delayMs + "ms");
    console.log("↓");
    console.log(id);

    this.timerManager.schedule({
      id,
      delayMs: step.delayMs!,
      event: step.eventKey,
      onFire: (timerId) => this.handleNarrativeDelayCompleted(timerId),
    });
  }

  private handleNarrativeDelayCompleted = (timerId: string): void => {
    this.pendingTimers.delete(timerId);

    console.log("[NARRATIVE TRACE]");
    console.log("action: handleNarrativeDelayCompleted");
    console.log("executionId: " + this.execCounter);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));
    console.log("transition: " + (this.narrativeEngine.currentStep() ? NarrativeTransition[this.narrativeEngine.currentStep()!.transition] : "null"));
    console.log("reason: narrative-delay-completed");
    console.log("timerId: " + timerId);

    console.log("[NARRATIVE]");
    console.log("Narrative delay completed");
    console.log("↓");
    console.log("Advancing narrative");
    console.log("↓");

    this.advanceNarrative("narrative-delay-completed");
  };

  private timerId(step: NarrativeStep): string {
    return "narrative:" + this.narrativeEngine.getScenarioName() + ":" + step.id;
  }

  private advanceNarrative(reason?: string): void {
    console.log("[NARRATIVE TRACE]");
    console.log("action: advanceNarrative");
    console.log("executionId: " + this.execCounter);
    console.log("scenario: " + this.narrativeEngine.getScenarioName());
    console.log("stepIndex: " + this.narrativeEngine.currentIndex());
    console.log("event: " + (this.narrativeEngine.currentStep()?.eventKey ?? "null"));
    console.log("transition: " + (this.narrativeEngine.currentStep() ? NarrativeTransition[this.narrativeEngine.currentStep()!.transition] : "null"));
    console.log("reason: " + (reason ?? "unknown"));

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
