/**
 * Lógica pura del overlay de traducciones (sin I/O): normalización de idioma,
 * construcción del mapa de traducciones y aplicación sobre filas origen.
 *
 * Las traducciones viven en la tabla `translates` y SIEMPRE son solo visuales:
 * las claves de búsqueda (`id`, `event_key`, `rank_title`, …) nunca se
 * reemplazan, solo los campos destinados a mostrarse.
 */

/** Idioma origen de todos los textos parametrizados. Es no-op con fallback. */
export const SOURCE_LANGUAGE = "es";

/** Clave del mapa de traducciones: `${recordId}|||${fieldName}`. */
export function translationMapKey(recordId: string, fieldName: string): string {
  return `${recordId}|||${fieldName}`;
}

/**
 * Normaliza un código de idioma al formato de `supported_languages`:
 * minúsculas y sin sufijo regional (`pt-BR` → `pt`, `en-US` → `en`).
 * Un valor vacío o desconocido se considera español (no-op seguro).
 */
export function normalizeLanguage(lang: unknown): string {
  const raw = String(lang ?? "").trim().toLowerCase();
  if (!raw) return SOURCE_LANGUAGE;
  return raw.split(/[-_]/)[0] || SOURCE_LANGUAGE;
}

/** `true` si el idioma es el origen (no hay nada que traducir). */
export function isSourceLanguage(lang: unknown): boolean {
  return normalizeLanguage(lang) === SOURCE_LANGUAGE;
}

export interface TranslationEntry {
  record_id: unknown;
  field_name: unknown;
  translated_text: unknown;
}

/**
 * Construye el mapa `recordId|||fieldName → texto` desde las filas crudas de
 * `translates`. Ignora entradas vacías o sin clave válida.
 */
export function buildTranslationMap(entries: TranslationEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries ?? []) {
    const recordId = String(entry.record_id ?? "").trim();
    const field = String(entry.field_name ?? "").trim();
    const text = typeof entry.translated_text === "string" ? entry.translated_text : String(entry.translated_text ?? "");
    if (!recordId || !field || !text) continue;
    map.set(translationMapKey(recordId, field), text);
  }
  return map;
}

/**
 * Devuelve una copia de `row` con los `fieldNames` reemplazados por su
 * traducción cuando existe. Nunca muta la fila original ni toca otros campos
 * (las claves de búsqueda quedan intactas).
 */
export function overlayTranslatedFields<T extends object>(
  row: T,
  recordId: string,
  fieldNames: readonly string[],
  lookup: (recordId: string, fieldName: string) => string | undefined,
): T {
  const overrides: Record<string, string> = {};
  for (const field of fieldNames) {
    const translated = lookup(recordId, field);
    if (translated !== undefined && translated !== "") {
      overrides[field] = translated;
    }
  }
  if (Object.keys(overrides).length === 0) return row;
  return { ...row, ...overrides };
}

/** Identificadores seguros para nombres de tabla/campo dinámicos. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

export function isSafeTableOrField(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}
