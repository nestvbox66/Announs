/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Servicio de caché en memoria para las pistas de música ambiental.
 *
 * Guarda el `ArrayBuffer` descargado de cada URL durante un TTL de 7 días, de
 * forma que el preview en la configuración (usa `clean_url`) y la reproducción
 * en vuelo (usa `processed_url`) compartan la misma descarga y no repitan
 * peticiones de red.
 */
export class MusicCacheService {
  private cache: Map<string, { data: ArrayBuffer; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

  async getMusic(url: string): Promise<ArrayBuffer> {
    // 1. Verificar caché
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[MusicCache] 🎵 Usando caché para:', url);
      return cached.data;
    }

    // 2. Descargar
    console.log('[MusicCache] 🎵 Descargando:', url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al descargar audio: ${url}`);
    }
    const data = await response.arrayBuffer();

    // 3. Almacenar en caché
    this.cache.set(url, { data, timestamp: Date.now() });

    return data;
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[MusicCache] 🗑️ Caché limpiado');
  }
}

/**
 * Instancia única compartida entre el preview de configuración y la
 * reproducción en vuelo (requisito de caché compartido).
 */
export const musicCacheService = new MusicCacheService();
