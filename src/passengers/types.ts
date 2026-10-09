/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tipos del sistema de pasajeros (Fase 1 — MVP).
 * Fuente: docs/Sistema de Pasajeros.pdf §11.
 *
 * Convención: todos los atributos en escala 0-100 donde 100 = mejor estado
 * posible. Esto evita bugs de signo invertido y hace el score interpretable.
 */

/** Claves de los 4 atributos de experiencia del pasajero. */
export type AttributeKey =
  | "saciedad"
  | "confortFisiologico"
  | "calma"
  | "entretenimiento";

/** Estado de los 4 atributos (siempre 0-100). */
export interface AttributeState {
  saciedad: number;
  confortFisiologico: number;
  calma: number;
  entretenimiento: number;
}

/** Claves iterables (el orden es estable para UI/logs). */
export const ATTRIBUTE_KEYS: AttributeKey[] = [
  "saciedad",
  "confortFisiologico",
  "calma",
  "entretenimiento",
];

/**
 * Definición estática de arquetipo (config, no cambia durante el vuelo).
 * Vive en `archetypes.json` para tunear sin recompilar.
 */
export interface ArchetypeDefinition {
  id: string;
  name: string;
  /** Multiplica la tasa base de deterioro por atributo. */
  deteriorationMultipliers: AttributeState;
  /** Multiplica la magnitud de boost/mitigate por atributo. */
  recoveryMultipliers: AttributeState;
  /**
   * Override del rango random al abordar (ej. "miedo a volar" → calma [20,50]).
   * Lo no especificado usa los rangos default del motor.
   */
  boardingRanges?: Partial<Record<AttributeKey, [number, number]>>;
}

/** Instancia runtime de un pasajero trackeado (uno de los 10 de la muestra). */
export interface Passenger {
  id: string;
  archetypeId: string;
  /** Flavor para UI (se asigna en la integración con el manifiesto). */
  seatLabel?: string;
  attributes: AttributeState;
}

/** Modo de efecto: mejora neta vs. mitigación de un evento negativo. */
export type EffectMode = "boost" | "mitigate";

/**
 * Efecto sobre pasajeros. Sirve tanto para deserializar el JSONB
 * `events.effects` de los anuncios como para eventos de telemetría
 * (turbulencia, etc.): un solo tipo, dos orígenes de datos.
 */
export interface PassengerEffect {
  attribute: AttributeKey;
  amount: number;
  mode: EffectMode;
}

/**
 * Bookkeeping para que `mitigate` funcione: el motor necesita saber que hay
 * un evento negativo reciente sin mitigar. Si la ventana expira sin anuncio
 * correspondiente, el evento queda cobrado sin mitigar.
 */
export interface ActiveNegativeEvent {
  id: string;
  attribute: AttributeKey;
  /** Segundo del vuelo en que ocurrió (elapsedSeconds del motor). */
  triggeredAtSecond: number;
  /** Cuánto tiempo sigue siendo "mitigable" (default 120s, Q1). */
  mitigationWindowSeconds: number;
  mitigated: boolean;
}

/** Estado runtime completo del motor en memoria durante el vuelo. */
export interface PassengerEngineState {
  passengers: Passenger[];
  activeNegativeEvents: ActiveNegativeEvent[];
  elapsedSeconds: number;
}

/**
 * Resumen final. Es lo ÚNICO que sale del motor (Q4: solo log local en
 * Fase 1, nada a Supabase). Todo lo demás se descarta al finalizar el vuelo.
 */
export interface FlightPassengerSummary {
  flightId: string;
  /** Promedio de los 4 atributos entre los pasajeros trackeados, al aterrizar. */
  globalAttributeAverages: AttributeState;
  /** Promedio de scores individuales menos penalización por varianza. */
  overallScore: number;
  variancePenaltyApplied: number;
}
