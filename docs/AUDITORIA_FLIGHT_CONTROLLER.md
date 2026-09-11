# Auditoría Desktop Announs — Integración con Simuladores y FlightController

**Fecha:** 30 de agosto de 2026  
**Proyecto:** Announs Desktop (`C:\Proyectos\Announs`)  
**Objetivo:** Entender el estado actual de la integración con simuladores de vuelo y preparar la implementación del `FlightController`  
**Arquitectura de referencia:** `docs/Arquitectura del Motor de Ejecución de Eventos.md`

---

## 1. Resumen ejecutivo

**No existe FlightController.** La arquitectura documentada en `docs/Arquitectura del Motor de Ejecución de Eventos.md:435` marca `Flight Controller (MSFS) ⏳ Pendiente` al 05/08/2026 y ese estado se mantiene.

La integración con simuladores (MSFS SimConnect, X-Plane SDK, Aerofly SDK) es **inexistente**: no hay código Rust/Tauri, ni websocket, ni pipe, ni polling de SimVars. Todo el flujo de vuelo es **manual/mockeado** vía UI.

El `FlightContext` está implementado pero su sección `telemetry` es genérica y nunca se alimenta con datos reales. Las transiciones de fase las dispara `SimulationController.nextPhase()` + `FlightFSM.transition()` desde botones de `VueloActualView.tsx` / `FlightStepper`, con un fallback de avance automático del `Scheduler` tras completar la narrativa. El único hook preparado para telemetría real (`Scheduler.notifyTelemetry` con `doorsClosed`) nunca es invocado desde un provider externo.

---

## 2. Archivos clave

| Archivo | Estado | Rol |
|---|---|---|
| `src/services/SimulationController.ts:4` | ✅ Existe, manual | Expone `start()`, `enterBoarding()`, `nextPhase()`, `triggerEvent()`. Solo delega a `flightFSM.transition()`. No lee simulador. |
| `src/services/FlightContext.ts:139` | ✅ Implementado | Estado central. Secciones `flight/voices/settings/telemetry/fsm/announcement/simbrief`. `updateTelemetry()` existe pero sin productor. |
| `src/services/FlightFSM.ts:25` | ✅ Implementado | FSM estricto `GATE→BOARDING→...→FLIGHT_COMPLETED` en `FlightFSM.ts:6`. `subscribe()` notifica a `Scheduler`. |
| `src/services/Scheduler.ts:47` | ✅ Implementado | Orquestador. `enterPhase():215`, `FLIGHT_SEQUENCE:53` (`PRE_FLIGHT→AT_GATE`), `advanceAfterNarrative():500`, `schedulePhaseAutoAdvance():514`. Define `TelemetrySnapshot:22`. |
| `src/engine/FlightEngine.ts:1` | ✅ | Enum `FlightPhase` (13 fases). |
| `src/types/flightPhase.ts:15` | ✅ | `ScreenType` / `PhaseScreenMapping`. |
| `src/services/VariableResolver.ts:161` | ⚠️ Parcial | Lista SimVars esperadas pero solo como `generateSimulatedValue()` en modo test (`isTestMode`). `aliases.telemetry:201` y `simulatedTelemetry:163`. |
| `src/eventContext/EventContextBuilder.ts:36` | ⚠️ | Declara `altitude/groundspeed/vertical_speed/heading` desde `telemetry`, nunca poblados en vuelo real. |
| `src-tauri/src/lib.rs:1` / `src-tauri/src/main.rs:1` / `src-tauri/Cargo.toml:1` | ⚠️ Vacío | Solo `tauri-plugin-log`. Sin `invoke` para SimConnect, sin dependencias `msfs-simconnect` / `XPLM`. |
| `src/services/FlightController.ts` | ❌ No existe | `Glob src/**/*` no lo retorna. |
| `src/flight/` | ❌ No existe | Directorio no existe. |
| `src/config.ts:1` | ❌ | Solo `supabaseUrl/anonKey`. Sin config de simulador. |

> Búsqueda `grep FlightController|SimConnect|XPlane` solo devuelve la doc de arquitectura + el placeholder `simulatedTelemetry` en `VariableResolver.ts:162`.

