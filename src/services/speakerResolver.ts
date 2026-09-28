/**
 * speakerResolver — locutor explícito para la Edge Function `audio-get`.
 *
 * Causa del bug de voz en puerta (EN/Amy → Mía en español): el payload solo
 * llevaba `language_id` y la Edge Function resolvía el locutor por su cuenta,
 * cayendo en la voz española por defecto para los eventos de tierra. Ahora el
 * Desktop envía el `voice_id` seleccionado por el usuario (configuración
 * global) junto con el `speaker_role` del catálogo, y garantiza que
 * `language_id` sea el idioma global vigente en el instante del disparo.
 *
 * Alcance deliberado: el pinning se aplica a eventos de tierra (`gate_*`).
 * El resto de eventos conserva el payload histórico para no alterar su
 * resolución en el servidor.
 */
import type { FlightContext } from "./FlightContext";
import { EventCatalogService } from "../events/EventCatalogService";

export type SpeakerRole = "captain" | "crew" | "gate";

/** Eventos con locutor fijado por el cliente (tierra/puerta). */
export function shouldPinSpeaker(eventKey: string): boolean {
  return (eventKey ?? "").startsWith("gate_");
}

/** Rol del evento según el catálogo del cliente (null si no está declarado). */
export function resolveSpeakerRole(eventKey: string): SpeakerRole | null {
  const role = (EventCatalogService.get(eventKey) as { speakerRole?: unknown } | undefined)?.speakerRole;
  return role === "captain" || role === "crew" || role === "gate" ? role : null;
}

/** `voice_id` seleccionado por el usuario para ese rol (null si no hay). */
export function resolveSpeakerVoiceId(
  role: SpeakerRole | null,
  fc: FlightContext | null
): string | null {
  if (!role || !fc) return null;
  try {
    const voices = fc.getVoices();
    const id = role === "captain" ? voices.captain : role === "crew" ? voices.crew : voices.gateAgent;
    const trimmed = (id ?? "").trim();
    return trimmed !== "" ? trimmed : null;
  } catch {
    return null;
  }
}

/** Idioma global vigente en el contexto (null si está vacío). */
export function resolveGlobalLanguageId(fc: FlightContext | null): string | null {
  try {
    const lang = (fc?.getFlight()?.captainPrimaryLang ?? "").trim();
    return lang !== "" ? lang : null;
  } catch {
    return null;
  }
}

export interface PinnedSpeaker {
  role: SpeakerRole | null;
  voiceId: string | null;
  languageId: string | null;
}

/**
 * Resolución endurecida del locutor para eventos con pinning (`gate_*`).
 *
 * Cadena de decisión (primera que aplique):
 *  1. Voz actual probada en el idioma global → se respeta tal cual.
 *  2. Primera voz del rol probada en el idioma global → se usa (corrige
 *     selecciones en otro idioma o sin etiquetar pudiendo elegir mejor).
 *  3. Voz actual sin etiquetar y sin alternativa probada → se mantiene
 *     (fail-open: catálogos sin tags siguen funcionando como antes).
 *  4. Resto → null (no fijar una voz en idioma erróneo; el servidor
 *     resuelve por idioma, mejor que una voz explícita equivocada).
 *
 * Si el idioma global está vacío, se deriva del locutor cuando sus tags lo
 * permiten. Sin rol (evento fuera de pinning) solo se devuelve el idioma.
 */
export function resolvePinnedSpeaker(
  eventKey: string | null | undefined,
  fc: FlightContext | null
): PinnedSpeaker {
  const key = (eventKey ?? "").trim();
  const role = key && shouldPinSpeaker(key) ? resolveSpeakerRole(key) : null;
  let languageId = resolveGlobalLanguageId(fc);
  if (!role || !fc) return { role, voiceId: null, languageId };
  let current = "";
  let voiceRoles: Record<string, string> = {};
  let voiceLanguages: Record<string, string[]> = {};
  try {
    const voices = fc.getVoices();
    current = (role === "captain" ? voices.captain : role === "crew" ? voices.crew : voices.gateAgent ?? "").trim();
    voiceRoles = voices.voiceRoles ?? {};
    voiceLanguages = voices.voiceLanguages ?? {};
  } catch {
    return { role, voiceId: null, languageId };
  }
  const tagsOf = (id: string): string[] | null => {
    const tags = voiceLanguages[id];
    return Array.isArray(tags) ? tags : null;
  };
  const provenFor = (id: string, lang: string | null): boolean =>
    id !== "" && lang !== null && (tagsOf(id) ?? []).includes(lang);
  // 1) Idioma vacío → derivarlo del locutor si sus tags lo permiten.
  if (!languageId && current !== "") {
    const curTags = tagsOf(current) ?? [];
    if (curTags.length > 0) languageId = curTags[0];
  }
  // 2) Voz actual probada → respeto estricto.
  if (provenFor(current, languageId)) {
    return { role, voiceId: current, languageId };
  }
  // 3) Alternativa del rol probada en el idioma global.
  if (languageId) {
    const alternative = Object.keys(voiceRoles).find(
      (id) => voiceRoles[id] === role && (tagsOf(id) ?? []).includes(languageId as string)
    );
    if (alternative) return { role, voiceId: alternative, languageId };
  }
  // 4) Actual sin etiquetar y sin alternativa → fail-open histórico.
  if (current !== "" && tagsOf(current) === null) {
    return { role, voiceId: current, languageId };
  }
  // 5) Actual en otro idioma sin alternativa: no fijar voz errónea.
  return { role, voiceId: null, languageId };
}
