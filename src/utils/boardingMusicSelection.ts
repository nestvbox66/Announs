/**
 * Selección de música de embarque sin la opción "SIN MÚSICA".
 *
 * Con el interruptor de música encendido, una pista vacía provocaba silencio
 * inesperado (bug). Por eso el valor por defecto y la normalización caen a
 * "Música al azar" (`RANDOM_MUSIC_ID`).
 */
import { RANDOM_MUSIC_ID } from "../services/MusicController";

/** Valor por defecto de los desplegables de música ("Música al azar"). */
export const DEFAULT_BOARDING_MUSIC_ID = RANDOM_MUSIC_ID;

/**
 * Normaliza un valor leído (perfil, localStorage o estado legacy): vacío,
 * nulo o no texto cae al default aleatorio; cualquier id se conserva.
 */
export function normalizeBoardingMusicTrackId(
  value: string | null | undefined,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    return RANDOM_MUSIC_ID;
  }
  return value;
}
