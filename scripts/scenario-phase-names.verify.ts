/**
 * Verificación de nombres de fase por clave (opción B: el `name` del snapshot
 * se ignora y el visible sale de los bundles de i18next).
 *
 * Regresión que previene: volver a mostrar `phase.name` del snapshot (mezcla
 * inglés/español como `GATE`+`BOARDING` en inglés con el resto en español) o
 * romper una clave de `flight.phase.*` en es/en.
 *
 * Uso: npx tsx scripts/scenario-phase-names.verify.ts
 */
import { SCENARIO_DESIGNER_PHASES } from "../src/services/eventConfigConstants";
import { resolveScenarioPhaseName } from "../src/utils/scenarioPhaseNames";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
  }
}

const expectedEs: Record<string, string> = {
  GATE: "GATE",
  BOARDING: "Embarque",
  PRE_FLIGHT: "Pre-Vuelo",
  TAXI: "Rodaje",
  TAKEOFF: "Despegue",
  CLIMB: "Ascenso",
  CRUISE: "Crucero",
  DESCENT: "Descenso",
  APPROACH: "Aproximación",
  LANDING: "Aterrizaje",
  TAXI_TO_GATE: "Rodaje a Puerta",
  AT_GATE: "En Puerta",
  FLIGHT_COMPLETED: "Vuelo Completado",
};

for (const phase of SCENARIO_DESIGNER_PHASES) {
  const es = resolveScenarioPhaseName(phase.key, "es");
  const en = resolveScenarioPhaseName(phase.key, "en");
  check(`${phase.key} resuelve en español`, es, expectedEs[phase.key]);
  check(`${phase.key} resuelve en inglés (no vacío)`, typeof en === "string" && en.length > 0, true);
  check(`${phase.key} inglés difiere del español o es intraducible`, es !== "" && en !== "", true);
}

check("GATE en inglés", resolveScenarioPhaseName("GATE", "en"), "GATE");
check("BOARDING en inglés", resolveScenarioPhaseName("BOARDING", "en"), "Boarding");
check("clave desconocida devuelve la clave", resolveScenarioPhaseName("NOPE", "es"), "NOPE");
check("vacío devuelve vacío", resolveScenarioPhaseName("", "es"), "");

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallida(s).`);
  process.exit(1);
}
console.log("\nNombres de fase: todas las verificaciones pasaron.");
