/**
 * Verificación: mapeo de proveedor a `flights.simulator` y agregación
 * para la torta "Distribución por Simulador" del HUB.
 *
 * Uso: npx tsx scripts/flight-simulator.verify.ts
 */
import {
  aggregateSimulatorShares,
  isFlightSimulator,
  resolveFlightSimulator,
  resolveSimProvider,
} from "../src/utils/flightSimulator";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name} ${detail}`);
  }
}

check("msfs -> MSFS2024", resolveFlightSimulator("msfs") === "MSFS2024");
check("xplane -> XPLANE12", resolveFlightSimulator("xplane") === "XPLANE12");
check("mock -> null", resolveFlightSimulator("mock") === null);
check("ausente -> null", resolveFlightSimulator(undefined) === null && resolveFlightSimulator("") === null);
check("acepta MSFS2024/XPLANE12", isFlightSimulator("MSFS2024") && isFlightSimulator("XPLANE12"));
check("rechaza otros", !isFlightSimulator(null) && !isFlightSimulator("MSFS") && !isFlightSimulator("xplane"));
check("preferencia MSFS2024 -> msfs", resolveSimProvider("MSFS2024") === "msfs");
check("preferencia XPLANE12 -> xplane", resolveSimProvider("XPLANE12") === "xplane");
check(
  "preferencia ausente/inválida -> null",
  resolveSimProvider(null) === null &&
    resolveSimProvider(undefined) === null &&
    resolveSimProvider("") === null &&
    resolveSimProvider("MSFS") === null,
);

const shares = aggregateSimulatorShares(["MSFS2024", "XPLANE12", "MSFS2024", null, undefined, "MSFS2020", "XPLANE12"]);
check(
  "agrega 2 MSFS + 2 XPLANE e ignora resto",
  shares.length === 2 &&
    shares[0].simulator === "MSFS2024" && shares[0].flights === 2 &&
    shares[1].simulator === "XPLANE12" && shares[1].flights === 2,
  JSON.stringify(shares)
);

const empty = aggregateSimulatorShares([]);
check("vacío -> ceros", empty[0].flights === 0 && empty[1].flights === 0);

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallida(s).`);
  process.exit(1);
}
console.log("\nSimulador de vuelo: todas las verificaciones pasaron.");
