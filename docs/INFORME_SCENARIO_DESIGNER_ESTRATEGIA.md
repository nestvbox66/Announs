# INFORME — Estrategia de migración hacia configuración centralizada (Scenario Designer)

**Fecha:** 2026-08-13
**Alcance:** solo análisis y propuesta. No se modificó código (ni Desktop `C:\Proyectos\Announs` ni Backoffice `C:\Proyectos\announs-backoffice`, ni DB, ni Storage).
**Base del análisis:** auditoría read-only del motor de ejecución de eventos (Desktop) + documentos `docs/Arquitectura del Motor de Ejecución de Eventos.md` y `docs/Scenario Designer.md`.

---

## 1. LO QUE EXISTE HOY (auditoría del motor)

### 1.1 Piezas del runtime y su estado real

| Componente | Archivo(s) | Qué hace hoy | ¿Configurable? |
|---|---|---|---|
| **ScenarioFactory** | `src/scenarios/ScenarioFactory.ts` | Devuelve escenarios **hardcodeados** por fase o por nombre (`PreBoardingScenario`, `BoardingScenario`). `getForPhase` solo responde a `BOARDING`; el resto → `null`. | No |
| **Scenario / FlightScenario** | `src/scenarios/FlightScenario.ts`, `BoardingScenario.ts`, `PreBoardingScenario.ts` | Interfaz `name + definition + onEnter/onExit/update`. Los escenarios concretos solo exponen una definición y loguean. Sin lógica. | No (clases) |
| **ScenarioDefinition** | `src/scenarios/definitions/*` | Interfaz `{ scenario, steps }`. Las implementaciones (`BoardingScenarioDefinition`, `PreBoardingScenarioDefinition`) son **arrays hardcodeados** de `NarrativeStep`. | No (hardcoded) |
| **NarrativeStep** | `src/scenarios/narrative/NarrativeStep.ts` | `id`, `eventKey`, `transition` (`IMMEDIATE | AFTER_COMPLETION | AFTER_DELAY | WAIT_CONDITION`), `blocking`, `optional`, `delayMs?`. | No (clase) |
| **NarrativeTransition** | `src/scenarios/narrative/NarrativeTransition.ts` | Enum de transiciones. | No |
| **NarrativeEngine** | `src/narrative/NarrativeEngine.ts` | Máquina secuencial sobre la definición: `load/reset/currentStep/currentIndex/hasNext/onStepCompleted`. **Consume `ScenarioDefinition`** (es el punto de inyección natural). | Parcial (lee lo que le den) |
| **NarrativeOrchestrator** | `src/narrative/NarrativeOrchestrator.ts` | Orquesta el paso actual: resuelve `EventDefinition` desde el catálogo, chequea `enabledSwitch` contra `flightContext.settings.eventConfig`, decide EXECUTE vs SKIP, despacha, maneja transiciones AFTER_COMPLETION / AFTER_DELAY, cancela timers. **Contiene la lógica de "habilitado/deshabilitado"**. | No |
| **Scheduler** | `src/services/Scheduler.ts` | Orquestador principal: `startScenario(name)`, `enterPhase(phase)`, `switchScenario`, `runPhaseRules`. En `switchScenario` hace `ScenarioFactory.getForPhase/getByName` → `narrativeEngine.load(def)` → `narrativeOrchestrator.executeCurrentStep()`. También dispara `ruleEngine.enterPhase`. | No |
| **RuleEngine** | `src/services/RuleEngine.ts` | `enterPhase(phase, context)`: toma eventos del catálogo por fase, evalúa con `TriggerEvaluatorFactory`, y según `priority === 10` emite action announcement; `priority === 20` emite timer de 60s hardcodeado. **Reglas de prioridad/timer embebidas en código**. | No (parcial) |
| **Trigger Evaluators** | `src/triggers/*` | `Manual`, `PhaseEnter`, `Timer`, `Condition` + `TriggerEvaluatorFactory`. Extensibles. | No |
| **Event Catalog** | `src/events/EventCatalog.ts`, `EventCatalogService.ts`, `boarding/*` | `EventDefinition` registradas en un `Map` en código: `eventKey`, `phase`, `triggerType`, `enabledSwitch`, `priority`, `blocking`, `description`, `speakerRole`, `preRecorded`. **Catálogo en código**, no en DB. | No (código) |
| **EventDispatcher / Handler** | `src/dispatcher/*` | Event bus → `AnnouncementEventHandler`. | No |
| **AnnouncementQueue / Player** | `src/services/*` | Serialización y reproducción de anuncios. | No |
| **FlightContext** | `src/services/FlightContext.ts` | Estado central: `flight`, `voices`, `settings` (incluye `eventConfig: Record<key, "off"|"pack"|"IA">`), `telemetry`, `fsm`, `announcement`, `simbrief`. **Es el único lugar donde hoy vive configuración dinámica** (`settings.eventConfig`). | Sí (runtime) |
| **FlightFSM** | `src/services/FlightFSM.ts` | Máquina de fases del vuelo. | No |
| **SimulationController** | `src/services/SimulationController.ts` | Motor de simulación que empuja fases (`nextPhase`) y dispara `flightFSM.transition`. | No |

