/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * avatarUrl — resolución de la URL de avatar para mostrar.
 *
 * El Desktop guarda URLs públicas (`getPublicUrl`) en `users.avatar`. Si el
 * bucket es privado o falla la lectura, la URL pública responde 403/400 y la
 * imagen no carga. Este helper obtiene el `path` del objeto y, como respaldo,
 * genera una URL firmada (requiere policy de SELECT en `storage.objects`).
 */
import { supabase } from "../lib/supabase";

const AVATAR_BUCKET = "avatars";
const SIGNED_TTL_SEC = 60 * 60;

/** `path` del objeto dentro de una URL pública de Storage, o null. */
export function extractStoragePath(url: string, bucket: string): string | null {
  try {
    const marker = `/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const rest = url.slice(idx + marker.length).split("?")[0];
    return decodeURIComponent(rest) || null;
  } catch {
    return null;
  }
}

/**
 * Mejor URL para renderizar el avatar:
 * - vacío → null
 * - `data:` → tal cual
 * - no-http (emoji) → tal cual
 * - URL de Storage del bucket `avatars` → intenta firmarla (respaldo ante
 *   bucket privado); si falla, devuelve la original.
 * - otra http → tal cual (se asume alcanzable).
 */
export async function resolveAvatarDisplayUrl(
  url: string | null | undefined
): Promise<string | null> {
  const value = (url ?? "").trim();
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  if (!/^https?:/i.test(value)) return value;
  const path = extractStoragePath(value, AVATAR_BUCKET);
  if (!path) return value;
  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_TTL_SEC);
    if (error || !data?.signedUrl) return value;
    return data.signedUrl;
  } catch {
    return value;
  }
}
