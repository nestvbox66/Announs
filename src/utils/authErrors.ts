/**
 * authErrors — sanitización de errores de auth para la UI (desktop).
 *
 * Port de `utils/errors.ts` de la versión web (app.announs.net):
 * - El detalle real se loguea en consola para diagnóstico interno.
 * - La UI solo recibe una clave pública (`auth_invalid`, `auth_throttled`…),
 *   que el componente traduce con `t("login.errors.<clave>")`.
 * - Los mensajes crudos de Supabase/PostgREST/RLS jamás llegan al usuario.
 */

/** Patrones sensibles que nunca deben ver los usuarios. */
const SENSITIVE_PATTERNS = [
  "row-level security",
  "jwt",
  "expired",
  "permission",
  "violates check constraint",
  "violates foreign key constraint",
  "foreign key",
  "check constraint",
  "duplicate key",
  "postgrest",
  "storage",
  "bucket",
  "auth.uid",
  "rls",
  "policy",
];

/** Mensajes conocidos de Supabase Auth → claves genéricas (anti-enumeración). */
const AUTH_MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "auth_invalid"],
  [/user already registered|email already registered/i, "auth_check_email"],
  [/email not confirmed/i, "auth_check_email"],
  // Debe ir antes que "password should be at least": Supabase devuelve la lista
  // de clases requeridas (minúscula, mayúscula, número y símbolo).
  [/password should contain at least one character of each/i, "auth_password_weak"],
  [/weak password|password is too weak/i, "auth_password_weak"],
  [/password should be at least/i, "auth_password_too_short"],
  [/new password should be different|same password/i, "auth_same_password"],
  [/for security purposes|rate limit|too many requests|throttl/i, "auth_throttled"],
  [/auth session missing|refresh token|session.*expired|session_invalid/i, "session_invalid"],
  [/network|failed to fetch|fetch failed/i, "network_error"],
];

/** Códigos de error de Supabase Auth (más fiables que el texto). */
const AUTH_CODE_MAP: Record<string, string> = {
  invalid_credentials: "auth_invalid",
  user_already_exists: "auth_check_email",
  email_exists: "auth_check_email",
  email_not_confirmed: "auth_check_email",
  weak_password: "auth_password_weak",
  same_password: "auth_same_password",
  over_email_send_rate_limit: "auth_throttled",
  over_request_rate_limit: "auth_throttled",
  over_sms_send_rate_limit: "auth_throttled",
  session_not_found: "session_invalid",
  refresh_token_not_found: "session_invalid",
  refresh_token_already_used: "session_invalid",
};

/** Claves genéricas propias: seguras para pasar tal cual. */
const GENERIC_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "string"
      ? err
      : "";
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

/**
 * Loguea el detalle real y calcula la clave pública segura.
 * Nunca devuelve el mensaje crudo: ante la duda, `fallback`.
 */
export function authErrorKey(err: unknown, fallback = "auth_error"): string {
  console.error("[Auth]", err);

  const code = errorCode(err);
  if (code && AUTH_CODE_MAP[code]) return AUTH_CODE_MAP[code];

  const message = errorMessage(err).trim();
  if (!message) return fallback;

  // Ya es una clave genérica propia (p. ej. tras doble sanitización).
  if (GENERIC_KEY_RE.test(message)) return message;

  // Mapeo de auth conocidos antes del fallback genérico.
  for (const [re, key] of AUTH_MAP) {
    if (re.test(message)) return key;
  }

  // Patrones sensibles de BD/RLS/Storage → mensaje genérico.
  const lower = message.toLowerCase();
  if (SENSITIVE_PATTERNS.some((p) => lower.includes(p))) return fallback;

  // Cualquier otro mensaje crudo tampoco se expone.
  return fallback;
}
