/**
 * desktopAuth — flujo de login con Google para la app de escritorio (Tauri).
 *
 * En escritorio el WebView no debe renderizar el retorno de Google: el
 * login se abre en el navegador del sistema y Supabase vuelve a la app
 * mediante el deep link `announs://auth/callback`, que Tauri entrega al
 * frontend vía `onOpenUrl`.
 */
import { isTauri } from "@tauri-apps/api/core";
import { supabase } from "../lib/supabase";
import { openExternalUrl } from "../utils/openExternal";
import {
  DESKTOP_AUTH_CALLBACK,
  extractAuthCode,
} from "../utils/desktopAuthUrl";

export { DESKTOP_AUTH_CALLBACK, extractAuthCode };

export function isDesktop(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Inicia el login con Google. En escritorio usa `skipBrowserRedirect` y
 * abre la URL de Supabase en el navegador externo; en web conserva el
 * comportamiento actual (redirección en la misma pestaña).
 * En escritorio devuelve `{ error: null }` tras abrir el navegador
 * (el resultado llegará por el deep link); en web, tras redirigir.
 */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  if (isDesktop()) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: DESKTOP_AUTH_CALLBACK,
        skipBrowserRedirect: true,
      },
    });
    if (error) {
      return { error: error.message };
    }
    if (!data.url) {
      return { error: "No se pudo obtener la URL de autenticación." };
    }
    await openExternalUrl(data.url);
    return { error: null };
  }

  const { error } = await supabase.auth.signInWithOAuth({ provider: "google" });
  return { error: error ? error.message : null };
}

/**
 * Registro con correo y contraseña (lógica portada de la versión web).
 * Devuelve `confirmEmail: true` cuando Supabase exige confirmación por correo
 * (el usuario debe revisar su bandeja antes de poder entrar).
 */
export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<{ confirmEmail: boolean; error: unknown | null }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { confirmEmail: false, error };
  }
  if (!data.session) {
    return { confirmEmail: true, error: null };
  }
  await ensureDesktopProfile(data.user?.id, email);
  return { confirmEmail: false, error: null };
}

/**
 * Envía el correo de recuperación de contraseña.
 *
 * El desktop no puede recibir el enlace del correo (no hay servidor https
 * local), así que el enlace abre la página web de actualización
 * (`update-password` en app.announs.net), donde el usuario define la clave
 * nueva y luego vuelve a entrar en el desktop. Como en la web, la respuesta
 * es siempre de éxito aparente (anti-enumeración: Supabase no revela si el
 * correo existe).
 */
export async function sendPasswordReset(email: string): Promise<{ error: unknown | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "https://app.announs.net/update-password",
  });
  return { error };
}

/**
 * Asegura la fila de perfil (`public.users`) tras el registro con correo.
 * Si la base la crea por trigger, el insert falla de forma inocua y se ignora
 * (misma lógica que `ensureProfile` de la versión web).
 */
export async function ensureDesktopProfile(
  userId: string | undefined,
  email: string,
): Promise<void> {
  if (!userId) return;
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return;
  const { error } = await supabase.from("users").insert({
    id: userId,
    username: email.split("@")[0] ?? email,
    email,
  });
  if (error) {
    console.warn("[Auth] ensureDesktopProfile:", error.message);
  }
}

/**
 * Resuelve una URL de deep link `announs://auth/callback?code=...`
 * intercambiando el código por una sesión de Supabase.
 * Devuelve `true` si la URL era un callback de auth y la sesión quedó
 * establecida.
 */
export async function handleAuthDeepLink(url: string): Promise<boolean> {
  const code = extractAuthCode(url);
  if (!code) {
    return false;
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[Auth] exchangeCodeForSession falló:", error.message);
    return false;
  }
  return true;
}
