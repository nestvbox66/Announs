/**
 * XpBonusExplanations — etiquetas explicativas del desglose post-vuelo.
 *
 * La tabla `flight_xp_breakdown` persiste solo montos por columna (sin la
 * evidencia que los originó), así que el motivo se reconstruye a partir del
 * valor guardado frente al máximo conocido de cada bonus:
 *  - xp >= máximo → cumplido (`earned`)
 *  - 0 < xp < máximo → parcial (`partial`, p. ej. sinergia o perfil 25/50)
 *  - xp <= 0 → no otorgado (`missed`, incluye "sin muestras/sin dato")
 *
 * Para `disc_butter_landing_xp` (criterio 100% servidor, máximo no publicado
 * en el cliente) cualquier xp > 0 se considera cumplido.
 */
import {
  AI_SYNERGY_EVENT_KEYS,
  AI_SYNERGY_XP_PER_EVENT,
  HARD_AIRPORT_BONUS_XP,
  NIGHT_FLIGHT_BONUS_XP,
  WEATHER_SEVERITY_BONUS_XP,
} from "./FlightCompletionBonuses";
import { XpBonusTracker } from "./XpBonusTracker";

/**
 * Etiquetas en español por columna de `flight_xp_breakdown`.
 * Vive aquí (módulo sin Supabase) para que el desglose sea testeable;
 * `ProgressionService` la reexporta para el detalle post-vuelo.
 */
export const BONUS_LABELS: Record<string, string> = {
  disc_taxi_lights_xp: "Luces de taxi",
  // La condición real es fase LANDING (no hay puerta de altitud en el cálculo).
  disc_landing_lights_xp: "Luces de aterrizaje (fase LANDING)",
  disc_strobe_lights_xp: "Estroboscópicas en despegue",
  disc_beacon_lights_xp: "Baliza todo el vuelo",
  disc_speed_limit_xp: "Límite < 255 kts bajo 10k ft",
  disc_vertical_profile_xp: "Perfil vertical suave",
  disc_butter_landing_xp: "Aterrizaje suave",
  ai_companion_synergy_xp: "Sinergia IA / TTS",
  night_flight_bonus_xp: "Vuelo nocturno",
  hard_airport_bonus_xp: "Aeropuerto complejo",
  weather_severity_bonus_xp: "Meteorología adversa",
};

export type XpBonusState = "earned" | "partial" | "missed";

export interface XpBonusExplanation {
  /** Clave de columna en `flight_xp_breakdown` (o "base_time_xp"). */
  key: string;
  label: string;
  xp: number;
  /** Máximo otorgable conocido (null si lo define el servidor). */
  maxXp: number | null;
  state: XpBonusState;
  /** Motivo breve ("Luces de rodaje: Cumplido (≥80%) (+15 XP)"). */
  reason: string;
}

/** Máximos conocidos en el cliente por columna de bonus. */
export const XP_BONUS_MAX: Record<string, number | null> = {
  disc_taxi_lights_xp: XpBonusTracker.XP_TAXI_LIGHTS,
  disc_strobe_lights_xp: XpBonusTracker.XP_STROBE,
  disc_landing_lights_xp: XpBonusTracker.XP_LANDING_LIGHTS,
  disc_beacon_lights_xp: XpBonusTracker.XP_BEACON,
  disc_speed_limit_xp: XpBonusTracker.XP_SPEED_LIMIT,
  disc_vertical_profile_xp:
    XpBonusTracker.XP_VERTICAL_CLIMB + XpBonusTracker.XP_VERTICAL_DESCENT,
  disc_butter_landing_xp: null,
  ai_companion_synergy_xp: AI_SYNERGY_EVENT_KEYS.size * AI_SYNERGY_XP_PER_EVENT,
  night_flight_bonus_xp: NIGHT_FLIGHT_BONUS_XP,
  hard_airport_bonus_xp: HARD_AIRPORT_BONUS_XP,
  weather_severity_bonus_xp: WEATHER_SEVERITY_BONUS_XP,
};

function stateOf(xp: number, maxXp: number | null): XpBonusState {
  if (xp <= 0) return "missed";
  if (maxXp === null || xp >= maxXp) return "earned";
  return "partial";
}

const fmt = (xp: number): string =>
  `+${xp.toLocaleString("en-US")} XP`;

/**
 * Motivo de un bonus a partir de su monto guardado. Para montos parciales
 * de sinergia/perfil reconstruye el conteo (eventos o tramos).
 */
