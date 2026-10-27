/**
 * passwordRules — reglas de contraseña alineadas con la política de Supabase
 * (minúscula, mayúscula, número y símbolo) + longitud mínima de 12.
 *
 * Port de `utils/password.ts` de la versión web. Las etiquetas se resuelven
 * vía i18n (`login.password_rules.<id>`) para no duplicar idiomas aquí.
 */
export interface PasswordRule {
  id: "length" | "lower" | "upper" | "digit" | "symbol";
  test: (value: string) => boolean;
}

const SYMBOL_RE = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", test: (value) => value.length >= 12 },
  { id: "lower", test: (value) => /[a-z]/.test(value) },
  { id: "upper", test: (value) => /[A-Z]/.test(value) },
  { id: "digit", test: (value) => /[0-9]/.test(value) },
  { id: "symbol", test: (value) => SYMBOL_RE.test(value) },
];

export function isPasswordValid(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