### 1.2 Flujo de ejecución actual (resumen)

```
FlightFSM.transition(fase)
        ↓
Scheduler.enterPhase(phase)
        ├─ ScenarioFactory.getForPhase(phase)   → escenario hardcodeado (o null)
        ├─ switchScenario(scenario)
        │     ├─ narrativeEngine.load(def)      → steps hardcodeados
        │     └─ narrativeOrchestrator.executeCurrentStep()
        └─ ruleEngine.enterPhase(phase)         → eventos sueltos por fase (priority/timer en código)
                ↓
NarrativeOrchestrator: EventCatalogService.get(eventKey) → EventDefinition hardcodeada
        ↓
enabledSwitch: flightContext.settings.eventConfig[key]  → "off"|"pack"|"IA" → EXECUTE o SKIP
        ↓
EventDispatcher.dispatch → AnnouncementEventHandler → AnnouncementQueue → AnnouncementPlayer
```

### 1.3 Hallazgos clave

1. **Todo lo estructural está hardcodeado en código TS** del Desktop: escenarios, definiciones, steps, catálogo de eventos, reglas de prioridad y timers.
2. **Lo único configurable en runtime hoy** es `flightContext.settings.eventConfig` (switches `off|pack|IA`), que decide habilitar/deshabilitar un evento, pero **no altera el orden ni la composición** de los escenarios.
3. La separación **definición vs ejecución ya existe en el código** (`ScenarioDefinition` / `NarrativeStep` son consumidos por `NarrativeEngine`), pero la definición es instanciada desde clases concretas hardcodeadas, no desde datos.
4. El **punto de inyección natural** es `NarrativeEngine.load(definition)` (y `ScenarioFactory`), porque el motor ya trata la definición como un dato (`{ scenario, steps }`) y no como lógica.
5. `NarrativeStep` ya modela casi todo lo que el Scenario Designer necesita por step: `eventKey`, `order` (implícito por posición), `transition`, `blocking`, `optional`, `delayMs`. **Falta**: `conditions`, `dependencies`, `parameters`, y la noción de `phase` dentro de la definición.

---

## 2. LO QUE PROPONEMOS CONSTRUIR

### 2.1 Principio rector

> **El Backoffice define. El Desktop interpreta.**
> El Desktop ya tiene la capacidad de consumir una `ScenarioDefinition` como dato. La migración consiste en **producir esa definición desde una configuración persistida (Backoffice) en lugar de desde clases hardcodeadas**, manteniendo intactos `NarrativeEngine`, `NarrativeOrchestrator`, `Dispatcher`, `Queue`, `Player`, `RuleEngine` y `FlightContext`.

### 2.2 Contrato conceptual Backoffice ↔ Desktop

El contrato debe ser un **DTO serializable** (JSON) que represente exactamente lo que `NarrativeEngine` y `NarrativeOrchestrator` ya consumen, ampliado con los campos que el Designer necesita:

```ts
interface PublishedScenario {
  scenario: string;          // key, p.ej. "standard_commercial_flight"
  name: string;              // display name
  version: number;
  phases: PublishedPhase[];
}

interface PublishedPhase {
  key: string;               // p.ej. "boarding"
  name: string;
  order: number;
  steps: PublishedStep[];
}

interface PublishedStep {
  id: number;
  eventKey: string;          // referencia al Event Catalog (NO duplica metadata)
  order: number;
  enabled: boolean;
  transition: "IMMEDIATE" | "AFTER_COMPLETION" | "AFTER_DELAY" | "WAIT_CONDITION";
  blocking: boolean;
  optional: boolean;
  delayMs?: number;
  conditions?: Condition[];  // futuro
  dependencies?: string[];   // futuro
  parameters?: Record<string, unknown>; // futuro
}
```

