/**
 * Auto-actualización nativa (Tauri v2 `plugin-updater` + `plugin-process`).
 *
 * - Solo disponible en la app de escritorio; en navegador (dev web) todo
 *   degrada a "no soportado" sin romper la UI.
 * - `checkForUpdatesCached` memoiza el último chequeo unos minutos para que
 *   el aviso silencioso de arranque y la tarjeta de Configuración no
 *   disparen doble descarga de metadatos.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

/** True solo dentro del runtime Tauri (la web nunca actualiza binarios). */
export function isDesktopApp(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window
    );
  } catch {
    return false;
  }
}

export interface AvailableUpdate {
  currentVersion: string;
  availableVersion: string;
  notes: string | null;
  update: Update;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAt = 0;
let cachedPromise: Promise<AvailableUpdate | null> | null = null;

/** Versión instalada (tauri.conf.json). Null si no se puede leer. */
export async function getCurrentVersion(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

/**
 * Comprueba si hay actualización (null = al día). Nunca lanza: ante
 * cualquier fallo (sin red, sin endpoint configurado, sin pubkey) devuelve
 * null para que el arranque siga silencioso.
 */
export async function checkForUpdates(): Promise<AvailableUpdate | null> {
  if (!isDesktopApp()) return null;
  try {
    const update = await check();
    if (!update) {
      await closeQuietly(null);
      return null;
    }
    return {
      currentVersion: update.currentVersion,
      availableVersion: update.version,
      notes: update.body ?? null,
      update,
    };
  } catch {
    return null;
  }
}

async function closeQuietly(update: Update | null): Promise<void> {
  try {
    await update?.close();
  } catch {
    // Mejor esfuerzo: el recurso se libera con el proceso.
  }
}

/** Variante memoizada (TTL) para no duplicar el chequeo al arrancar. */
export function checkForUpdatesCached(force = false): Promise<AvailableUpdate | null> {
  if (force || !cachedPromise || Date.now() - cachedAt > CACHE_TTL_MS) {
    cachedAt = Date.now();
    cachedPromise = checkForUpdates();
  }
  return cachedPromise;
}

/** Descarga, instala y reinicia la app con la actualización dada. */
export async function downloadInstallAndRelaunch(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      downloaded = 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }
    onProgress?.(downloaded, total);
  });
  await relaunch();
}

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "error"
  | "unsupported";

export interface UpdaterState {
  phase: UpdaterPhase;
  supported: boolean;
  currentVersion: string | null;
  availableVersion: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
}

/**
 * Estado compartible del actualizador (tarjeta de Configuración).
 * Con `autoCheck`, dispara el chequeo memoizado al montar.
 */
export function useAppUpdater(autoCheck = false): UpdaterState & {
  checkNow: () => void;
  install: () => Promise<void>;
} {
  const [phase, setPhase] = useState<UpdaterPhase>("idle");
  const [supported] = useState(() => isDesktopApp());
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyResult = useCallback((result: AvailableUpdate | null) => {
    if (!mountedRef.current) return;
    if (result) {
      updateRef.current = result.update;
      setCurrentVersion(result.currentVersion);
      setAvailableVersion(result.availableVersion);
      setNotes(result.notes);
      setPhase("available");
    } else {
      setPhase("up-to-date");
    }
  }, []);

  const checkNow = useCallback(() => {
    if (!isDesktopApp()) {
      setPhase("unsupported");
      return;
    }
    setPhase("checking");
    setError(null);
    void getCurrentVersion()
      .then((v) => {
        if (mountedRef.current && v) setCurrentVersion(v);
      })
      .catch(() => {});
    void checkForUpdatesCached()
      .then(applyResult)
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
  }, [applyResult]);

  useEffect(() => {
    if (autoCheck) checkNow();
  }, [autoCheck, checkNow]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    setError(null);
    try {
      await downloadInstallAndRelaunch(update, (downloaded, total) => {
        if (!mountedRef.current) return;
        setProgress(total && total > 0 ? Math.min(1, downloaded / total) : null);
      });
      // Si relaunch no prospera, se queda en descarga al 100 %.
      if (mountedRef.current) setProgress(1);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  return {
    phase,
    supported,
    currentVersion,
    availableVersion,
    notes,
    progress,
    error,
    checkNow,
    install,
  };
}
