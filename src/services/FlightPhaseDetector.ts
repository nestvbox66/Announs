/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FlightPhaseDetector — detector independiente de fase desde telemetría.
 * Reutilizable por MockFlightController y MsfsFlightController.
 */

import { FlightPhase } from "../engine/FlightEngine";
import type { TelemetrySnapshot } from "../types/telemetry";
import type { FlightContext } from "./FlightContext";
import { fileLogger } from "./FileLogger";
import { logger } from "../utils/logger";

export class FlightPhaseDetector {
  private lastPhase: FlightPhase | null = null;
  private stability = 0;
  private readonly STABILITY_THRESHOLD = 3;
  private boardingCompleted = false;
  // Última fase CONFIRMADA (la que detectPhase realmente devolvió, no el
  // tracking transitorio de lastPhase). Se usa para el mapeo direccional
  // TAXI vs TAXI_IN: debe reflejar de dónde venimos de forma estable.
  private lastStablePhase: FlightPhase | null = null;
  // Contexto opcional (inyectado por la vista): provee flight.cruiseAltitude
  // (SimBrief) para detectar CRUISE a la altitud real del vuelo. Sin contexto
  // (Mock/tests/vía estática) se usa solo el fallback genérico de 25.000 ft.
  private flightContext?: FlightContext;

  // Ventanas de histéresis por reloj (no por ticks): un dip de ruido de 0.3s
  // jamás debe proponer cambio de fase. CRUISE 5s, DESCENT 15s.
  private cruiseWindow: { startedAt: number | null; announced: boolean } = { startedAt: null, announced: false };
  private descentWindow: { startedAt: number | null; announced: boolean } = { startedAt: null, announced: false };
  private static readonly CRUISE_VS_BAND = 200;
  private static readonly CRUISE_WINDOW_S = 5;
  private static readonly DESCENT_VS_THRESHOLD = -500;
  private static readonly DESCENT_WINDOW_S = 15;
  private static readonly DESCENT_ALT_CAP = 35000;
  private static readonly DESCENT_ALT_FLOOR = 1000;

  setBoardingCompleted(completed: boolean): void {
    this.boardingCompleted = completed;
  }

  /** Inyecta el FlightContext para la detección por altitud real de crucero. */
  setFlightContext(ctx: FlightContext): void {
    this.flightContext = ctx;
  }

  /**
   * Reloj de ventanas en segundos: zuluTime del sim si es válido (> 0), si no
   * reloj de pared. Nunca null (la pared siempre avanza).
   */
  private windowClockS(snapshot: TelemetrySnapshot): number {
    const z = Number((snapshot as any).zuluTime ?? (snapshot as any).zulu_time ?? NaN);
    if (!Number.isNaN(z) && z > 0) return z;
    return Date.now() / 1000;
  }

  /**
   * Rebasa una ventana al reloj actual si el elapsed es imposible (wrap de
   * medianoche con zulu, o salto atrás / cambio de fuente del reloj). Un
   * elapsed absurdo nunca debe dejar la ventana clavada ni dispararla.
   * Retorna el elapsed saneado (< 0 nunca).
   */
  private saneElapsed(now: number, startedAt: number, key: string): number {
    let elapsed = now - startedAt;
    if (elapsed < 0 || elapsed > 86400) {
      logger.phaseDetector(`${key}: salto de reloj detectado, rebaseando ventana:`, {
        now,
        startedAt,
        elapsed,
      });
      return -1; // señal: rebasear
    }
    return elapsed;
  }

