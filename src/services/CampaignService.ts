/**
 * CampaignService — campañas activas ("Campaña Activa" en la sección Volar).
 *
 * Tablas (lectura pública, mismo patrón que `of_*`):
 *  - `weekly_campaigns` (id, title, description, image_url, start_date,
 *    end_date, is_active): campañas con vigencia por fecha.
 *  - `weekly_campaign_flights` (campaign_id, origin_icao, destination_icao,
 *    aircraft_icao, airline_code, xp_multiplier, sort_order, description,
 *    flight_number, departure_time, metar): los vuelos de cada campaña.
 *
 * Una campaña está vigente si `is_active = true` y la fecha actual (UTC)
 * cae dentro de [start_date, end_date].
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";
import { hasAircraftSilhouette } from "../utils/aircraftSilhouettes";
import { getAirlineName } from "../utils/airlineMapping";

export interface CampaignFlight {
  id: string;
  campaignId: string;
  originIcao: string;
  destinationIcao: string;
  /** Nombre del aeropuerto de origen ("" si no se resolvió). */
  originName: string;
  /** Nombre del aeropuerto de destino ("" si no se resolvió). */
  destinationName: string;
  aircraftIcao: string;
  /** Nombre del tipo de avión (ej. "Boeing 737-800", "" si no se resolvió). */
  aircraftName: string;
  /**
   * Categoría para la silueta: el ICAO directo si hay imagen local, si no
   * `aircraft_types.category` (los archivos se nombran por categoría,
   * p. ej. "B737", no por código ICAO/IATA).
   */
  aircraftCategory: string;
  airlineCode: string;
  /** Nombre de la aerolínea ("" si no se resolvió). */
  airlineName: string;
  xpMultiplier: number;
  sortOrder: number;
  description: string;
  flightNumber: string;
  departureTime: string;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  startDate: string;
  endDate: string;
  flights: CampaignFlight[];
}

/** Asociación de un plan importado con un vuelo de campaña vigente. */
export interface CampaignMatch {
  campaignId: string;
  campaignTitle: string;
  campaignFlightId: string;
  xpMultiplier: number;
}

/** Vuelo de campaña finalizado por el usuario (HUB, recientes primero). */
export interface CampaignFlightHistoryEntry {
  flightId: string;
  campaignId: string;
  campaignTitle: string;
  campaignImageUrl: string;
  campaignFlightId: string | null;
  flightNumber: string;
  originIcao: string;
  destinationIcao: string;
  /** Nombre del aeropuerto de origen ("" si no se resolvió). */
  originName: string;
  /** Nombre del aeropuerto de destino ("" si no se resolvió). */
  destinationName: string;
  /** Código de aerolínea ("" si no hay). */
  airlineCode: string;
  /** Nombre de la aerolínea ("" si no se resolvió). */
  airlineName: string;
  /** ICAO del avión ("" si no hay). */
  aircraftIcao: string;
  /** Nombre del avión ("" si no se resolvió). */
  aircraftName: string;
  /** Multiplicador aplicado (de la fila del vuelo) o null. */
  xpMultiplier: number | null;
  createdAt: string | null;
  /** Puntos ganados (`flight_xp_breakdown.total_flight_xp`) o null. */
  totalXp: number | null;
  /** Satisfacción global final (`flights.global_satisfaction`) o null. */
  globalSatisfaction: number | null;
  /** XP de pasajeros (`flights.passenger_xp_awarded`) o null. */
  passengerXpAwarded: number | null;
}

interface CampaignRow {
  id: unknown;
  title: unknown;
  description: unknown;
  image_url: unknown;
  start_date: unknown;
  end_date: unknown;
}

interface CampaignFlightRow {
  id: unknown;
  campaign_id: unknown;
  origin_icao: unknown;
  destination_icao: unknown;
  aircraft_icao: unknown;
  airline_code: unknown;
  xp_multiplier: unknown;
  sort_order: unknown;
  description: unknown;
  flight_number: unknown;
  departure_time: unknown;
}

function toCampaign(row: CampaignRow, flights: CampaignFlight[]): Campaign {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "").trim() || "—",
    description: String(row.description ?? "").trim(),
    imageUrl: String(row.image_url ?? "").trim(),
    startDate: String(row.start_date ?? ""),
    endDate: String(row.end_date ?? ""),
    flights,
  };
}

