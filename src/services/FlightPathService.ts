/**
 * FlightPathService — persistencia del recorrido del vuelo.
 *
 * Inserta el GeoJSON Feature del recorrido en `public.flight_paths`
 * (`flight_id` + `path_data` jsonb). El vaciado del buffer en memoria lo hace
 * el llamador recién cuando el INSERT fue exitoso.
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, okVoid, fail } from "./ServiceResult";
import type { FlightPathFeature } from "./FlightPathRecorder";

export interface FlightCompletionReward {
  baseXpAwarded: number;
  totalFlightXp: number;
  newTotalXp: number;
  newLevel: number | null;
  newRank: string | null;
}

/** Bonos de disciplina + entorno para la RPC unificada. */
export interface FlightCompletionBonuses {
  /** Disciplina operativa actual (desde XpBonusTracker). */
  p_disc_taxi: number;
  p_disc_strobe: number;
  p_disc_landing: number;
  p_disc_beacon: number;
  p_disc_speed: number;
  p_disc_climb: number;
  p_disc_descent: number;
  /** Bonus de entorno/sinergia (calculados en el Desktop, fail-closed a 0). */
  p_ai_synergy?: number;
  p_night_flight?: number;
  p_hard_airport?: number;
  p_weather_severity?: number;
}

export class FlightPathService {
  /**
   * Progresión post-vuelo (RPC unificada): otorga la XP base por tiempo de
   * vuelo junto con los bonos de disciplina en una sola llamada atómica, y
   * devuelve los totales actualizados del piloto. Solo se invoca en cierre
   * normal (flight_status 'ended'), nunca en recuperaciones 'saved' (evita
   * doble otorgamiento si el vuelo se finaliza después).
   */
  static async processFlightCompletion(
    flightId: string,
    userId: string,
    bonuses?: Partial<FlightCompletionBonuses>
  ): Promise<ServiceResult<FlightCompletionReward>> {
    if (!flightId || !userId) {
      return fail("flight_id y user_id son obligatorios para la progresión.");
    }
    const b = bonuses ?? {};
    const params = {
      p_flight_id: flightId,
      p_user_id: userId,
      // Disciplina operativa actual
      p_disc_taxi: b.p_disc_taxi ?? 0,
      p_disc_strobe: b.p_disc_strobe ?? 0,
      p_disc_landing: b.p_disc_landing ?? 0,
      p_disc_beacon: b.p_disc_beacon ?? 0,
      p_disc_speed: b.p_disc_speed ?? 0,
      p_disc_climb: b.p_disc_climb ?? 0,
      p_disc_descent: b.p_disc_descent ?? 0,
      // Bonus de entorno/sinergia (calculados en el Desktop).
      p_ai_synergy: b.p_ai_synergy ?? 0,
      p_night_flight: b.p_night_flight ?? 0,
      p_hard_airport: b.p_hard_airport ?? 0,
      p_weather_severity: b.p_weather_severity ?? 0,
    };
    const callRpc = async (p: Record<string, unknown>) => supabase.rpc("process_flight_completion", p);
    try {
      console.log("[FlightPathService] RPC process_flight_completion → params", {
        flightId,
        ...params,
      });
      let { data, error } = await callRpc(params);
      if (error) {
        const full = describePostgrestError(error);
        // Compatibilidad: si el servidor aún no declara `p_disc_beacon`
        // (migración pendiente), reintentar sin él para no perder el resto
        // de la XP del vuelo. El beacon queda en 0 en ese caso.
        if (/beacon/i.test(full.text)) {
          console.warn("[FlightPathService] Servidor sin p_disc_beacon; reintentando sin beacon:", full.text);
          const { p_disc_beacon: _dropped, ...legacyParams } = params;
          const retry = await callRpc(legacyParams);
          data = retry.data;
          error = retry.error;
          if (!error) {
            console.log("[FlightPathService] Reintento sin beacon OK (beacon=0).");
          }
        }
        if (error) {
          const retryFull = describePostgrestError(error);
          console.error("[FlightPathService] Error en process_flight_completion:", {
            ...retryFull,
            flightId,
          });
          return fail(retryFull.text);
        }
      }
      const row: any = Array.isArray(data) ? data[0] : data;
      const reward: FlightCompletionReward = {
        baseXpAwarded: Number(row?.base_xp_awarded ?? 0) || 0,
        totalFlightXp: Number(row?.total_flight_xp ?? 0) || 0,
        newTotalXp: Number(row?.new_total_xp ?? 0) || 0,
        newLevel: row?.new_level === null || row?.new_level === undefined
          ? null
          : Number(row.new_level) || null,
        newRank: row?.new_rank !== null && row?.new_rank !== undefined
          ? String(row.new_rank)
          : null,
      };
      console.log("[FlightPathService] Progresión otorgada:", { flightId, ...reward });
      return ok(reward);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[FlightPathService] Excepción en process_flight_completion:", message);
      return fail(message);
    }
  }

