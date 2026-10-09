/**
 * FlightHistoryService — historial de vuelos recientes del piloto.
 *
 * Lee `public.flights` del usuario autenticado (auth.uid(), con filtro
 * explícito `user_id` además de RLS), ordenado por `created_at DESC` y
 * limitado a los últimos vuelos. El historial solo incluye operaciones
 * completadas (`flight_status = 'ended'`). Resuelve los nombres de ciudad de
 * origen/destino vía `airportService` (DB + caché, fallback hardcodeado).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import { getAirportCity, getAirportByIcao } from "./airportService";
import { getAirlineName } from "../utils/airlineMapping";
import { hasAircraftSilhouette } from "../utils/aircraftSilhouettes";
import { formatDepartLabel, formatShortDate, formatDuration, parseDurationMinutes } from "./flightHistoryFormat";

export interface FlightHistoryEntry {
  flightId: string;
  airline: string;
  flightNumber: string;
  departIcao: string;
  arriveIcao: string;
  departCity: string;
  arriveCity: string;
  /** Etiqueta amigable de partida ("20 sept 2026, 14:15") o "—". */
  departLabel: string;
  /** Etiqueta corta para la ficha de detalle. */
  fechaCorta: string;
  /** Duración ("1h 10m") o "—". */
  durationLabel: string;
  createdAt: string | null;
  /** Satisfacción global final (`flights.global_satisfaction`) o null. */
  globalSatisfaction: number | null;
}

/** Satisfacción de pasajeros de un vuelo (`flights`, best-effort). */
export interface FlightPassengerReport {
  flightId: string;
  /** Score final 0-100 o null (sin dato / migración sin aplicar). */
  globalSatisfaction: number | null;
  /** Niveles de necesidad 0-100 (bajo = bien) o null. */
  attributesSummary: {
    hunger: number;
    bladder: number;
    fear: number;
    boredom: number;
  } | null;
  /** XP otorgada por pasajeros o null. */
  passengerXpAwarded: number | null;
}

/** Ficha completa de un vuelo para la pantalla de detalle. */
export interface FlightDetailData {
  flightId: string;
  flightNumber: string;
  airline: string;
  /** Código ICAO de la aerolínea (para el banner; puede venir vacío). */
  airlineIcao: string | null;
  aircraft: string;
  aircraftReg: string;
  /** Categoría del avión para la silueta (de `flights.aircraft_type`). */
  aircraftCategory: string | null;
  originIcao: string;
  originName: string;
  originCity: string;
  originLat: number | null;
  originLon: number | null;
  destIcao: string;
  destName: string;
  destCity: string;
  destLat: number | null;
  destLon: number | null;
  departLabel: string;
  departTime: string;
  arriveTime: string;
  durationLabel: string;
  /** Minutos crudos de duración (para "X Minutos") o null. */
  durationMinutes: number | null;
  /** Fecha y hora de creación del registro ("20 sept 2026, 21:33") o "—". */
  createdLabel: string;
  status: string | null;
  /** URL pública de la "Foto de la Sesión" (`flights.photo_url`) o null. */
  photoUrl: string | null;
}

interface FlightRow {
  id: string;
  saved_flight?: string | null;
  airlane_icao?: string | null;
  flight_number?: string | null;
  depart_icao?: string | null;
  arrive_icao?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  air_time?: string | null;
  block_time?: string | null;
  flight_status?: string | null;
  created_at?: string | null;
  photo_url?: string | null;
}

export const FLIGHT_HISTORY_PAGE_SIZE = 10;

export interface FlightHistoryPage {
  entries: FlightHistoryEntry[];
  total: number;
}

