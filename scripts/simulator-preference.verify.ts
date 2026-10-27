/**
 * Verificación: preferencia de simulador (`setting_general.simulator`) y
 * eliminación de la opción "SIN MÚSICA" de los desplegables de embarque.
 *
 * - `resolveSimProvider` mapea la preferencia guardada al proveedor del setup.
 * - `normalizeBoardingMusicTrackId` cae a "Música al azar" ante valores
 *   vacíos/legacy (el bug: switch encendido + pista vacía = silencio).
 * - Chequeos estáticos del cableado entre Configuración, fly 2 y la columna
 *   `simulator`.
 *
 * Uso: npx tsx scripts/simulator-preference.verify.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSimProvider } from "../src/utils/flightSimulator";
import {
  DEFAULT_BOARDING_MUSIC_ID,
  normalizeBoardingMusicTrackId,
} from "../src/utils/boardingMusicSelection";
import { RANDOM_MUSIC_ID } from "../src/services/MusicController";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf-8");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name} ${detail}`);
  }
}

// Mapeo preferencia -> proveedor del setup.
check("MSFS2024 -> msfs", resolveSimProvider("MSFS2024") === "msfs");
check("XPLANE12 -> xplane", resolveSimProvider("XPLANE12") === "xplane");
check("null -> null (conserva selección)", resolveSimProvider(null) === null);
check(
  "vacío/inválido -> null",
  resolveSimProvider(undefined) === null &&
    resolveSimProvider("") === null &&
    resolveSimProvider("MSFS") === null &&
    resolveSimProvider("mock") === null,
);

// Normalización de la pista (default = Música al azar).
check(
  "default es el id aleatorio",
  DEFAULT_BOARDING_MUSIC_ID === RANDOM_MUSIC_ID && RANDOM_MUSIC_ID === "random",
);
check(
  "vacío/nulo cae al azar",
  normalizeBoardingMusicTrackId("") === RANDOM_MUSIC_ID &&
    normalizeBoardingMusicTrackId(null) === RANDOM_MUSIC_ID &&
    normalizeBoardingMusicTrackId(undefined) === RANDOM_MUSIC_ID &&
    normalizeBoardingMusicTrackId("   ") === RANDOM_MUSIC_ID,
);
check(
  "id válido se conserva",
  normalizeBoardingMusicTrackId("abc-123") === "abc-123" &&
    normalizeBoardingMusicTrackId(RANDOM_MUSIC_ID) === RANDOM_MUSIC_ID,
);

// Cableado estático.
const configView = read("src/components/ConfigView.tsx");
const immersion = read("src/components/fly-v2/ImmersionTab.tsx");
const flySetup = read("src/components/fly-v2/FlySetupView.tsx");

check(
  "ConfigView guarda simulator en setting_general",
  configView.includes("simulator: preferredSimulator || null"),
);
check(
  "ConfigView muestra la sección en la segunda columna",
  configView.includes('config.simulator_title') &&
    configView.includes("FLIGHT_SIMULATORS.map"),
);
check(
  "ConfigView sin opción SIN MUSICA",
  !configView.includes('t("music.no_music")'),
);
check(
  "ConfigView cae a Música al azar por defecto",
  configView.includes("DEFAULT_BOARDING_MUSIC_ID"),
);
check(
  "ImmersionTab sin opción SIN MUSICA",
  !immersion.includes('t("music.no_music")'),
);
check(
  "ImmersionTab cae a Música al azar por defecto",
  immersion.includes("DEFAULT_BOARDING_MUSIC_ID") &&
    immersion.includes("normalizeBoardingMusicTrackId"),
);
check(
  "FlySetup preselecciona desde la preferencia guardada",
  flySetup.includes("resolveSimProvider") &&
    flySetup.includes("cfg_preferred_simulator") &&
    flySetup.includes('"simulator"'),
);
check(
  "Migración setting_general.simulator existe",
  existsSync(
    join(root, "supabase/migrations/20261023_setting_general_simulator.sql"),
  ) &&
    read("supabase/migrations/20261023_setting_general_simulator.sql").includes(
      "setting_general_simulator_check",
    ),
);

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallida(s).`);
  process.exit(1);
}
console.log("\nPreferencia de simulador y música: todas las verificaciones pasaron.");
