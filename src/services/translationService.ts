/**
 * Servicio de overlay de traducciones para el desktop.
 *
 * Lee la tabla `translates` en lote y sobrescribe SOLO los campos visibles de
 * las filas origen. Comportamiento fail-soft: si no hay idioma distinto del
 * español, si falta la traducción o si la consulta falla, devuelve las filas
 * originales en español sin romper al llamador.
 *
 * Reglas:
 * - El idioma se normaliza (`pt-BR` → `pt`) contra `supported_languages`.
 * - `es` (o variante) es no-op: no consulta nada.
 * - Las claves de búsqueda (`id`, `event_key`, `rank_title`, …) nunca se
 *   reemplazan: solo los `fields` declarados en cada llamada.
 * - Caché en memoria por sesión (`tabla|||idioma`) con `clearTranslationCache()`.
 */
import { supabase } from "../lib/supabase";
import i18n from "../lib/i18n";
import {
  SOURCE_LANGUAGE,
  buildTranslationMap,
  isSafeTableOrField,
  isSourceLanguage,
  normalizeLanguage,
  overlayTranslatedFields,
  translationMapKey,
} from "../utils/translationOverlay";

/** Tope de registros por consulta a `translates`. */
const MAX_RECORDS_PER_QUERY = 500;

/** Caché de sesión: `${table}|||${lang}` → mapa `recordId|||field → texto`. */
const cache = new Map<string, Map<string, string>>();

/** Ids ya consultados por clave de caché (para pedir solo los faltantes). */
const fetchedIds = new Map<string, Set<string>>();

/** Idioma de contenido actual (del i18n del desktop), normalizado. */
export function getCurrentContentLanguage(): string {
  try {
    return normalizeLanguage((i18n as unknown as { language?: unknown })?.language);
  } catch {
    return SOURCE_LANGUAGE;
  }
}

/** Limpia la caché de sesión (llamar al cambiar de idioma). */
export function clearTranslationCache(): void {
  cache.clear();
  fetchedIds.clear();
}

function cacheKey(tableName: string, language: string): string {
  return `${tableName}|||${language}`;
}

/**
 * Mapa `recordId|||field → texto traducido` para los registros dados.
 * Fail-soft: ante cualquier problema devuelve un mapa vacío.
 */
export async function resolveTranslations(
  tableName: string,
  recordIds: string[],
  language: string,
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  const lang = normalizeLanguage(language);
  if (isSourceLanguage(lang)) return empty;
  if (!isSafeTableOrField(tableName)) {
    console.warn(`[translationService] Tabla no válida: ${tableName}`);
    return empty;
  }

  const ids = Array.from(new Set((recordIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))).slice(
    0,
    MAX_RECORDS_PER_QUERY,
  );
  if (ids.length === 0) return empty;

  const key = cacheKey(tableName, lang);
  const known = cache.get(key) ?? new Map<string, string>();
  const alreadyFetched = fetchedIds.get(key) ?? new Set<string>();
  const missing = ids.filter((id) => !alreadyFetched.has(id));

  const subset = new Map<string, string>();
  for (const id of ids) {
    for (const [mapKey, text] of known) {
      if (mapKey.startsWith(`${id}|||`)) subset.set(mapKey, text);
    }
  }
  if (missing.length === 0) return subset;

  try {
    const { data, error } = await supabase
      .from("translates")
      .select("record_id, field_name, translated_text")
      .eq("table_name", tableName)
      .eq("language_code", lang)
      .in("record_id", missing);

    if (error) {
      console.warn(`[translationService] No se pudieron cargar traducciones (${tableName}/${lang}): ${error.message}`);
      return subset;
    }

    const fresh = buildTranslationMap(
      ((data ?? []) as Array<{ record_id?: unknown; field_name?: unknown; translated_text?: unknown }>).map((row) => ({
        record_id: row.record_id,
        field_name: row.field_name,
        translated_text: row.translated_text,
      })),
    );
    for (const [mapKey, text] of fresh) {
      known.set(mapKey, text);
      subset.set(mapKey, text);
    }
    for (const id of missing) alreadyFetched.add(id);
    cache.set(key, known);
    fetchedIds.set(key, alreadyFetched);
    return subset;
  } catch (err) {
    console.warn(`[translationService] Excepción cargando traducciones (${tableName}/${lang}): ${String(err)}`);
    return subset;
  }
}

export interface LocalizeRowsOptions {
  /** Campo con el id del registro (por defecto `id`). */
  idField?: string;
  /** Campos visibles a traducir (nunca claves de búsqueda). */
  fields: string[];
  /** Idioma destino; por defecto el idioma actual del i18n. */
  language?: string;
}

/**
 * Devuelve las filas con los `fields` traducidos cuando corresponde.
 * No muta el arreglo ni las filas originales.
 */
export async function localizeRows<T extends object>(
  tableName: string,
  rows: T[],
  options: LocalizeRowsOptions,
): Promise<T[]> {
  const { idField = "id", fields, language } = options;
  if (!Array.isArray(rows) || rows.length === 0 || fields.length === 0) return rows;
  const lang = normalizeLanguage(language ?? getCurrentContentLanguage());
  if (isSourceLanguage(lang)) return rows;

  const ids = rows.map((row) => String((row as Record<string, unknown>)[idField] ?? "").trim()).filter(Boolean);
  if (ids.length === 0) return rows;

  const map = await resolveTranslations(tableName, ids, lang);
  if (map.size === 0) return rows;

  return rows.map((row) => {
    const recordId = String((row as Record<string, unknown>)[idField] ?? "").trim();
    if (!recordId) return row;
    return overlayTranslatedFields(row, recordId, fields, (r, f) => map.get(translationMapKey(r, f)));
  });
}

/**
 * Variante singular de `localizeRows` para filas únicas (`maybeSingle`).
 * Devuelve la misma referencia cuando no hay nada que traducir.
 */
export async function localizeRow<T extends object>(
  tableName: string,
  row: T | null,
  options: LocalizeRowsOptions,
): Promise<T | null> {
  if (!row) return row;
  const [localized] = await localizeRows(tableName, [row], options);
  return localized ?? row;
}
