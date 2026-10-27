import { supabase } from "../lib/supabase";
import {
  buildGenericWidebodyLayout,
  normalizeCabinLayout,
  selectClosestCapacityLayout,
  type CabinLayout,
} from "../types/cabinLayout";
import { localizeRow, localizeRows } from "./translationService";

export type CabinLayoutSource = "aircraft" | "capacity" | "fallback";

export interface CabinLayoutResolution {
  layout: CabinLayout;
  source: CabinLayoutSource;
  error: string | null;
}

async function getAircraftDefaultLayoutId(aircraftIcao: string): Promise<string | null> {
  if (!aircraftIcao) return null;
  const { data, error } = await supabase
    .from("aircraft_types")
    .select("default_layout_id")
    .eq("icao_code", aircraftIcao.toUpperCase())
    .maybeSingle();

  if (error) return null;
  const layoutId = (data as { default_layout_id?: string | null } | null)?.default_layout_id;
  return typeof layoutId === "string" && layoutId.trim() !== "" ? layoutId : null;
}

export async function resolveCabinLayoutForFlight(
  aircraftIcao: string,
  paxCount: number,
): Promise<CabinLayoutResolution> {
  try {
    const aircraftLayoutId = await getAircraftDefaultLayoutId(aircraftIcao);
    if (aircraftLayoutId) {
      const { data, error } = await supabase
        .from("cabin_layouts")
        .select("*")
        .eq("id", aircraftLayoutId)
        .maybeSingle();
      if (!error && data) {
        const layout = normalizeCabinLayout((await localizeRow("cabin_layouts", data, { fields: ["name"] })) ?? data);
        if (layout.capacity > 0) return { layout, source: "aircraft", error: null };
      }
    }

    if (paxCount > 0) {
      const { data, error } = await supabase.from("cabin_layouts").select("*");
      if (!error && Array.isArray(data)) {
        const layouts = (await localizeRows("cabin_layouts", data, { fields: ["name"] }))
          .map(normalizeCabinLayout)
          .filter((layout) => layout.is_generic && layout.capacity > 0);
        const layout = selectClosestCapacityLayout(layouts, Math.floor(paxCount));
        if (layout) return { layout, source: "capacity", error: null };
      }
    }

    return { layout: buildGenericWidebodyLayout(), source: "fallback", error: null };
  } catch (err) {
    return {
      layout: buildGenericWidebodyLayout(),
      source: "fallback",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