---

## 3. Modelo de datos de telemetría

### 3.1 En `FlightContext.ts:34-36` — Estado central genérico

```ts
export interface TelemetryInfo { [key:string]: unknown; } // src/services/FlightContext.ts:34
const DEFAULT_TELEMETRY: TelemetryInfo = {};              // src/services/FlightContext.ts:109
```

Genérico, sin tipado. Acceso vía `getTelemetry():228` / `updateTelemetry(partial):232` con `emit("telemetry")`. Nunca se invoca desde código productivo excepto en tests.

```ts
// src/services/FlightContext.ts:70
export interface FlightContextState {
  flight: FlightInfo;
  voices: VoicesInfo;
  settings: SettingsInfo;
  telemetry: TelemetryInfo;
  fsm: FsmInfo;
  announcement: AnnouncementState;
  simbrief: SimbriefInfo;
}
```

### 3.2 En `Scheduler.ts:22` — Contrato esperado para el futuro FlightController

```ts
export interface TelemetrySnapshot {  // src/services/Scheduler.ts:22
  groundspeed: number;
  altitude: number;
  verticalSpeed: number;
  heading: number;
  latitude: number;
  longitude: number;
  /** true cuando el simulador reporta las puertas principales cerradas. */
  doorsClosed?: boolean;
}
```

Consumido solo en:

```ts
notifyTelemetry(data: TelemetrySnapshot): void {  // src/services/Scheduler.ts:438
  if (data.doorsClosed) this.notifyDoorsClosed();
}
```

→ `notifyDoorsClosed():477` → `enterPhase(PRE_FLIGHT)`. Hoy es **dead code** (nadie lo invoca).

### 3.3 En `VariableResolver.ts:163-228` — Catálogo dorado para el FlightController

Simula valores si `isTestMode==true` y `source=="telemetry"` (`getFallbackStrategy():148` → `simulated`):

**Aliases amigables** `src/services/VariableResolver.ts:200`:
`altitude`, `groundspeed`, `verticalSpeed`, `heading`, `latitude`, `longitude`, `pitch`, `roll`, `flightPhase`, `isSlewActive`, `zuluTime`, etc.

**SimVars crudas** `src/services/VariableResolver.ts:163`:
`PLANE_ALTITUDE`, `GROUND_VELOCITY`, `VERTICAL_SPEED`, `PLANE_HEADING_DEGREES_GYRO`, `PLANE_LATITUDE`, `GENERAL_ENG_COMBUSTION`, + estilo X-Plane `sim/flightmodel/position/elevation`.

**Uso en eventos** — `EventContextBuilder.ts:36` fallback `preflight_capt_basic_info`:
```ts
altitude: { source: "telemetry", source_path: "altitude" },
groundspeed: { source: "telemetry", source_path: "groundspeed" },
vertical_speed: { source: "telemetry", source_path: "verticalSpeed" },
heading: { source: "telemetry", source_path: "heading" },
```

### 3.4 Actualización hoy

`FlightContext.updateTelemetry` no tiene caller real. `VueloActualView.tsx:647` hace `flightContext.updateFSM()` pero nunca `updateTelemetry`. `TelemetryView.tsx:14` es puramente determinista a partir de `VueloReciente` (genera `altitude/speed/terrain` ficticio con `Math.sin`), no lee `FlightContext`.

---

## 4. Gestión de fases

- **Manual 100%.** `SimulationController.nextPhase():38` itera `orderedPhases:42` y llama `flightFSM.transition(next):68`. Accionado desde `VueloActualView.tsx:440` (`SimulationController`) + `FlightStepper`. `FlightFSM.transition():40` valida contra `VALID_TRANSITIONS:6` y hace `scheduler.enterPhase():66`.

- **`Scheduler` controla vista pero no simulador.** `enterPhase():215` carga `ScenarioFactory`, `runPhaseRules():381`, `emit("phase:changed"):506`. `GATE/BOARDING` tienen manejo especial (`phase:gate:entered` / `phase:boarding:started` en `Scheduler.ts:289`). `closeDoors():452` manual solo desde `BOARDING` con `boardingStepsCompleted`.

