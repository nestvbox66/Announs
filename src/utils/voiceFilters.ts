/**
 * voiceFilters — filtros puros para el catálogo de voces (configuración/voces).
 *
 * - `filterPublicVoices`: solo voces con `user_public === true`.
 * - `availableVoiceLanguages`: idiomas únicos presentes en la lista cargada.
 * - `filterVoicesByLanguage`: voces de un idioma; `"all"` no filtra.
 *   Las voces sin información de idioma pasan cualquier filtro (criterio
 *   leniente, igual que `staffVoiceMatchesLanguage` en ConfigView): la tabla
 *   `voice_languages` es opcional y su ausencia no debe ocultar voces.
 */

export interface VoiceLike {
  id: string;
  user_public?: boolean | null;
  languages?: Array<{ id: string; language_name: string }>;
}

export const ALL_LANGUAGES = "all";

export function filterPublicVoices<T extends VoiceLike>(voices: T[]): T[] {
  return voices.filter((v) => v.user_public === true);
}

export function availableVoiceLanguages<T extends VoiceLike>(
  voices: T[],
): Array<{ id: string; language_name: string }> {
  const seen = new Map<string, string>();
  for (const v of voices) {
    for (const l of v.languages ?? []) {
      if (l?.id && !seen.has(l.id)) seen.set(l.id, l.language_name ?? l.id);
    }
  }
  return [...seen.entries()]
    .map(([id, language_name]) => ({ id, language_name }))
    .sort((a, b) => a.language_name.localeCompare(b.language_name));
}

export function filterVoicesByLanguage<T extends VoiceLike>(
  voices: T[],
  languageId: string,
): T[] {
  if (!languageId || languageId === ALL_LANGUAGES) return voices;
  return voices.filter(
    (v) =>
      !v.languages ||
      v.languages.length === 0 ||
      v.languages.some((l) => l?.id === languageId),
  );
}