function toFlight(
  row: CampaignFlightRow,
  names: {
    airports: Map<string, string>;
    airlines: Map<string, string>;
    aircraft: Map<string, string>;
    categories: Map<string, string>;
  }
): CampaignFlight {
  const mult = Number(row.xp_multiplier);
  const originIcao = String(row.origin_icao ?? "").trim().toUpperCase();
  const destinationIcao = String(row.destination_icao ?? "").trim().toUpperCase();
  const aircraftIcao = String(row.aircraft_icao ?? "").trim().toUpperCase();
  const airlineCode = String(row.airline_code ?? "").trim().toUpperCase();
  return {
    id: String(row.id ?? ""),
    campaignId: String(row.campaign_id ?? ""),
    originIcao,
    destinationIcao,
    originName: names.airports.get(originIcao) ?? "",
    destinationName: names.airports.get(destinationIcao) ?? "",
    aircraftIcao,
    aircraftName: names.aircraft.get(aircraftIcao) ?? "",
    aircraftCategory: resolveSilhouetteCategory(aircraftIcao, names.categories),
    airlineCode,
    airlineName: names.airlines.get(airlineCode) ?? "",
    xpMultiplier: Number.isFinite(mult) && mult > 0 ? mult : 1,
    sortOrder: Number(row.sort_order ?? 0) || 0,
    description: String(row.description ?? "").trim(),
    flightNumber: String(row.flight_number ?? "").trim(),
    departureTime: String(row.departure_time ?? "").trim(),
  };
}

/**
 * Categoría para la silueta: el ICAO directo si hay imagen local con ese
 * nombre; si no, `aircraft_types.category` (p. ej. B38M → B737). Si nada
 * resuelve, el ICAO original (la UI cae al genérico `NULL`).
 */
function resolveSilhouetteCategory(
  aircraftIcao: string,
  categories: Map<string, string>
): string {
  if (!aircraftIcao) return "";
  if (hasAircraftSilhouette(aircraftIcao)) return aircraftIcao.toUpperCase();
  return categories.get(aircraftIcao) ?? aircraftIcao;
}

/**
 * Resuelve nombres para mostrar (best-effort, nunca falla):
 * aeropuertos desde `of_airports` (icao → name), aerolíneas desde
 * `of_airlines` (icao → name) y aviones desde `of_planes` (icao_code → name).
 */