export class FlightHistoryService {
  /**
   * Página de vuelos del usuario autenticado (más recientes primero).
   * Filtro estricto: solo operaciones completadas (`flight_status = 'ended'`);
   * los vuelos en curso, cancelados o en estados intermedios no se listan.
   * Nunca falla por lista vacía: sin vuelos devuelve página vacía con total 0.
   */
  static async loadRecentFlights(
    limit: number = FLIGHT_HISTORY_PAGE_SIZE,
    offset: number = 0
  ): Promise<ServiceResult<FlightHistoryPage>> {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver tu historial.");
      }

      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || FLIGHT_HISTORY_PAGE_SIZE));
      const safeOffset = Math.max(0, Math.floor(offset) || 0);
      const { data, error, count } = await supabase
        .from("flights")
        .select("id, saved_flight, airlane_icao, flight_number, depart_icao, arrive_icao, departure_date, departure_time, air_time, block_time, flight_status, created_at", { count: "exact" })
        .eq("user_id", user.id)
        .eq("flight_status", "ended")
        .order("created_at", { ascending: false })
        .range(safeOffset, safeOffset + safeLimit - 1);

      if (error) return fail(error.message);

      const rows = (data ?? []) as FlightRow[];
      if (rows.length === 0) return ok({ entries: [], total: count ?? 0 });

      // Resolver ciudades una sola vez por ICAO distinto.
      const icaos = Array.from(
        new Set(
          rows.flatMap((row) => [row.depart_icao ?? "", row.arrive_icao ?? ""])
            .map((code) => code.toUpperCase().trim())
            .filter(Boolean)
        )
      );
      const cityByIcao = new Map<string, string>();
      await Promise.all(
        icaos.map(async (code) => {
          try {
            cityByIcao.set(code, await getAirportCity(code));
          } catch {
            cityByIcao.set(code, code);
          }
        })
      );

      const entries: FlightHistoryEntry[] = rows.map((row) =>
        mapRowToEntry(row, cityByIcao)
      );
      // Satisfacción por vuelo (best-effort): si las columnas de la migración
      // de satisfacción aún no existen, la consulta falla y queda null.
      try {
        const ids = entries.map((e) => e.flightId);
        if (ids.length > 0) {
          const { data: paxRows, error: paxErr } = await supabase
            .from("flights")
            .select("id, global_satisfaction")
            .eq("user_id", user.id)
            .in("id", ids);
          if (!paxErr && Array.isArray(paxRows)) {
            const scoreById = new Map<string, number | null>();
            for (const r of paxRows as Array<{ id: string; global_satisfaction?: unknown }>) {
              const n = Number(r.global_satisfaction);
              scoreById.set(r.id, Number.isFinite(n) ? n : null);
            }
            for (const e of entries) {
              if (scoreById.has(e.flightId)) {
                e.globalSatisfaction = scoreById.get(e.flightId) ?? null;
              }
            }
          }
        }
      } catch {
        // Sin dato de satisfacción: las entradas conservan null.
      }
      return ok({ entries, total: count ?? entries.length });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Ficha completa de un vuelo por `flight_id` (cabecera + panel de ruta del
   * detalle). Resuelve nombres de aeropuertos vía `airports`.
   */
  static async loadFlightDetail(flightId: string): Promise<ServiceResult<FlightDetailData | null>> {
    if (!flightId) return fail("flight_id es obligatorio.");
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para ver el detalle.");
      }

      const { data, error } = await supabase
        .from("flights")
        .select("id, saved_flight, airlane_icao, flight_number, atc_callsign, depart_icao, arrive_icao, aircraft_type, variant_airframe, airframe, departure_date, departure_time, arrival_time, air_time, block_time, flight_status, photo_url, created_at")
        .eq("id", flightId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) return fail(error.message);
      if (!data) return ok(null);

      const row = data as FlightRow & {
        atc_callsign?: string | null;
        aircraft_type?: string | null;
        variant_airframe?: string | null;
        airframe?: string | null;
        arrival_time?: string | null;
        photo_url?: string | null;
      };
      const departIcao = (row.depart_icao ?? "").toUpperCase().trim();
      const arriveIcao = (row.arrive_icao ?? "").toUpperCase().trim();

      const [origin, dest, aircraftCat] = await Promise.all([
        departIcao ? getAirportByIcao(departIcao).catch(() => null) : Promise.resolve(null),
        arriveIcao ? getAirportByIcao(arriveIcao).catch(() => null) : Promise.resolve(null),
        // `flights.aircraft_type` ya trae la categoría (p. ej. "B737"); solo se
        // consulta `aircraft_types` como respaldo si no hay imagen local.
        resolveAircraftCategory(row.aircraft_type),
      ]);

      const aircraft = [row.aircraft_type, row.variant_airframe].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || "—";
      const departTime = (row.departure_time ?? "").trim().slice(0, 5) || "—";
      const arriveTime = (row.arrival_time ?? "").trim().slice(0, 5) || "—";

      return ok({
        flightId: row.id,
        flightNumber: row.saved_flight?.trim() || row.flight_number?.trim() || "—",
        airline: getAirlineName(row.airlane_icao ?? ""),
        airlineIcao: (row.airlane_icao ?? "").toUpperCase().trim() || null,
        aircraft,
        aircraftReg: (row.airframe ?? "").trim() || "—",
        aircraftCategory: aircraftCat,
        originIcao: departIcao || "—",
        originName: origin?.name || departIcao || "—",
        originCity: origin?.municipality || departIcao || "—",
        originLat: origin?.latitude_deg ?? null,
        originLon: origin?.longitude_deg ?? null,
        destIcao: arriveIcao || "—",
        destName: dest?.name || arriveIcao || "—",
        destCity: dest?.municipality || arriveIcao || "—",
        destLat: dest?.latitude_deg ?? null,
        destLon: dest?.longitude_deg ?? null,
        departLabel: formatDepartLabel(row.departure_date, row.departure_time, row.created_at),
        departTime,
        arriveTime,
        durationLabel: formatDuration(row.air_time, row.block_time),
        durationMinutes: parseDurationMinutes(row.air_time, row.block_time),
        createdLabel: formatDepartLabel(null, null, row.created_at),
        status: row.flight_status ?? null,
        photoUrl: (row.photo_url ?? "").trim() || null,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}

/** Categoría para la silueta: el valor directo de `flights.aircraft_type`, con
 * respaldo a `aircraft_types.category` solo si no hay imagen local. */
async function resolveAircraftCategory(aircraftType: string | null | undefined): Promise<string | null> {
  const direct = (aircraftType ?? "").trim();
  if (direct && hasAircraftSilhouette(direct)) {
    return direct.toUpperCase();
  }
  const code = direct.toUpperCase();
  if (!code) return null;
  try {
    const { data, error } = await supabase
      .from("aircraft_types")
      .select("category")
      .eq("icao_code", code)
      .limit(1)
      .maybeSingle();
    if (error || !data) return direct || null;
    const category = ((data as { category?: unknown }).category ?? "").toString().trim();
    return category ? category.toUpperCase() : direct || null;
  } catch {
    return direct || null;
  }
}

function mapRowToEntry(row: FlightRow, cityByIcao: Map<string, string>): FlightHistoryEntry {  const departIcao = (row.depart_icao ?? "").toUpperCase().trim();
  const arriveIcao = (row.arrive_icao ?? "").toUpperCase().trim();
  const flightNumber = row.saved_flight?.trim() || row.flight_number?.trim() || "—";

  return {
    flightId: row.id,
    airline: getAirlineName(row.airlane_icao ?? ""),
    flightNumber,
    departIcao,
    arriveIcao,
    departCity: cityByIcao.get(departIcao) ?? departIcao,
    arriveCity: cityByIcao.get(arriveIcao) ?? arriveIcao,
    departLabel: formatDepartLabel(row.departure_date, row.departure_time, row.created_at),
    fechaCorta: formatShortDate(row.departure_date, row.created_at),
    durationLabel: formatDuration(row.air_time, row.block_time),
    createdAt: row.created_at ?? null,
    globalSatisfaction: null,
  };
}

/**
 * Reporte de satisfacción de un vuelo (`flights.global_satisfaction`,
 * `passenger_attributes_summary`, `passenger_xp_awarded`). Best-effort:
 * sin dato o sin migración aplicada devuelve campos null, nunca falla.
 */export async function loadFlightPassengerReport(
  flightId: string
): Promise<FlightPassengerReport> {
  const empty: FlightPassengerReport = {
    flightId,
    globalSatisfaction: null,
    attributesSummary: null,
    passengerXpAwarded: null,
  };
  if (!flightId) return empty;
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return empty;
    const { data, error } = await supabase
      .from("flights")
      .select("id, global_satisfaction, passenger_attributes_summary, passenger_xp_awarded")
      .eq("id", flightId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return empty;
    const row = data as {
      global_satisfaction?: unknown;
      passenger_attributes_summary?: unknown;
      passenger_xp_awarded?: unknown;
    };
    const score = Number(row.global_satisfaction);
    const xp = Number(row.passenger_xp_awarded);
    let attrs: FlightPassengerReport["attributesSummary"] = null;
    const raw = row.passenger_attributes_summary as Record<string, unknown> | null;
    if (raw && typeof raw === "object") {
      const num = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
      };
      const hunger = num(raw.hunger);
      const bladder = num(raw.bladder);
      const fear = num(raw.fear);
      const boredom = num(raw.boredom);
      if (hunger !== null && bladder !== null && fear !== null && boredom !== null) {
        attrs = { hunger, bladder, fear, boredom };
      }
    }
    return {
      flightId,
      globalSatisfaction: Number.isFinite(score) ? score : null,
      attributesSummary: attrs,
      passengerXpAwarded: Number.isFinite(xp) ? xp : null,
    };
  } catch {
    return empty;
  }
}