  /**
   * ¿Está el avión en crucero SOSTENIDO? Fuente primaria: `flight.cruiseAltitude`
   * (SimBrief, pies) con tolerancia ±500 ft (igual que el ancla
   * transition_to_cruise) y banda |VS| ≤ 200 fpm anti-jitter. Fallback:
   * umbral genérico de 25.000 ft si no hay altitud de crucero. La condición
   * instantánea debe mantenerse 5s por reloj antes de proponer CRUISE.
   * Sin efectos secundarios salvo el avance de su propia ventana.
   */
  public detectCruise(snapshot: TelemetrySnapshot): boolean {
    const altitude = snapshot.altitude ?? 0;
    const verticalSpeed = snapshot.verticalSpeed ?? 0;
    let cruiseAltitude: number | null = null;
    try {
      const raw = this.flightContext?.getFlight?.()?.cruiseAltitude;
      const n = Number(raw);
      if (raw !== undefined && raw !== null && !Number.isNaN(n) && n > 0) cruiseAltitude = n;
    } catch {
      cruiseAltitude = null;
    }

    let instant = false;
    let diff: number | string = "N/A";
    if (cruiseAltitude !== null) {
      diff = Math.abs(altitude - cruiseAltitude);
      if (diff <= 500 && Math.abs(verticalSpeed) <= FlightPhaseDetector.CRUISE_VS_BAND) {
        logger.phaseDetector('CRUISE por cruiseAltitude:', {
          altitude,
          cruiseAltitude,
          diff,
          verticalSpeed,
        });
        instant = true;
      }
    }
    if (!instant && altitude > 25000 && Math.abs(verticalSpeed) <= FlightPhaseDetector.CRUISE_VS_BAND) {
      logger.phaseDetector('CRUISE por umbral 25000:', {
        altitude,
        verticalSpeed,
      });
      instant = true;
    }

    const now = this.windowClockS(snapshot);
    if (!instant) {
      if (this.cruiseWindow.startedAt !== null) {
        logger.phaseDetector('CRUISE reseteado:', { altitude, verticalSpeed });
      }
      this.cruiseWindow = { startedAt: null, announced: false };
      if (altitude > 10000 || cruiseAltitude !== null) {
        logger.phaseDetector('Evaluando CRUISE:', {
          altitude,
          cruiseAltitude,
          diff,
          verticalSpeed,
          result: 'NOT_CRUISE',
        });
      }
      return false;
    }
    if (this.cruiseWindow.startedAt === null) {
      this.cruiseWindow = { startedAt: now, announced: false };
      logger.phaseDetector('CRUISE iniciado:', { altitude, verticalSpeed, startedAt: now });
      return false;
    }
    const elapsed = this.saneElapsed(now, this.cruiseWindow.startedAt, 'CRUISE');
    if (elapsed < 0) {
      this.cruiseWindow = { startedAt: now, announced: false };
      return false;
    }
    const met = elapsed >= FlightPhaseDetector.CRUISE_WINDOW_S;
    if (met && !this.cruiseWindow.announced) {
      this.cruiseWindow.announced = true;
      logger.phaseDetector('CRUISE confirmado:', { altitude, verticalSpeed, elapsed });
    }
    if (altitude > 10000 || cruiseAltitude !== null) {
      logger.phaseDetector('Evaluando CRUISE:', {
        altitude,
        cruiseAltitude,
        diff,
        verticalSpeed,
        result: met ? 'CRUISE' : 'NOT_CRUISE',
      });
    }
    return met;
  }

  /**
   * ¿Descenso SOSTENIDO? 1000 < alt < 35000 con VS < −500 durante 15s por
   * reloj. Un dip de ruido de 0.3s abre la ventana pero jamás la cierra.
   */
  public detectDescent(snapshot: TelemetrySnapshot): boolean {
    const altitude = snapshot.altitude ?? 0;
    const verticalSpeed = snapshot.verticalSpeed ?? 0;
    const instant =
      altitude > FlightPhaseDetector.DESCENT_ALT_FLOOR &&
      altitude < FlightPhaseDetector.DESCENT_ALT_CAP &&
      verticalSpeed < FlightPhaseDetector.DESCENT_VS_THRESHOLD;
    const now = this.windowClockS(snapshot);
    if (!instant) {
      if (this.descentWindow.startedAt !== null) {
        logger.phaseDetector('DESCENT reseteado:', {
          altitude,
          verticalSpeed,
          elapsed: now - (this.descentWindow.startedAt ?? now),
        });
      }
      this.descentWindow = { startedAt: null, announced: false };
      return false;
    }
    if (this.descentWindow.startedAt === null) {
      this.descentWindow = { startedAt: now, announced: false };
      logger.phaseDetector('DESCENT iniciado:', { altitude, verticalSpeed, startedAt: now });
      return false;
    }
    const elapsed = this.saneElapsed(now, this.descentWindow.startedAt, 'DESCENT');
    if (elapsed < 0) {
      this.descentWindow = { startedAt: now, announced: false };
      return false;
    }
    const met = elapsed >= FlightPhaseDetector.DESCENT_WINDOW_S;
    if (met && !this.descentWindow.announced) {
      this.descentWindow.announced = true;
      logger.phaseDetector('DESCENT confirmado:', { altitude, verticalSpeed, elapsed });
    }
    return met;
  }