- **Automático narrativo, no de sim.** `Scheduler` avanza solo cuando `narrativeOrchestrator.on("scenario:completed"):111` → `advanceAfterNarrative():500` o fallback 5s si fase sin pasos `Scheduler.ts:249`. No hay detección de `altitude>500ft → TAKEOFF`.

- **Puente para sim ya esbozado pero sin uso.** `Scheduler.notifyTelemetry():438` + `notifyDoorsClosed():477` previsto para que `FlightController` detecte cierre de puertas. `NarrativeOrchestrator.notifyExternalEvent():604` y `decision_maker: "flight_controller"` en `src/narrative/NarrativeOrchestrator.ts:327` también previstos.

```ts
// src/services/SimulationController.ts:38
nextPhase(): void {
  const orderedPhases: FlightPhase[] = [
    FlightPhase.GATE, FlightPhase.BOARDING, FlightPhase.PRE_FLIGHT,
    FlightPhase.TAXI, FlightPhase.TAKEOFF, FlightPhase.CLIMB,
    FlightPhase.CRUISE, FlightPhase.DESCENT, FlightPhase.APPROACH,
    FlightPhase.LANDING, FlightPhase.TAXI_IN, FlightPhase.AT_GATE,
    FlightPhase.FLIGHT_COMPLETED,
  ];
  const currentIdx = orderedPhases.indexOf(this.flightFSM.getCurrentState());
  if (currentIdx >= 0 && currentIdx < orderedPhases.length - 1) {
    this.flightFSM.transition(orderedPhases[currentIdx + 1]);
  }
}
```

---

## 5. Conexiones existentes

**Ninguna.** Verificado:

- `grep websocket|WebSocket|pipe|Tauri invoke` en `src/` → 0 hits relevantes (solo `src-tauri/src/lib.rs:6` con `tauri_plugin_log`).
- `src-tauri/Cargo.toml:24` sin `msfs-simconnect` ni `simconnect-sdk`. No hay `build.rs` ni crate de sim.
- `src-tauri/src/lib.rs:1` y `src-tauri/src/main.rs:1` — boilerplate Tauri sin `#[tauri::command]`.
- `src/config.ts:1` sin URL/endpoint de simulador:
  ```ts
  export const config = {
    supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
    supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "",
  };
  ```
- `VueloActualView.tsx:399` instancia `FlightContext`, `FlightFSM`, `Scheduler`, `SimulationController` en memoria (`useRef`), sin bridge externo.
- Únicas comunicaciones reales: `supabase.functions.invoke("audio-get")` en `src/services/AnnouncementService.ts:56` para TTS y queries a Supabase.

---

## 6. Gaps — Qué falta para un FlightController completo

| # | Gap | Detalle |
|---|---|---|
| 1 | **Sin abstracción provider** | Falta `interface FlightControllerProvider { connect()/disconnect()/poll(); onTelemetry: (snap)=>void; onPhaseHint: (phase)=>void }` + implementaciones `MsfsSimConnectProvider`, `XPlaneProvider`, `MockProvider`. |
| 2 | **Telemetría sin tipar ni poblar** | `TelemetryInfo` es `[key:unknown]`. Debe pasar a tipo fuerte alineado con `TelemetrySnapshot` + SimVars completas (IAS/TAS, VS, flaps, gear, squawk, COM freq, pause/slew, simRate). |
| 3 | **Sin fase automática** | Falta mapeo `TelemetrySnapshot → FlightPhase` (ej. `onGround+doorsClosed→TAXI`, `groundspeed>30+AGL>50→TAKEOFF`, `verticalSpeed` thresholds para `CLIMB/DESCENT`). Hoy hardcodeado en `SimulationController`. |
| 4 | **Sin transporte Tauri** | No hay `#[tauri::command] poll_simconnect` en `src-tauri/src/lib.rs:2` ni `invoke` JS. MSFS requiere WASM + SimConnect o `MSFS SDK JS` vía `Coherent` — no integrado. |
| 5 | **Sin config/conexión** | No hay persistencia de `simConnectHost/port` ni `autoConnect` en `setting_general` ni `config.ts`. |
| 6 | **Sin degradación** | El fallback `VariableResolver.generateSimulatedValue` solo funciona en modo test; en vuelo normal faltan valores → `[key no disponible]`. |
| 7 | **Scheduler acoplado a UI** | `VueloActualView.tsx:440` crea todo el stack en el componente; debe extraerse a singleton/service para que el FlightController pueda emitir sin remontar el componente. |