/** Voz del personal usada en el vuelo (nombre + foto, best-effort). */
export interface FlightVoiceInfo {
  name: string;
  avatarUrl: string | null;
}

/** Idioma de los anuncios del vuelo (nombre + bandera, best-effort). */
export interface FlightLanguageInfo {
  name: string;
  /** URL de la bandera (`languages.flag_URL`) o null (la UI usa emoji). */
  flagUrl: string | null;
}

/** Personal e idioma de los anuncios de un vuelo (pestaña Anuncios). */
export interface FlightCrewReport {
  flightId: string;
  language: FlightLanguageInfo | null;
  captain: FlightVoiceInfo | null;
  /** Voz de puerta/embarque (preferencia vigente: no se persiste por vuelo). */
  boarding: FlightVoiceInfo | null;
  crew: FlightVoiceInfo | null;
}

/**
 * Personal e idioma de los anuncios de un vuelo. Best-effort: captain/crew e
 * idioma salen de la fila `flights` (guardados al iniciar); la voz de puerta
 * sale de `flights.voice_gate_id` y, si la columna aún no existe o viene
 * vacía, de la preferencia vigente (`setting_general`, misma fuente que usa
 * `audio-get`). Sin dato → null.
 */
export async function loadFlightCrewReport(
  flightId: string
): Promise<FlightCrewReport> {
  const empty: FlightCrewReport = {
    flightId,
    language: null,
    captain: null,
    boarding: null,
    crew: null,
  };
  if (!flightId) return empty;
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return empty;

    const { data: flightRow, error: flightErr } = await supabase
      .from("flights")
      .select("id, lang_primary_id, voice_captain_id, voice_crew_id")
      .eq("id", flightId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (flightErr || !flightRow) return empty;
    const flight = flightRow as {
      lang_primary_id?: unknown;
      voice_captain_id?: unknown;
      voice_crew_id?: unknown;
    };
    const langId = String(flight.lang_primary_id ?? "").trim() || null;
    const captainId = String(flight.voice_captain_id ?? "").trim() || null;
    const crewId = String(flight.voice_crew_id ?? "").trim() || null;

    // Voz de puerta del vuelo (columna nueva; best-effort por separado para
    // no romper la consulta principal si la migración aún no se aplicó).
    let flightGateId: string | null = null;
    try {
      const { data: gateRow, error: gateErr } = await supabase
        .from("flights")
        .select("voice_gate_id")
        .eq("id", flightId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!gateErr && gateRow) {
        flightGateId =
          String((gateRow as { voice_gate_id?: unknown }).voice_gate_id ?? "").trim() || null;
      }
    } catch {
      flightGateId = null;
    }

    const [langRes, voicesRes, gateRes] = await Promise.all([
      langId
        ? supabase.from("languages").select("id, language_name, flag_URL").eq("id", langId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      (() => {
        const ids = [captainId, crewId].filter((v): v is string => v !== null);
        if (ids.length === 0) return Promise.resolve({ data: [], error: null });
        return supabase.from("voices_stock").select("id, voice_name, avatar_url").in("id", ids);
      })(),
      // Preferencia vigente como respaldo (o única fuente si la columna del
      // vuelo aún no existe).
      supabase
        .from("setting_general")
        .select("gate_agent_voice_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    let language: FlightLanguageInfo | null = null;
    if (!langRes.error && langRes.data) {
      const row = langRes.data as { language_name?: unknown; flag_URL?: unknown };
      const name = String(row.language_name ?? "").trim();
      if (name) {
        const flag = String(row.flag_URL ?? "").trim();
        language = { name, flagUrl: flag || null };
      }
    }

    const voiceById = new Map<string, FlightVoiceInfo>();
    if (!voicesRes.error && Array.isArray(voicesRes.data)) {
      for (const v of voicesRes.data as Array<{ id?: unknown; voice_name?: unknown; avatar_url?: unknown }>) {
        const id = String(v.id ?? "").trim();
        const name = String(v.voice_name ?? "").trim();
        if (id && name) {
          const avatar = String(v.avatar_url ?? "").trim();
          voiceById.set(id, { name, avatarUrl: avatar || null });
        }
      }
    }

    // Voz de puerta: primero la guardada en el vuelo (`voice_gate_id`);
    // si no hay (columna sin migrar o vuelo viejo), la preferencia vigente.
    let boarding: FlightVoiceInfo | null = null;
    const prefGateId = String(
      (gateRes.data as { gate_agent_voice_id?: unknown } | null)?.gate_agent_voice_id ?? ""
    ).trim() || null;
    const gateId = flightGateId ?? (gateRes.error ? null : prefGateId);
    if (gateId) {
      const known = voiceById.get(gateId);
      if (known) {
        boarding = known;
      } else {
        try {
          const { data: gv, error: gvErr } = await supabase
            .from("voices_stock")
            .select("id, voice_name, avatar_url")
            .eq("id", gateId)
            .maybeSingle();
          if (!gvErr && gv) {
            const row = gv as { voice_name?: unknown; avatar_url?: unknown };
            const name = String(row.voice_name ?? "").trim();
            if (name) {
              const avatar = String(row.avatar_url ?? "").trim();
              boarding = { name, avatarUrl: avatar || null };
            }
          }
        } catch {
          boarding = null;
        }
      }
    }

    return {
      flightId,
      language,
      captain: captainId ? voiceById.get(captainId) ?? null : null,
      boarding,
      crew: crewId ? voiceById.get(crewId) ?? null : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Anuncio entregado en un vuelo (`flight_audio_deliveries`, orden
 * cronológico). Título resuelto del catálogo local o clave legible.
 */
export interface FlightAudioDelivery {
  id: string;
  eventKey: string;
  title: string;
  deliveredAt: string | null;
  audioUrl: string | null;
  messageText: string | null;
  /** Nombre de la voz que narró (`voices_stock.voice_name`) o null. */
  narrator: string | null;
}

/** `cruise_crew_service_info` → "Cruise Crew Service Info". */
function prettifyEventKey(key: string): string {
  const clean = String(key ?? "").trim().replace(/[_-]+/g, " ").trim();
  if (!clean) return "Anuncio";
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Historial de anuncios entregados de un vuelo (pestaña Anuncios del
 * reporte). Best-effort: sin tabla o sin filas devuelve [] (la UI muestra
 * estado vacío). Los títulos salen del catálogo local cuando existe.
 */
export async function loadFlightAudioDeliveries(
  flightId: string
): Promise<FlightAudioDelivery[]> {
  if (!flightId) return [];
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return [];
    const baseSelect = (withVoice: boolean) =>
      supabase
        .from("flight_audio_deliveries")
        .select(
          withVoice
            ? "id, event_id, delivered_at, audio_url, message_text, voice_id"
            : "id, event_id, delivered_at, audio_url, message_text"
        )
        .eq("flight_id", flightId)
        .order("delivered_at", { ascending: true });
    let { data, error } = await baseSelect(true);
    if (error && /voice_id/i.test(error.message)) {
      // Columna de narrador aún sin migrar: reintentar sin ella.
      ({ data, error } = await baseSelect(false));
    }
    if (error || !data) return [];
    const rows = data as Array<{
      id?: unknown;
      event_id?: unknown;
      delivered_at?: unknown;
      audio_url?: unknown;
      message_text?: unknown;
      voice_id?: unknown;
    }>;
    if (rows.length === 0) return [];

    // voice_id → nombre de la voz (narrador de la tarjeta).
    const narratorById = new Map<string, string>();
    try {
      const voiceIds = Array.from(
        new Set(rows.map((r) => String(r.voice_id ?? "").trim()).filter(Boolean))
      );
      if (voiceIds.length > 0) {
        const { data: voices, error: voicesErr } = await supabase
          .from("voices_stock")
          .select("id, voice_name")
          .in("id", voiceIds);
        if (!voicesErr && Array.isArray(voices)) {
          for (const v of voices as Array<{ id?: unknown; voice_name?: unknown }>) {
            const id = String(v.id ?? "").trim();
            const name = String(v.voice_name ?? "").trim();
            if (id && name) narratorById.set(id, name);
          }
        }
      }
    } catch {
      // Sin narradores: las tarjetas quedan sin narrador.
    }

    // event_id → event_key (best-effort para titular cada tarjeta).
    const keyById = new Map<string, string>();
    try {
      const ids = Array.from(
        new Set(rows.map((r) => String(r.event_id ?? "").trim()).filter(Boolean))
      );
      if (ids.length > 0) {
        const { data: evts, error: evtsErr } = await supabase
          .from("events")
          .select("id, event_key")
          .in("id", ids);
        if (!evtsErr && Array.isArray(evts)) {
          for (const e of evts as Array<{ id?: unknown; event_key?: unknown }>) {
            const id = String(e.id ?? "").trim();
            const key = String(e.event_key ?? "").trim();
            if (id && key) keyById.set(id, key);
          }
        }
      }
    } catch {
      // Sin títulos remotos: se usa la clave legible o el id.
    }

    const { EventCatalogService } = await import("../events/EventCatalogService");
    return rows.map((r) => {
      const eventId = String(r.event_id ?? "").trim();
      const eventKey = keyById.get(eventId) ?? eventId;
      let title = eventKey;
      try {
        const def = EventCatalogService.get(eventKey) as { description?: unknown } | undefined;
        const desc = String(def?.description ?? "").trim();
        title = desc || prettifyEventKey(eventKey);
      } catch {
        title = prettifyEventKey(eventKey);
      }
      const audio = String(r.audio_url ?? "").trim();
      const text = String(r.message_text ?? "").trim();
      const voiceId = String(r.voice_id ?? "").trim();
      return {
        id: String(r.id ?? `${eventId}-${String(r.delivered_at ?? "")}`),
        eventKey,
        title,
        deliveredAt: typeof r.delivered_at === "string" ? r.delivered_at : null,
        audioUrl: audio || null,
        messageText: text || null,
        narrator: (voiceId ? narratorById.get(voiceId) : undefined) ?? null,
      };
    });
  } catch {
    return [];
  }
}
