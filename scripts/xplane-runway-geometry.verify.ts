/**
 * Verificación — geometría de pistas X-Plane (vía paridad onAnyRunway).
 *
 * Casos (requerimiento G):
 *  1. Punto sobre la pista → dentro.
 *  2. Fuera lateral → fuera.
 *  3. En línea de espera (antes del extremo) → fuera.
 *  4. Más allá del extremo (lejos) → fuera.
 *  5. Pistas paralelas → coincide la correcta.
 *  6. Mismatch con plan_rwy → dispara igual + flag.
 *  7. Sin geometría → fuera (el fallback vive en el proveedor, no acá).
 *  8. Constantes: margen 10 m, umbral fallback 30 kt.
 *  9. MSFS y Mock intactos: el módulo no importa controladores ni telemetría.
 *
 * Uso: npx tsx scripts/xplane-runway-geometry.verify.ts
 */
import * as fs from "node:fs";
import {
  RUNWAY_MARGIN_M,
  FALLBACK_GROUNDSPEED_KT,
  PARKING_RADIUS_M,
  checkNearRamp,
  checkOnAnyRunway,
  isPointOnRunway,
  type RampStart,
  type RunwayGeometry,
} from "../src/services/RunwayGeometry";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FALLA - ${name}${detail !== undefined ? ` (${detail})` : ""}`);
  }
}

// Pista sintética E-O de ~1112 m x 45 m sobre el ecuador:
// A "09" en (0, 0), B "27" en (0, 0.01).
const RWY: RunwayGeometry = {
  widthM: 45,
  ends: [
    { designator: "09", lat: 0, lon: 0, displacedThresholdM: 0 },
    { designator: "27", lat: 0, lon: 0.01, displacedThresholdM: 0 },
  ],
};
// 1 grado de longitud en el ecuador ≈ 111320 m.
const DEG = 1 / 111320;

// ── 1. Punto sobre la pista ─────────────────────────────────────────
{
  const r = isPointOnRunway(0, 0.005, RWY);
  check("1 centro de pista dentro", r.inside === true, JSON.stringify(r));
}

// ── 2. Fuera lateral ────────────────────────────────────────────────
{
  // 50 m al norte del eje: fuera (semiancho 22.5 + margen 10 = 32.5).
  const r = isPointOnRunway(50 / 111320, 0.005, RWY);
  check("2 fuera lateral (50 m)", r.inside === false, JSON.stringify(r));
  // 30 m al norte: dentro (límite 32.5).
  const r2 = isPointOnRunway(30 / 111320, 0.005, RWY);
  check("2b borde lateral (30 m) dentro", r2.inside === true, JSON.stringify(r2));
}

// ── 3. Línea de espera: 30 m antes del extremo A sobre el eje → fuera ──
{
  const r = isPointOnRunway(0, -30 * DEG, RWY);
  check("3 espera previa (30 m) fuera", r.inside === false, JSON.stringify(r));
}

// ── 4. Más allá del extremo ─────────────────────────────────────────
{
  // Extremos sin capuchón: 5 m pasado el extremo, fuera (ya salió).
  const r = isPointOnRunway(0, 0.01 + 5 * DEG, RWY);
  check("4a pasado el extremo (5 m) fuera", r.inside === false, JSON.stringify(r));
  // Justo sobre la línea del umbral: dentro (entrando).
  const r2 = isPointOnRunway(0, 0.01, RWY);
  check("4b sobre el umbral dentro", r2.inside === true, JSON.stringify(r2));
  // 200 m pasado: fuera.
  const r3 = isPointOnRunway(0, 0.01 + 200 * DEG, RWY);
  check("4c más allá (200 m) fuera", r3.inside === false, JSON.stringify(r3));
}

// ── 5. Paralelas ────────────────────────────────────────────────────
{
  const rwy2: RunwayGeometry = {
    widthM: 45,
    ends: [
      { designator: "09L", lat: 300 / 111320, lon: 0, displacedThresholdM: 0 },
      { designator: "27R", lat: 300 / 111320, lon: 0.01, displacedThresholdM: 0 },
    ],
  };
  const out = checkOnAnyRunway(300 / 111320, 0.005, [RWY, rwy2]);
  check("5 paralela correcta", out.onRunway && out.matchedDesignator === "09L", JSON.stringify(out));
  // Punto medio entre ambas (150 m de cada eje): fuera de las dos.
  const mid = checkOnAnyRunway(150 / 111320, 0.005, [RWY, rwy2]);
  check("5b entre paralelas fuera", mid.onRunway === false, JSON.stringify(mid));
}

// ── 6. Mismatch con planificada ─────────────────────────────────────
{
  const out = checkOnAnyRunway(0, 0.005, [RWY], { planRwy: "27" });
  // El punto está más cerca del extremo 09 → coincide 09 ≠ plan 27.
  check("6 dispara igual con mismatch", out.onRunway === true, JSON.stringify(out));
  check("6 flag planMismatch", out.planMismatch === true, JSON.stringify(out));
  const out2 = checkOnAnyRunway(0, 0.005, [RWY], { planRwy: "09" });
  check("6b sin mismatch si coincide", out2.planMismatch === false, JSON.stringify(out2));
}

// ── 7. Sin geometría ────────────────────────────────────────────────
{
  const out = checkOnAnyRunway(0, 0.005, []);
  check("7 sin geometría fuera", out.onRunway === false, JSON.stringify(out));
  const nan = checkOnAnyRunway(NaN, 0.005, [RWY]);
  check("7b NaN no lanza y da fuera", nan.onRunway === false, JSON.stringify(nan));
}

// ── 8. Constantes ───────────────────────────────────────────────────
{
  check("8 margen 10 m", RUNWAY_MARGIN_M === 10, String(RUNWAY_MARGIN_M));
  check("8 umbral fallback 30 kt", FALLBACK_GROUNDSPEED_KT === 30, String(FALLBACK_GROUNDSPEED_KT));
}

// ── 9. MSFS y Mock intactos ─────────────────────────────────────────
{
  const src = fs.readFileSync("src/services/RunwayGeometry.ts", "utf-8");
  const banned = ["FlightController", "MockFlightController", "MsfsFlightController", "TelemetrySnapshot", "@tauri-apps"];
  const hit = banned.filter((b) => src.includes(b));
  check("9 geometría sin acoples (MSFS/Mock intactos)", hit.length === 0, hit.join(","));
}

// ── 10. Rampas (fila 1300) ──────────────────────────────────────────
{
  const ramps: RampStart[] = [
    { lat: 0, lon: 0, kind: "gate", name: "A7" },
    { lat: 500 / 111320, lon: 0, kind: "tie-down", name: "C3" },
  ];
  // Junto a la puerta A7 (10 m): cerca.
  const near = checkNearRamp(10 / 111320, 0, ramps);
  check("10 junto a puerta cerca", near.near === true && near.stand?.name === "A7", JSON.stringify(near));
  // 100 m: fuera (radio 40).
  const far = checkNearRamp(100 / 111320, 0, ramps);
  check("10 lejos fuera", far.near === false, JSON.stringify(far));
  // Sin rampas: fuera + distancia null.
  const empty = checkNearRamp(0, 0, []);
  check("10 sin rampas fuera", empty.near === false && empty.distanceM === null, JSON.stringify(empty));
  check("10 radio 40 m", PARKING_RADIUS_M === 40, String(PARKING_RADIUS_M));
}

// ── Resultado ───────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} verificación(es) FALLIDA(S)`);
  process.exit(1);
} else {
  console.log("\nTodas las verificaciones de geometría superadas.");
}
