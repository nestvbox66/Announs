/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * rpcSignature — utilidades puras (sin dependencias) para el fallback
 * progresivo de RPCs PostgREST: ante PGRST202 se recorta a la firma real
 * que el servidor declara en el hint y se reintenta.
 */

/**
 * Extrae la firma real del servidor desde el hint de PostgREST
 * ("Perhaps you meant to call the function public.f(p1, p2, ...)").
 * Devuelve null si no se puede parsear.
 */
export function parseRpcSignatureHint(errorText: string): Set<string> | null {
  const marker = "Perhaps you meant to call the function";
  const idx = errorText.indexOf(marker);
  if (idx < 0) return null;
  const rest = errorText.slice(idx + marker.length);
  const m = rest.match(/\(([^()]*)\)/);
  if (!m) return null;
  const params = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (params.length === 0) return null;
  return new Set(params);
}

/**
 * Filtra los params a los que el servidor declara (intersección).
 * Devuelve null si no hay nada que recortar.
 */
export function filterParamsToSignature(
  params: Record<string, unknown>,
  signature: Set<string>
): Record<string, unknown> | null {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (signature.has(k)) filtered[k] = v;
  }
  if (Object.keys(filtered).length === Object.keys(params).length) return null;
  return filtered;
}
