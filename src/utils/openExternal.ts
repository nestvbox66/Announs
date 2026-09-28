/**
 * openExternalUrl — abre una URL en el navegador por defecto.
 *
 * En la app de escritorio (Tauri) `window.open` no hace nada: se usa el
 * plugin shell (`open`), que delega en el navegador del sistema. En
 * navegador web (modo dev) se usa `window.open` clásico.
 */
import { isTauri } from "@tauri-apps/api/core";

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  }
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    throw new Error("popup-blocked");
  }
}