  /**
   * Instantánea PURA (sin efectos) de las ventanas para el monitor.
   * `snap` parcial con {altitude, verticalSpeed, zuluTime} (p. ej. desde la
   * telemetría del contexto); el elapsed usa el mismo reloj que el detector.
   */
  public getHysteresisSnapshot(snap?: { altitude?: unknown; verticalSpeed?: unknown; zuluTime?: unknown }): {
    cruise: { requiredS: number; elapsedS: number | null; stable: boolean };
    descent: { requiredS: number; elapsedS: number | null; stable: boolean };
  } {
    const now = this.windowClockS({
      altitude: 0,
      verticalSpeed: 0,
      zuluTime: (snap as any)?.zuluTime ?? (snap as any)?.zulu_time ?? NaN,
    } as unknown as TelemetrySnapshot);
    const elapsedOf = (startedAt: number | null): number | null => {
      if (startedAt === null) return null;
      const e = now - startedAt;
      return e < 0 || e > 86400 ? 0 : e;
    };
    const cElapsed = elapsedOf(this.cruiseWindow.startedAt);
    const dElapsed = elapsedOf(this.descentWindow.startedAt);
    return {
      cruise: {
        requiredS: FlightPhaseDetector.CRUISE_WINDOW_S,
        elapsedS: cElapsed,
        stable: cElapsed !== null && cElapsed >= FlightPhaseDetector.CRUISE_WINDOW_S,
      },
      descent: {
        requiredS: FlightPhaseDetector.DESCENT_WINDOW_S,
        elapsedS: dElapsed,
        stable: dElapsed !== null && dElapsed >= FlightPhaseDetector.DESCENT_WINDOW_S,
      },
    };
  }

  /**
   * Detección con histéresis: requiere STABILITY_THRESHOLD lecturas estables
   * antes de confirmar cambio de fase. Retorna null hasta que se estabilice.
   * PRE_FLIGHT solo si doorsClosed y BOARDING completado (evita transición temprana).
   */
  detectPhase(snap: TelemetrySnapshot): FlightPhase | null {
    // PRE_FLIGHT solo si doorsClosed Y BOARDING está completado
    if (snap.doorsClosed && !this.boardingCompleted) {
      const wouldBePreFlight = this.computePhase(snap) === FlightPhase.PRE_FLIGHT;
      if (wouldBePreFlight) {
        console.warn('[PhaseDetector] Puertas cerradas pero BOARDING no completado');
        fileLogger.warn('[PhaseDetector] Puertas cerradas pero BOARDING no completado', { doorsClosed: snap.doorsClosed, boardingCompleted: this.boardingCompleted });
        return null;
      }
    }

    const detected = this.computePhase(snap);

    if (detected === this.lastPhase) {
      this.stability++;
      if (this.stability >= this.STABILITY_THRESHOLD) {
        this.lastStablePhase = detected;
        return detected;
      }
    } else {
      this.stability = 0;
      this.lastPhase = detected;
    }

    return null;
  }

  /**
   * Detección inmediata SIN ventanas sostenidas (vía estática). Útil como
   * lectura puntual, pero NO propone CRUISE/DESCENT: esas fases exigen
   * confirmación por reloj y un detector fresco nunca la acumula. Para el
   * flujo vivo (con histéresis real) usar la instancia + `detectPhase`.
   * Actualmente sin llamadas en src (compatibilidad histórica).
   */
  static detectPhase(snap: TelemetrySnapshot): FlightPhase {
    return FlightPhaseDetector.computePhaseStatic(snap);
  }

  private static computePhaseStatic(snap: TelemetrySnapshot): FlightPhase {
    const detector = new FlightPhaseDetector();
    return detector.computePhase(snap);
  }

  /**
   * Verifica que TODOS los motores estén en combustión (ENG COMBUSTION:1..N).
   * Usa los nombres reales del TelemetrySnapshot (engineRunning para el motor 1,
   * engCombustion2..N) con alias por compatibilidad (engineCombustion1..N,
   * numEngines).
   * - numEngines === 0 (reportado): false (no hay motores encendidos).
   * - numEngines indefinido (provider no reporta cantidad): conserva el
   *   comportamiento previo basado solo en el motor 1 (engineRunning), para no
   *   romper telemetrías parciales.
   */
  private static allEnginesRunning(snap: TelemetrySnapshot): boolean {
    const raw: any = snap;
    const numEngines = raw.numberOfEngines ?? raw.numEngines;
    if (numEngines === 0) return false;
    if (typeof numEngines !== "number" || !Number.isFinite(numEngines) || numEngines <= 0) {
      // Sin dato de cantidad: usar motor 1 (compat).
      const e1 = raw.engineCombustion1 ?? raw.engCombustion1 ?? raw.engineRunning;
      return e1 === true;
    }

    const isEngineRunning = (index: number): boolean => {
      if (index === 1) {
        const e1 = raw.engineCombustion1 ?? raw.engCombustion1 ?? raw.engineRunning;
        return e1 === true;
      }
      const eN = raw[`engineCombustion${index}`] ?? raw[`engCombustion${index}`];
      return eN === true;
    };

    for (let i = 1; i <= numEngines; i++) {
      if (!isEngineRunning(i)) return false;
    }
    return true;
  }

