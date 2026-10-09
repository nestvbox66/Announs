/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Servicio para el catálogo de paquetes multimedia (`packages`) y las
 * preferencias personales del piloto (`user_package_preferences`).
 *
 * Esquema real (descubierto en Supabase):
 *   packages(id, package_name, package_desc, package_type, package_url,
 *     cover_image_url, duration_seconds, status, airline_icao,
 *     package_enabled, user_id, created_at)
 *   user_package_preferences(id, user_id, package_id, is_enabled, updated_at)
 *
 * Storage: bucket público `packages` (rutas `{userId}/covers/...` y
 * `{userId}/media/...`).
 */

export type PackageType = "boarding_audio" | "safety_video" | "airport_chime";

export type PackageStatus = "pending" | "approved" | "rejected" | string;

export interface PackageRecord {
  id: string;
  package_name: string;
  package_desc: string | null;
  package_type: PackageType;
  package_url: string | null;
  cover_image_url: string | null;
  duration_seconds: number | null;
  status: PackageStatus;
  airline_icao: string | null;
  package_enabled: boolean;
  user_id: string | null;
  created_at: string;
}

export interface AirlineOption {
  icao: string;
  name: string;
  country: string | null;
}

export interface CreatePackageInput {
  packageName: string;
  packageDesc: string;
  packageType: PackageType;
  airlineIcao: string | null;
  durationSeconds: number;
  mediaFile: File;
  coverFile: File | null;
}

import { supabase } from "../lib/supabase";

/** Bucket público de Supabase donde se suben portadas y archivos multimedia. */
export const PACKAGES_BUCKET = "packages";

const PACKAGE_SELECT =
  "id, package_name, package_desc, package_type, package_url, cover_image_url, duration_seconds, status, airline_icao, package_enabled, user_id, created_at";

/** Límites aplicados en el formulario de carga (textos vía i18n). */
export const PACKAGE_LIMITS = {
  audio: {
    accept: ".mp3,.wav",
    mimeTypes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"],
    maxSizeMb: 50,
    maxDurationSeconds: 600,
  },
  video: {
    accept: ".mp4",
    mimeTypes: ["video/mp4"],
    maxSizeMb: 200,
    maxDurationSeconds: 900,
  },
} as const;

function toPackageRecord(row: any): PackageRecord {
  return {
    id: String(row.id),
    package_name: row.package_name ?? "",
    package_desc: row.package_desc ?? null,
    package_type: row.package_type as PackageType,
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

/**
 * Lista el catálogo de paquetes APROBADOS (`status = 'approved'`),
 * más recientes primero. Los pendientes/rechazados no se muestran.
 */
export async function listPackages(): Promise<{
  data: PackageRecord[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("packages")
    .select(PACKAGE_SELECT)
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map(toPackageRecord), error: null };
}

/** Mapa package_id → is_enabled con las preferencias del piloto. */
export async function listPreferences(
  userId: string
): Promise<{ data: Map<string, boolean>; error: string | null }> {
  const { data, error } = await supabase
    .from("user_package_preferences")
    .select("package_id, is_enabled")
    .eq("user_id", userId);

  if (error) return { data: new Map(), error: error.message };
  const map = new Map<string, boolean>();
  for (const row of (data ?? []) as Array<{
    package_id: string;
    is_enabled: boolean;
  }>) {
    map.set(String(row.package_id), row.is_enabled ?? true);
  }
  return { data: map, error: null };
}

/**
 * Persiste la preferencia personal del piloto sobre un paquete
 * (UPSERT por `user_id + package_id`).
 */
export async function upsertPreference(
  userId: string,
  packageId: string,
  isEnabled: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("user_package_preferences").upsert(
    {
      user_id: userId,
      package_id: packageId,
      is_enabled: isEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,package_id" }
  );
  return { error: error ? error.message : null };
}

/**
 * Alterna la propiedad pública `package_enabled` del paquete.
 * (Puede fallar por RLS si el usuario no es el dueño: se propaga el error
 * para mostrarlo en un toast sin romper la UI.)
 */
export async function updatePackageEnabled(
  packageId: string,
  enabled: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("packages")
    .update({ package_enabled: enabled })
    .eq("id", packageId);
  return { error: error ? error.message : null };
}

/** Buscador de aerolíneas por ICAO o nombre (`of_airlines`). */
export async function searchAirlines(
  query: string
): Promise<{ data: AirlineOption[]; error: string | null }> {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return { data: [], error: null };

  const { data, error } = await supabase
    .from("of_airlines")
    .select("icao, name, country")
    .or(`icao.ilike.%${q}%,name.ilike.%${q}%`)
    .limit(10);

  if (error) return { data: [], error: error.message };
  const rows = ((data ?? []) as Array<{
    icao: unknown;
    name: unknown;
    country: unknown;
  }>)
    .map((r) => ({
      icao: String(r.icao ?? "").toUpperCase().trim(),
      name: String(r.name ?? "").trim(),
      country: r.country != null ? String(r.country) : null,
    }))
    .filter(
      (r) => r.icao !== "" && !["N/A", "-", "NA", "NULL"].includes(r.icao)
    );
  return { data: rows, error: null };
}

/** Claves de tipo para i18n (`config.packages.type_*`). */
export function packageTypeKey(type: PackageType): string {
  switch (type) {
    case "boarding_audio":
      return "type_boarding_audio";
    case "safety_video":
      return "type_safety_video";
    case "airport_chime":
      return "type_airport_chime";
    default:
      return "type_unknown";
  }
}

/** Clave de estado para i18n (`config.packages.status_*`). */
export function packageStatusKey(status: PackageStatus): string {
  switch (status) {
    case "approved":
      return "status_approved";
    case "rejected":
      return "status_rejected";
    case "pending":
      return "status_pending";
    default:
      return "status_unknown";
  }
}

/** Formatea segundos a `mm:ss` (ej. 165 → "02:45"). */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Lee en memoria la duración exacta (segundos) de un archivo multimedia
 * usando un elemento temporal `<audio>` / `<video>` (object URL).
 * Rechaza con códigos estables para i18n: `DURATION_UNREADABLE` |
 * `MEDIA_INVALID`.
 */
export function readMediaDuration(
  file: File,
  kind: "audio" | "video"
): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el =
      kind === "audio"
        ? document.createElement("audio")
        : document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const seconds = el.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(seconds)) {
        reject(new Error("DURATION_UNREADABLE"));
        return;
      }
      resolve(seconds);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("MEDIA_INVALID"));
    };
    el.src = url;
  });
}

