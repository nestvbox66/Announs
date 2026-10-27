/**
 * bump-version.js — incremento minor de la versión de la app.
 *
 * Fuente de la verdad: `src-tauri/tauri.conf.json` (versión que Tauri
 * muestra y empaqueta). El script calcula el siguiente minor
 * (p. ej. 0.11.0 -> 0.12.0, patch reiniciado a 0) y lo sincroniza en:
 *   - src-tauri/tauri.conf.json
 *   - package.json
 *
 * Uso: node scripts/bump-version.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_CONF = path.join(ROOT, "src-tauri", "tauri.conf.json");
const PACKAGE_JSON = path.join(ROOT, "package.json");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`No se pudo leer ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function bumpMinor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec((version || "").trim());
  if (!match) {
    console.error(
      `Versión actual inválida ("${version}"): se esperaba formato X.Y.Z.`,
    );
    process.exit(1);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `${major}.${minor + 1}.0`;
}

const tauriConf = readJson(TAURI_CONF);
const packageJson = readJson(PACKAGE_JSON);

const oldVersion = tauriConf.version;
if (typeof oldVersion !== "string" || oldVersion.length === 0) {
  console.error("src-tauri/tauri.conf.json no contiene un campo version válido.");
  process.exit(1);
}

const newVersion = bumpMinor(oldVersion);

tauriConf.version = newVersion;
writeJson(TAURI_CONF, tauriConf);

packageJson.version = newVersion;
writeJson(PACKAGE_JSON, packageJson);

console.log(`Versión actualizada: ${oldVersion} -> ${newVersion}`);
console.log(`  - src-tauri/tauri.conf.json`);
console.log(`  - package.json`);
