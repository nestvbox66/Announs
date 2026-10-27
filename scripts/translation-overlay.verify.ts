/**
 * Verificación del overlay de traducciones (lógica pura, sin red ni BD).
 *
 * Regresión que previene: normalizar mal un idioma, reemplazar claves de
 * búsqueda, mutar la fila original o perder el fallback a español.
 *
 * Uso: npx tsx scripts/translation-overlay.verify.ts
 */
import {
  SOURCE_LANGUAGE,
  buildTranslationMap,
  isSourceLanguage,
  normalizeLanguage,
  overlayTranslatedFields,
} from "../src/utils/translationOverlay";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
  }
}

// Normalización de idioma.
check("pt-BR -> pt", normalizeLanguage("pt-BR"), "pt");
check("en-US -> en", normalizeLanguage("en-US"), "en");
check("ES mayúsculas -> es", normalizeLanguage("ES"), "es");
check("vacío -> es (no-op seguro)", normalizeLanguage(""), SOURCE_LANGUAGE);
check("es es origen", isSourceLanguage("es"), true);
check("es-ES es origen", isSourceLanguage("es-ES"), true);
check("en no es origen", isSourceLanguage("en"), false);
check("pt-BR no es origen", isSourceLanguage("pt-BR"), false);

// Mapa de traducciones.
const map = buildTranslationMap([
  { record_id: "id-1", field_name: "title", translated_text: "Polar Flights" },
  { record_id: "id-1", field_name: "description", translated_text: "" },
  { record_id: "", field_name: "title", translated_text: "Sin id" },
]);
check("mapa tiene title id-1", map.get("id-1|||title"), "Polar Flights");
check("mapa ignora texto vacío", map.has("id-1|||description"), false);
check("mapa ignora sin record_id", map.size, 1);

// Overlay sobre filas.
const row = { id: "id-1", title: "Vuelos Polares", description: "Desc", event_key: "X" };
const localized = overlayTranslatedFields(row, "id-1", ["title", "description"], (r, f) => map.get(`${r}|||${f}`));
check("reemplaza campo traducido", localized.title, "Polar Flights");
check("conserva campo sin traducción (fallback español)", localized.description, "Desc");
check("no toca claves de búsqueda", localized.event_key, "X");
check("no muta la fila original", row.title, "Vuelos Polares");
check("sin traducciones devuelve la misma referencia", overlayTranslatedFields(row, "otro", ["title"], () => undefined) === row, true);

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallida(s).`);
  process.exit(1);
}
console.log("\nOverlay de traducciones: todas las verificaciones pasaron.");
