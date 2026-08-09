import { ScenarioDefinition } from "../scenarios/definitions/ScenarioDefinition";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";

export class NarrativeEngine {
  private definition: ScenarioDefinition;
  private currentStepIndex = 0;
  private completed = false;

  constructor(definition: ScenarioDefinition) {
    this.definition = definition;
  }

  load(definition: ScenarioDefinition): void {
    console.log("[NARRATIVE ENGINE TRACE]");
    console.log("action: load");
    console.log("scenario: " + definition.scenario);
    console.log("previousIndex: " + this.currentStepIndex);
    console.log("newIndex: 0");
    console.log("definitionSteps: " + definition.steps.length);

    this.definition = definition;
    this.currentStepIndex = 0;
    this.completed = false;
  }

  getScenarioName(): string {
    return this.definition.scenario;
  }

  reset(): void {
    console.log("[NARRATIVE ENGINE TRACE]");
    console.log("action: reset");
    console.log("scenario: " + this.definition.scenario);
    console.log("previousIndex: " + this.currentStepIndex);
    console.log("newIndex: 0");

    this.currentStepIndex = 0;
    this.completed = false;
  }

  currentStep(): NarrativeStep | null {
    if (this.completed) {
      console.log("[NARRATIVE ENGINE TRACE]");
      console.log("action: currentStep");
      console.log("scenario: " + this.definition.scenario);
      console.log("currentIndex: " + this.currentStepIndex);
      console.log("event: null (scenario completed)");
      return null;
    }

    const step = this.definition.steps[this.currentStepIndex] ?? null;
    console.log("[NARRATIVE ENGINE TRACE]");
    console.log("action: currentStep");
    console.log("scenario: " + this.definition.scenario);
    console.log("currentIndex: " + this.currentStepIndex);
    console.log("event: " + (step?.eventKey ?? "null"));
    return step;
  }

  currentIndex(): number {
    return this.currentStepIndex;
  }

  hasNextStep(): boolean {
    return this.currentStepIndex + 1 < this.definition.steps.length;
  }

  isCompleted(): boolean {
    return this.completed;
  }

  onStepCompleted(): void {
    const before = this.currentStepIndex;
    if (this.currentStepIndex + 1 >= this.definition.steps.length) {
      this.completed = true;
      console.log("[NARRATIVE ENGINE TRACE]");
      console.log("action: onStepCompleted");
      console.log("scenario: " + this.definition.scenario);
      console.log("beforeIndex: " + before);
      console.log("afterIndex: " + this.currentStepIndex);
      console.log("scenarioCompleted: true");
      console.log("[NARRATIVE]");
      console.log("Scenario completed");
      return;
    }

    this.currentStepIndex++;
    console.log("[NARRATIVE ENGINE TRACE]");
    console.log("action: onStepCompleted");
    console.log("scenario: " + this.definition.scenario);
    console.log("beforeIndex: " + before);
    console.log("afterIndex: " + this.currentStepIndex);
    console.log("scenarioCompleted: false");
    console.log("[NARRATIVE]");
    console.log("Step completed");
    console.log("↓");
    console.log("Moving to next step");
    console.log("↓");
    console.log("Current Step:");
    console.log(this.currentStep()?.eventKey);
  }
}