  private computePhase(snap: TelemetrySnapshot): FlightPhase {
    const altitude = snap.altitude ?? 0;
    const groundspeed = snap.groundspeed ?? 0;
    const verticalSpeed = snap.verticalSpeed ?? 0;
    const parkingBrake = snap.parkingBrake ?? false;
    const doorsClosed = snap.doorsClosed ?? false;
    const engineRunning = snap.engineRunning ?? false;
    const simOnGround = snap.simOnGround;
    const atcOnParkingSpot = snap.atcOnParkingSpot;

    // 1. CRUISE (prioridad alta): por altitud real de crucero (SimBrief) con
    // fallback al umbral genérico. Va primero porque un nivelado a FL170 con
    // VS≈0 no debe caer a GATE ni confundirse con otras fases: con altitud >
    // 0 y cerca del FL planificado solo puede ser crucero.
    // La condición debe sostenerse 5s por reloj (ventana anti-ruido).
    if (this.detectCruise(snap)) return FlightPhase.CRUISE;

    // 2. DESCENT con histéresis real: VS < −500 sostenido 15s por reloj.
    // Sin esto, un dip de ruido de 0.3s proponía DESCENT y el FSM saltaba
    // fases (p. ej. CLIMB → DESCENT) abandonando la narrativa.
    if (this.detectDescent(snap)) return FlightPhase.DESCENT;

    // GATE: en tierra, parado, puertas abiertas, motores apagados, freno puesto
    if (altitude === 0 && groundspeed < 5 && !doorsClosed && !engineRunning && parkingBrake) {
      return FlightPhase.GATE;
    }
    if (altitude === 0 && !doorsClosed && !engineRunning) {
      return FlightPhase.BOARDING;
    }
    // PRE_FLIGHT: en tierra, parado, puertas cerradas, motores encendidos, freno puesto
    if (altitude === 0 && groundspeed < 5 && doorsClosed && engineRunning && parkingBrake) {
      return FlightPhase.PRE_FLIGHT;
    }

    // TAXI — transición automática PRE_FLIGHT → TAXI.
    //
    // Con telemetría avanzada del simulador (simOnGround / atcOnParkingSpot +
    // número de motores) se exigen TODAS las condiciones:
    //   1. Está en tierra (simOnGround === true)
    //   2. Está en movimiento (> 5 nudos)
    //   3. Freno de mano liberado (parkingBrake === false)
    //   4. Ya no está en la puerta de embarque (atcOnParkingSpot === false)
    //   5. TODOS los motores encendidos (ENG COMBUSTION:1..N)
    //
    // Si esa telemetría no está disponible (compat Mock / providers parciales)
    // se mantiene la detección anterior (altura 0 + puertas cerradas + motor 1).
    // Mapeo direccional: el mismo rodaje en tierra significa cosas opuestas
    // según de dónde venimos. Si la última fase estable fue de llegada
    // (DESCENT/APPROACH/LANDING), el rollout va a TAXI_IN (el Scheduler lo
    // normaliza a TAXI_TO_GATE: bienvenida destino, permanecer sentado). Si
    // venimos de salida, a TAXI (escenario de departure). Sin esto, al
    // aterrizar se recargaba TAXI desde el paso 1 y sonaba el safety demo de
    // salida (incidente 2026-09-19).
    // TAXI_IN está en el set a propósito (auto-sostenido): una vez confirmado
    // el rodaje de llegada, las siguientes evaluaciones deben seguir diciendo
    // TAXI_IN. Sin esto, la primera confirmación contaminaría lastStablePhase
    // y la salida fliparía a TAXI, reintroduciendo el bug con 1s de retraso.
    const ARRIVAL_PHASES = [FlightPhase.DESCENT, FlightPhase.APPROACH, FlightPhase.LANDING, FlightPhase.TAXI_IN];
    const taxiPhase = ARRIVAL_PHASES.includes(this.lastStablePhase as FlightPhase)
      ? FlightPhase.TAXI_IN
      : FlightPhase.TAXI;
    const hasAdvancedGroundData = simOnGround !== undefined && atcOnParkingSpot !== undefined;
    if (hasAdvancedGroundData) {
      const isOnGround = simOnGround === true;
      const isMoving = groundspeed > 5;
      const isParkingBrakeOff = parkingBrake === false;
      const isNotAtParkingSpot = atcOnParkingSpot === false;
      const allEnginesRunning = FlightPhaseDetector.allEnginesRunning(snap);
      const allConditionsMet =
        isOnGround && isMoving && isParkingBrakeOff && isNotAtParkingSpot && allEnginesRunning;
      const detectedPhase = allConditionsMet ? taxiPhase : FlightPhase.PRE_FLIGHT;
      const raw: any = snap;
      logger.phaseDetector('🔍 Evaluando transición a TAXI:', {
        // Condiciones individuales
        isOnGround,
        isMoving,
        isParkingBrakeOff,
        isNotAtParkingSpot,
        allEnginesRunning,
        // Valores crudos
        groundspeed,
        parkingBrake,
        atcOnParkingSpot,
        simOnGround,
        numEngines: raw.numberOfEngines ?? raw.numEngines,
        engineCombustion: {
          1: raw.engineCombustion1 ?? raw.engCombustion1 ?? raw.engineRunning,
          2: raw.engineCombustion2 ?? raw.engCombustion2,
          3: raw.engineCombustion3 ?? raw.engCombustion3,
          4: raw.engineCombustion4 ?? raw.engCombustion4,
        },
        // Resultado
        allConditionsMet,
        currentPhase: this.lastPhase,
        detectedPhase,
      });
      if (allConditionsMet) {
        logger.phaseDetector('🔄 Cambio de fase detectado:', {
          from: this.lastPhase,
          to: taxiPhase,
          reason: taxiPhase === FlightPhase.TAXI_IN
            ? 'Rollout post-aterrizaje: TAXI_IN (llegada), no TAXI (salida)'
            : 'Condiciones de TAXI cumplidas',
          conditions: {
            isOnGround,
            isMoving,
            isParkingBrakeOff,
            isNotAtParkingSpot,
            allEnginesRunning,
          },
        });
        return taxiPhase;
      }
    } else if (
      altitude === 0 &&
      groundspeed > 5 &&
      doorsClosed &&
      engineRunning &&
      !parkingBrake
    ) {
      return taxiPhase;
    }
    if (altitude > 0 && altitude < 500 && groundspeed > 50) {
      return FlightPhase.TAKEOFF;
    }
    if (altitude >= 500 && altitude < 35000 && verticalSpeed > 0) {
      return FlightPhase.CLIMB;
    }
    // NOTA: el DESCENT instantáneo (alt/vs directo) se eliminó a propósito:
    // ahora lo gobierna detectDescent() con ventana de 15s. Dejar la condición
    // vieja aquí anularía la histéresis (un dip de 0.3s volvería a proponerla).
    if (altitude <= 1000 && altitude > 0 && groundspeed > 50) {
      return FlightPhase.APPROACH;
    }
    // LANDING: ajustado a <100 y 5<groundspeed<50 para evitar saltos con TAXI
    if (altitude < 100 && groundspeed < 50 && groundspeed > 5) {
      return FlightPhase.LANDING;
    }
    // TAXI_TO_GATE: solo en tierra y muy lento
    if (altitude === 0 && groundspeed < 20) {
      return FlightPhase.TAXI_IN;
    }
    if (altitude === 0 && parkingBrake && doorsClosed) {
      return FlightPhase.AT_GATE;
    }

    return FlightPhase.GATE;
  }

  detect(snap: TelemetrySnapshot): FlightPhase | null {
    return this.detectPhase(snap);
  }

  /** Compatibilidad: detección inmediata sin histéresis */
  static detectPhaseImmediate(snap: TelemetrySnapshot): FlightPhase {
    return FlightPhaseDetector.computePhaseStatic(snap);
  }

  /** Limpia histéresis de salida + ventanas por reloj (nuevo vuelo). */
  reset(): void {
    this.lastPhase = null;
    this.lastStablePhase = null;
    this.stability = 0;
    this.boardingCompleted = false;
    this.cruiseWindow = { startedAt: null, announced: false };
    this.descentWindow = { startedAt: null, announced: false };
  }
}
