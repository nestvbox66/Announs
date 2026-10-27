/**
 * Verificación del parseo del deep link `announs://auth/callback`.
 * Uso: npx tsx scripts/desktop-auth-deep-link.verify.ts
 */
import { extractAuthCode, DESKTOP_AUTH_CALLBACK } from "../src/utils/desktopAuthUrl";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
  if (!ok) failures++;
}

check("callback con code", extractAuthCode("announs://auth/callback?code=abc123"), "abc123");
check("constante de callback", DESKTOP_AUTH_CALLBACK, "announs://auth/callback");
check("sin code", extractAuthCode("announs://auth/callback"), null);
check("otro esquema", extractAuthCode("https://auth/callback?code=abc123"), null);
check("url inválida", extractAuthCode("no-es-url"), null);
check("code en fragmento", extractAuthCode("announs://auth/callback#code=xyz"), "xyz");
check("otro path sin code", extractAuthCode("announs://otra/cosa"), null);

if (failures > 0) {
  console.error(`${failures} comprobación(es) fallida(s)`);
  process.exit(1);
}
console.log("deep-link auth: todo OK");
