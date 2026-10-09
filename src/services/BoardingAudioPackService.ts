/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Servicio de Packages de la comunidad de tipo audio de embarque
 * (`boarding_audio`), espejo del flujo de Safety Video pero para la música de
 * embarque/desembarque.
 *
 * Responsabilidades:
 *  - Consultar el catálogo `packages` filtrando por
 *    `package_type = 'boarding_audio'` y `status = 'approved'`, con match
 *    contra el `airline_icao` del vuelo actual (los genéricos —`airline_icao`
 *    nulo o vacío— siempre aplican).
 *  - Mantener el package seleccionado para el vuelo en curso.
 *  - Pre-descargar en segundo plano el `package_url` (Supabase Storage) a un
 *    caché local en memoria (blob + object URL) para reproducción inmediata.
 *
 * La reproducción la hace `MusicController` (loop + ducking + stop, igual que
 * la pista de catálogo): este servicio solo resuelve QUÉ audio suena.
 */

import { supabase } from "../lib/supabase";
import type { PackageRecord } from "./PackagesService";
import { fileLogger } from "./FileLogger";

/** Clave de localStorage con el package de audio elegido por defecto (id). */
export const BOARDING_AUDIO_PACKAGE_STORAGE_KEY = "cfg_boarding_audio_package_id";

/** Clave de localStorage con la fuente de música (`ia` | `pack`). */
export const BOARDING_AUDIO_SOURCE_STORAGE_KEY = "cfg_boarding_music_source";

/** Fuente de la música de embarque/desembarque. */
export type BoardingAudioSource = "ia" | "pack";

/** TTL del caché local de audio (7 días, igual que el resto de medios). */
export const BOARDING_AUDIO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PACKAGE_SELECT =
  "id, package_name, package_desc, package_type, package_url, cover_image_url, duration_seconds, status, airline_icao, package_enabled, user_id, created_at";

/** Valores de `airline_icao` que se consideran "genéricos" (valen para todo). */
const GENERIC_AIRLINE_TOKENS = new Set(["", "N/A", "-", "NA", "NULL", "GENERIC", "ALL"]);

/** ¿El package es genérico (sin aerolínea asignada)? */
export function isGenericBoardingPackage(pkg: Pick<PackageRecord, "airline_icao">): boolean {
  const icao = (pkg.airline_icao ?? "").toString().toUpperCase().trim();
  return GENERIC_AIRLINE_TOKENS.has(icao);
}

/** Normaliza un ICAO de aerolínea (mayúsculas, sin espacios). */
export function normalizeBoardingAirlineIcao(value: string | null | undefined): string {
  return (value ?? "").toString().toUpperCase().trim();
}

/** Normaliza la fuente guardada (`ia` por defecto ante cualquier otro valor). */
export function toBoardingAudioSource(value: string | null | undefined): BoardingAudioSource {
  return (value ?? "").toString().trim().toLowerCase() === "pack" ? "pack" : "ia";
}

function toPackageRecord(row: any): PackageRecord {
  return {
    id: String(row.id),
    package_name: row.package_name ?? "",
    package_desc: row.package_desc ?? null,
    package_type: row.package_type,
    package_url: row.package_url ?? null,
    cover_image_url: row.cover_image_url ?? null,
    duration_seconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    status: row.status ?? "pending",
    airline_icao: row.airline_icao ?? null,
    package_enabled: row.package_enabled ?? true,
    user_id: row.user_id ?? null,
    created_at: row.created_at ?? "",
  };
}

interface CachedAudio {
  packageId: string;
  blob: Blob;
  objectUrl: string;
  remoteUrl: string;
  timestamp: number;
}

class BoardingAudioPackService {
  private activePackage: PackageRecord | null = null;
  private cache = new Map<string, CachedAudio>();

  // ── Selección ────────────────────────────────────────────────────

  /** Package seleccionado para el vuelo en curso (o default del usuario). */
  getActivePackage(): PackageRecord | null {
    return this.activePackage;
  }

  setActivePackage(pkg: PackageRecord | null): void {
    this.activePackage = pkg;
  }

  /** URL local cacheada del package activo, si ya se pre-descargó. */
  getActiveObjectUrl(): string | null {
    if (!this.activePackage) return null;
    const cached = this.cache.get(this.activePackage.id);
    if (cached && Date.now() - cached.timestamp < BOARDING_AUDIO_CACHE_TTL_MS) {
      return cached.objectUrl;
    }
    return null;
  }

  /** ¿Hay audio cacheado en memoria para este package? */
  isCached(packageId: string): boolean {
    const cached = this.cache.get(packageId);
    return !!cached && Date.now() - cached.timestamp < BOARDING_AUDIO_CACHE_TTL_MS;
  }