/** Sube un archivo al bucket `packages` y devuelve su URL pública. */
async function uploadToBucket(
  userId: string,
  folder: "covers" | "media",
  file: File
): Promise<{ publicUrl: string; error: string | null }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${folder}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage
    .from(PACKAGES_BUCKET)
    .upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
  if (error) return { publicUrl: "", error: error.message };
  const { data } = supabase.storage.from(PACKAGES_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, error: null };
}

/** Códigos de error estables de `createPackage` (textos vía i18n). */
export type CreatePackageErrorCode =
  | "COVER_UPLOAD_FAILED"
  | "MEDIA_UPLOAD_FAILED"
  | "INSERT_FAILED"
  | "NO_RESPONSE";

/**
 * Flujo completo de carga: sube portada (opcional) y multimedia al bucket
 * `packages` y realiza el INSERT en `packages` con estado `pending`.
 * `error` es un código estable; `detail` trae el mensaje técnico (inglés).
 */
export async function createPackage(
  userId: string,
  input: CreatePackageInput
): Promise<{
  data: PackageRecord | null;
  error: CreatePackageErrorCode | null;
  detail: string | null;
}> {
  let coverUrl: string | null = null;
  if (input.coverFile) {
    const up = await uploadToBucket(userId, "covers", input.coverFile);
    if (up.error)
      return { data: null, error: "COVER_UPLOAD_FAILED", detail: up.error };
    coverUrl = up.publicUrl;
  }

  const media = await uploadToBucket(userId, "media", input.mediaFile);
  if (media.error)
    return { data: null, error: "MEDIA_UPLOAD_FAILED", detail: media.error };

  const { data, error } = await supabase
    .from("packages")
    .insert({
      package_name: input.packageName.trim(),
      package_desc: input.packageDesc.trim() || null,
      package_type: input.packageType,
      package_url: media.publicUrl,
      cover_image_url: coverUrl,
      duration_seconds: Math.round(input.durationSeconds),
      status: "pending",
      airline_icao: input.airlineIcao ? input.airlineIcao.toUpperCase() : null,
      package_enabled: true,
      user_id: userId,
    })
    .select(PACKAGE_SELECT)
    .maybeSingle();

  if (error) return { data: null, error: "INSERT_FAILED", detail: error.message };
  if (!data) return { data: null, error: "NO_RESPONSE", detail: null };
  return { data: toPackageRecord(data), error: null, detail: null };
}