**Reglas del contrato:**
- `eventKey` **referencia** el catálogo (fuente de verdad del evento); el Step **no** duplica `displayName`, handler, prompt, audio, etc.
- El Desktop descarga el **escenario publicado** (un snapshot estable) y lo instancia como `ScenarioDefinition` (vía una capa de adaptación), sin tocar `NarrativeEngine`.
- La precedencia se respeta en runtime: `System Defaults → Scenario Configuration → User Configuration → Flight Configuration → Runtime Context`. Hoy solo existe `FlightContext.settings.eventConfig`; el contrato introduce la capa "Scenario Configuration" **sin reemplazar** la configuración de usuario/vuelo existente.

### 2.3 Estrategia de migración en el Desktop (por fases, sin romper el runtime)

#### Fase A — Capa de carga de escenarios (Compatibility + Adapter)
- Crear un **ScenarioLoader** (nuevo servicio en el Desktop) que:
  1. Intente obtener el `PublishedScenario` (desde Supabase / endpoint del Backoffice) para la clave activa.
  2. Si existe y está publicado → lo mapee a un `ScenarioDefinition` (adapter que convierte `steps` de JSON a la forma que `NarrativeEngine` ya espera).
  3. Si no existe → devuelva el comportamiento actual (`ScenarioFactory` hardcodeado). **Compatibility Layer / fallback**.
- No tocar `NarrativeEngine` ni `NarrativeOrchestrator` en esta fase (ya son compatibles porque consumen la interfaz `ScenarioDefinition`).

#### Fase B — Refactor del ScenarioFactory (punto único de selección)
- Modificar `ScenarioFactory` para que **resuelva** la definición desde el loader en lugar de instanciar clases concretas.
  - `getForPhase(phase)` → pregunta al loader "¿hay escenario publicado para esta fase?" → adapta → devuelve; si no, mantiene el fallback.
  - `getByName(name)` → igual.
- La interfaz `FlightScenario` se mantiene; solo cambia de dónde sale `definition`.

#### Fase C — Ampliar NarrativeStep para condiciones/dependencias (solo lectura, opcional)
- `NarrativeStep` ya cubre `transition/blocking/optional/delayMs`. Las condiciones pueden mapearse en esta fase a un formato que el `RuleEngine`/`ConditionTriggerEvaluator` ya entienda (NO crear un segundo motor de reglas).
- No es obligatorio en el MVP.

#### Fase D — Scheduler y RuleEngine (mantener sin cambios en el MVP)
- `Scheduler` ya llama `narrativeEngine.load(def)`; si el loader devuelve una definición adaptada, **el Scheduler no necesita cambios**.
- `RuleEngine` (eventos sueltos por fase, timers de 60s en `priority===20`) puede dejarse como está en una primera versión; idealmente sus acciones también pasarían a configurarse, pero eso es evolución posterior (no bloqueante).

### 2.4 Persistencia (modelo conceptual; NO implementar todavía)

Auditoría de lo que ya existe en DB (Backoffice) que puede reutilizarse:

| Necesidad | Entidad existente | Observación |
|---|---|---|
| Eventos del catálogo | `events` (+ `speaker_role`, `is_pre_recorded`, `config_attribute_name`, `profile_id`) | Reutilizable como **fuente de verdad** de eventos. Falta: `triggerType`, `priority`, `blocking`, `enabledSwitch` como columnas (hoy en código). |
| Texto del anuncio | `announces_catalog` (`event_id`+`language_id`+`variant_name`+`text_announce`) | Reutilizable. |
| Prompts | `master_prompts`, `prompts` | Reutilizable (el Step referencia un prompt vía evento). |
| Audios | `audio_raw`, `audio_final` | Reutilizable. |
| Fases | No existe tabla de fases | Evaluar si la fase queda modelada en `events.phase` (no existe hoy) o si se resuelve por convención en el escenario. **El doc del Designer sugiere no crear tabla de fases si no hace falta**; en el motor, la fase ya está en `FlightPhase` (código) y en `events` no hay columna. |