  /** Id del package por defecto guardado por el usuario (Settings/pre-vuelo). */
  getStoredPackageId(): string | null {
    try {
      return localStorage.getItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /** Fuente guardada por el usuario (`ia` por defecto). */
  getStoredSource(): BoardingAudioSource {
    try {
      return toBoardingAudioSource(localStorage.getItem(BOARDING_AUDIO_SOURCE_STORAGE_KEY));
    } catch {
      return "ia";
    }
  }

  /**
   * Resuelve el package activo para una aerolínea: el preferido (por id) si
   * sigue disponible, si no el primero del catálogo, si no null.
   */
  async resolveActivePackage(
    airlineIcao: string | null | undefined,
    preferredId?: string | null
  ): Promise<PackageRecord | null> {
    const { data, error } = await this.listBoardingAudiosForAirline(airlineIcao);
    if (error) {
      console.warn("[BoardingAudio] No se pudo resolver el package activo:", error);
      fileLogger.warn("[BoardingAudio] resolveActivePackage falló", {
        airlineIcao: airlineIcao ?? null,
        error,
      });
      return null;
    }
    if (data.length === 0) {
      console.warn("[BoardingAudio] Sin audios para la aerolínea:", airlineIcao ?? "(todas)");
      fileLogger.warn("[BoardingAudio] Sin audios para la aerolínea", {
        airlineIcao: airlineIcao ?? null,
      });
      return null;
    }
    if (preferredId) {
      const found = data.find((pkg) => pkg.id === preferredId) ?? null;
      if (found) return found;
    }
    return data[0];
  }

  // ── Catálogo ─────────────────────────────────────────────────────

  /**
   * Lista los audios de embarque disponibles para una aerolínea:
   * `package_type = 'boarding_audio'`, `status = 'approved'`, habilitados, y
   * con match de `airline_icao` (o genéricos). Los específicos van primero;
   * dentro de cada grupo, los más recientes primero.
   *
   * Con `airlineIcao` vacío se devuelven todos (pantalla de preferencias sin
   * vuelo asociado).
   */
  async listBoardingAudiosForAirline(
    airlineIcao: string | null | undefined
  ): Promise<{ data: PackageRecord[]; error: string | null }> {
    const wanted = normalizeBoardingAirlineIcao(airlineIcao);
    try {
      const { data, error } = await supabase
        .from("packages")
        .select(PACKAGE_SELECT)
        .eq("package_type", "boarding_audio")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) return { data: [], error: error.message };

      const records = ((data ?? []) as any[])
        .map(toPackageRecord)
        .filter((pkg) => pkg.package_enabled !== false)
        .filter((pkg) => !!pkg.package_url)
        .filter((pkg) => {
          if (!wanted) return true;
          if (isGenericBoardingPackage(pkg)) return true;
          return normalizeBoardingAirlineIcao(pkg.airline_icao) === wanted;
        });

      records.sort((a, b) => {
        const aSpecific = !isGenericBoardingPackage(a) ? 0 : 1;
        const bSpecific = !isGenericBoardingPackage(b) ? 0 : 1;
        if (aSpecific !== bSpecific) return aSpecific - bSpecific;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });

      return { data: records, error: null };
    } catch (err) {
      return { data: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Caché local (pre-descarga en segundo plano) ──────────────────

  /**
   * Descarga silenciosa del `package_url` a un blob local + object URL.
   * Idempotente: si ya está cacheado y vigente, reutiliza el caché. Nunca
   * lanza (los errores se devuelven en `error`).
   */
  async precacheBoardingAudio(
    pkg: PackageRecord
  ): Promise<{ objectUrl: string | null; fromCache: boolean; error: string | null }> {
    const cached = this.cache.get(pkg.id);
    if (cached && Date.now() - cached.timestamp < BOARDING_AUDIO_CACHE_TTL_MS) {
      return { objectUrl: cached.objectUrl, fromCache: true, error: null };
    }
    if (!pkg.package_url) {
      return { objectUrl: null, fromCache: false, error: "Package sin package_url" };
    }
    try {
      console.log("[BoardingAudio] ⏬ Pre-descargando en segundo plano:", {
        id: pkg.id,
        name: pkg.package_name,
      });
      const response = await fetch(pkg.package_url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al descargar ${pkg.package_url}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const previous = this.cache.get(pkg.id);
      if (previous) {
        try {
          URL.revokeObjectURL(previous.objectUrl);
        } catch {
          // ignorar: la URL anterior ya era inválida
        }
      }
      this.cache.set(pkg.id, {
        packageId: pkg.id,
        blob,
        objectUrl,
        remoteUrl: pkg.package_url,
        timestamp: Date.now(),
      });
      console.log("[BoardingAudio] ✅ Audio cacheado localmente:", {
        id: pkg.id,
        bytes: blob.size,
      });
      fileLogger.log("[BoardingAudio] Audio cacheado", { id: pkg.id, bytes: blob.size });
      return { objectUrl, fromCache: false, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[BoardingAudio] ⚠️ Pre-descarga fallida (se usará streaming):", message);
      fileLogger.warn("[BoardingAudio] Pre-descarga fallida", { id: pkg.id, error: message });
      return { objectUrl: null, fromCache: false, error: message };
    }
  }

  /** Libera los object URL cacheados (p. ej. al cerrar el vuelo). */
  clearCache(): void {
    for (const cached of this.cache.values()) {
      try {
        URL.revokeObjectURL(cached.objectUrl);
      } catch {
        // ignorar
      }
    }
    this.cache.clear();
  }
}

/** Instancia única compartida entre configuración, vuelo y reproductor. */
export const boardingAudioPackService = new BoardingAudioPackService();
