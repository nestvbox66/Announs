/**
 * ProgressionService — sistema de progresión y XP del piloto.
 *
 * - Desglose por vuelo desde `public.flight_xp_breakdown` (filas por regla).
 * - Perfil desde `public.user_progression` (total_xp, current_rank_title).
 * - Horas totales desde `public.flights` con `flight_status = 'ended'`.
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import { BONUS_LABELS } from "./XpBonusExplanations";

export interface XpBonus {
  /** Clave de columna en `flight_xp_breakdown` (para explicaciones). */
  key: string;
  label: string;
  xp: number;
}

export interface FlightXpBreakdown {
  /** Minutos de vuelo usados para la base (air_time) o null. */
  baseMinutes: number | null;
  /** XP base = air_time * XP_PER_MINUTE. */
  baseXp: number;
  /** Bonificaciones de Disciplina Operativa. */
  discipline: XpBonus[];
  /** Bonificaciones de Entorno y Suscripción. */
  environment: XpBonus[];
  /** Bonus de campaña vigente (null si no aplica o aún sin migrar). */
  campaign: { multiplier: number; xp: number } | null;
  /** Bonus de pasajeros (null si no aplica o aún sin migrar). */
  passenger: { xp: number; score: number | null } | null;
  /** Total consolidado del vuelo. */
  totalXp: number;
}

/** XP base por minuto de vuelo. */
export const XP_PER_MINUTE = 10;

/** Etiquetas en español para cada columna de bonus (reexportadas). */
export { BONUS_LABELS };
const DISCIPLINE_KEYS = [
  "disc_taxi_lights_xp",
  "disc_landing_lights_xp",
  "disc_strobe_lights_xp",
  "disc_beacon_lights_xp",
  "disc_speed_limit_xp",
  "disc_vertical_profile_xp",
  "disc_butter_landing_xp",
];

const ENVIRONMENT_KEYS = [
  "ai_companion_synergy_xp",
  "night_flight_bonus_xp",
  "hard_airport_bonus_xp",
  "weather_severity_bonus_xp",
];

const XP_BREAKDOWN_COLUMNS = [
  "base_time_xp",
  ...DISCIPLINE_KEYS,
  ...ENVIRONMENT_KEYS,
  "total_flight_xp",
].join(",");

/**
 * Bonus de campaña de un vuelo (best-effort): lee `campaign_xp` de
 * `flight_xp_breakdown` y `campaign_xp_multiplier` de `flights`. Si las
 * columnas de la migración 20260929_campaign_xp aún no existen (o no hay
 * bonus), devuelve null sin fallar.
 */
