/**
 * Verificación de los filtros del catálogo de voces (configuración/voces):
 * solo voces públicas y filtro por idioma con default "todos".
 * Uso: npx tsx scripts/voices-filters.verify.ts
 */
import {
  ALL_LANGUAGES,
  availableVoiceLanguages,
  filterPublicVoices,
  filterVoicesByLanguage,
} from "../src/utils/voiceFilters";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
  if (!ok) failures++;
}

const voices = [
  { id: "a", user_public: true, languages: [{ id: "es", language_name: "Español" }] },
  { id: "b", user_public: false, languages: [{ id: "es", language_name: "Español" }] },
  { id: "c", user_public: true, languages: [{ id: "en", language_name: "English" }] },
  { id: "d", user_public: true, languages: [] },
  { id: "e", user_public: null, languages: [{ id: "en", language_name: "English" }] },
];

// 1. Solo públicas (true estricto: false y null quedan fuera)
check("solo publicas", filterPublicVoices(voices).map((v) => v.id), ["a", "c", "d"]);

// 2. Idiomas disponibles (únicos, ordenados)
check("idiomas unicos", availableVoiceLanguages(filterPublicVoices(voices)), [
  { id: "en", language_name: "English" },
  { id: "es", language_name: "Español" },
]);

// 3. Filtro por idioma
check("filtro es", filterVoicesByLanguage(filterPublicVoices(voices), "es").map((v) => v.id), ["a", "d"]);
check("filtro en", filterVoicesByLanguage(filterPublicVoices(voices), "en").map((v) => v.id), ["c", "d"]);

// 4. Default "todos los idiomas" no filtra
check("default all", filterVoicesByLanguage(filterPublicVoices(voices), ALL_LANGUAGES).map((v) => v.id), ["a", "c", "d"]);
check("idioma vacio no filtra", filterVoicesByLanguage(filterPublicVoices(voices), "").map((v) => v.id), ["a", "c", "d"]);

// 5. Idioma inexistente: solo pasan las voces sin info de idioma
check("idioma inexistente", filterVoicesByLanguage(filterPublicVoices(voices), "pt").map((v) => v.id), ["d"]);

if (failures > 0) {
  console.error(`${failures} comprobación(es) fallida(s)`);
  process.exit(1);
}
console.log("voices filters: todo OK");
