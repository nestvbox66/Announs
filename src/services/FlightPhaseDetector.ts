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

export class FlightPhaseDetector {
  private lastPhase: FlightPhase | null = null;
  private stability = 0;
  private readonly STABILITY_THRESHOLD = 3;
  private boardingCompleted = false;
  // Contexto opcional (inyectado por la vista): provee flight.cruiseAltitude
  // (SimBrief) para detectar CRUISE a la altitud real del vuelo. Sin contexto
  // (Mock/tests/vía estática) se usa solo el fallback genérico de 25.000 ft.
  private flightContext?: FlightContext;

  setBoardingCompleted(completed: boolean): void {
    this.boardingCompleted = completed;
  }

  /** Inyecta el FlightContext para la detección por altitud real de crucero. */
  setFlightContext(ctx: FlightContext): void {
    this.flightContext = ctx;
  }

  /**
   * ¿Está el avión en crucero? Fuente primaria: `flight.cruiseAltitude`
   * (SimBrief, pies) con tolerancia ±500 ft (igual que el ancla
   * transition_to_cruise) y banda |VS| ≤ 200 fpm anti-jitter. Fallback:
   * umbral genérico de 25.000 ft si no hay altitud de crucero. Sin efectos
   * secundarios (apto para monitor/tests).
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

    let result = false;
    let diff: number | string = "N/A";
    if (cruiseAltitude !== null) {
      diff = Math.abs(altitude - cruiseAltitude);
      if (diff <= 500 && Math.abs(verticalSpeed) <= 200) {
        console.log('[FlightPhaseDetector] CRUISE por cruiseAltitude:', {
          altitude,
          cruiseAltitude,
          diff,
          verticalSpeed,
        });
        result = true;
      }
    }
    if (!result && altitude > 25000 && Math.abs(verticalSpeed) <= 200) {
      console.log('[FlightPhaseDetector] CRUISE por umbral 25000:', {
        altitude,
        verticalSpeed,
      });
      result = true;
    }
    if (altitude > 10000 || cruiseAltitude !== null) {
      console.log('[FlightPhaseDetector] Evaluando CRUISE:', {
        altitude,
        cruiseAltitude,
        diff,
        verticalSpeed,
        result: result ? 'CRUISE' : 'NOT_CRUISE',
      });
    }
    return result;
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
        return detected;
      }
    } else {
      this.stability = 0;
      this.lastPhase = detected;
    }

    return null;
  }

  /**
   * Detección inmediata sin histéresis (usada por Mock y tests).
   * Mantiene compatibilidad con código existente.
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
    if (this.detectCruise(snap)) return FlightPhase.CRUISE;

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
    const hasAdvancedGroundData = simOnGround !== undefined && atcOnParkingSpot !== undefined;
    if (hasAdvancedGroundData) {
      const isOnGround = simOnGround === true;
      const isMoving = groundspeed > 5;
      const isParkingBrakeOff = parkingBrake === false;
      const isNotAtParkingSpot = atcOnParkingSpot === false;
      const allEnginesRunning = FlightPhaseDetector.allEnginesRunning(snap);
      const allConditionsMet =
        isOnGround && isMoving && isParkingBrakeOff && isNotAtParkingSpot && allEnginesRunning;
      const detectedPhase = allConditionsMet ? FlightPhase.TAXI : FlightPhase.PRE_FLIGHT;
      const raw: any = snap;
      console.log('[PhaseDetector] 🔍 Evaluando transición a TAXI:', {
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
        console.log('[PhaseDetector] 🔄 Cambio de fase detectado:', {
          from: this.lastPhase,
          to: FlightPhase.TAXI,
          reason: 'Condiciones de TAXI cumplidas',
          conditions: {
            isOnGround,
            isMoving,
            isParkingBrakeOff,
            isNotAtParkingSpot,
            allEnginesRunning,
          },
        });
        return FlightPhase.TAXI;
      }
    } else if (
      altitude === 0 &&
      groundspeed > 5 &&
      doorsClosed &&
      engineRunning &&
      !parkingBrake
    ) {
      return FlightPhase.TAXI;
    }
    if (altitude > 0 && altitude < 500 && groundspeed > 50) {
      return FlightPhase.TAKEOFF;
    }
    if (altitude >= 500 && altitude < 35000 && verticalSpeed > 0) {
      return FlightPhase.CLIMB;
    }
    if (altitude > 1000 && altitude <= 35000 && verticalSpeed < 0) {
      return FlightPhase.DESCENT;
    }
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

  reset(): void {
    this.lastPhase = null;
    this.stability = 0;
    this.boardingCompleted = false;
  }
}