---

## 7. Recomendaciones — Próximos pasos

### P1 — Contratos (sin romper nada)

- Tipar `TelemetryInfo` en `src/services/FlightContext.ts:34` como `TelemetrySnapshot & Record<string,unknown>` (compat).
- Extraer `TelemetrySnapshot` de `Scheduler.ts:22` a `src/types/telemetry.ts` compartido.
- Definir `src/services/FlightController.ts` (interfaz):
  ```ts
  interface FlightController {
    connect(): Promise<void>;
    disconnect(): void;
    isConnected(): boolean;
    getTelemetry(): TelemetrySnapshot;
    onTelemetry: (snap: TelemetrySnapshot) => void; // → FlightContext.updateTelemetry() + Scheduler.notifyTelemetry()
  }
  ```

### P2 — Mock útil inmediato

- Crear `MockFlightController` que emita `TelemetrySnapshot` sintética (reusar `TelemetryView.getTelemetryData` + `VariableResolver.simulatedTelemetry`) para validar `notifyDoorsClosed` y transiciones automáticas sin MSFS.

### P3 — Bridge Tauri MSFS

- Añadir crate `msfs-simconnect` o `simconnect-sdk` en `src-tauri/Cargo.toml`, exponer `#[tauri::command] simconnect_subscribe(vars: Vec<String>)` y polling 10Hz en thread `src-tauri/src/lib.rs:3` → `app.emit("telemetry", snapshot)`. En JS `listen("telemetry", (e) => flightContext.updateTelemetry(e.payload))`.
- Alternativa JS-only: si se corre como WASM in-game, usar `Coherent.call("GET_SIM_VAR")`; si es desktop externo, evaluar `MSFS WebSocket Bridge` (community).

### P4 — Phase Detector

- Nuevo `src/services/FlightPhaseDetector.ts`: `detectPhase(snapshot, prevPhase) → FlightPhase|null` con histéresis (evitar flapping). Inyectado en `FlightController` → `FlightFSM.transition()` solo si `transitionAllowed` (`FlightFSM.ts:21`).

### P5 — Config

- Extender `src/config.ts:1` y tabla `setting_general` con `sim_provider: 'msfs'|'xplane'|'mock'`, `sim_autoconnect`, `sim_host`.

Esto desacopla el simulador del dominio (principio `docs/Arquitectura del Motor de Ejecución de Eventos.md:384` — independencia respecto del simulador) y habilita implementar MSFS primero manteniendo X-Plane/Mock por la misma interfaz.

---

## 8. Archivos relevantes inspeccionados

- `src/services/FlightContext.ts`
- `src/services/SimulationController.ts`
- `src/services/FlightFSM.ts`
- `src/services/Scheduler.ts`
- `src/services/VariableResolver.ts`
- `src/eventContext/EventContextBuilder.ts`
- `src/services/Clock.ts`
- `src/services/TimerManager.ts`
- `src/services/RuleEngine.ts`
- `src/services/AnnouncementQueue.ts`
- `src/services/AnnouncementPlayer.ts`
- `src/narrative/NarrativeOrchestrator.ts`
- `src/engine/FlightEngine.ts`
- `src/types.ts` / `src/types/flightPhase.ts`
- `src/components/VueloActualView.tsx`
- `src/components/TelemetryView.tsx`
- `src/App.tsx`
- `src/config.ts`
- `src-tauri/src/lib.rs` / `src-tauri/src/main.rs` / `src-tauri/Cargo.toml`
- `docs/Arquitectura del Motor de Ejecución de Eventos.md`

---

*Auditoría generada automáticamente. No se modificó código fuente.*
