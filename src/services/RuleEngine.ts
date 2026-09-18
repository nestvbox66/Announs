import { FlightPhase } from "../engine/FlightEngine";
import { EventCatalogService } from "../events/EventCatalogService";
import { TriggerEvaluatorFactory } from "../triggers/TriggerEvaluatorFactory";
import { FlightContext } from "./FlightContext";
import { NarrativeStep } from "../scenarios/narrative/NarrativeStep";
import { secondsToHHMM } from "../utils/timeUtils";
import { logger } from "../utils/logger";

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

type WaitDetailRow = { label: string; ok: boolean | null; value: string };

/** AND de los checks evaluables; null si ninguno tiene dato. */
function andOk(rows: WaitDetailRow[]): boolean | null {
  let saw = false;
  for (const r of rows) {
    if (r.ok === null || r.ok === undefined) continue;
    saw = true;
    if (!r.ok) return false;
  }
  return saw ? true : null;
}

/** JSON compacto para valores configurados (nunca lanza). */
function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

export class RuleEngine {
  private timerCounter = 0;

  // Compatibilidad con spec: permite inyección opcional para isDelayThresholdExceeded sin parámetro
  private flightContext?: FlightContext;
  private eventCatalog: typeof EventCatalogService = EventCatalogService as any;

  // One-shot: max_once_per_flight — evita re-disparo dentro del mismo vuelo
  private executedEvents = new Set<string>();