  /**
   * Guarda el recorrido de un vuelo. Genera el `id` en cliente (la tabla lo
   * tiene como uuid) para no depender del default del servidor.
   */
  static async saveFlightPath(
    flightId: string,
    feature: FlightPathFeature
  ): Promise<ServiceResult<void>> {
    if (!flightId) return fail("flight_id es obligatorio para guardar el recorrido.");

    try {
      const { error } = await supabase.from("flight_paths").insert({
        id: generateUuid(),
        flight_id: flightId,
        path_data: feature,
      });

      if (error) {
        const full = describePostgrestError(error);
        console.error("[FlightPathService] Error al guardar el recorrido:", {
          ...full,
          flightId,
          points: feature.properties.point_count,
        });
        return fail(full.text);
      }

      console.log("[FlightPathService] Recorrido guardado:", {
        flightId,
        points: feature.properties.point_count,
        phase: feature.properties.flight_phase,
      });
      return okVoid();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[FlightPathService] Excepción al guardar el recorrido:", message);
      return fail(message);
    }
  }

  /** Resumen calculado al cierre del vuelo para `public.flights`.
   *
   * Formatos exactos de columna (verificado contra el esquema real):
   *  - `departure_time` / `arrival_time` son `time` → se envían como
   *    `HH:MM:SS` en UTC (coherente con el INSERT programado, que usa
   *    `toISOString().slice(11,19)`). Enviar un ISO completo falla con
   *    `22007 invalid input syntax for type time` (incidente 2026-09-20).
   *  - `departure_date` es `date` → `YYYY-MM-DD` (fecha REAL del despegue).
   *  - `air_time` / `distance_nm` son numéricos.
   */
  static async updateFlightSummary(
    flightId: string,
    summary: FlightSummaryUpdate
  ): Promise<ServiceResult<void>> {
    if (!flightId) return fail("flight_id es obligatorio para actualizar el resumen.");

    const patch: Record<string, number | string> = {};
    if (summary.airTimeMin !== null && summary.airTimeMin !== undefined) {
      patch.air_time = summary.airTimeMin;
    }
    if (summary.distanceNm !== null && summary.distanceNm !== undefined) {
      patch.distance_nm = summary.distanceNm;
    }
    if (summary.departureMs !== null && summary.departureMs !== undefined) {
      patch.departure_date = toUtcDateString(summary.departureMs);
      patch.departure_time = toUtcTimeString(summary.departureMs);
    }
    if (summary.arrivalMs !== null && summary.arrivalMs !== undefined) {
      patch.arrival_time = toUtcTimeString(summary.arrivalMs);
    }
    // Estado de cierre: 'ended' en cierre normal, 'saved' en recuperación de
    // emergencia. Sin esto los vuelos finalizados quedan en 'started' y no se
    // reflejan en las estadísticas globales.
    if (summary.flightStatus === "ended" || summary.flightStatus === "saved") {
      patch.flight_status = summary.flightStatus;
    }

    // Sin ciclo aéreo registrado solo se persiste la distancia del rodaje.
    if (Object.keys(patch).length === 0) return okVoid();

    try {
      const { error } = await supabase.from("flights").update(patch).eq("id", flightId);
      if (error) {
        const full = describePostgrestError(error);
        console.error("[FlightPathService] Error al actualizar el resumen del vuelo:", {
          ...full,
          flightId,
          patch,
        });
        return fail(full.text);
      }
      console.log("[FlightPathService] Resumen del vuelo actualizado:", { flightId, patch });
      return okVoid();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[FlightPathService] Excepción al actualizar el resumen:", message);
      return fail(message);
    }
  }

  /**
   * Recorrido más reciente de un vuelo (`path_data` GeoJSON Feature con
   * geometría LineString). Devuelve `ok(null)` si el vuelo aún no tiene
   * recorrido registrado.
   */
  static async loadFlightPath(flightId: string): Promise<ServiceResult<FlightPathFeature | null>> {
    if (!flightId) return fail("flight_id es obligatorio para leer el recorrido.");
    try {
      const { data, error } = await supabase
        .from("flight_paths")
        .select("path_data")
        .eq("flight_id", flightId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return fail(error.message);
      const feature = (data?.path_data ?? null) as FlightPathFeature | null;
      if (!feature || feature.type !== "Feature") return ok(null);
      return ok(feature);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

export interface FlightSummaryUpdate {
  /** Minutos despegue→toque (null si el ciclo no se completó). */
  airTimeMin?: number | null;
  /** Millas náuticas totales del historial en memoria. */
  distanceNm?: number | null;
  /** Epoch ms del despegue → departure_date + departure_time (UTC). */
  departureMs?: number | null;
  /** Epoch ms del toque → arrival_time (UTC). */
  arrivalMs?: number | null;
  /** Estado de cierre del vuelo: 'ended' (normal) o 'saved' (recuperación). */
  flightStatus?: "ended" | "saved" | null;
}

/** `HH:MM:SS` en UTC (mismo estándar que el INSERT programado). */
export function toUtcTimeString(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** `YYYY-MM-DD` en UTC. */
export function toUtcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UUID v4 con fallback si `crypto.randomUUID` no está disponible. */
function generateUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // continúa con el fallback
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normaliza un error PostgREST al objeto completo (message + code + details +
 * hint) para que los fallos de RLS/validación sean diagnosticables en consola
 * en vez de un mensaje genérico.
 */
function describePostgrestError(error: {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}): { text: string; message: string; code?: string; details?: string | null; hint?: string | null } {
  const parts = [error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return {
    text: parts.join(" | "),
    message: error.message,
    code: error.code,
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
}
