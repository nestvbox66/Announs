// Herramienta Backoffice: cruise_capt_general_info -> optional:true en v44.
//
// Requiere SERVICE_ROLE (la anon key solo tiene lectura por RLS en
// scenario_versions: el PATCH con anon devuelve 200 [] sin modificar).
// Uso:
//   $env:SUPABASE_URL="https://xxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="..."
//   node scripts/patch-scenario-snapshot.mjs [--apply]
//
// Sin --apply solo muestra el diff (dry-run).
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
);

const { data: scenario } = await supabase
  .from("scenarios")
  .select("id")
  .eq("key", "standard_commercial_flight")
  .single();

const { data: version } = await supabase
  .from("scenario_versions")
  .select("id, version, snapshot")
  .eq("scenario_id", scenario.id)
  .eq("status", "published")
  .order("version", { ascending: false })
  .limit(1)
  .single();

const snapshot = structuredClone(version.snapshot);
const cruise = snapshot.phases.find((p) => p.key === "CRUISE");
const step = cruise.steps.find((s) => s.event_key === "cruise_capt_general_info");
console.log("BEFORE optional =", step.optional, "restrictions =", JSON.stringify(step.restrictions));

step.optional = true;
step.restrictions = { ...(step.restrictions ?? {}), optional: true };
console.log("AFTER  optional =", step.optional, "restrictions =", JSON.stringify(step.restrictions));

if (!APPLY) {
  console.log(`Dry-run sobre v${version.version} (id ${version.id}). Re-ejecutar con --apply.`);
  process.exit(0);
}

const { error } = await supabase
  .from("scenario_versions")
  .update({ snapshot })
  .eq("id", version.id);
if (error) {
  console.error("UPDATE ERROR:", error.message);
  process.exit(1);
}
console.log(`v${version.version} actualizada. Verificar Edge: scenarios-active?phase=CRUISE debe traer optional=true.`);