async function loadCampaignBonus(
  flightId: string,
  userId: string
): Promise<{ multiplier: number; xp: number } | null> {
  try {
    const [breakdownRes, flightRes] = await Promise.all([
      supabase
        .from("flight_xp_breakdown")
        .select("campaign_xp")
        .eq("flight_id", flightId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("flights")
        .select("campaign_xp_multiplier")
        .eq("id", flightId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (breakdownRes.error || flightRes.error) return null;
    const xp = Math.round(
      Number((breakdownRes.data as unknown as Record<string, unknown> | null)?.campaign_xp ?? 0) || 0
    );
    const mult = Number(
      (flightRes.data as unknown as Record<string, unknown> | null)?.campaign_xp_multiplier ?? 1
    );
    const multiplier = Number.isFinite(mult) && mult > 1 ? Math.round(mult * 100) / 100 : 1;
    if (xp <= 0 && multiplier <= 1) return null;
    return { multiplier, xp: Math.max(0, xp) };
  } catch {
    return null;
  }
}

/**
 * Bonus de pasajeros de un vuelo (best-effort): lee `passenger_xp_awarded` y
 * `global_satisfaction` de `flights`. Si las columnas de la migración de
 * satisfacción aún no existen (o no hay bonus), devuelve null sin fallar.
 */
async function loadPassengerBonus(
  flightId: string,
  userId: string
): Promise<{ xp: number; score: number | null } | null> {
  try {
    const { data, error } = await supabase
      .from("flights")
      .select("passenger_xp_awarded, global_satisfaction")
      .eq("id", flightId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as Record<string, unknown> | null;
    const xp = Math.round(Number(row?.passenger_xp_awarded ?? 0) || 0);
    const rawScore = Number(row?.global_satisfaction);
    const score = Number.isFinite(rawScore) ? Math.round(rawScore) : null;
    if (xp <= 0 && score === null) return null;
    return { xp: Math.max(0, xp), score };
  } catch {
    return null;
  }
}

export class ProgressionService {
  /**
   * Desglose de XP de un vuelo desde `flight_xp_breakdown` (una fila por
   * vuelo). La base es autoritativa (air_time * XP_PER_MINUTE); el total
   * consolidado se lee de `total_flight_xp` con fallback a base + bonos.
   */
  static async loadFlightXp(
    flightId: string,
    airTimeMinutes: number | null
  ): Promise<ServiceResult<FlightXpBreakdown>> {
    const minutes = airTimeMinutes !== null && airTimeMinutes !== undefined && Number.isFinite(airTimeMinutes) && airTimeMinutes > 0
      ? Math.round(airTimeMinutes)
      : null;
    const baseXp = minutes !== null ? minutes * XP_PER_MINUTE : 0;
    const empty: FlightXpBreakdown = { baseMinutes: minutes, baseXp, discipline: [], environment: [], campaign: null, passenger: null, totalXp: baseXp };

    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver el XP del vuelo.");
      }

      const { data, error } = await supabase
        .from("flight_xp_breakdown")
        .select(XP_BREAKDOWN_COLUMNS)
        .eq("flight_id", flightId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return fail(error.message);
      if (!data) return ok(empty);

      const row = data as unknown as Record<string, unknown>;
      const amountOf = (key: string): number => {
        const value = Number(row[key]);
        return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
      };
      const storedBase = Number(row.base_time_xp);
      const storedTotal = Number(row.total_flight_xp);
      const discipline = DISCIPLINE_KEYS.map((key) => ({
        key,
        label: BONUS_LABELS[key],
        xp: amountOf(key),
      }));
      const environment = ENVIRONMENT_KEYS.map((key) => ({
        key,
        label: BONUS_LABELS[key],
        xp: amountOf(key),
      }));
      const bonusesTotal = [...discipline, ...environment].reduce((sum, item) => sum + item.xp, 0);
      // Bonus de campaña (best-effort: columnas de la migración
      // 20260929_campaign_xp; si aún no existen, queda null sin romper).
      const campaign = await loadCampaignBonus(flightId, user.id);
      // Bonus de pasajeros (best-effort: columnas de la migración de
      // satisfacción; si aún no existen, queda null sin romper).
      const passenger = await loadPassengerBonus(flightId, user.id);

      return ok({
        baseMinutes: minutes,
        baseXp: Number.isFinite(storedBase) && storedBase > 0 ? Math.round(storedBase) : baseXp,
        discipline,
        environment,
        campaign,
        passenger,
        totalXp: Number.isFinite(storedTotal) && storedTotal > 0
          ? Math.round(storedTotal)
          : baseXp + bonusesTotal,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** Perfil de progresión del usuario autenticado (con badge del rango). */
  static async loadUserProgression(): Promise<ServiceResult<{
    totalXp: number;
    rankTitle: string | null;
    level: number | null;
    badgeIconUrl: string | null;
  }>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tu progresión.");
      }

      const { data, error } = await supabase
        .from("user_progression")
        .select("total_xp,current_rank_title,current_level")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) return fail(error.message);
      if (!data) {
        return ok({ totalXp: 0, rankTitle: null, level: null, badgeIconUrl: null });
      }
      const row = data as { total_xp?: unknown; current_rank_title?: unknown; current_level?: unknown };
      const rankTitle = row.current_rank_title ? String(row.current_rank_title) : null;

      let badgeIconUrl: string | null = null;
      if (rankTitle) {
        try {
          const { data: rankRow } = await supabase
            .from("ranks_definition")
            .select("badge_icon")
            .eq("rank_title", rankTitle)
            .limit(1)
            .maybeSingle();
          const url = (rankRow as { badge_icon?: unknown } | null)?.badge_icon;
          badgeIconUrl = typeof url === "string" && url.trim() !== "" ? url.trim() : null;
        } catch {
          badgeIconUrl = null;
        }
      }

      return ok({
        totalXp: Number(row.total_xp) || 0,
        rankTitle,
        level: typeof row.current_level === "number" ? row.current_level : Number(row.current_level) || null,
        badgeIconUrl,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** Minutos acumulados de air_time en vuelos finalizados ('ended'). */
  static async loadTotalAirMinutes(): Promise<ServiceResult<number>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida.");
      }

      const { data, error } = await supabase
        .from("flights")
        .select("air_time")
        .eq("user_id", user.id)
        .eq("flight_status", "ended")
        .limit(2000);

      if (error) return fail(error.message);

      let total = 0;
      for (const row of (data ?? []) as Array<{ air_time?: unknown }>) {
        const minutes = parseInt(String(row?.air_time ?? "").trim(), 10);
        if (!Number.isNaN(minutes) && minutes > 0) total += minutes;
      }
      return ok(total);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Progreso hacia el siguiente nivel: XP total, nivel y rango actuales, XP
   * requerida del siguiente rango y porcentaje de avance. Si ya está en el
   * máximo, `nextRankXp` es null y el progreso es 100.
   */
  static async loadLevelProgress(): Promise<ServiceResult<LevelProgress>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tu progreso.");
      }

      const [progRes, ladderRes] = await Promise.all([
        supabase
          .from("user_progression")
          .select("total_xp,current_rank_title,current_level")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("ranks_definition")
          .select("rank_title,xp_required")
          .order("xp_required", { ascending: true }),
      ]);
      if (progRes.error) return fail(progRes.error.message);
      if (ladderRes.error) return fail(ladderRes.error.message);

      const prog = (progRes.data ?? {}) as {
        total_xp?: unknown;
        current_rank_title?: unknown;
        current_level?: unknown;
      };
      const totalXp = Number(prog.total_xp) || 0;
      const level = typeof prog.current_level === "number"
        ? prog.current_level
        : Number(prog.current_level) || null;

      const ladder = ((ladderRes.data ?? []) as Array<{ rank_title?: unknown; xp_required?: unknown }>)
        .map((row) => ({
          title: String(row.rank_title ?? "").trim(),
          xp: Number(row.xp_required) || 0,
        }))
        .filter((row) => row.title !== "")
        .sort((a, b) => a.xp - b.xp);

      let current = ladder.length > 0 ? ladder[0] : { title: "", xp: 0 };
      let next: { title: string; xp: number } | null = null;
      for (const rank of ladder) {
        if (totalXp >= rank.xp) {
          current = rank;
        } else {
          next = rank;
          break;
        }
      }

      if (!next) {
        return ok({
          totalXp,
          level,
          currentRankTitle: current.title || null,
          currentRankXp: current.xp,
          nextRankTitle: null,
          nextRankXp: null,
          xpToNext: 0,
          progressPct: 100,
        });
      }

      const span = Math.max(1, next.xp - current.xp);
      const done = Math.min(Math.max(0, totalXp - current.xp), span);
      return ok({
        totalXp,
        level,
        currentRankTitle: current.title || null,
        currentRankXp: current.xp,
        nextRankTitle: next.title,
        nextRankXp: next.xp,
        xpToNext: Math.max(0, next.xp - totalXp),
        progressPct: Math.round((done / span) * 1000) / 10,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

export interface LevelProgress {
  totalXp: number;
  level: number | null;
  currentRankTitle: string | null;
  currentRankXp: number;
  nextRankTitle: string | null;
  nextRankXp: number | null;
  xpToNext: number;
  progressPct: number;
}
