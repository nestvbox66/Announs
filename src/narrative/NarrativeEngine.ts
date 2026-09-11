import { ScenarioDefinition } from "../scenarios/definitions/ScenarioDefinition";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { NarrativeTransition } from "../scenarios/narrative/NarrativeTransition";

export class NarrativeEngine {
  private definition: ScenarioDefinition;
  private currentStepIndex = 0;
  private completed = false;
  // One-shot: max_once_per_flight — registro de eventos ya disparados en este vuelo
  private firedOnce = new Set<string>();

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
    this.firedOnce.clear();
    try {
      console.log('[NarrativeEngine] 📦 Cargando pasos:', {
        scenario: definition.scenario,
        steps: definition.steps.map((s) => ({
          eventKey: s.eventKey,
          transition: NarrativeTransition[s.transition],
          preconditions: (s as any).preconditions ?? null,
          schedulerRule: (s as any).scheduler_rule ?? null,
        })),
      });
    } catch {}
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
    this.firedOnce.clear();
  }

  /** One-shot: verifica si un evento con max_once_per_flight ya se disparó. */
  hasFired(eventKey: string): boolean {
    return this.firedOnce.has(eventKey);
  }

  /** One-shot: marca un evento como disparado. */
  markFired(eventKey: string): void {
    this.firedOnce.add(eventKey);
    console.log(`[NarrativeEngine] max_once_per_flight marcado: ${eventKey}`);
  }

  /** Limpia el registro one-shot (nuevo vuelo). */
  resetFired(): void {
    this.firedOnce.clear();
  }

  /** Snapshot del registro one-shot (debug). */
  getFiredEvents(): string[] {
    return Array.from(this.firedOnce);
  }

  /** Alias compat spec: verifica si un paso ya se completó/disparó (one-shot). */
  isStepCompleted(eventKey: string): boolean {
    return this.hasFired(eventKey);
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

  getTotalSteps(): number {
    return this.definition.steps.length;
  }

  hasNextStep(): boolean {
    return this.currentStepIndex + 1 < this.definition.steps.length;
  }

  isCompleted(): boolean {
    return this.completed;
  }

  /** Snapshot de depuración para el Monitor de variables */
  getDebugInfo(): {
    scenario: string;
    currentStepKey: string | null;
    currentIndex: number;
    totalSteps: number;
    hasNextStep: boolean;
    isCompleted: boolean;
    definitionSteps: string[];
  } {
    const step = this.currentStep();
    return {
      scenario: this.definition.scenario,
      currentStepKey: step?.eventKey ?? null,
      currentIndex: this.currentStepIndex,
      totalSteps: this.definition.steps.length,
      hasNextStep: this.hasNextStep(),
      isCompleted: this.completed,
      definitionSteps: this.definition.steps.map((s) => s.eventKey),
    };
  }

  /** Alias legible para el monitor */
  getCurrentPhaseLabel(): string {
    return this.definition.scenario || "(sin escenario)";
  }

  findStepByEventKey(eventKey: string): NarrativeStep | null {
    return this.definition.steps.find((step) => step.eventKey === eventKey) ?? null;
  }

  /** Pasos del escenario cargado (copia para lectura/monitor). */
  getSteps(): NarrativeStep[] {
    return [...this.definition.steps];
  }

  // Helpers para auditoría WAIT_CONDITION / botón Cerrar Puertas
  // Considera completado si solo quedan pasos opcionales (ej. delay_parked no disparado no bloquea cierre)
  isPhaseComplete(_phase?: string): boolean {
    if (this.completed) return true;
    const remaining = this.definition.steps.slice(this.currentStepIndex);
    return remaining.length > 0 && remaining.every(s => s.optional);
  }

  hasPendingSteps(_phase?: string): boolean {
    if (this.completed) return false;
    const remaining = this.definition.steps.slice(this.currentStepIndex);
    // Solo cuenta pendientes no opcionales como bloqueantes
    return remaining.some(s => !s.optional);
  }

  /** Pasos WAIT_CONDITION no opcionales aún no superados (bloquean el avance de fase). */
  hasPendingWaitConditions(): boolean {
    if (this.completed) return false;
    return this.definition.steps
      .slice(this.currentStepIndex)
      .some(s => s.transition === NarrativeTransition.WAIT_CONDITION && !s.optional);
  }

  /** EventKeys pendientes no opcionales desde el paso actual (diagnóstico). */
  getPendingSteps(): string[] {
    if (this.completed) return [];
    return this.definition.steps
      .slice(this.currentStepIndex)
      .filter(s => !s.optional)
      .map(s => s.eventKey);
  }

  onStepCompleted(): void {
    try {
      const steps = this.definition.steps;
      console.log('[NarrativeEngine] 📋 Avanzando narrativa:', {
        currentIndex: this.currentStepIndex,
        totalSteps: steps.length,
        currentStep: steps[this.currentStepIndex]?.eventKey ?? null,
        nextStep: steps[this.currentStepIndex + 1]?.eventKey ?? null,
        isLastStep: this.currentStepIndex >= steps.length - 1,
      });
    } catch {}
    // Traza de completado: quién/qué paso se completa y por qué vía (el
    // motivo real está en el caller — ver stack). Los WAIT_CONDITION solo
    // deberían llegar aquí tras evaluación TRUE (polling) o vía manual/forzado.
    try {
      const st = this.definition.steps[this.currentStepIndex];
      console.log('[NarrativeEngine] ✅ Marcando paso como completado:', {
        eventKey: st?.eventKey ?? 'unknown',
        transition: st ? NarrativeTransition[st.transition] : 'unknown',
        isWaitCondition: st?.transition === NarrativeTransition.WAIT_CONDITION,
        optional: st?.optional ?? null,
        blocking: (st as any)?.blocking ?? null,
        stack: new Error().stack,
      });
    } catch {}
    // One-shot: si el paso completado tenía max_once_per_flight, marcarlo
    const completedStep = this.definition.steps[this.currentStepIndex];
    if (completedStep?.restrictions?.max_once_per_flight) {
      this.markFired(completedStep.eventKey);
    }
    // Log de auditoría solicitado
    try {
      console.log('[NarrativeEngine] Estado del paso:', {
        eventKey: completedStep?.eventKey ?? 'unknown',
        isCompleted: completedStep ? this.isStepCompleted(completedStep.eventKey) : false,
        currentIndex: this.currentStepIndex,
        totalSteps: this.definition.steps.length,
        nextStep: this.definition.steps[this.currentStepIndex + 1]?.eventKey ?? null,
      });
    } catch {}
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
