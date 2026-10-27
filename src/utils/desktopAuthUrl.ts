/**
 * desktopAuthUrl — utilidades puras (sin dependencias nativas ni de red)
 * para el flujo de login con Google en escritorio vía deep link.
 */

/** Esquema personalizado registrado en tauri.conf.json (plugins.deep-link). */
export const DESKTOP_AUTH_CALLBACK = "announs://auth/callback";

/**
 * Extrae el `code` de autorización de una URL `announs://auth/callback`.
 * Devuelve `null` si la URL no es un callback de auth válido.
 */
export function extractAuthCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "announs:") {
    return null;
  }
  // `announs://auth/callback` → host "auth", path "/callback".
  const code =
    parsed.searchParams.get("code") ??
    // Tolerar variantes con el código en el fragmento (#access_token=...):
    new URLSearchParams(parsed.hash.replace(/^#/, "")).get("code");
  const isCallback =
    parsed.host === "auth" ||
    parsed.pathname.includes("callback") ||
    code !== null;
  if (!isCallback || !code) {
    return null;
  }
  return code;
}
