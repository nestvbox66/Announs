/**
 * Verificación Bug 3 (fase vuelo): la etiqueta de música de embarque del
 * panel de layout debe reflejar lo que realmente suena.
 *
 * Regresión: con pista aleatoria, sin selección explícita o con fuente
 * `pack`, la música sonaba pero la etiqueta decía "Sin música" porque solo
 * resolvía `musicTracks.find(id)`.
 *
 * Uso: npx tsx scripts/boarding-music-label.verify.ts
 */
import { resolveBoardingMusicDisplayName } from "../src/utils/boardingMusicLabel";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
  }
}

const base = {
  enabled: true,
  audioSource: "ia",
  packName: null,
  trackName: null,
  trackId: "",
  catalogSize: 3,
  randomTrackId: "random",
  randomLabel: "Música al azar",
};

check("pista del catálogo -> nombre", resolveBoardingMusicDisplayName({ ...base, trackName: "Bossa Nova", trackId: "abc" }), "Bossa Nova");
check("id aleatorio -> etiqueta azar", resolveBoardingMusicDisplayName({ ...base, trackId: "random" }), "Música al azar");
check("sin selección con catálogo -> etiqueta azar", resolveBoardingMusicDisplayName(base), "Música al azar");
check("sin selección ni catálogo -> null", resolveBoardingMusicDisplayName({ ...base, catalogSize: 0 }), null);
check("fuente pack con package -> package", resolveBoardingMusicDisplayName({ ...base, audioSource: "pack", packName: "Pack Aerolínea", trackName: "Bossa Nova", trackId: "abc" }), "Pack Aerolínea");
check("fuente pack sin package -> pista", resolveBoardingMusicDisplayName({ ...base, audioSource: "pack", trackName: "Bossa Nova", trackId: "abc" }), "Bossa Nova");
check("desactivada con pista -> null", resolveBoardingMusicDisplayName({ ...base, enabled: false, trackName: "Bossa Nova", trackId: "abc" }), null);
check("id heredado desconocido -> id en crudo", resolveBoardingMusicDisplayName({ ...base, trackId: "mi-pista-vieja" }), "mi-pista-vieja");

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallida(s).`);
  process.exit(1);
}
console.log("\nEtiqueta de música de embarque: todas las verificaciones pasaron.");