async function resolveDisplayNames(flights: CampaignFlightRow[]): Promise<{
  airports: Map<string, string>;
  airlines: Map<string, string>;
  aircraft: Map<string, string>;
  categories: Map<string, string>;
}> {
  const empty = {
    airports: new Map<string, string>(),
    airlines: new Map<string, string>(),
    aircraft: new Map<string, string>(),
    categories: new Map<string, string>(),
  };
  try {
    const airportIcaos = Array.from(new Set(
      flights.flatMap((f) => [
        String(f.origin_icao ?? "").trim().toUpperCase(),
        String(f.destination_icao ?? "").trim().toUpperCase(),
      ]).filter((c) => c !== "")
    ));
    const airlineIcaos = Array.from(new Set(
      flights.map((f) => String(f.airline_code ?? "").trim().toUpperCase()).filter((c) => c !== "")
    ));
    const aircraftIcaos = Array.from(new Set(
      flights.map((f) => String(f.aircraft_icao ?? "").trim().toUpperCase()).filter((c) => c !== "")
    ));
    const [airportsRes, airlinesRes, planesRes, typesRes] = await Promise.all([
      airportIcaos.length > 0
        ? supabase.from("of_airports").select("icao, name").in("icao", airportIcaos)
        : Promise.resolve({ data: [], error: null }),
      airlineIcaos.length > 0
        ? supabase.from("of_airlines").select("icao, name").in("icao", airlineIcaos)
        : Promise.resolve({ data: [], error: null }),
      aircraftIcaos.length > 0
        ? supabase.from("of_planes").select("icao_code, name").in("icao_code", aircraftIcaos)
        : Promise.resolve({ data: [], error: null }),
      aircraftIcaos.length > 0
        ? supabase.from("aircraft_types").select("icao_code, category").in("icao_code", aircraftIcaos)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const airports = new Map<string, string>();
    for (const a of ((airportsRes.data ?? []) as Array<{ icao: unknown; name: unknown }>)) {
      const code = String(a.icao ?? "").trim().toUpperCase();
      const name = String(a.name ?? "").trim();
      if (code && name) airports.set(code, name);
    }
    const airlines = new Map<string, string>();
    for (const a of ((airlinesRes.data ?? []) as Array<{ icao: unknown; name: unknown }>)) {
      const code = String(a.icao ?? "").trim().toUpperCase();
      const name = String(a.name ?? "").trim();
      if (code && name && !["N/A", "-", "NA"].includes(name.toUpperCase())) airlines.set(code, name);
    }
    const aircraft = new Map<string, string>();
    for (const a of ((planesRes.data ?? []) as Array<{ icao_code: unknown; name: unknown }>)) {
      const code = String(a.icao_code ?? "").trim().toUpperCase();
      const name = String(a.name ?? "").trim();
      if (code && name) aircraft.set(code, name);
    }
    const categories = new Map<string, string>();
    for (const a of ((typesRes.data ?? []) as Array<{ icao_code: unknown; category: unknown }>)) {
      const code = String(a.icao_code ?? "").trim().toUpperCase();
      const category = String(a.category ?? "").trim().toUpperCase();
      if (code && category) categories.set(code, category);
    }
    return { airports, airlines, aircraft, categories };
  } catch {
    return empty;
  }
}

/**
 * Campañas vigentes: `is_active = true` y hoy dentro de
 * [start_date, end_date]. Cada campaña incluye sus vuelos ordenados por
 * `sort_order`. Sin vigentes → `ok([])` (la UI muestra estado vacío).
 */
export async function loadActiveCampaigns(
  now: Date = new Date()
): Promise<ServiceResult<Campaign[]>> {
  try {
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const { data: campaigns, error: campaignsError } = await supabase
      .from("weekly_campaigns")
      .select("id, title, description, image_url, start_date, end_date")
      .eq("is_active", true)
      .lte("start_date", `${today}T23:59:59.999Z`)
      .gte("end_date", `${today}T00:00:00.000Z`)
      .order("start_date", { ascending: true });
    if (campaignsError) return fail(campaignsError.message);
    const rows = ((campaigns ?? []) as CampaignRow[]).filter((r) => String(r.id ?? "") !== "");
    if (rows.length === 0) return ok([]);

    const ids = rows.map((r) => String(r.id));
    const { data: flights, error: flightsError } = await supabase
      .from("weekly_campaign_flights")
      .select(
        "id, campaign_id, origin_icao, destination_icao, aircraft_icao, airline_code, " +
        "xp_multiplier, sort_order, description, flight_number, departure_time"
      )
      .in("campaign_id", ids)
      .order("sort_order", { ascending: true });
    if (flightsError) return fail(flightsError.message);

    const byCampaign = new Map<string, CampaignFlight[]>();
    const names = await resolveDisplayNames((flights ?? []) as unknown as CampaignFlightRow[]);
    for (const f of ((flights ?? []) as unknown as CampaignFlightRow[])) {
      const flight = toFlight(f, names);
      if (!flight.id || !flight.campaignId) continue;
      const list = byCampaign.get(flight.campaignId) ?? [];
      list.push(flight);
      byCampaign.set(flight.campaignId, list);
    }
    return ok(rows.map((r) => toCampaign(r, byCampaign.get(String(r.id)) ?? [])));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Match blando contra vuelos de campañas vigentes: coinciden origen y
 * destino (ICAO, insensible a mayúsculas/espacios). Devuelve la primera
 * coincidencia en orden de campaña/vuelo, o null.
 */
export function findCampaignFlightMatch(
  campaigns: Campaign[],
  originIcao: string,
  destIcao: string
): CampaignMatch | null {
  const origin = (originIcao ?? "").trim().toUpperCase();
  const dest = (destIcao ?? "").trim().toUpperCase();
  if (!origin || !dest) return null;
  for (const campaign of campaigns) {
    for (const flight of campaign.flights) {
      if (flight.originIcao === origin && flight.destinationIcao === dest) {
        return {
          campaignId: campaign.id,
          campaignTitle: campaign.title,
          campaignFlightId: flight.id,
          xpMultiplier: flight.xpMultiplier,
        };
      }
    }
  }
  return null;
}

/** Formatea un multiplicador como "×1.2" (sin decimales si es entero). */
export function formatMultiplier(mult: number): string {
  if (!Number.isFinite(mult) || mult <= 0) return "×1";
  return `×${String(Math.round(mult * 100) / 100)}`;
}

/**
 * Historial de vuelos de campaña del usuario: `flights` finalizados
 * (`flight_status = 'ended'`) con `campaign_id` no nulo, de más recientes a
 * más antiguos, enriquecidos con campaña, vuelo de campaña, puntos y
 * satisfacción. Todo best-effort salvo la consulta base: si las columnas de
 * campaña aún no existen, devuelve lista vacía; el resto de faltantes queda
 * en null sin romper.
 */
export async function loadCampaignFlightHistory(): Promise<
  ServiceResult<CampaignFlightHistoryEntry[]>
> {
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return fail("Sesión no válida: iniciá sesión para ver tus campañas.");
    }

    // 1) Vuelos de campaña finalizados (con columnas de satisfacción si existen).
    let rows: Array<Record<string, unknown>> | null = null;
    {
      const baseCols =
        "id, saved_flight, flight_number, depart_icao, arrive_icao, created_at, " +
        "campaign_id, campaign_flight_id, campaign_xp_multiplier, " +
        "airlane_icao, aircraft_type, variant_airframe";
      const fullCols = `${baseCols}, global_satisfaction, passenger_xp_awarded`;
      const query = (cols: string) => supabase
        .from("flights")
        .select(cols)
        .eq("user_id", user.id)
        .eq("flight_status", "ended")
        .not("campaign_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);
      const first = await query(fullCols);
      if (!first.error) {
        rows = (first.data ?? []) as unknown as Array<Record<string, unknown>>;
      } else if (/global_satisfaction|passenger_xp_awarded/i.test(first.error.message)) {
        const second = await query(baseCols);
        if (second.error) return fail(second.error.message);
        rows = (second.data ?? []) as unknown as Array<Record<string, unknown>>;
      } else {
        // Sin columnas de campaña (migración sin aplicar) u otro error: vacío.
        return ok([]);
      }
    }
    if (!rows || rows.length === 0) return ok([]);

    const str = (v: unknown): string => String(v ?? "").trim();
    const numOrNull = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const flightIds = rows.map((r) => str(r.id)).filter(Boolean);
    const campaignIds = Array.from(new Set(rows.map((r) => str(r.campaign_id)).filter(Boolean)));
    const campaignFlightIds = Array.from(
      new Set(rows.map((r) => str(r.campaign_flight_id)).filter(Boolean))
    );

    // 2) Campañas (título + imagen) y 3) vuelos de campaña (ruta + multiplicador).
    const campaignsById = new Map<string, { title: string; imageUrl: string }>();
    const campaignFlightsById = new Map<
      string,
      {
        originIcao: string;
        destinationIcao: string;
        flightNumber: string;
        xpMultiplier: number | null;
        aircraftIcao: string;
        airlineCode: string;
      }
    >();
    let campaignFlightNameRows: CampaignFlightRow[] = [];
    try {
      if (campaignIds.length > 0) {
        const { data, error } = await supabase
          .from("weekly_campaigns")
          .select("id, title, image_url")
          .in("id", campaignIds);
        if (!error && Array.isArray(data)) {
          for (const c of data as unknown as Array<Record<string, unknown>>) {
            const id = str(c.id);
            if (id) {
              campaignsById.set(id, {
                title: str(c.title) || "—",
                imageUrl: str(c.image_url),
              });
            }
          }
        }
      }
      if (campaignFlightIds.length > 0) {
        const { data, error } = await supabase
          .from("weekly_campaign_flights")
          .select("id, origin_icao, destination_icao, flight_number, xp_multiplier, aircraft_icao, airline_code")
          .in("id", campaignFlightIds);
        if (!error && Array.isArray(data)) {
          const typed = data as unknown as Array<CampaignFlightRow>;
          campaignFlightNameRows = typed;
          for (const f of data as unknown as Array<Record<string, unknown>>) {
            const id = str(f.id);
            if (id) {
              campaignFlightsById.set(id, {
                originIcao: str(f.origin_icao).toUpperCase(),
                destinationIcao: str(f.destination_icao).toUpperCase(),
                flightNumber: str(f.flight_number),
                xpMultiplier: numOrNull(f.xp_multiplier),
                aircraftIcao: str(f.aircraft_icao).toUpperCase(),
                airlineCode: str(f.airline_code).toUpperCase(),
              });
            }
          }
        }
      }
    } catch {
      // Sin enriquecimiento: se usan los datos de la fila del vuelo.
    }

    // 3b) Nombres de aeropuertos/aerolíneas/aviones (best-effort, tablas `of_*`).
    const displayNames = await resolveDisplayNames(campaignFlightNameRows).catch(() => ({
      airports: new Map<string, string>(),
      airlines: new Map<string, string>(),
      aircraft: new Map<string, string>(),
      categories: new Map<string, string>(),
    }));

    // 4) Puntos ganados por vuelo (best-effort).
    const totalXpByFlight = new Map<string, number>();
    try {
      if (flightIds.length > 0) {
        const { data, error } = await supabase
          .from("flight_xp_breakdown")
          .select("flight_id, total_flight_xp")
          .in("flight_id", flightIds);
        if (!error && Array.isArray(data)) {
          for (const b of data as unknown as Array<Record<string, unknown>>) {
            const xp = numOrNull(b.total_flight_xp);
            if (xp !== null && xp > 0) totalXpByFlight.set(str(b.flight_id), Math.round(xp));
          }
        }
      }
    } catch {
      // Sin puntos: quedan null.
    }

    const entries: CampaignFlightHistoryEntry[] = rows.map((r) => {
      const campaignId = str(r.campaign_id);
      const campaignFlightId = str(r.campaign_flight_id) || null;
      const campaign = campaignsById.get(campaignId);
      const campFlight = campaignFlightId ? campaignFlightsById.get(campaignFlightId) : undefined;
      const flightId = str(r.id);
      const originIcao = campFlight?.originIcao || str(r.depart_icao).toUpperCase();
      const destinationIcao = campFlight?.destinationIcao || str(r.arrive_icao).toUpperCase();
      // Aerolínea: código de campaña o de la fila; nombre desde `of_airlines`
      // con respaldo al mapeo local.
      const airlineCode = campFlight?.airlineCode || str(r.airlane_icao).toUpperCase();
      const airlineName =
        (airlineCode ? displayNames.airlines.get(airlineCode) : undefined) ||
        (airlineCode ? getAirlineName(airlineCode) : "") ||
        "";
      // Aeronave: ICAO de campaña o de la fila; nombre desde `of_planes`.
      const aircraftIcao =
        campFlight?.aircraftIcao ||
        str(r.aircraft_type).toUpperCase() ||
        "";
      const aircraftVariant = str(r.variant_airframe);
      const aircraftName =
        (aircraftIcao ? displayNames.aircraft.get(aircraftIcao) : undefined) ||
        [aircraftIcao, aircraftVariant].filter(Boolean).join(" ") ||
        "";
      return {
        flightId,
        campaignId,
        campaignTitle: campaign?.title ?? "Campaña",
        campaignImageUrl: campaign?.imageUrl ?? "",
        campaignFlightId,
        flightNumber:
          str(r.saved_flight) || str(r.flight_number) || campFlight?.flightNumber || "—",
        originIcao: originIcao || "—",
        destinationIcao: destinationIcao || "—",
        originName: (originIcao ? displayNames.airports.get(originIcao) : undefined) || "",
        destinationName: (destinationIcao ? displayNames.airports.get(destinationIcao) : undefined) || "",
        airlineCode,
        airlineName,
        aircraftIcao,
        aircraftName,
        xpMultiplier: numOrNull(r.campaign_xp_multiplier) ?? campFlight?.xpMultiplier ?? null,
        createdAt: typeof r.created_at === "string" ? r.created_at : null,
        totalXp: totalXpByFlight.get(flightId) ?? null,
        globalSatisfaction: numOrNull(r.global_satisfaction),
        passengerXpAwarded: numOrNull(r.passenger_xp_awarded),
      };
    });
    return ok(entries);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Deriva los parámetros de fecha/hora de SimBrief desde el `departure_time`
 * de un vuelo de campaña ("2026-10-06T22:30", interpretado como UTC):
 * `date` (DDMMMYY), `deph` (hora) y `depm` (minutos). Null si no parsea.
 */
export function toSimbriefDateTime(departureTime: string): {
  date: string;
  deph: string;
  depm: string;
} | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec((departureTime ?? "").trim());
  if (!m) return null;
  const [, yyyy, mm, dd, hh, mi] = m;
  const monthIdx = Number(mm) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  return {
    date: `${dd}${MONTHS[monthIdx]}${yyyy.slice(2)}`,
    deph: String(Number(hh)),
    depm: mi,
  };
}
