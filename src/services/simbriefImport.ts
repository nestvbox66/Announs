/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Importación real del último plan SimBrief del usuario.
 * Reutiliza el endpoint oficial (`xml.fetcher.php`) y el mapeo a
 * `SimBriefData` que usa la vista estable de vuelo.
 */

import { supabase } from "../lib/supabase";
import type { SimBriefData } from "../types";
import { extractAirlineCode } from "../utils/ofResolvers";

export interface SimBriefOfp {
  general?: {
    pilot_id?: string | number;
    captain?: string;
    flight_number?: string;
    icao_airline?: string;
    airline?: string;
    route_altitude?: string;
  };
  origin?: { icao_code?: string };
  destination?: { icao_code?: string };
  aircraft?: { name?: string };
  times?: { est_block?: string };
  weights?: { pax_count?: string | number };
}

export interface SimBriefImportResult {
  /** Datos mapeados para `SimBriefData` (resumen del setup / vuelo). */
  plan: SimBriefData;
  /** OFP crudo: horarios, crucero, aeropuertos, METAR (monitor, fases, setup). */
  raw: SimBriefOfp;
}

/**
 * Resuelve el `simbrief_pilot_id` del perfil del usuario autenticado
 * (tabla `users`), igual que la vista estable de vuelo.
 */
export async function resolveSimbriefPilotId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("users")
    .select("simbrief_pilot_id")
    .eq("id", user.id)
    .maybeSingle();
  const raw = (data as { simbrief_pilot_id?: unknown } | null)?.simbrief_pilot_id;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Descarga el último OFP generado: devuelve el mapeo a `SimBriefData` más
 * el OFP crudo (lo necesitan el monitor, la detección de crucero, los
 * horarios y el setup). Lanza `simbrief_no_plan` (400 sin plan) o
 * `simbrief_generic_error`.
 */
export async function fetchLatestSimBriefPlan(pilotId: string): Promise<SimBriefImportResult> {
  const response = await fetch(
    `https://www.simbrief.com/api/xml.fetcher.php?userid=${pilotId}&json=1`,
  );
  if (response.status === 400) {
    throw new Error("simbrief_no_plan");
  }
  if (!response.ok) {
    throw new Error("simbrief_generic_error");
  }
  const data = (await response.json()) as SimBriefOfp;
  return {
    plan: {
      username: data.general?.pilot_id ? `pilot_${data.general.pilot_id}` : "",
      nombrePiloto: data.general?.captain ?? "",
      vueloCodigo: data.general?.flight_number ?? "",
      origen: data.origin?.icao_code ?? "",
      destino: data.destination?.icao_code ?? "",
      aerolinea: extractAirlineCode(data),
      avion: data.aircraft?.name ?? "",
      cruisingAltitude: data.general?.route_altitude ?? "",
      blockTime: data.times?.est_block
        ? `${Math.round(parseFloat(data.times.est_block) * 60)} minutos`
        : "",
      pasajerosCount: parseInt(String(data.weights?.pax_count ?? "0"), 10),
    },
    raw: data,
  };
}
