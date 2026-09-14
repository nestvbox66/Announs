import { supabase } from "../lib/supabase";

export interface AircraftTypeData {
  icao_code: string;
  display_name: string;
  family: string;
  is_widebody: boolean;
}

/**
 * Obtiene el tipo de aeronave desde la tabla `aircraft_types` de Supabase.
 * Solo lectura: no modifica la base de datos.
 */
export async function getAircraftType(icaoCode: string): Promise<AircraftTypeData | null> {
  if (!icaoCode) return null;

  const { data, error } = await supabase
    .from("aircraft_types")
    .select("icao_code, display_name, family, is_widebody")
    .eq("icao_code", icaoCode.toUpperCase())
    .maybeSingle();

  if (error || !data) {
    console.warn("[aircraftService] No se encontró el tipo de aeronave:", icaoCode);
    return null;
  }

  return data as AircraftTypeData;
}