export function explainXpBonus(key: string, label: string, xp: number): XpBonusExplanation {
  const maxXp = XP_BONUS_MAX[key] ?? null;
  const state = stateOf(xp, maxXp);
  const missedSuffix = "(0 XP)";
  let reason: string;

  switch (key) {
    case "disc_taxi_lights_xp":
      reason = state === "earned"
        ? `Luces de taxi: Cumplido (ON en ≥80% en TAXI) (${fmt(xp)})`
        : `Luces de taxi: No cumplido (<80% ON en TAXI o sin muestras) ${missedSuffix}`;
      break;
    case "disc_strobe_lights_xp":
      reason = state === "earned"
        ? `Strobe: Cumplido (ON en ≥80% en TAKEOFF) (${fmt(xp)})`
        : `Strobe: No cumplido (<80% ON en TAKEOFF o sin muestras) ${missedSuffix}`;
      break;
    case "disc_landing_lights_xp":
      reason = state === "earned"
        ? `Luces de aterrizaje: Cumplido (ON en ≥80% en LANDING) (${fmt(xp)})`
        : `Luces de aterrizaje: No cumplido (<80% ON en LANDING o sin muestras) ${missedSuffix}`;
      break;
    case "disc_beacon_lights_xp":
      reason = state === "earned"
        ? `Baliza: ON todo el vuelo (gracia 60 s, hasta AT_GATE) (${fmt(xp)})`
        : `Baliza: Apagada fuera de gracia o sin muestras ${missedSuffix}`;
      break;
    case "disc_speed_limit_xp":
      reason = state === "earned"
        ? `Velocidad: <255 kt bajo 10.000 ft en ≥80% del tiempo (${fmt(xp)})`
        : `Velocidad: <80% del tiempo bajo 255 kt (o sin muestras) ${missedSuffix}`;
      break;
    case "disc_vertical_profile_xp": {
      if (state === "earned") {
        reason = `Perfil vertical: Ascenso ≤3.000 fpm y descenso ≥-2.000 fpm en ≥90% del tiempo (${fmt(xp)})`;
      } else if (state === "partial") {
        reason = `Perfil vertical: Solo un tramo en ≥90% del tiempo (${fmt(xp)} de 50 XP)`;
      } else {
        reason = `Perfil vertical: <90% del tiempo en límites o sin muestras ${missedSuffix}`;
      }
      break;
    }
    case "disc_butter_landing_xp":
      reason = state === "earned"
        ? `Aterrizaje suave: Cumplido (criterio del servidor) (${fmt(xp)})`
        : `Aterrizaje suave: No cumplido o sin dato ${missedSuffix}`;
      break;
    case "ai_companion_synergy_xp": {
      const events = Math.round(xp / AI_SYNERGY_XP_PER_EVENT);
      reason = state === "missed"
        ? `Sinergia IA: Sin eventos de voz reproducidos (0 de 8) ${missedSuffix}`
        : `Sinergia IA: ${events} de ${AI_SYNERGY_EVENT_KEYS.size} eventos de voz (3 XP c/u) (${fmt(xp)})`;
      break;
    }
    case "night_flight_bonus_xp":
      reason = state === "earned"
        ? `Vuelo nocturno: >30% del tiempo con E:TIME OF DAY = 3 (${fmt(xp)})`
        : `Vuelo nocturno: ≤30% en noche o sin dato de hora ${missedSuffix}`;
      break;
    case "hard_airport_bonus_xp":
      reason = state === "earned"
        ? `Aeropuerto difícil: Destino marcado hard (${fmt(xp)})`
        : `Aeropuerto difícil: Destino estándar o sin dato ${missedSuffix}`;
      break;
    case "weather_severity_bonus_xp":
      reason = state === "earned"
        ? `Clima severo: Detectado en METAR de destino (${fmt(xp)})`
        : `Clima severo: No detectado en METAR ${missedSuffix}`;
      break;
    default:
      reason = state === "missed"
        ? `${label}: No otorgado ${missedSuffix}`
        : `${label}: Otorgado (${fmt(xp)})`;
      break;
  }

  return { key, label, xp, maxXp, state, reason };
}

/** Explica la lista completa de bonus de un desglose (disciplina + entorno). */
export function explainXpBreakdown(
  items: Array<{ key: string; label: string; xp: number }>
): XpBonusExplanation[] {
  return items.map((item) => explainXpBonus(item.key, item.label, item.xp));
}

/** Parámetros de bonus tal como viajan a la RPC `process_flight_completion`. */
export interface CompletionRpcBonuses {
  p_disc_taxi: number;
  p_disc_strobe: number;
  p_disc_landing: number;
  p_disc_beacon: number;
  p_disc_speed: number;
  p_disc_climb: number;
  p_disc_descent: number;
  p_ai_synergy: number;
  p_night_flight: number;
  p_hard_airport: number;
  p_weather_severity: number;
}

/**
 * Convierte los parámetros de la RPC a items por columna de
 * `flight_xp_breakdown` (perfil vertical llega combinado: climb + descent).
 * Se usa para el informe post-vuelo con datos capturados ANTES del reset.
 */
export function toColumnBonusItems(rpc: CompletionRpcBonuses): Array<{ key: string; label: string; xp: number }> {
  const item = (key: string, xp: number) => ({
    key,
    label: BONUS_LABELS[key] ?? key,
    xp: Math.max(0, Math.round(xp) || 0),
  });
  return [
    item("disc_taxi_lights_xp", rpc.p_disc_taxi),
    item("disc_strobe_lights_xp", rpc.p_disc_strobe),
    item("disc_landing_lights_xp", rpc.p_disc_landing),
    item("disc_beacon_lights_xp", rpc.p_disc_beacon ?? 0),
    item("disc_speed_limit_xp", rpc.p_disc_speed),
    item("disc_vertical_profile_xp", rpc.p_disc_climb + rpc.p_disc_descent),
    item("ai_companion_synergy_xp", rpc.p_ai_synergy),
    item("night_flight_bonus_xp", rpc.p_night_flight),
    item("hard_airport_bonus_xp", rpc.p_hard_airport),
    item("weather_severity_bonus_xp", rpc.p_weather_severity),
  ];
}

/** Estado del cierre de XP para la pantalla final (Plataforma). */
export interface XpCompletionSummary {
  status: "pending" | "done" | "error";
  flightId: string;
  /** Bonus por columna, capturados ANTES de liberar el tracker. */
  bonuses: Array<{ key: string; label: string; xp: number }>;
  /** XP base otorgada por la RPC (null hasta su respuesta). */
  baseXpAwarded: number | null;
  /** XP total del vuelo según la RPC (null hasta su respuesta). */
  totalFlightXp: number | null;
  /** Mensaje si la RPC falló. */
  error?: string | null;
}