**Entidades conceptuales nuevas (hipótesis de diseño, verificar en SD-03):**
- `scenarios` (metadata: key, name, version, status `draft|published`)
- `scenario_versions`
- `scenario_phases`
- `scenario_steps` (eventKey FK → `events`, order, transition, blocking, optional, delayMs, phase)
- `scenario_conditions` (futuro)
- `scenario_step_dependencies` (futuro)

**Regla:** no crear tablas automáticamente. Primero validar si `events` puede ganar columnas (`phase`, `trigger_type`, `priority`, `blocking`, `enabled_switch`) para que el catálogo sea la fuente de verdad, y si `scenario_steps` es lo único realmente nuevo.

### 2.5 Publicación / consumo

- Backoffice: editor del Designer → guarda **draft** → valida → **publica** (snapshot inmutable versionado).
- Desktop: descarga la **configuración publicada** (no el draft) y la cachea; ante ausencia, fallback al comportamiento actual.
- Antes de publicar, el Designer valida: eventKey existe en `events`, evento activo, orden sin duplicados, fases válidas, condiciones/operadores válidos, recursos (prompt/audio) existentes.

---

## 3. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper el runtime existente | Compatibility Layer: si no hay escenario publicado → comportamiento actual. Cambios progresivos por fase. |
| Duplicar el catálogo de eventos | `scenario_steps.eventKey` referencia `events`; no duplicar metadata. `EventCatalogService` del Desktop pasa a leerse de `events` (o un endpoint) en lugar de un Map en código. |
| Duplicar el motor de reglas | El Designer **configura** reglas que `RuleEngine`/`TriggerEvaluators` ya interpretan; no crear un segundo motor. |
| Precedencia ambigua (system/user/flight) | Documentar la precedencia antes de implementar; no tocar `flight_setting_announcements` ni `setting_announcements`. |
| `audio_final.raw_id` sin FK declarada | (hallazgo de la etapa Audio Raw) al modelar dependencias, decidir si se agrega FK o se mantiene consulta por `eq`. |
| RLS | Toda escritura del Designer protegida por Supabase Auth + `app_metadata.role` + `public.is_admin()` + policies RLS; no confiar en ocultar menú. |

---

## 4. Camino propuesto (alineado a SD-01..SD-10 del doc del Designer)

1. **SD-01 Auditoría** (este informe es su insumo principal; ampliar con las 17 preguntas del doc).
2. **SD-02 Modelo conceptual** (Scenario / Phase / Step / Event / Condition / Dependency / Parameters) — sin tocar DB.
3. **SD-03 Gap analysis de DB** — decidir: ¿`events` gana columnas? ¿`scenario_steps` es lo único nuevo? ¿tabla de fases o convención?
4. **SD-04 Diseño UX** del Designer (fases + steps ordenables + panel de propiedades + validaciones).
5. **SD-05 Persistencia** + RLS (solo después de aprobar el modelo).
6. **SD-06 Scenario Designer MVP** en el Backoffice.
7. **SD-07 Contrato Desktop** (`PublishedScenario` → `ScenarioDefinition` adapter).
8. **SD-08 Integración Desktop** progresiva (loader + factory + fallback).
9. **SD-09 Compatibility Layer** (transición segura).
10. **SD-10 Activación** (eliminar hardcode solo tras validar).

---

## 5. Conclusión

**Es factible y de bajo riesgo** porque el motor del Desktop ya fue diseñado con **separación definición/ejecución**: `NarrativeEngine` consume `ScenarioDefinition` como dato y `NarrativeOrchestrator` ya separa el "qué" (steps, enabledSwitch) del "cómo" (dispatch, timers, cola). La migración no requiere reconstruir el runtime:

- Se **inyecta** la definición desde una fuente persistida (Backoffice → publicado → Desktop).
- Se **adapta** el `ScenarioFactory` para resolver la definición desde un loader con **fallback** al comportamiento actual.
- El motor de reproducción (Dispatcher/Queue/Player) y las reglas existentes **no se tocan** en el MVP.
- Los pasos del vuelo se vuelven dinámicos porque el orden/composición de `NarrativeStep` pasa a estar gobernado por la configuración publicada, y el runtime ya sabe ejecutar esa configuración.

El único trabajo de fondo real es: (a) persistir catálogo + escenarios en Backoffice, (b) construir el editor (Designer MVP), (c) un adapter en el Desktop que convierta el snapshot publicado en `ScenarioDefinition`. El resto es progresivo y reversible.
