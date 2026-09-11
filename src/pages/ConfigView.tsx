/**
 * Wrapper para compatibilidad con la ruta documentada.
 * La implementación real vive en `src/components/ConfigView.tsx` e integra
 * la persistencia de Personal de Vuelo (language_id, captain_voice_id, crew_voice_id, gate_agent_voice_id)
 * en `setting_general` vía supabase.
 *
 * Este archivo existe para satisfacer la ruta `src/pages/ConfigView.tsx`
 * mencionada en la spec.
 */
export { default } from "../components/ConfigView";
