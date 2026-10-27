/**
 * Etiqueta de música de embarque para el panel de layout de cabina.
 *
 * La etiqueta debe reflejar lo que realmente suena, no solo la selección del
 * catálogo. Casos que `musicTracks.find(id)` no cubre y que sí suenan:
 * - `RANDOM_MUSIC_ID`: el controlador elige una pista al azar.
 * - Sin selección explícita: el controlador usa una pista al azar del
 *   catálogo en vez de silencio (el on/off lo gobierna `enabled`).
 * - Fuente `pack`: suena el audio de la comunidad, no la pista del catálogo.
 */

export interface BoardingMusicLabelInput {
  /** Interruptor de música de embarque (`play_boarding_music`). */
  enabled: boolean;
  /** Fuente efectiva de audio (`ia` = catálogo, `pack` = comunidad). */
  audioSource: string;
  /** Nombre del package comunitario activo, si lo hay. */
  packName: string | null;
  /** Nombre de la pista del catálogo resuelta por id, si existe. */
  trackName: string | null;
  /** Id seleccionado en el selector (puede ser "" o el id aleatorio). */
  trackId: string;
  /** Cantidad de pistas del catálogo cargadas. */
  catalogSize: number;
  /** Valor del id especial aleatorio (`RANDOM_MUSIC_ID`). */
  randomTrackId: string;
  /** Etiqueta traducida de `music.random`. */
  randomLabel: string;
}

export function resolveBoardingMusicDisplayName(input: BoardingMusicLabelInput): string | null {
  if (!input.enabled) return null;
  if (input.audioSource === "pack" && input.packName) return input.packName;
  if (input.trackName) return input.trackName;
  if (input.trackId === input.randomTrackId) return input.randomLabel;
  // Sin selección explícita el controlador reproduce una pista al azar del
  // catálogo, así que la etiqueta no debe decir "sin música".
  if (!input.trackId && input.catalogSize > 0) return input.randomLabel;
  return input.trackId || null;
}