  // Ventanas sostenidas por evento para descent_condition (eventKey → zulu de
  // inicio). Se resetean con resetOneShot (vuelo/fase nueva).
  private descentConditionState = new Map<string, { startedAt: number | null }>();

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
    this.descentConditionState.clear();
    this.stoppedSince = null;
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
      logger.ruleEvaluation("is_night_flight: sin hora de salida disponible; false", { flight: rawFlight });
      return false;
    }

    // Normalizar 24:xx (medianoche) a 00:xx.
    if (hourOfDay === 24) hourOfDay = 0;

    // 20:00 – 06:00 (vuelo nocturno).
    const isNight = hourOfDay >= 20 || hourOfDay < 6;
    logger.ruleEvaluation("is_night_flight:", {
      source,
      hourOfDay,
      formatted: `${String(hourOfDay).padStart(2, "0")}:00`,
      isNightFlight: isNight,
    });
    return isNight;
  }

  /**
   * Devuelve el progreso del crucero de 0.0 a 1.0 ("cuenta regresiva" por
   * distancia, inmune al TOD del ATC):
   *   faltante = distancia_restante / distancia_total; progreso = 1 - faltante.
   *
   * Fuentes: `flight.totalDistanceNm` (SimBrief route_distance o GC) y
   * `getDistanceToDestination()` (Haversine posición→destino). Sin datos de
   * distancia se usa el fallback legacy por tiempo (cruiseEntryTime /
   * cruiseTimeSeconds vs zuluTime). Fuera de CRUISE o sin datos devuelve 0.
   */
  public getCruiseProgress(context?: FlightContext): number {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return 0;
    const flight: any = ctx.getFlight?.() ?? {};
    const telemetry: any = ctx.getTelemetry?.() ?? {};
    let currentPhase: unknown = null;
    try {
      const fsm: any = ctx.getFSM?.() ?? {};
      currentPhase = fsm?.currentState ?? fsm?.getCurrentState?.() ?? null;
    } catch {}

    logger.ruleEvaluation('getCruiseProgress - estado:', {
      totalDistanceNm: flight.totalDistanceNm,
      cruiseTimeSeconds: flight.cruiseTimeSeconds,
      cruiseEntryTime: flight.cruiseEntryTime,
      currentZuluTime: telemetry.zuluTime ?? telemetry.zulu_time,
      currentPhase,
      schedulerPhase: this.currentFlightPhase(),
    });

    // La fase de vuelo la provee el Scheduler (inyectado vía setPhaseProvider).
    // Fallback: FlightContext.getFSM().currentState (estado UI "A".."D" o fase).
    const phase = this.currentFlightPhase();
    if (phase !== null) {
      if (phase !== "CRUISE") {
        logger.ruleEvaluation('getCruiseProgress: no estamos en CRUISE', { phase });
        return 0;
      }
    } else {
      try {
        const fsm: any = ctx.getFSM?.() ?? {};
        const current = fsm?.currentState ?? fsm?.getCurrentState?.() ?? null;
        if (current !== null && current !== "CRUISE") {
          logger.ruleEvaluation('getCruiseProgress: no estamos en CRUISE', { current });
          return 0;
        }
      } catch {}
    }

    // Vía principal: distancia ("cuenta regresiva").
    const totalNum = Number(flight.totalDistanceNm);
    if (flight.totalDistanceNm != null && !Number.isNaN(totalNum) && totalNum > 0) {
      const remaining = this.getDistanceToDestination(ctx);
      if (Number.isFinite(remaining) && remaining >= 0) {
        const progress = 1 - remaining / totalNum;
        logger.ruleEvaluation('getCruiseProgress cálculo (distancia):', {
          remainingNm: remaining,
          totalDistanceNm: totalNum,
          progress,
        });
        return Math.min(Math.max(progress, 0), 1);
      }
      logger.ruleEvaluation('getCruiseProgress: sin posición/destino para distancia', {
        totalDistanceNm: totalNum,
      });
      return 0;
    }

    // Fallback legacy por tiempo (compatibilidad sin SimBrief/distancia).
    const entryNum = Number(flight.cruiseEntryTime);
    const totalTimeNum = Number(flight.cruiseTimeSeconds);
    if (
      flight.cruiseTimeSeconds == null || flight.cruiseEntryTime == null ||
      Number.isNaN(totalTimeNum) || Number.isNaN(entryNum) || totalTimeNum <= 0
    ) {
      logger.ruleEvaluation('getCruiseProgress: faltan datos', {
        totalDistanceNm: flight.totalDistanceNm,
        cruiseTimeSeconds: flight.cruiseTimeSeconds,
        cruiseEntryTime: flight.cruiseEntryTime,
      });
      return 0;
    }

    const zuluTime = Number(telemetry.zuluTime ?? telemetry.zulu_time);
    const entry = entryNum;
    const total = totalTimeNum;
    if (Number.isNaN(zuluTime) || total <= 0) return 0;

    let elapsed = zuluTime - entry;
    // Wrap de medianoche: zuluTime son segundos del día UTC (0-86400). Si el
    // crucero empezó antes de medianoche y ya es el día siguiente, elapsed
    // sale negativo y el progreso se clava en 0 (caso real: cruiseEntryTime
    // 52681 = 14:37 UTC con zulu 3564 = 00:59 UTC del día siguiente).
    if (elapsed < 0) elapsed += 86400;
    const progress = elapsed / total;

    logger.ruleEvaluation('getCruiseProgress cálculo (tiempo, fallback):', {
      elapsed,
      cruiseTimeSeconds: flight.cruiseTimeSeconds,
      progress,
    });

    return Math.min(Math.max(progress, 0), 1);
  }

  /**
   * Faltante del crucero de 1.0 a 0.0 (inverso del progreso):
   *   faltante = distancia_restante / distancia_total.
   * Sin distancia total devuelve 1 (nada consumido). Los eventos con
   * `max_remaining` disparan cuando faltante <= max_remaining.
   */
  public getCruiseProgressRemaining(context?: FlightContext): number {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return 1;
    const flight: any = ctx.getFlight?.() ?? {};
    const totalNum = Number(flight.totalDistanceNm);
    if (flight.totalDistanceNm == null || Number.isNaN(totalNum) || totalNum <= 0) return 1;
    const remaining = this.getDistanceToDestination(ctx);
    if (!Number.isFinite(remaining) || remaining < 0) return 1;
    return Math.min(remaining / totalNum, 1);
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

  // ============================================================
  // RESTRICCIONES AVANZADAS CRUISE
  // ============================================================

  /**
   * Noche según la hora LOCAL actual del simulador (23:00–06:00).
   * Distinto de `isNightFlight()` (que estima noche por la hora programada
   * de salida y se usa para `preferred_condition`): este mide el "ahora"
   * para `exclude_if_night`.
   */
  public isNightNow(context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    const telemetry: any = ctx?.getTelemetry?.() ?? {};
    const localTime = Number(telemetry.localTime ?? 0);
    if (Number.isNaN(localTime)) return false;
    const localHour = Math.floor((localTime % 86400) / 3600);
    return localHour >= 23 || localHour < 6;
  }

  /** Si la aeronave es widebody (resuelto al importar SimBrief). */
  public isWidebodyAircraft(context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return false;
    const flight: any = ctx.getFlight?.() ?? {};
    return flight.aircraftIsWidebody === true;
  }

  /** Duración estimada del vuelo en minutos (de SimBrief). */
  public getFlightDurationMinutes(context?: FlightContext): number {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return 0;
    const flight: any = ctx.getFlight?.() ?? {};
    const v = Number(flight.durationMinutes ?? 0);
    return Number.isNaN(v) ? 0 : v;
  }

  // ============================================================
  // FUNCIONES CALCULADAS DESCENT
  // ============================================================

  /**
   * Tiempo restante de vuelo en minutos.
   * elapsed = telemetry.zuluTime - flight.scheduledTakeoffTime (segundos);
   * restante = durationMinutes - elapsed/60 (nunca negativo).
   * Sin datos devuelve 0.
   */
  public getRemainingTime(context?: FlightContext): number {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return 0;
    const flight: any = ctx.getFlight?.() ?? {};
    const telemetry: any = ctx.getTelemetry?.() ?? {};

    if (!flight.durationMinutes || !flight.scheduledTakeoffTime) return 0;

    const zulu = Number(telemetry.zuluTime ?? telemetry.zulu_time);
    const sched = Number(flight.scheduledTakeoffTime ?? flight.scheduled_takeoff_time);
    if (Number.isNaN(zulu) || Number.isNaN(sched)) return 0;

    // Wrap de medianoche (igual que getCruiseProgress): zulu y sched son
    // segundos del día UTC; si el despegue fue antes de medianoche, la
    // diferencia sale negativa y el restante superaría la duración total.
    let elapsedSeconds = zulu - sched;
    if (elapsedSeconds < 0) elapsedSeconds += 86400;
    const elapsedMinutes = elapsedSeconds / 60;
    return Math.max(0, Number(flight.durationMinutes) - elapsedMinutes);
  }

  /**
   * Distancia al destino en NM (fórmula de Haversine).
   * Usa telemetry.latitude/longitude vs flight.destLatitude/destLongitude.
   * Sin coordenadas devuelve NaN (desconocido), NO 0: 0 significaría "en
   * destino" y dispararía reglas tipo DISTANCE_TO_DESTINATION <= 70 a ciegas.
   * Los llamadores tratan NaN como "sin dato" (isFinite / || 0 en display).
   */
  public getDistanceToDestination(context?: FlightContext): number {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return NaN;
    const telemetry: any = ctx.getTelemetry?.() ?? {};
    const flight: any = ctx.getFlight?.() ?? {};

    const lat1d = Number(telemetry.latitude);
    const lon1d = Number(telemetry.longitude);
    const lat2d = Number(flight.destLatitude ?? flight.dest_latitude);
    const lon2d = Number(flight.destLongitude ?? flight.dest_longitude);
    if ([lat1d, lon1d, lat2d, lon2d].some((v) => Number.isNaN(v))) return NaN;
    if (!lat1d && !lon1d) return NaN;
    if (!lat2d && !lon2d) return NaN;

    const R = 3440.065; // Radio de la Tierra en NM
    const lat1 = lat1d * Math.PI / 180;
    const lat2 = lat2d * Math.PI / 180;
    const dLat = (lat2d - lat1d) * Math.PI / 180;
    const dLon = (lon2d - lon1d) * Math.PI / 180;

    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Verifica si el avión está por debajo de una altitud AGL usando RADIO HEIGHT.
   * RADIO HEIGHT solo da lectura válida por debajo de ~2,500 pies AGL:
   * si es 0 (fuera de rango) devuelve false para no disparar en crucero.
   */
  public isBelowAgl(thresholdFeet: number, context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    if (!ctx) return false;
    const telemetry: any = ctx.getTelemetry?.() ?? {};
    const radioHeight = Number(telemetry.radioHeight ?? telemetry.radio_height ?? 0);

    // Si radioHeight es 0, puede que estemos por encima del rango del radioaltímetro
    if (!radioHeight || Number.isNaN(radioHeight)) return false;

    return radioHeight <= thresholdFeet;
  }

  // ============================================================
  // TIEMPO DETENIDO (TAXI_TO_GATE)
  // ============================================================

  /** Zulu (s) en que el avión se detuvo; null si está en movimiento o sin datos. */
  private stoppedSince: number | null = null;

  /**
   * Devuelve el tiempo (en segundos) que el avión lleva detenido.
   * Menos de 1 nudo se considera detenido. Se resetea cuando el avión
   * vuelve a moverse. Con estado interno (stoppedSince) acumulativo entre
   * llamadas: llamar periódicamente (bucle de evaluación / monitor 1s).
   */
  public getTimeStopped(context?: FlightContext): number {
    const ctx: any = context ?? this.flightContext;
    if (!ctx) return 0;
    const telemetry: any = ctx?.getTelemetry?.() ?? {};
    const zuluTime = Number(telemetry.zuluTime ?? telemetry.zulu_time ?? 0) || 0;
    const groundspeed = Number(telemetry.groundspeed ?? telemetry.ground_speed ?? 0) || 0;

    // Umbral: menos de 1 nudo se considera detenido
    if (groundspeed < 1) {
      if (this.stoppedSince === null) {
        this.stoppedSince = zuluTime;
        logger.ruleEvaluation('Avión detenido, iniciando contador:', zuluTime);
      }
      let elapsed = zuluTime - this.stoppedSince;
      if (elapsed < 0) {
        // Salto hacia atrás del reloj del sim (p. ej. wrap de medianoche):
        // reiniciar el contador en vez de quedarse clavado en 0.
        this.stoppedSince = zuluTime;
        elapsed = 0;
      }
      return elapsed;
    } else {
      if (this.stoppedSince !== null) {
        logger.ruleEvaluation('Avión en movimiento, reseteando contador');
        this.stoppedSince = null;
      }
      return 0;
    }
  }

  /**
   * Lectura del tiempo detenido sin efectos secundarios (para el monitor).
   * No inicia ni resetea el contador; si aún no hay referencia devuelve 0.
   */
  public peekTimeStopped(context?: FlightContext): number {
    const ctx: any = context ?? this.flightContext;
    if (!ctx) return 0;
    const telemetry: any = ctx?.getTelemetry?.() ?? {};
    const groundspeed = Number(telemetry.groundspeed ?? telemetry.ground_speed ?? 0) || 0;
    if (!(groundspeed < 1)) return 0;
    if (this.stoppedSince === null) return 0;
    const zuluTime = Number(telemetry.zuluTime ?? telemetry.zulu_time ?? NaN);
    if (Number.isNaN(zuluTime)) return 0;
    return Math.max(0, zuluTime - this.stoppedSince);
  }

  /**
   * Evalúa la precondición `time_stopped` (p. ej. `taxitogate_crew_delay_apologies`):
   * dispara cuando el avión lleva detenido más de `time_stopped_gt` segundos.
   * Acepta `fsm` opcional para restringir a una fase (TAXI_TO_GATE).
   */
  private evaluateTimeStopped(conditions: any, step?: NarrativeStep, context?: FlightContext): boolean {
    const ctx: any = context ?? this.flightContext;
    const threshold = Number(conditions?.time_stopped_gt ?? conditions?.timeStoppedGt ?? 0);
    const timeStopped = this.getTimeStopped(ctx as FlightContext);
    let tel: any = {};
    try {
      tel = ctx?.getTelemetry?.() ?? {};
    } catch {
      tel = {};
    }
    let fsmOk = true;
    let currentState: unknown = null;
    if (conditions?.fsm) {
      try {
        const fsmInfo: any = ctx?.getFSM?.() ?? {};
        currentState = fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.() ?? null;
        const flightPhase = this.currentFlightPhase();
        const expected = String(conditions.fsm);
        fsmOk = String(currentState) === expected || (flightPhase !== null && flightPhase === expected);
      } catch {
        fsmOk = false;
      }
    }
    const ok = fsmOk && timeStopped > threshold;
    logger.ruleEvaluation('Evaluando time_stopped:', {
      eventKey: step?.eventKey ?? 'time_stopped',
      groundspeed: tel.groundspeed ?? tel.ground_speed,
      timeStopped,
      threshold,
      fsm: conditions?.fsm ?? null,
      currentState,
      fsmOk,
      result: ok,
    });
    return ok;
  }

  // ============================================================
  // MOTORES APAGADOS (AT_GATE)
  // ============================================================

  /**
   * Devuelve true si todos los motores están apagados.
   * Usa numberOfEngines para saber cuántos motores verificar (misma
   * semántica y aliases que allEnginesRunning: el motor 1 se resuelve
   * vía engineCombustion1/engCombustion1/engineRunning, imprescindible
   * porque el path MSFS/Rust reporta el motor 1 solo como engineRunning).
   * Sin dato de N exige motor 1 explícitamente apagado; con N=0 o sin
   * ningún dato devuelve false (no se puede determinar).
   */
  public areAllEnginesOff(context?: FlightContext): boolean {
    const ctx: any = context ?? this.flightContext;
    if (!ctx) return false;
    const telemetry: any = ctx?.getTelemetry?.() ?? {};
    const numEnginesRaw =
      telemetry.numberOfEngines ?? telemetry.numEngines ?? telemetry.number_of_engines;

    const isEngineOn = (index: number): boolean => {
      if (index === 1) {
        return (
          telemetry.engineCombustion1 ?? telemetry.engCombustion1 ?? telemetry.engineRunning
        ) === true;
      }
      return (
        telemetry[`engineCombustion${index}`] ?? telemetry[`engCombustion${index}`]
      ) === true;
    };

    if (numEnginesRaw === 0) return false; // No se puede determinar

    if (
      typeof numEnginesRaw !== 'number' ||
      !Number.isFinite(numEnginesRaw) ||
      numEnginesRaw <= 0
    ) {
      // Sin dato de N: fallback al motor 1, exigiendo apagado explícito
      // (undefined no basta: sin datos no se puede determinar).
      const motor1 =
        telemetry.engineCombustion1 ?? telemetry.engCombustion1 ?? telemetry.engineRunning;
      return motor1 === false;
    }

    for (let i = 1; i <= numEnginesRaw; i++) {
      if (isEngineOn(i)) return false; // Al menos uno está encendido
    }

    return true;
  }

  /**
   * Evalúa la precondición `all_engines_off` (p. ej. `atgate_capt_disarm_doors`).
   * Acepta `fsm` opcional para restringir a una fase (AT_GATE).
   */
  private evaluateAllEnginesOff(conditions: any, step?: NarrativeStep, context?: FlightContext): boolean {
    const ctx: any = context ?? this.flightContext;
    const expected = conditions?.all_engines_off ?? conditions?.allEnginesOff;
    const allOff = this.areAllEnginesOff(ctx as FlightContext);
    const ok = allOff === (expected !== false);
    let tel: any = {};
    try {
      tel = ctx?.getTelemetry?.() ?? {};
    } catch {
      tel = {};
    }
    logger.ruleEvaluation('Evaluando all_engines_off:', {
      eventKey: step?.eventKey ?? 'all_engines_off',
      expected,
      numberOfEngines: tel.numberOfEngines ?? tel.numEngines,
      engineCombustion1: tel.engineCombustion1 ?? tel.engCombustion1 ?? tel.engineRunning,
      engineCombustion2: tel.engCombustion2,
      engineCombustion3: tel.engCombustion3,
      engineCombustion4: tel.engCombustion4,
      allOff,
      result: ok,
    });
    return ok;
  }

  /**
   * Umbrales de progreso de crucero con soporte para el shape anidado del
   * Backoffice: `preconditions: {type: 'cruise_progress', conditions:
   * {conditions: {max_remaining: X}, allow_night: ...}}`.
   * Sin este unwrap, `max_remaining`/`min_progress` quedaban en undefined y
   * todo WAIT de crucero evaluaba TRUE al entrar en CRUISE (ráfaga de eventos).
   */
  private cruiseThresholds(conditions: any): { minRaw: unknown; maxRaw: unknown } {
    const c: any = conditions ?? {};
    const nested: any = c.conditions && typeof c.conditions === "object" ? c.conditions : {};
    return {
      minRaw: c.min_progress ?? nested.min_progress,
      maxRaw: c.max_remaining ?? nested.max_remaining,
    };
  }

  /**
   * Precondición de progreso de crucero. Dos formas (nueva arquitectura
   * "cuenta regresiva" convive con la legacy):
   *  - `max_remaining` (0.0–1.0): dispara cuando faltante <= max.
   *  - `min_progress` (0.0–1.0): dispara cuando progreso >= min (legacy).
   * Si hay ambas, deben cumplirse las dos. Sin ninguna, true.
   */
  private evaluateCruiseProgress(conditions: any, context?: FlightContext): boolean {
    const ctx = context ?? this.flightContext;
    const { minRaw, maxRaw } = this.cruiseThresholds(conditions);
    let ok = true;
    if (maxRaw !== undefined) {
      ok = this.getCruiseProgressRemaining(ctx) <= Number(maxRaw) && ok;
    }
    if (minRaw !== undefined) {
      ok = this.getCruiseProgress(ctx) >= Number(minRaw) && ok;
    }
    return ok;
  }

  /**
   * Reloj para ventanas sostenidas: zuluTime de telemetría si es válido (> 0),
   * si no reloj de pared. Sin ninguna referencia temporal no se puede medir
   * una duración (ver evaluateDescentCondition).
   */
  private sustainedClockS(context?: FlightContext): number | null {
    try {
      const tel: any = (context ?? this.flightContext)?.getTelemetry?.() ?? {};
      const z = Number(tel.zuluTime ?? tel.zulu_time);
      if (!Number.isNaN(z) && z > 0) return z;
      const w = Date.now() / 1000;
      return Number.isNaN(w) ? null : w;
    } catch {
      return null;
    }
  }

  /**
   * Precondición `descent_condition`: exige vertical_speed_lt sostenido
   * durante duration_above_threshold_sec (jitter-proof). Sin duración
   * requerida se evalúa directo. Si conditions.fsm está presente, también
   * exige la fase (Scheduler o letras FSM). Sin reloj disponible y con
   * duración requerida → false (no se puede medir; nunca true a ciegas).
   */
  private evaluateDescentCondition(step: NarrativeStep, conditions: any, context?: FlightContext): boolean {
    const ctx = context ?? this.flightContext;
    const eventKey = step.eventKey;
    const tel: any = (ctx as FlightContext)?.getTelemetry?.() ?? {};
    const currentVs = Number(tel.verticalSpeed ?? tel.vertical_speed ?? 0) || 0;
    const threshold = Number(conditions?.vertical_speed_lt ?? -1000);
    const durationRequired = Number(conditions?.duration_above_threshold_sec ?? 0) || 0;

    // Puerta de fase (si el escenario la declara): igual criterio que delay.
    if (conditions?.fsm) {
      const fsmInfo: any = (ctx as FlightContext)?.getFSM?.() ?? {};
      const currentState: string | undefined = fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.() ?? undefined;
      const flightPhase = this.currentFlightPhase();
      const expected = String(conditions.fsm);
      const ok = String(currentState) === expected || (flightPhase !== null && flightPhase === expected);
      if (!ok) {
        logger.ruleEvaluation('descent_condition: puerta fsm no cumplida, omitiendo:', {
          eventKey,
          fsmState: currentState ?? null,
          schedulerPhase: flightPhase,
          required: expected,
        });
        return false;
      }
    }

    // Sin duración requerida: evaluación directa.
    if (!(durationRequired > 0)) {
      return currentVs < threshold;
    }

    if (!this.descentConditionState.has(eventKey)) {
      this.descentConditionState.set(eventKey, { startedAt: null });
    }
    const state = this.descentConditionState.get(eventKey)!;

    // Condición violada → resetear ventana.
    if (!(currentVs < threshold)) {
      if (state.startedAt !== null) {
        logger.ruleEvaluation('descent_condition reseteado:', { eventKey, currentVs, threshold });
      }
      state.startedAt = null;
      return false;
    }

    const now = this.sustainedClockS(ctx as FlightContext);
    if (now === null) return false;

    // Condición cumplida por primera vez → abrir ventana (aún no basta).
    if (state.startedAt === null) {
      state.startedAt = now;
      logger.ruleEvaluation('descent_condition iniciado:', { eventKey, currentVs, threshold, startedAt: now });
      return false;
    }

    const elapsed = now - state.startedAt;
    // Guard anti-wrap: si el vuelo cruza medianoche UTC (o el reloj del sim
    // salta atrás) con la ventana abierta, elapsed sale negativo y `met`
    // quedaría en false para siempre. Se rebasea la ventana al reloj actual.
    if (elapsed < 0) {
      logger.ruleEvaluation('descent_condition: wrap de medianoche detectado, reseteando ventana:', {
        eventKey,
        currentZuluTime: now,
        startedAt: state.startedAt,
        elapsed,
      });
      state.startedAt = now;
      return false;
    }
    const met = elapsed >= durationRequired;
    logger.ruleEvaluation('descent_condition evaluando:', {
      eventKey, currentVs, threshold, elapsed, durationRequired, met,
    });
    return met;
  }

  /**
   * Lectura PURA (sin efectos) del estado sostenido para el monitor: no abre
   * ni resetea ventanas. elapsed null = ventana aún no abierta.
   */
  public peekDescentCondition(
    step: NarrativeStep,
    conditions: any,
    context?: FlightContext
  ): { vs: number; threshold: number; required: number; elapsed: number | null; met: boolean } {
    const ctx = context ?? this.flightContext;
    const tel: any = (ctx as FlightContext)?.getTelemetry?.() ?? {};
    const vs = Number(tel.verticalSpeed ?? tel.vertical_speed ?? 0) || 0;
    const threshold = Number(conditions?.vertical_speed_lt ?? -1000);
    const required = Number(conditions?.duration_above_threshold_sec ?? 0) || 0;
    if (!(required > 0)) return { vs, threshold, required, elapsed: null, met: vs < threshold };
    const startedAt = this.descentConditionState.get(step.eventKey)?.startedAt ?? null;
    if (startedAt === null || !(vs < threshold)) {
      return { vs, threshold, required, elapsed: null, met: false };
    }
    const now = this.sustainedClockS(ctx as FlightContext);
    if (now === null) return { vs, threshold, required, elapsed: null, met: false };
    // Coherencia con el guard anti-wrap del evaluador (que rebasea en el
    // próximo tick): nunca mostrar elapsed negativo.
    const elapsed = Math.max(0, now - startedAt);
    return { vs, threshold, required, elapsed, met: elapsed >= required };
  }

  /** Restricción `exclude_if_night`: excluye el paso en horario nocturno. */
  private evaluateExcludeIfNight(restrictions: any, context?: FlightContext): boolean {
    if (restrictions?.exclude_if_night !== true) return true;
    return !this.isNightNow(context ?? this.flightContext);
  }

  /** Restricción `aircraft_is_widebody`: solo fuselaje ancho. */
  private evaluateAircraftIsWidebody(restrictions: any, context?: FlightContext): boolean {
    if (restrictions?.aircraft_is_widebody !== true) return true;
    return this.isWidebodyAircraft(context ?? this.flightContext);
  }

  /** Restricción `flight_duration_minutes`: duración mínima en minutos. */
  private evaluateFlightDuration(restrictions: any, context?: FlightContext): boolean {
    const minDuration = restrictions?.flight_duration_minutes;
    if (!minDuration) return true;

    return this.getFlightDurationMinutes(context ?? this.flightContext) >= Number(minDuration);
  }

  /** Restricción `requires_international_flight`: solo vuelos internacionales. */
  private evaluateRequiresInternational(restrictions: any, context?: FlightContext): boolean {
    if (restrictions?.requires_international_flight !== true) return true;
    return this.isInternationalFlight(context ?? this.flightContext);
  }

  // ============================================================
  // TRANSICIÓN A DESCENSO
  // ============================================================

  /**
   * El evento `transition_to_descent` se activa cuando el avión abandona la
   * altitud de crucero y comienza a descender:
   *   (PLANE_ALTITUDE - FLIGHT_LEVEL) <= -1000
   *   AND CRUISE_PROGRESS >= 0.95
   *   AND VERTICAL_SPEED < -500
   */
  private evaluateTransitionToDescent(context?: FlightContext): boolean {
    const ctx: FlightContext | undefined = context ?? this.flightContext;
    const telemetry: any = ctx?.getTelemetry?.() ?? {};
    const flight: any = ctx?.getFlight?.() ?? {};

    const currentAltitude = Number(telemetry.altitude ?? 0) || 0;
    const flightLevel = Number(flight.cruiseAltitude ?? 0) || 0;
    const verticalSpeed = Number(telemetry.verticalSpeed ?? 0) || 0;
    const cruiseProgress = this.getCruiseProgress(ctx);

    const altitudeDrop = currentAltitude - flightLevel;

    const result =
      altitudeDrop <= -1000 &&
      cruiseProgress >= 0.95 &&
      verticalSpeed < -500;

    logger.ruleEvaluation('Evaluando transición a descenso:', {
      currentAltitude,
      flightLevel,
      altitudeDrop,
      cruiseProgress,
      verticalSpeed,
      result
    });

    return result;
  }

  // ============================================================
  // TRANSICIÓN A CRUCERO
  // ============================================================

  /**
   * Detalle puro (sin logs) de la transición CLIMB → CRUISE para el monitor.
   * Regla de Backoffice: ABS(PLANE_ALTITUDE - FLIGHT_LEVEL) <= 500, donde
   * FLIGHT_LEVEL = flight.cruiseAltitude (pies, de SimBrief route_altitude).
   *
   * NOTA altitud (discrepancia reportada 23.100 vs 23.600 ft): `altitude` viene
   * de `PLANE ALTITUDE` (altitud verdadera MSL). El panel del sim muestra
   * INDICATED (corregida por reglaje barométrico): con QNH distinto de STD
   * bajo la transición, o atmósfera no ISA en altura, difieren en cientos de
   * pies de forma normal. La tolerancia de 500 ft absorbe esa diferencia; no
   * cambiar de SimVar sin evidencia (ver grupo Transición a CRUISE).
   */
  public getCruiseTransitionDetail(context?: FlightContext): {
    currentAltitude: number | null;
    flightLevel: number | null;
    diff: number | null;
    threshold: number;
    met: boolean;
  } {
    const ctx: any = context ?? this.flightContext;
    const tel: any = ctx?.getTelemetry?.() ?? {};
    const fl: any = ctx?.getFlight?.() ?? {};
    const altRaw = Number(tel.altitude ?? tel.plane_altitude ?? NaN);
    const flRaw = Number(fl.cruiseAltitude ?? NaN);
    const currentAltitude = Number.isNaN(altRaw) ? null : altRaw;
    const flightLevel = Number.isNaN(flRaw) ? null : flRaw;
    const threshold = 500;
    const diff =
      currentAltitude !== null && flightLevel !== null
        ? Math.abs(currentAltitude - flightLevel)
        : null;
    return { currentAltitude, flightLevel, diff, threshold, met: diff !== null && diff <= threshold };
  }

  /**
   * Evalúa la transición a crucero con log de depuración
   * (misma regla que el scheduler_rule de Backoffice).
   */
  public evaluateTransitionToCruise(context?: FlightContext): boolean {
    const d = this.getCruiseTransitionDetail(context);
    logger.ruleEvaluation('Evaluando transition_to_cruise:', {
      currentAltitude: d.currentAltitude,
      flightLevel: d.flightLevel,
      diff: d.diff,
      threshold: d.threshold,
      result: d.met,
    });
    return d.met;
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
        logger.ruleEvaluation(`Skipping ${ev.eventKey}: max_once_per_flight ya ejecutado`);
        continue;
      }
      const isTriggered = step
        ? this.evaluateStep(step, context)
        : TriggerEvaluatorFactory.get(ev.triggerType).evaluate(ev, context);

      logger.ruleEvaluation("[RULE ENGINE]");
      logger.ruleEvaluation("Evaluating:");
      logger.ruleEvaluation(ev.eventKey);
      logger.ruleEvaluation("↓");
      if (step) {
        logger.ruleEvaluation("Source: NarrativeStep.scheduler_rule");
        logger.ruleEvaluation("SchedulerRule: " + (step.scheduler_rule ?? "(none, fallback trigger)"));
        if ((step as any).preconditions) {
          logger.ruleEvaluation("Preconditions: " + JSON.stringify((step as any).preconditions));
        }
      } else {
        logger.ruleEvaluation(evaluatorName(ev.triggerType));
      }
      logger.ruleEvaluation("↓");
      logger.ruleEvaluation(isTriggered ? "TRUE" : "FALSE");

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
      logger.ruleEvaluation('📦 Evaluando paso:', {
        eventKey: step.eventKey,
        hasPreconditions: !!(step as any).preconditions,
        hasSchedulerRule: !!(step as any).scheduler_rule,
        preconditions: (step as any).preconditions ?? null,
        schedulerRule: (step as any).scheduler_rule ?? null,
      });
    } catch {}
    // Guard one-shot
    if ((step as any).restrictions?.max_once_per_flight && this.executedEvents.has(step.eventKey)) {
      logger.ruleEvaluation(`evaluateStep bloqueado por max_once_per_flight: ${step.eventKey}`);
      return false;
    }

    // Si es el paso de transición a descenso: con preconditions configuradas
    // (Backoffice) se evalúan tal cual (phase_transition + conditions); sin
    // ellas se usa la lógica específica legacy (altitud + progreso + VS).
    // Sin este gate, la parametría publicada se ignoraba siempre y el monitor
    // (que sí lee las preconditions) podía verse en verde sin que el sistema
    // avanzara.
    if (step.eventKey === 'transition_to_descent') {
      const pre: any = (step as any).preconditions;
      if (pre) return this.evaluatePreconditions(step, context);
      return this.evaluateTransitionToDescent(context);
    }

    // Transición a crucero: ABS(PLANE_ALTITUDE - FLIGHT_LEVEL) <= 500
    // (misma regla que el scheduler_rule de Backoffice; el parser también la
    // soporta vía ABS() y FLIGHT_LEVEL, este atajo garantiza el disparo).
    if (step.eventKey === 'transition_to_cruise') {
      return this.evaluateTransitionToCruise(context);
    }

    // Si tiene preconditions tipo delay_detection, evaluarlas (WAIT_CONDITION logic)
    const preconditions: any = (step as any).preconditions;
    if (preconditions) {
      const preResult = this.evaluatePreconditions(step, context);
      // Si el tipo era delay_detection, evaluatePreconditions ya decidió; respetar su resultado
      if (preconditions.type === "delay_detection") {
        const triggered = this.executedEvents.has(step.eventKey) || this.getDelayEventState(step.eventKey).triggered;
        logger.ruleEvaluation(`Evaluando ${step.eventKey}:`, {
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

    // 2. Evaluar restricciones avanzadas CRUISE. Solo las claves presentes
    //    filtran (ausencia = true), por lo que los pasos sin restrictions
    //    mantienen el comportamiento anterior.
    const restrictions: any = (step as any).restrictions ?? {};
    if (!this.evaluateExcludeIfNight(restrictions, context)) {
      logger.ruleEvaluation(`${step.eventKey}: bloqueado por exclude_if_night (vuelo nocturno)`);
      return false;
    }
    if (!this.evaluateAircraftIsWidebody(restrictions, context)) {
      logger.ruleEvaluation(`${step.eventKey}: bloqueado por aircraft_is_widebody`);
      return false;
    }
    if (!this.evaluateFlightDuration(restrictions, context)) {
      logger.ruleEvaluation(`${step.eventKey}: bloqueado por flight_duration_minutes`);
      return false;
    }
    if (!this.evaluateRequiresInternational(restrictions, context)) {
      logger.ruleEvaluation(`${step.eventKey}: bloqueado por requires_international_flight`);
      return false;
    }
    try {
      logger.ruleEvaluation('Evaluando paso:', {
        eventKey: step.eventKey,
        cruiseProgress: this.getCruiseProgress(context),
        isNightFlight: this.isNightNow(context),
        isWidebody: this.isWidebodyAircraft(context),
        flightDuration: this.getFlightDurationMinutes(context),
        isInternational: this.isInternationalFlight(context),
        restrictions,
      });
    } catch {}

    const rule = step.scheduler_rule;

    if (!rule) {
      // Paso narrativo autosuficiente: preconditions + restricciones ya se
      // evaluaron con éxito arriba → TRUE sin consultar los trigger
      // evaluators (los stubs phase_enter/condition/timer retornan false
      // siempre y bloquearían el paso en polling infinito).
      if (preconditions) return true;
      // Sin preconditions ni regla: fallback al comportamiento hardcodeado
      // (evaluación por trigger del evento). Sin cambios respecto a antes.
      const event = EventCatalogService.get(step.eventKey);
      if (!event) return false;
      return TriggerEvaluatorFactory.get(event.triggerType).evaluate(event, context);
    }

    return this.evaluateSchedulerRule(rule, context, step.eventKey);
  }

  /**
   * ¿El paso está excluido por restricciones en este contexto?
   * Solo restricciones (noche, flota, duración, internacional). NO evalúa
   * preconditions, scheduler_rule ni one-shot: el llamador decide qué hacer
   * (p. ej. omitir un opcional excluido de noche en vez de esperar el alba).
   */
  isRestrictedOut(step: NarrativeStep, context?: FlightContext): boolean {
    try {
      const ctx = context ?? this.flightContext;
      const restrictions: any = (step as any).restrictions ?? {};
      if (!this.evaluateExcludeIfNight(restrictions, ctx as FlightContext)) return true;
      if (!this.evaluateAircraftIsWidebody(restrictions, ctx as FlightContext)) return true;
      if (!this.evaluateFlightDuration(restrictions, ctx as FlightContext)) return true;
      if (!this.evaluateRequiresInternational(restrictions, ctx as FlightContext)) return true;
      return false;
    } catch {
      return false;
    }
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
      logger.ruleEvaluation(`isDelayThresholdExceeded: evento no encontrado ${eventKey}`);
      return false;
    }

    if (!ctx) {
      logger.ruleEvaluation(`isDelayThresholdExceeded: sin FlightContext para ${eventKey}`);
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
    logger.ruleEvaluation(`📋 scheduledTakeoffTime:`, {
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
      logger.ruleEvaluation(`isDelayThresholdExceeded: datos insuficientes para ${eventKey}`, {
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
      logger.ruleEvaluation(`scheduledTakeoffTime normalizado epoch→segundos del día para ${eventKey}: ${st}`);
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
    logger.ruleEvaluation(`⏱️ Evaluando demora para ${eventKey}:`, {
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
    logger.ruleEvaluation(`Evaluando ${eventKey}:`, {
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
    const ctxTel: any = (context ?? this.flightContext as any)?.getTelemetry?.() ?? {};
    const ctxFlight: any = (context ?? this.flightContext as any)?.getFlight?.() ?? {};
    const currentAltitude = Number(ctxTel.altitude ?? ctxTel.plane_altitude ?? 0) || 0;
    const flightLevel = Number(ctxFlight.cruiseAltitude ?? 0) || 0;
    let distanceToDest: number | null = null;
    try {
      const dd = this.getDistanceToDestination((context ?? this.flightContext) as FlightContext);
      if (Number.isFinite(dd) && (dd as number) >= 0) distanceToDest = dd as number;
    } catch {
      distanceToDest = null;
    }
    logger.ruleEvaluation('Evaluando phase_transition:', {
      eventKey: step?.eventKey ?? 'transition_to_taxi',
      targetPhase: detail.targetPhase,
      // Campos de telemetría relevantes (incluye taxi_in: abandono de pista,
      // y at_gate: estacionado con freno y en parking)
      simOnGround: ctxTel.simOnGround ?? ctxTel.sim_on_ground,
      onAnyRunway: ctxTel.onAnyRunway,
      groundspeed: ctxTel.groundspeed ?? ctxTel.ground_speed,
      parkingBrake: ctxTel.parkingBrake ?? ctxTel.parking_brake,
      atcOnParkingSpot: ctxTel.atcOnParkingSpot ?? ctxTel.atc_on_parking_spot,
      // Campos de descenso (transition_to_descent)
      currentAltitude,
      flightLevel,
      altitudeDiff: currentAltitude - flightLevel,
      distanceToDest,
      verticalSpeed: Number(ctxTel.verticalSpeed ?? ctxTel.vertical_speed ?? 0) || 0,
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
      cruiseAltitude: unknown;
      verticalSpeed: unknown;
      distanceToDest: unknown;
    };
  } {
    const conds: any = conditions ?? {};
    const ctx: any = context ?? this.flightContext;
    const tel: any = ctx?.getTelemetry?.() ?? {};
    // Umbral de velocidad: preservar 0 como valor válido (groundspeed_gt: 0
    // significa "cualquier movimiento"). Solo usar 5 por defecto si no hay
    // valor configurado o no es numérico. (`Number(0) || 5` daría 5: bug.)
    const rawThreshold = conds.groundspeed_gt ?? conds.ground_velocity_gt ?? conds.groundspeedGt ?? 5;
    const parsedThreshold = Number(rawThreshold);
    const groundspeedThreshold = Number.isNaN(parsedThreshold) ? 5 : parsedThreshold;
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
    if (has('groundspeed_lt') || has('ground_velocity_lt') || has('groundspeedLt')) {
      // Límite superior de velocidad (p. ej. transition_to_at_gate con
      // groundspeed_lt: 0.5). NaN-safe y preserva 0 como valor válido.
      const rawLt = conds.groundspeed_lt ?? conds.ground_velocity_lt ?? conds.groundspeedLt;
      const parsedLt = Number(rawLt);
      const ltThreshold = Number.isNaN(parsedLt) ? 0 : parsedLt;
      const belowLt = (Number(groundspeed) || 0) < ltThreshold;
      items.push({ key: 'groundspeed_lt', label: `GROUND SPEED < ${ltThreshold}`, ok: belowLt, value: fmtGs(groundspeed) });
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
      items.push({ key: 'on_any_runway', label: expected === false ? 'NOT ON ANY RUNWAY' : 'ON ANY RUNWAY', ok: (onAnyRunway === true) === expected, value: String(onAnyRunway ?? '—') });
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
    // ── Transición a DESCENT (transition_to_descent) ────────────────────
    // altitude_diff_lt: (altitud actual − FL crucero) <= umbral (p. ej. -1000).
    // distance_to_dest_lt: distancia al destino (Haversine) <= umbral NM.
    // vertical_speed_lt: velocidad vertical < umbral (p. ej. -500 fpm).
    // Sin estas claves, `items` quedaba vacío y se caía a la receta clásica
    // de TAXI (en tierra), que en crucero nunca cumple: el ancla no avanzaba
    // aunque el monitor (vía scheduler_rule) se viera en verde.
    const flight: any = ctx?.getFlight?.() ?? {};
    const cruiseAltitude = Number(flight.cruiseAltitude ?? 0) || 0;
    const verticalSpeed = Number(tel.verticalSpeed ?? tel.vertical_speed ?? 0) || 0;
    let distanceToDest = NaN;
    try {
      const dd = this.getDistanceToDestination(ctx as FlightContext);
      if (Number.isFinite(dd) && (dd as number) >= 0) distanceToDest = dd as number;
    } catch {
      distanceToDest = NaN;
    }
    const fmtAlt = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(1)} ft`;
    if (has('altitude_diff_lt') || has('altitudeDiffLt')) {
      const rawTh = conds.altitude_diff_lt ?? conds.altitudeDiffLt;
      const threshold = Number(rawTh);
      const diff = (Number(altitude) || 0) - cruiseAltitude;
      const ok = !Number.isNaN(threshold) ? diff <= threshold : false;
      items.push({
        key: 'altitude_diff_lt',
        label: `ALT DIFF <= ${String(rawTh)} ft`,
        ok,
        value: `actual ${fmtAlt(diff)} (alt ${fmtAlt(Number(altitude) || 0)} − FL ${fmtAlt(cruiseAltitude)})`,
      });
    }
    if (has('distance_to_dest_lt') || has('distanceToDestLt')) {
      const rawTh = conds.distance_to_dest_lt ?? conds.distanceToDestLt;
      const threshold = Number(rawTh);
      const ok = !Number.isNaN(threshold) && Number.isFinite(distanceToDest)
        ? (distanceToDest as number) <= threshold
        : false;
      items.push({
        key: 'distance_to_dest_lt',
        label: `DIST DEST <= ${String(rawTh)} NM`,
        ok,
        value: Number.isFinite(distanceToDest) ? `actual ${(distanceToDest as number).toFixed(1)} NM` : 'actual: sin dato',
      });
    }
    if (has('vertical_speed_lt') || has('verticalSpeedLt')) {
      const rawTh = conds.vertical_speed_lt ?? conds.verticalSpeedLt;
      const threshold = Number(rawTh);
      const ok = !Number.isNaN(threshold) ? verticalSpeed < threshold : false;
      items.push({
        key: 'vertical_speed_lt',
        label: `VS < ${String(rawTh)} fpm`,
        ok,
        value: `actual ${Number.isInteger(verticalSpeed) ? verticalSpeed : verticalSpeed.toFixed(1)} fpm`,
      });
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
        cruiseAltitude,
        verticalSpeed,
        distanceToDest: Number.isFinite(distanceToDest) ? distanceToDest : null,
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
    result: { met: boolean | null; kind: string; rows: { label: string; ok: boolean | null; value: string }[]; summary: string }
  ): { met: boolean | null; kind: string; rows: { label: string; ok: boolean | null; value: string }[]; summary: string } {
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
    rows: { label: string; ok: boolean | null; value: string }[];
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
    if (pre.type === 'cruise_progress') {
      const c: any = pre.conditions ?? {};
      const rows: { label: string; ok: boolean | null; value: string }[] = [];
      let met: boolean | null = null;
      try {
        const prog = this.getCruiseProgress((context ?? this.flightContext) as FlightContext);
        const rem = this.getCruiseProgressRemaining((context ?? this.flightContext) as FlightContext);
        const { minRaw, maxRaw } = this.cruiseThresholds(c);
        const hasMin = minRaw !== undefined;
        const hasMax = maxRaw !== undefined;
        const okMin = hasMin ? prog >= Number(minRaw) : true;
        const okMax = hasMax ? rem <= Number(maxRaw) : true;
        rows.push({ label: 'EN CRUCERO (fase)', ok: prog > 0, value: `${(prog * 100).toFixed(0)}%` });
        // Umbrales configurados (objetivo) + valores actuales: nunca "Progreso >= —".
        if (hasMin) rows.push({ label: `UMBRAL min_progress: ${minRaw}`, ok: okMin, value: `actual ${prog.toFixed(2)}` });
        if (hasMax) rows.push({ label: `UMBRAL max_remaining: ${maxRaw}`, ok: okMax, value: `actual ${rem.toFixed(2)}` });
        rows.push({ label: 'PROGRESO actual', ok: okMin, value: prog.toFixed(2) });
        rows.push({ label: 'FALTANTE actual', ok: okMax, value: rem.toFixed(2) });
        met = okMin && okMax;
        // Si además trae scheduler_rule, anexar sus átomos en vivo.
        const rule = (step as any).scheduler_rule as string | null | undefined;
        if (typeof rule === "string" && rule.trim() !== "" && this.isTelemetryExpression(rule)) {
          const d = this.getSchedulerRuleDetail(rule, context);
          rows.push(...d.rows);
          if (d.met === false) met = false;
        }
      } catch {
        met = null;
      }
      return this.withNightRow(step, context, { met, kind, rows, summary: met === true ? 'Condiciones cumplidas' : met === false ? 'Condiciones NO cumplidas' : 'Sin datos suficientes' });
    }
    if (pre.type === 'time_stopped' || pre.type === 'timeStopped') {
      const c: any = pre.conditions ?? pre;
      const threshold = Number(c.time_stopped_gt ?? c.timeStoppedGt ?? 0);
      const rows: { label: string; ok: boolean; value: string }[] = [];
      let met: boolean | null = null;
      try {
        // Solo lectura (sin iniciar/resetear el contador de getTimeStopped).
        const stopped = this.peekTimeStopped((context ?? this.flightContext) as FlightContext);
        const ok = stopped > threshold;
        rows.push({ label: `TIME_STOPPED > ${threshold}s`, ok, value: `${stopped.toFixed(0)} s` });
        if (c.fsm) rows.push({ label: `FSM = ${String(c.fsm)}`, ok: true, value: 'ver evaluación' });
        met = ok;
      } catch {
        met = null;
      }
      return this.withNightRow(step, context, { met, kind, rows, summary: met === true ? 'Condiciones cumplidas' : met === false ? 'Condiciones NO cumplidas' : 'Sin datos suficientes' });
    }
    if (pre.type === 'all_engines_off' || pre.type === 'allEnginesOff') {
      const c: any = pre.conditions ?? pre;
      const expected = c.all_engines_off ?? c.allEnginesOff;
      const rows: { label: string; ok: boolean; value: string }[] = [];
      let met: boolean | null = null;
      try {
        const ctx: any = context ?? this.flightContext;
        const tel: any = ctx?.getTelemetry?.() ?? {};
        const allOff = this.areAllEnginesOff((context ?? this.flightContext) as FlightContext);
        const ok = allOff === (expected !== false);
        const eng = (i: number): string => {
          const v = i === 1
            ? (tel.engineCombustion1 ?? tel.engCombustion1 ?? tel.engineRunning)
            : (tel[`engineCombustion${i}`] ?? tel[`engCombustion${i}`]);
          return String(v ?? '—');
        };
        rows.push({ label: 'ALL ENGINES OFF', ok, value: String(allOff) });
        for (let i = 1; i <= 4; i++) {
          rows.push({ label: `ENG COMBUSTION ${i}`, ok: eng(i) === 'false', value: eng(i) });
        }
        if (c.fsm) rows.push({ label: `FSM = ${String(c.fsm)}`, ok: true, value: 'ver evaluación' });
        met = ok;
      } catch {
        met = null;
      }
      return this.withNightRow(step, context, { met, kind, rows, summary: met === true ? 'Condiciones cumplidas' : met === false ? 'Condiciones NO cumplidas' : 'Sin datos suficientes' });
    }
    // Otros tipos de precondiciones (landing_condition, preconditions sin
    // `type`, etc.): si el paso trae scheduler_rule de telemetría, desglosarla
    // para el monitor en vez de "sin desglose". descent_condition tiene su
    // propia rama abajo (ventana sostenida + regla si existe).
    const maybeRule = (step as any).scheduler_rule as string | null | undefined;
    if (pre?.type !== 'descent_condition' && typeof maybeRule === "string" && maybeRule.trim() !== "" && this.isTelemetryExpression(maybeRule)) {
      const d = this.getSchedulerRuleDetail(maybeRule, context);
      return this.withNightRow(step, context, {
        met: d.met,
        kind: 'scheduler_rule',
        rows: d.rows,
        summary: d.met === true ? 'Condiciones cumplidas (scheduler_rule)' : d.met === false ? 'Condiciones NO cumplidas (scheduler_rule)' : 'Sin datos suficientes (scheduler_rule)',
      });
    }
    // descent_condition (con o sin regla): ventana sostenida + átomos de la
    // regla si existe. Mismo patrón que cruise_progress: AMBAS deben cumplirse,
    // igual que en la ejecución (evaluatePreconditions + evaluateSchedulerRule).
    // Sin esto, un paso con regla en verde mostraba "cumplida" aunque la
    // ventana sostenida aún no cerrara.
    if (pre?.type === 'descent_condition') {
      const c: any = pre.conditions ?? {};
      const peek = this.peekDescentCondition(step, c, context);
      const rows: { label: string; ok: boolean | null; value: string }[] = [
        { label: 'VERTICAL_SPEED', ok: peek.vs < peek.threshold, value: `${Number.isInteger(peek.vs) ? peek.vs : peek.vs.toFixed(1)} fpm` },
        { label: `VS < ${peek.threshold}`, ok: peek.vs < peek.threshold, value: peek.vs < peek.threshold ? 'sí' : 'no' },
      ];
      if (peek.required > 0) {
        rows.push({
          label: `SOSTENIDO >= ${peek.required}s`,
          ok: peek.met,
          value: peek.elapsed === null ? 'ventana no abierta' : `${peek.elapsed.toFixed(0)}s / ${peek.required}s`,
        });
      }
      let met: boolean | null = peek.met;
      if (typeof maybeRule === "string" && maybeRule.trim() !== "" && this.isTelemetryExpression(maybeRule)) {
        const d = this.getSchedulerRuleDetail(maybeRule, context);
        rows.push(...d.rows);
        if (d.met === false) met = false;
      }
      return this.withNightRow(step, context, {
        met,
        kind: 'descent_condition',
        rows,
        summary: met ? 'Condiciones cumplidas (descent_condition)' : 'Condiciones NO cumplidas (descent_condition)',
      });
    }
    return this.withNightRow(step, context, { met: null, kind, rows: [], summary: `Tipo '${kind}' sin desglose` });
  }

  // ── Tipos del desglose estructurado para el monitor ────────────────────

  /**
   * Desglose estructurado de un paso WAIT_CONDITION para el DebugMonitor.
   * Secciones:
   *  - REGLA DEL SCHEDULER: fórmula configurada + check global + cada
   *    variable de la fórmula con valor configurado (en el átomo) y actual.
   *  - PRECONDICIONES (<tipo>): filas del evaluador especializado.
   *  - CONDITIONS (grupo): cada variable del grupo `conditions` con valor
   *    configurado y valor actual usado para determinar si se cumple.
   *  - RESTRICCIONES: cada restricción con valor configurado y actual.
   * `ok: null` = sin dato / solo informativo (el monitor lo muestra como ❓).
   * `executedChecker` resuelve "ya ejecutado" (monitor: RuleEngine +
   * NarrativeEngine); por defecto solo el registro interno. Sin efectos
   * secundarios.
   */
  public explainWaitStep(
    step: NarrativeStep,
    context?: FlightContext,
    executedChecker?: (eventKey: string) => boolean
  ): {
    met: boolean | null;
    kind: string;
    summary: string;
    sections: Array<{
      title: string;
      formula?: string;
      met: boolean | null;
      rows: Array<{ label: string; ok: boolean | null; value: string }>;
    }>;
  } {
    const detail = this.evaluateWaitConditionDetail(step, context);
    const sections: Array<{
      title: string;
      formula?: string;
      met: boolean | null;
      rows: Array<{ label: string; ok: boolean | null; value: string }>;
    }> = [];
    const isDone = (key: string): boolean => {
      try {
        if (executedChecker && executedChecker(key)) return true;
      } catch {}
      try {
        return this.executedEvents.has(key);
      } catch {
        return false;
      }
    };

    // 1. Regla del scheduler (fórmula + check + variables).
    const rule = (step as any).scheduler_rule as string | null | undefined;
    const hasRule = typeof rule === "string" && rule.trim() !== "";
    if (hasRule) {
      const formula = (rule as string).trim();
      if (detail.kind === "scheduler_rule") {
        // El desglose base ya son los átomos de la regla: reutilizar.
        sections.push({ title: "REGLA DEL SCHEDULER", formula, met: detail.met, rows: detail.rows });
      } else if (this.isTelemetryExpression(formula)) {
        const d = this.getSchedulerRuleDetail(formula, context);
        sections.push({ title: "REGLA DEL SCHEDULER", formula, met: d.met, rows: d.rows });
      } else {
        sections.push({
          title: "REGLA DEL SCHEDULER",
          formula,
          met: detail.met,
          rows: [{ label: "Regla no-telemetría (fecha/hora/cron)", ok: null, value: "se evalúa al activar el paso" }],
        });
      }
    }

    // 2. Precondiciones (filas del evaluador especializado). Si el desglose
    // base ya era la regla, no duplicar esas filas aquí.
    const pre: any = (step as any).preconditions;
    if (!pre && !hasRule) {
      sections.push({
        title: "PRECONDICIONES",
        met: detail.met,
        rows: [{ label: "Sin precondiciones configuradas", ok: null, value: "el paso no espera ninguna condición" }],
      });
    } else if (detail.kind !== "scheduler_rule" && detail.kind !== "none") {
      sections.push({ title: `PRECONDICIONES (${detail.kind})`, met: detail.met, rows: detail.rows });
    }

    // 3. Grupo `conditions`: todas sus variables con configurado vs actual.
    const condRows = this.buildConditionsGroupRows(step, context, isDone);
    if (condRows.length > 0) {
      sections.push({ title: "CONDITIONS (grupo)", met: andOk(condRows), rows: condRows });
    }

    // 4. Restricciones: todas con configurado vs actual.
    const restRows = this.buildRestrictionsRows(step, context, isDone);
    if (restRows.length > 0) {
      sections.push({ title: "RESTRICCIONES", met: andOk(restRows), rows: restRows });
    }

    return { met: detail.met, kind: detail.kind, summary: detail.summary, sections };
  }

  /**
   * Desglosa cada entrada del grupo `conditions` (preconditions.conditions o
   * el propio objeto preconditions sin `type`) con valor configurado y valor
   * actual. Claves ya representadas en las filas especializadas de
   * cruise_progress (min_progress/max_remaining) se omiten para no duplicar.
   */
  private buildConditionsGroupRows(
    step: NarrativeStep,
    context?: FlightContext,
    isDone?: (eventKey: string) => boolean
  ): Array<{ label: string; ok: boolean | null; value: string }> {
    const pre: any = (step as any).preconditions;
    if (!pre || typeof pre !== "object") return [];
    const src: any = pre.conditions && typeof pre.conditions === "object" ? pre.conditions : pre;
    if (!src || typeof src !== "object") return [];
    // Shape anidado del Backoffice: conditions: {conditions: {max_remaining},
    // allow_night}. Se desciende un nivel para evaluar los umbrales reales en
    // vez de mostrar el objeto como blob informativo.
    const nested: any =
      src.conditions && typeof src.conditions === "object" && !Array.isArray(src.conditions)
        ? src.conditions
        : null;
    const entries: Array<[string, unknown]> = [];
    if (nested) {
      for (const [k, v] of Object.entries(nested)) entries.push([k, v]);
      for (const [k, v] of Object.entries(src)) {
        if (k === "type" || k === "conditions") continue;
        entries.push([k, v]);
      }
    } else {
      for (const [k, v] of Object.entries(src)) entries.push([k, v]);
    }
    const coversThresholds = pre?.type === "cruise_progress";
    const rows: Array<{ label: string; ok: boolean | null; value: string }> = [];
    let ctx: any = null;
    let tel: any = {};
    let flight: any = {};
    try {
      ctx = context ?? this.flightContext;
      tel = ctx?.getTelemetry?.() ?? {};
      flight = ctx?.getFlight?.() ?? {};
    } catch {
      tel = {};
      flight = {};
    }
    const fmtBool = (v: unknown): string =>
      v === true ? "true" : v === false ? "false" : "sin dato";
    const phaseNow = (): string | null => {
      try {
        const provided = this.currentFlightPhase();
        if (provided) return provided;
        const f: any = ctx?.getFSM?.() ?? {};
        const raw = f?.currentState ?? f?.getCurrentState?.() ?? null;
        return raw !== undefined && raw !== null && String(raw) !== "" ? String(raw) : null;
      } catch {
        return null;
      }
    };
    for (const [key, expected] of entries) {
      if (key === "type") continue;
      // Cubiertas por las filas especializadas de cruise_progress (UMBRAL …);
      // en cualquier otro tipo se evalúan aquí de forma genérica.
      if ((key === "min_progress" || key === "max_remaining") && coversThresholds) continue;
      // vertical_speed_lt bajo descent_condition lo cubren las filas SOSTENIDO
      // (ventana anti-jitter); la fila directa contradiría esa semántica.
      if (key === "vertical_speed_lt" && (pre as any)?.type === "descent_condition") continue;
      try {
        switch (key) {
          case "min_progress": {
            const prog = this.getCruiseProgress(ctx as FlightContext);
            const th = Number(expected);
            rows.push({
              label: `min_progress >= ${String(expected)}`,
              ok: Number.isNaN(th) ? null : prog >= th,
              value: `actual: ${prog.toFixed(2)}`,
            });
            break;
          }
          case "max_remaining": {
            const rem = this.getCruiseProgressRemaining(ctx as FlightContext);
            const th = Number(expected);
            rows.push({
              label: `max_remaining <= ${String(expected)}`,
              ok: Number.isNaN(th) ? null : rem <= th,
              value: `actual: ${rem.toFixed(2)}`,
            });
            break;
          }
          case "fsm": {
            const actual = phaseNow();
            rows.push({
              label: `fsm = ${String(expected)}`,
              ok: actual === null ? null : actual === String(expected),
              value: `actual: ${actual ?? "sin dato"}`,
            });
            break;
          }
          case "phase_entered":
            rows.push({ label: "phase_entered", ok: null, value: `configurado: ${fmtBool(expected)}` });
            break;
          case "previous_event": {
            const done = isDone ? isDone(String(expected)) : null;
            rows.push({
              label: `previous_event = ${String(expected)}`,
              ok: done,
              value: done === null ? "sin registro de ejecución" : `ya ejecutado: ${done ? "sí" : "no"}`,
            });
            break;
          }
          case "is_international": {
            const actual = this.isInternationalFlight(ctx as FlightContext);
            rows.push({
              label: "is_international",
              ok: actual === (expected !== false),
              value: `configurado: ${fmtBool(expected)} · actual: ${actual ? "sí" : "no"}`,
            });
            break;
          }
          case "vertical_speed_lt": {
            const vs = Number(tel.verticalSpeed ?? tel.vertical_speed ?? 0) || 0;
            const th = Number(expected);
            rows.push({
              label: `vertical_speed < ${String(expected)}`,
              ok: Number.isNaN(th) ? null : vs < th,
              value: `actual: ${Number.isInteger(vs) ? vs : vs.toFixed(1)} fpm`,
            });
            break;
          }
          case "duration_above_threshold_sec": {
            // Ventana sostenida con la MISMA semántica que la evaluación real
            // (peek puro: no abre ni resetea ventanas).
            const peek = this.peekDescentCondition(step, src, ctx as FlightContext);
            const vsFmt = Number.isInteger(peek.vs) ? peek.vs : peek.vs.toFixed(1);
            rows.push({
              label: `SOSTENIDO VS < ${peek.threshold} durante >= ${String(expected)}s`,
              ok: peek.met,
              value: peek.elapsed === null
                ? `ventana no abierta · actual ${vsFmt} fpm`
                : `${peek.elapsed.toFixed(0)}s / ${peek.required}s · actual ${vsFmt} fpm`,
            });
            break;
          }
          case "altitude_below": {
            const alt = Number(tel.altitude ?? tel.plane_altitude ?? NaN);
            const th = Number(expected);
            rows.push({
              label: `altitude <= ${String(expected)} ft`,
              ok: Number.isNaN(alt) || Number.isNaN(th) ? null : alt <= th,
              value: Number.isNaN(alt) ? "actual: sin dato" : `actual: ${Number.isInteger(alt) ? alt : alt.toFixed(1)} ft`,
            });
            break;
          }
          case "ground_velocity_lt":
          case "groundspeed_lt": {
            const gs = Number(tel.groundspeed ?? tel.ground_speed ?? NaN);
            const th = Number(expected);
            rows.push({
              label: `groundspeed < ${String(expected)}`,
              ok: Number.isNaN(gs) || Number.isNaN(th) ? null : gs < th,
              value: Number.isNaN(gs) ? "actual: sin dato" : `actual: ${Number.isInteger(gs) ? gs : gs.toFixed(1)} kt`,
            });
            break;
          }
          case "sim_on_ground": {
            const raw = tel.simOnGround ?? tel.sim_on_ground;
            rows.push({
              label: `sim_on_ground = ${fmtBool(expected)}`,
              ok: typeof raw !== "boolean" ? null : raw === (expected !== false),
              value: `actual: ${fmtBool(raw)}`,
            });
            break;
          }
          case "atc_on_parking_spot": {
            const raw = tel.atcOnParkingSpot ?? tel.atc_on_parking_spot;
            rows.push({
              label: `atc_on_parking_spot = ${fmtBool(expected)}`,
              ok: typeof raw !== "boolean" ? null : raw === (expected !== false),
              value: `actual: ${fmtBool(raw)}`,
            });
            break;
          }
          case "all_engines_off": {
            const actual = this.areAllEnginesOff(ctx as FlightContext);
            rows.push({
              label: `all_engines_off = ${fmtBool(expected)}`,
              ok: actual === (expected !== false),
              value: `actual: ${actual ? "apagados" : "encendidos"}`,
            });
            break;
          }
          case "time_stopped_gt": {
            const stopped = this.peekTimeStopped(ctx as FlightContext);
            const th = Number(expected);
            rows.push({
              label: `time_stopped > ${String(expected)}s`,
              ok: Number.isNaN(th) ? null : stopped > th,
              value: `actual: ${stopped.toFixed(0)}s`,
            });
            break;
          }
          case "seatbelt_on": {
            const raw = tel.seatbeltOn ?? tel.seatbelt_on;
            rows.push({
              label: `seatbelt_on = ${fmtBool(expected)}`,
              ok: typeof raw !== "boolean" ? null : raw === (expected !== false),
              value: `actual: ${fmtBool(raw)} (SEATBELT_SWITCH: ${raw ? 1 : 0})`,
            });
            break;
          }
          case "target_phase":
            rows.push({ label: `target_phase = ${String(expected)}`, ok: null, value: "fase objetivo del ancla" });
            break;
          case "altitude_diff_lt": {
            const fl = Number((flight as any)?.cruiseAltitude ?? NaN);
            const alt = Number(tel.altitude ?? tel.plane_altitude ?? NaN);
            const th = Number(expected);
            const ok = !Number.isNaN(fl) && !Number.isNaN(alt) && !Number.isNaN(th)
              ? alt - fl <= th
              : null;
            rows.push({
              label: `altitude_diff <= ${String(expected)} ft`,
              ok,
              value: !Number.isNaN(fl) && !Number.isNaN(alt)
                ? `actual: ${alt - fl} ft (alt ${alt} − FL ${fl})`
                : "actual: sin dato",
            });
            break;
          }
          case "distance_to_dest_lt": {
            let dd = NaN;
            try {
              const v = this.getDistanceToDestination(ctx as FlightContext);
              if (Number.isFinite(v) && (v as number) >= 0) dd = v as number;
            } catch {
              dd = NaN;
            }
            const th = Number(expected);
            rows.push({
              label: `distance_to_dest <= ${String(expected)} NM`,
              ok: !Number.isNaN(th) && Number.isFinite(dd) ? (dd as number) <= th : null,
              value: Number.isFinite(dd) ? `actual: ${(dd as number).toFixed(1)} NM` : "actual: sin dato",
            });
            break;
          }
          case "vertical_speed_lt": {
            const vs = Number(tel.verticalSpeed ?? tel.vertical_speed ?? NaN);
            const th = Number(expected);
            rows.push({
              label: `vertical_speed < ${String(expected)} fpm`,
              ok: Number.isNaN(vs) || Number.isNaN(th) ? null : vs < th,
              value: Number.isNaN(vs) ? "actual: sin dato" : `actual: ${vs} fpm`,
            });
            break;
          }
          default:
            rows.push({ label: String(key), ok: null, value: `configurado: ${safeJson(expected)}` });
            break;
        }
      } catch {
        rows.push({ label: String(key), ok: null, value: `configurado: ${safeJson(expected)} (error al leer actual)` });
      }
    }
    return rows;
  }

  /**
   * Desglosa cada restricción del paso con valor configurado y valor actual
   * usado para determinar si se cumple. Misma semántica que la evaluación
   * real (evaluateExcludeIfNight / AircraftIsWidebody / FlightDuration /
   * RequiresInternational + one-shots).
   */
  private buildRestrictionsRows(
    step: NarrativeStep,
    context?: FlightContext,
    isDone?: (eventKey: string) => boolean
  ): Array<{ label: string; ok: boolean | null; value: string }> {
    const r: any = (step as any).restrictions;
    if (!r || typeof r !== "object") return [];
    const rows: Array<{ label: string; ok: boolean | null; value: string }> = [];
    let ctx: any = null;
    try {
      ctx = context ?? this.flightContext;
    } catch {
      ctx = null;
    }
    for (const [key, expected] of Object.entries(r)) {
      try {
        switch (key) {
          case "max_once_per_flight": {
            const done = isDone ? isDone(step.eventKey) : null;
            rows.push({
              label: "max_once_per_flight",
              ok: done === null ? null : !(expected === true && done),
              value: `configurado: ${String(expected)} · ya ejecutado: ${done === null ? "sin dato" : done ? "sí" : "no"}`,
            });
            break;
          }
          case "flight_duration_minutes": {
            const actual = this.getFlightDurationMinutes(ctx as FlightContext);
            const req = Number(expected);
            rows.push({
              label: `duración vuelo >= ${String(expected)} min`,
              ok: Number.isNaN(req) ? null : actual >= req,
              value: `actual: ${actual} min`,
            });
            break;
          }
          case "requires_international_flight": {
            const actual = this.isInternationalFlight(ctx as FlightContext);
            rows.push({
              label: "requires_international_flight",
              ok: expected !== true ? true : actual,
              value: `configurado: ${String(expected)} · actual: ${actual ? "internacional" : "doméstico"}`,
            });
            break;
          }
          case "aircraft_is_widebody": {
            const actual = this.isWidebodyAircraft(ctx as FlightContext);
            rows.push({
              label: "aircraft_is_widebody",
              ok: expected !== true ? true : actual,
              value: `configurado: ${String(expected)} · actual: ${actual ? "widebody" : "narrowbody"}`,
            });
            break;
          }
          case "exclude_if_night": {
            const night = this.isNightNow(ctx as FlightContext);
            rows.push({
              label: "exclude_if_night",
              ok: expected !== true ? true : !night,
              value: `configurado: ${String(expected)} · ahora: ${night ? "noche (excluido)" : "día"}`,
            });
            break;
          }
          case "preferred_condition":
            rows.push({
              label: `preferred_condition = ${String(expected)}`,
              ok: null,
              value: expected === "is_night_flight"
                ? `noche programada: ${this.isNightFlight(ctx as FlightContext) ? "sí" : "no"} (solo informativa: de día se omite)`
                : "solo informativa",
            });
            break;
          case "requires_previous": {
            const done = isDone ? isDone(String(expected)) : null;
            rows.push({
              label: `requires_previous = ${String(expected)}`,
              ok: done,
              value: done === null ? "sin registro de ejecución" : `previo ejecutado: ${done ? "sí" : "no"}`,
            });
            break;
          }
          default:
            rows.push({ label: String(key), ok: null, value: `configurado: ${safeJson(expected)}` });
            break;
        }
      } catch {
        rows.push({ label: String(key), ok: null, value: `configurado: ${safeJson(expected)} (error al leer actual)` });
      }
    }
    return rows;
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

    if (preconditions.type === 'cruise_progress') {
      const conditions = preconditions.conditions ?? preconditions;
      const ok = this.evaluateCruiseProgress(conditions, context);
      const { minRaw, maxRaw } = this.cruiseThresholds(conditions);
      logger.ruleEvaluation(`Evaluando cruise_progress para ${step.eventKey}:`, {
        eventKey: step.eventKey,
        minProgress: minRaw ?? null,
        maxRemaining: maxRaw ?? null,
        cruiseProgress: this.getCruiseProgress(context ?? this.flightContext),
        cruiseRemaining: this.getCruiseProgressRemaining(context ?? this.flightContext),
        decision: ok ? "✅ EJECUTAR" : "❌ OMITIR (progreso insuficiente)",
      });
      return ok;
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
          logger.ruleEvaluation('Evaluando taxi delay:', {
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
      logger.ruleEvaluation(`📋 Condiciones para ${step.eventKey}:`, {
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
          logger.ruleEvaluation(`Precondición fsm no cumplida para ${step.eventKey}: esperado ${conditions.fsm}, actual fsm=${currentState} fase=${flightPhase ?? "—"}`);
          extraConditionsMet = false;
        }
      }
      if (conditions.sim_on_ground !== undefined) {
        const ok = simOnGround === conditions.sim_on_ground;
        if (!ok) {
          logger.ruleEvaluation(`Precondición sim_on_ground no cumplida para ${step.eventKey}: esperado ${conditions.sim_on_ground}, actual ${simOnGround}`);
          extraConditionsMet = false;
        }
      }
      if (conditions.atc_on_parking_spot !== undefined || conditions.atcOnParkingSpot !== undefined) {
        const expected = conditions.atc_on_parking_spot ?? conditions.atcOnParkingSpot;
        const ok = atcOnParkingSpot === expected;
        if (!ok) {
          logger.ruleEvaluation(`Precondición atc_on_parking_spot no cumplida para ${step.eventKey}: esperado ${expected}, actual ${atcOnParkingSpot}`);
          extraConditionsMet = false;
        }
      }
      if (conditions.ground_velocity_lt !== undefined) {
        const ok = groundspeed < conditions.ground_velocity_lt;
        if (!ok) {
          logger.ruleEvaluation(`Precondición ground_velocity_lt no cumplida para ${step.eventKey}: ${groundspeed} >= ${conditions.ground_velocity_lt}`);
          extraConditionsMet = false;
        }
      }
      // Alias snake/camel por compatibilidad
      if (conditions.groundspeed_lt !== undefined) {
        const ok = groundspeed < conditions.groundspeed_lt;
        if (!ok) {
          logger.ruleEvaluation(`Precondición groundspeed_lt no cumplida para ${step.eventKey}: ${groundspeed} >= ${conditions.groundspeed_lt}`);
          extraConditionsMet = false;
        }
      }

      // ── LOG resultado final ─────────────────────────────────────────────────
      const ejecutar = tiempoCondicion && extraConditionsMet;
      logger.ruleEvaluation(`📋 Resultado para ${step.eventKey}:`, {
        tiempoCondicion,
        condicionesExtra: extraConditionsMet,
        ejecutar,
        decision: ejecutar ? "✅ EJECUTAR evento de demora" : "❌ NO ejecutar (condición no cumplida)",
      });

      return ejecutar;
    }

    if (preconditions.type === 'time_stopped' || preconditions.type === 'timeStopped') {
      const conditions = preconditions.conditions ?? preconditions;
      return this.evaluateTimeStopped(conditions, step, context);
    }

    if (preconditions.type === 'all_engines_off' || preconditions.type === 'allEnginesOff') {
      const conditions = preconditions.conditions ?? preconditions;
      return this.evaluateAllEnginesOff(conditions, step, context);
    }

    if (preconditions.type === 'descent_condition') {
      const conditions = preconditions.conditions ?? preconditions;
      return this.evaluateDescentCondition(step, conditions, context);
    }

    // time_stopped_gt / all_engines_off también pueden acompañar a otros tipos
    // de precondición (condiciones adicionales, no exclusivas de su type).
    const genericConds: any = preconditions.conditions ?? preconditions;
    const hasStoppedKey =
      genericConds?.time_stopped_gt !== undefined || genericConds?.timeStoppedGt !== undefined;
    const hasEnginesOffKey =
      genericConds?.all_engines_off !== undefined || genericConds?.allEnginesOff !== undefined;
    if (hasStoppedKey || hasEnginesOffKey) {
      let ok = true;
      if (hasStoppedKey) ok = this.evaluateTimeStopped(genericConds, step, context) && ok;
      if (hasEnginesOffKey) ok = this.evaluateAllEnginesOff(genericConds, step, context) && ok;
      return ok;
    }

    // Modificadores sueltos (con o sin `type`): puerta de fase + umbrales
    // directos. Los tipos con evaluador propio ya retornaron arriba, así que
    // esto solo afecta a typeless (p. ej. descent_capt_10kfeet) y tipos sin
    // evaluador específico (p. ej. landing_condition: al menos su fsm).
    const mods: any = preconditions.conditions ?? preconditions;
    if (mods && typeof mods === 'object') {
      const ctxM: any = context ?? this.flightContext;
      const telM: any = ctxM?.getTelemetry?.() ?? {};
      if (mods.fsm) {
        const fsmInfo: any = ctxM?.getFSM?.() ?? {};
        const currentState = fsmInfo?.currentState ?? fsmInfo?.getCurrentState?.() ?? undefined;
        const flightPhase = this.currentFlightPhase();
        const expected = String(mods.fsm);
        const fsmOk = String(currentState) === expected || (flightPhase !== null && flightPhase === expected);
        if (!fsmOk) {
          logger.ruleEvaluation(`Precondición fsm no cumplida para ${step.eventKey}: esperado ${expected}, actual fsm=${currentState} fase=${flightPhase ?? '—'}`);
          return false;
        }
      }
      if (mods.altitude_below !== undefined) {
        if (!this.evaluateAltitudeBelow(mods, context)) return false;
      }
      // vertical_speed_lt DIRECTO solo fuera de descent_condition (ese tipo ya
      // se evaluó arriba con ventana sostenida anti-jitter).
      if (mods.vertical_speed_lt !== undefined && preconditions.type !== 'descent_condition') {
        const vs = Number(telM.verticalSpeed ?? telM.vertical_speed ?? 0) || 0;
        if (!(vs < Number(mods.vertical_speed_lt))) {
          logger.ruleEvaluation(`Precondición vertical_speed_lt no cumplida para ${step.eventKey}: actual ${vs} >= ${mods.vertical_speed_lt}`);
          return false;
        }
      }
    }

    // Otros tipos de precondiciones: por defecto pasar (extensible)
    return true;
  }

  /**
   * Umbral de altitud (p. ej. `descent_capt_10kfeet` con `altitude_below`).
   * Dispara cuando la altitud actual <= umbral. Fail-closed con umbral
   * inválido. Sin efectos secundarios.
   */
  private evaluateAltitudeBelow(conditions: any, context?: FlightContext): boolean {
    const rawThreshold = conditions?.altitude_below;
    const threshold = Number(rawThreshold);
    const ctx: any = context ?? this.flightContext;
    const tel: any = ctx?.getTelemetry?.() ?? {};
    const altitude = Number(tel.altitude ?? tel.plane_altitude ?? 0) || 0;
    const result = !Number.isNaN(threshold) ? altitude <= threshold : false;
    logger.ruleEvaluation('Evaluando altitude_below:', {
      currentAltitude: altitude,
      threshold: rawThreshold,
      result,
    });
    return result;
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
    "VERTICAL_SPEED",
    "RADIO_HEIGHT",
    "GEAR_DOWN",
    "SEATBELT_SWITCH",
    "FLIGHT_LEVEL",
    // Calculadas/proveídas (sin ellas isTelemetryExpression devolvía false y
    // reglas como "FSM == 'DESCENT'" o "REMAINING_TIME <= 5" ni se intentaban).
    "CRUISE_PROGRESS",
    "FSM",
    "REMAINING_TIME",
    "DISTANCE_TO_DESTINATION",
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
    VERTICAL_SPEED: number;
    RADIO_HEIGHT: number;
    GEAR_DOWN: number;
    SEATBELT_SWITCH: number;
    FLIGHT_LEVEL: number;
    /** Progreso de crucero 0..1 (calculado; sin él el parser lanzaba "Variable desconocida"). */
    CRUISE_PROGRESS: number;
    /** Fase de vuelo (Scheduler) o estado FSM ('UNKNOWN' si no hay dato). */
    FSM: string;
    /** Minutos restantes (SimBrief). NaN sin datos: así `<= 5` es falso y un OR degrada al otro brazo. */
    REMAINING_TIME: number;
    /** NM restantes al destino (Haversine). NaN sin posición/destino. */
    DISTANCE_TO_DESTINATION: number;
    _raw: { simOnGround: unknown; groundspeed: unknown; parkingBrake: unknown; atcOnParkingSpot: unknown; atcClearedTakeoff: unknown; onAnyRunway: unknown; altitude: unknown; verticalSpeed: unknown; radioHeight: unknown; gearDown: unknown; seatbeltOn: unknown };
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
    const verticalSpeed = Number(tel.verticalSpeed ?? tel.vertical_speed ?? 0) || 0;
    const radioHeight = Number(tel.radioHeight ?? tel.radio_height ?? 0) || 0;
    const gearDown = tel.gearDown ?? tel.gear_down;
    // Cinturones: 1 = ON (SDK MSFS: CABIN SEATBELTS ALERT SWITCH es True si el
    // interruptor está ON; el backend ya mapea `!= 0.0` sin negar).
    const seatbeltOn = tel.seatbeltOn ?? tel.seatbelt_on;
    // Nivel de vuelo planificado (pies, de SimBrief route_altitude vía
    // flight.cruiseAltitude). Para reglas tipo ABS(PLANE_ALTITUDE - FLIGHT_LEVEL).
    let flightLevel = 0;
    try {
      const fl: any = ctx?.getFlight?.() ?? {};
      flightLevel = Number(fl.cruiseAltitude ?? 0) || 0;
    } catch {
      flightLevel = 0;
    }
    let allEnginesRunning = false;
    try {
      allEnginesRunning = this.getPhaseTransitionDetail(undefined, ctx as FlightContext).allEnginesRunning;
    } catch {
      allEnginesRunning = false;
    }
    // Fase para átomos tipo FSM == 'DESCENT': proveedor del Scheduler, si no
    // estado FSM crudo, si no 'UNKNOWN' (nunca undefined: el parser lanzaría).
    let fsm = "UNKNOWN";
    try {
      const provided = this.currentFlightPhase();
      if (provided) {
        fsm = provided;
      } else {
        const f: any = ctx?.getFSM?.() ?? {};
        const raw = f?.currentState ?? f?.getCurrentState?.() ?? null;
        if (raw !== undefined && raw !== null && String(raw) !== "") fsm = String(raw);
      }
    } catch {
      fsm = "UNKNOWN";
    }
    // Minutos restantes para átomos tipo REMAINING_TIME <= 5. Sin SimBrief
    // (o sin zulu) → NaN, NO 0: NaN hace falsa la comparación y un OR con
    // otro brazo (p. ej. RADIO_HEIGHT) sigue funcionando.
    let remainingTime = NaN;
    try {
      const fl: any = ctx?.getFlight?.() ?? {};
      const tel3: any = ctx?.getTelemetry?.() ?? {};
      const schedRaw = fl.scheduledTakeoffTime ?? fl.scheduled_takeoff_time;
      const z = Number(tel3.zuluTime ?? tel3.zulu_time);
      const s = Number(schedRaw);
      const d = Number(fl.durationMinutes);
      if (
        fl.durationMinutes != null && schedRaw != null &&
        !Number.isNaN(z) && !Number.isNaN(s) && !Number.isNaN(d) && d > 0
      ) {
        remainingTime = Math.max(0, d - (z - s) / 60);
      }
    } catch {
      remainingTime = NaN;
    }
    // NM restantes para átomos tipo DISTANCE_TO_DESTINATION <= 70.
    // Sin posición/destino → NaN (falso en comparaciones, sin lanzar).
    let distanceToDest = NaN;
    try {
      const dd = this.getDistanceToDestination(ctx as FlightContext);
      if (Number.isFinite(dd) && dd >= 0) distanceToDest = dd;
    } catch {
      distanceToDest = NaN;
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
      VERTICAL_SPEED: verticalSpeed,
      RADIO_HEIGHT: radioHeight,
      GEAR_DOWN: gearDown ? 1 : 0,
      SEATBELT_SWITCH: seatbeltOn ? 1 : 0,
      FLIGHT_LEVEL: flightLevel,
      // Progreso de crucero para reglas tipo "CRUISE_PROGRESS >= 0.95"
      // (transition_to_descent). Antes ausente: el parser lanzaba
      // "Variable desconocida" y la regla era falsa siempre.
      CRUISE_PROGRESS: this.getCruiseProgress(ctx as FlightContext),
      FSM: fsm,
      REMAINING_TIME: remainingTime,
      DISTANCE_TO_DESTINATION: distanceToDest,
      _raw: { simOnGround, groundspeed: tel.groundspeed ?? tel.ground_speed, parkingBrake, atcOnParkingSpot, atcClearedTakeoff, onAnyRunway, altitude: tel.altitude, verticalSpeed: tel.verticalSpeed, radioHeight: tel.radioHeight, gearDown, seatbeltOn },
    };
  }

  /**
   * Contexto de regla para depuración y compatibilidad (incluye telemetría
   * + FSM + calculadas). La evaluación usa `getTelemetryExpressionContext`
   * como fuente única; este método expone la misma foto más contexto.
   */
  public getRuleContext(context?: FlightContext): Record<string, any> {
    const ctx: any = context ?? this.flightContext;
    const tel: any = ctx?.getTelemetry?.() ?? {};
    const c = this.getTelemetryExpressionContext(ctx as FlightContext);
    let fsmState: unknown = null;
    try {
      const fsm: any = ctx?.getFSM?.() ?? null;
      fsmState = fsm?.currentState ?? fsm?.getCurrentState?.() ?? null;
    } catch {
      fsmState = null;
    }
    return {
      // Telemetría
      SIM_ON_GROUND: c.SIM_ON_GROUND,
      GROUND_VELOCITY: c.GROUND_VELOCITY,
      PARKING_BRAKE: c.PARKING_BRAKE,
      ATC_ON_PARKING_SPOT: c.ATC_ON_PARKING_SPOT,
      ALTITUDE: c.ALTITUDE,
      VERTICAL_SPEED: tel.verticalSpeed ?? c.VERTICAL_SPEED,
      RADIO_HEIGHT: tel.radioHeight ?? c.RADIO_HEIGHT,
      ON_ANY_RUNWAY: c.ON_ANY_RUNWAY,
      GEAR_DOWN: tel.gearDown ? 1 : 0,
      SEATBELT_SWITCH: tel.seatbeltOn ? 1 : 0,
      FLIGHT_LEVEL: c.FLIGHT_LEVEL,
      // Contexto
      FSM: fsmState,
      CRUISE_PROGRESS: this.getCruiseProgress(ctx as FlightContext),
      REMAINING_TIME: this.getRemainingTime(ctx as FlightContext),
      DISTANCE_TO_DESTINATION: this.getDistanceToDestination(ctx as FlightContext),
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
      logger.ruleEvaluation("Evaluando scheduler_rule:", {
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
          VERTICAL_SPEED: ctx.VERTICAL_SPEED,
          RADIO_HEIGHT: ctx.RADIO_HEIGHT,
          GEAR_DOWN: ctx.GEAR_DOWN,
          SEATBELT_SWITCH: ctx.SEATBELT_SWITCH,
          FLIGHT_LEVEL: ctx.FLIGHT_LEVEL,
          CRUISE_PROGRESS: ctx.CRUISE_PROGRESS,
          FSM: ctx.FSM,
          REMAINING_TIME: ctx.REMAINING_TIME,
          DISTANCE_TO_DESTINATION: ctx.DISTANCE_TO_DESTINATION,
        },
        result,
      });
      return result;
    } catch (err) {
      logger.ruleEvaluation("scheduler_rule no evaluable:", { rule, error: String(err) });
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
    rows: { label: string; ok: boolean | null; value: string }[];
  } {
    if (!this.isTelemetryExpression(rule)) return { isExpression: false, met: null, rows: [] };
    const ctx = this.getTelemetryExpressionContext(context);
    const vars = ctx as unknown as Record<string, boolean | number | string>;
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
    vars: Record<string, boolean | number | string>
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
  private atomLiveValue(tokens: string[], vars: Record<string, boolean | number | string>): string {
    for (const t of tokens) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) continue;
      const u = t.toUpperCase();
      if (u === "AND" || u === "OR" || u === "NOT" || u === "TRUE" || u === "FALSE") continue;
      const v = vars[u] ?? (vars as any)[t];
      if (typeof v === "number") {
        if (Number.isNaN(v)) return "—";
        return Number.isInteger(v) ? String(v) : v.toFixed(2);
      }
      if (typeof v === "boolean") return String(v);
      if (typeof v === "string") return v === "" ? "—" : v;
      return String(v ?? "—");
    }
    return "—";
  }

  private tokenizeTelemetryExpression(rule: string): string[] {
    const out: string[] = [];
    // NOTA: incluye `+`/`-` para aritmética (p. ej. PLANE_ALTITUDE - FLIGHT_LEVEL)
    // y literales entrecomillados '...' / "..." (p. ej. FSM == 'DESCENT').
    // Sin las alternativas de comillas, el `'` se salteaba en silencio y el
    // contenido se trataba como variable → "Variable desconocida".
    const re = /\s*(==|!=|>=|<=|>|<|\+|-|\(|\)|'[^']*'|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*/g;
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
          VERTICAL_SPEED: c.VERTICAL_SPEED,
          RADIO_HEIGHT: c.RADIO_HEIGHT,
          GEAR_DOWN: c.GEAR_DOWN,
          SEATBELT_SWITCH: c.SEATBELT_SWITCH,
          FLIGHT_LEVEL: c.FLIGHT_LEVEL,
        };
      } catch {}
      logger.ruleEvaluation("🔍 Evaluando scheduler_rule para:", {
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

    logger.ruleEvaluation(`Regla de programación no reconocida: "${rule}"`);
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

/** Parser recursivo para expresiones de scheduler_rule (AND/OR/NOT, comparaciones,
 *  aritmética +/-, paréntesis y función ABS()). Sin eval(): parser propio.
 *  Los niveles booleanos (OR/AND/NOT) conservan números sin forzar booleano en
 *  intermedios, para que la aritmética (p. ej. ABS(A - B) <= 500) se evalúe bien.
 */
class TelemetryExprParser {
  private pos = 0;

  constructor(
    private readonly tokens: string[],
    private readonly vars: Record<string, boolean | number | string>
  ) {}

  parse(): boolean {
    const result = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Token inesperado: ${this.tokens[this.pos]}`);
    }
    return this.toBoolean(result);
  }

  private parseOr(): boolean | number | string {
    let left = this.parseAnd();
    while (this.peekUpper() === "OR") {
      this.pos++;
      const right = this.parseAnd();
      left = this.toBoolean(left) || this.toBoolean(right);
    }
    return left;
  }

  private parseAnd(): boolean | number | string {
    let left = this.parseNot();
    while (this.peekUpper() === "AND") {
      this.pos++;
      const right = this.parseNot();
      left = this.toBoolean(left) && this.toBoolean(right);
    }
    return left;
  }

  private parseNot(): boolean | number | string {
    if (this.peekUpper() === "NOT") {
      this.pos++;
      return !this.toBoolean(this.parseNot());
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean | number | string {
    const left = this.parseAdditive();
    const op = this.peek();
    if (op === "==" || op === "!=" || op === ">" || op === "<" || op === ">=" || op === "<=") {
      this.pos++;
      const right = this.parseAdditive();
      // Comparación de cadenas (p. ej. FSM == 'DESCENT'): solo igualdad.
      // Ordenar cadenas no tiene sentido en reglas → falso (no lanzar: un
      // throw invalidaría toda la regla aunque otro brazo del OR cumpla).
      if (typeof left === "string" || typeof right === "string") {
        if (op === "==") return String(left) === String(right);
        if (op === "!=") return String(left) !== String(right);
        return false;
      }
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
    return left;
  }

  private parseAdditive(): boolean | number | string {
    let left = this.parsePrimary();
    for (;;) {
      const op = this.peek();
      if (op !== "+" && op !== "-") return left;
      this.pos++;
      const right = this.parsePrimary();
      const l = this.toNumber(left);
      const r = this.toNumber(right);
      left = op === "+" ? l + r : l - r;
    }
  }

  private parsePrimary(): boolean | number | string {
    const tok = this.tokens[this.pos++];
    if (tok === undefined) throw new Error("Expresión incompleta");
    // Literal entrecomillado '...' / "..." (p. ej. FSM == 'DESCENT').
    if (tok.length >= 2 && ((tok.startsWith("'") && tok.endsWith("'")) || (tok.startsWith('"') && tok.endsWith('"')))) {
      return tok.slice(1, -1);
    }
    // Signo unario (p. ej. VERTICAL_SPEED < -500).
    if (tok === "-") return -this.toNumber(this.parsePrimary());
    if (tok === "+") return +this.toNumber(this.parsePrimary());
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
      // Función ABS(<expr>) para reglas tipo ABS(PLANE_ALTITUDE - FLIGHT_LEVEL).
      if (upper === "ABS" && this.tokens[this.pos] === "(") {
        this.pos++;
        const inner = this.parseOr();
        if (this.tokens[this.pos++] !== ")") throw new Error("Falta ')' en ABS()");
        return Math.abs(this.toNumber(inner));
      }
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

  private toNumber(v: boolean | number | string): number {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isNaN(n) ? NaN : n;
    }
    return v;
  }

  private toBoolean(v: boolean | number | string): boolean {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v !== "";
    return v !== 0;
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
