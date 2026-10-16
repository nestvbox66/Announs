/**
 * Verificación — proveedor onAnyRunway X-Plane (vía paridad) + saneado.
 *
 * Casos:
 *  1. Geometría salida + plan coincide → true/geometría, sin mismatch.
 *  2. Mismatch con planificada → dispara igual + flag.
 *  3. Geometría destino (arribo) → true con airportIcao destino.
 *  4. Fuera de pista con geometría → false/geometría.
 *  5. Sin geometría + gs 35 en tierra → true/fallback (degradado).
 *  6. Sin geometría + gs 10 en tierra → false/fallback.
 *  7. Sin geometría + en aire → ausente (null, no se adjunta).
 *  8. Sin lat/lon → ausente.
 *  9. Caché: si invoke falla, usa caché; si cambia mtime, revalida.
 * 10. Saneado null→undefined (aislado): null→undefined, false/0 intactos.
 * 11. MSFS y Mock intactos: sin cableado de paridad en sus archivos ni en
 *     el detector (onAnyRunway sigue sin leerse ahí).
 *
 * Uso: npx tsx scripts/xplane-runway-provider.verify.ts
 */
import * as fs from "node:fs";

// localStorage minimal para Node (el servicio lo usa con try/catch).
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

import { RunwayProximityService } from "../src/services/RunwayProximityService";
import { stripTelemetryNulls } from "../src/services/telemetryNulls";
import type { RunwayGeometry } from "../src/services/RunwayGeometry";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FALLA - ${name}${detail !== undefined ? ` (${detail})` : ""}`);
  }
}

// Pista E-O ~1112 m x 45 m: A "09" (0,0), B "27" (0,0.01).
const RWY: RunwayGeometry = {
  widthM: 45,
  ends: [
    { designator: "09", lat: 0, lon: 0, displacedThresholdM: 0 },
    { designator: "27", lat: 0, lon: 0.01, displacedThresholdM: 0 },
  ],
};

function rustPayload(designators = RWY) {
  return {
    icao: "TEST",
    runways: [
      {
        width_m: designators.widthM,
        surface: 2,
        ends: designators.ends.map((e) => ({
          designator: e.designator,
          lat: e.lat,
          lon: e.lon,
          displaced_threshold_m: e.displacedThresholdM,
        })),
      },
    ],
    ramps: [
      { lat: 1, lon: 1, kind: "gate", name: "B2" },
    ],
    source_file: "/xplane/Custom Scenery/Pack/Earth nav data/apt.dat",
    source_mtime: 1700000000,
    found: true,
  };
}

function invokeOk() {
  return async (cmd: string) => {
    if (cmd !== "get_runways") throw new Error("cmd inesperado " + cmd);
    return rustPayload();
  };
}

function snap(over: Record<string, unknown> = {}) {
  return {
    altitude: 0,
    groundspeed: 0,
    verticalSpeed: 0,
    heading: 180,
    latitude: 0,
    longitude: 0.005,
    simOnGround: true,
    onAnyRunway: null,
    ...over,
  } as any;
}

// ── 1. Plan coincide ────────────────────────────────────────────────
{
  const svc = new RunwayProximityService(invokeOk());
  svc.configureFlight({ departIcao: "TEST", arriveIcao: null, planRwy: "09" });
  await svc["ensureLoaded"]("TEST");
  const r = svc.evaluateSnap(snap());
  check("1 plan coincide true/geometría", r?.value === true && r?.source === "geometry", JSON.stringify(r));
  check("1 sin mismatch", r?.planMismatch === false, JSON.stringify(r));
}

// ── 2. Mismatch ─────────────────────────────────────────────────────
{
  const svc = new RunwayProximityService(invokeOk());
  svc.configureFlight({ departIcao: "TEST", arriveIcao: null, planRwy: "27" });
  await svc["ensureLoaded"]("TEST");
  const r = svc.evaluateSnap(snap()); // más cerca del extremo 09
  check("2 mismatch dispara igual", r?.value === true, JSON.stringify(r));
  check("2 flag mismatch", r?.planMismatch === true, JSON.stringify(r));
}

// ── 3. Destino ──────────────────────────────────────────────────────
{
  // ICAOs frescos (la caché es compartida en el proceso).
  const svc2 = new RunwayProximityService(async (cmd: string, args: any) => {
    if (args?.icao === "DSTARR") return rustPayload();
    throw new Error("sin datos");
  });
  svc2.configureFlight({ departIcao: "DSTDEP", arriveIcao: "DSTARR", planRwy: null });
  await (svc2 as any).ensureLoaded("DSTARR");
  await (svc2 as any).ensureLoaded("DSTDEP");
  const r = svc2.evaluateSnap(snap());
  check("3 destino true", r?.value === true && r?.airportIcao === "DSTARR", JSON.stringify(r));
}

// ── 4. Fuera con geometría ──────────────────────────────────────────
{
  const svc = new RunwayProximityService(invokeOk());
  svc.configureFlight({ departIcao: "TEST", arriveIcao: null, planRwy: null });
  await svc["ensureLoaded"]("TEST");
  const r = svc.evaluateSnap(snap({ latitude: 50 / 111320 }));
  check("4 fuera false/geometría", r?.value === false && r?.source === "geometry", JSON.stringify(r));
}

// ── 5/6/7/8. Fallback y ausencias ───────────────────────────────────
{
  const failing = async () => {
    throw new Error("sin backend");
  };
  const svc = new RunwayProximityService(failing);
  svc.configureFlight({ departIcao: "NOGEO", arriveIcao: null, planRwy: null });
  await (svc as any).ensureLoaded("NOGEO");
  const fast = svc.evaluateSnap(snap({ groundspeed: 35 }));
  check("5 fallback rápido true", fast?.value === true && fast?.source === "fallback", JSON.stringify(fast));
  const slow = svc.evaluateSnap(snap({ groundspeed: 10 }));
  check("6 fallback lento false", slow?.value === false && slow?.source === "fallback", JSON.stringify(slow));
  const air = svc.evaluateSnap(snap({ groundspeed: 150, simOnGround: false }));
  check("7 en aire ausente", air === null, JSON.stringify(air));
  const nolat = svc.evaluateSnap(snap({ latitude: NaN }));
  check("8 sin lat ausente", nolat === null, JSON.stringify(nolat));
}

// ── 9. Caché ────────────────────────────────────────────────────────
{
  store.clear();
  let mtime = 1700000000;
  const invokeV = async () => ({ ...rustPayload(), source_mtime: mtime });
  const svc = new RunwayProximityService(invokeV);
  svc.configureFlight({ departIcao: "CACH", arriveIcao: null, planRwy: null });
  await (svc as any).ensureLoaded("CACH");
  check("9a carga inicial", svc.getRunways("CACH").length === 1, String(svc.getRunways("CACH").length));
  // Falla invoke → sirve caché.
  const svc2 = new RunwayProximityService(async () => {
    throw new Error("caído");
  });
  await (svc2 as any).ensureLoaded("CACH");
  check("9b caché ante fallo", svc2.getRunways("CACH").length === 1, String(svc2.getRunways("CACH").length));
  // Cambia mtime → revalida.
  mtime = 1800000000;
  const svc3 = new RunwayProximityService(invokeV);
  svc3.configureFlight({ departIcao: "CACH", arriveIcao: null, planRwy: null });
  await (svc3 as any).ensureLoaded("CACH");
  const st = svc3.getStatus();
  check("9c revalida por mtime", st.departSource !== null && st.departSource.includes("1800000000"), st.departSource ?? "null");
}

// ── 10. Saneado (aislado) ───────────────────────────────────────────
{
  const s = stripTelemetryNulls({
    altitude: 1000,
    onAnyRunway: null,
    atcOnParkingSpot: null,
    parkingBrake: false,
    groundspeed: 0,
    nextWaypoint: undefined,
  } as any) as any;
  check("10 null→undefined", s.onAnyRunway === undefined && s.atcOnParkingSpot === undefined, JSON.stringify(s));
  check("10 false/0 intactos", s.parkingBrake === false && s.groundspeed === 0 && s.altitude === 1000, JSON.stringify(s));
}

// ── 11. MSFS/Mock/detector intactos ─────────────────────────────────
{
  const msfs = fs.readFileSync("src/services/MsfsFlightController.ts", "utf-8");
  const mock = fs.readFileSync("src/services/MockFlightController.ts", "utf-8");
  const det = fs.readFileSync("src/services/FlightPhaseDetector.ts", "utf-8");
  const banned = ["RunwayProximity", "setOnAnyRunwayProvider", "setParkingProvider", "get_runways", "checkOnAnyRunway", "checkNearRamp", "evaluateParking"];
  const hit = (f: string, name: string) => banned.filter((b) => f.includes(b)).map((b) => `${name}:${b}`);
  const hits = [...hit(msfs, "msfs"), ...hit(mock, "mock"), ...hit(det, "detector")];
  check("11 sin cableado en MSFS/Mock/detector", hits.length === 0, hits.join(","));
  check("11 detector ignora onAnyRunway", !det.includes("onAnyRunway"), "referencia encontrada");
}

// ── 12. Parking por paridad ─────────────────────────────────────────
function parkSnap(over: Record<string, unknown> = {}) {
  return {
    altitude: 0,
    groundspeed: 0,
    verticalSpeed: 0,
    heading: 180,
    latitude: 1,
    longitude: 1,
    simOnGround: true,
    parkingBrake: true,
    atcOnParkingSpot: null,
    ...over,
  } as any;
}

{
  const svc = new RunwayProximityService(invokeOk());
  svc.configureFlight({ departIcao: "TEST", arriveIcao: null, planRwy: null });
  await (svc as any).ensureLoaded("TEST");
  // Junto a la puerta B2 (1,1), detenido, freno → true/geometry.
  const at = svc.evaluateParking(parkSnap());
  check("12 en puerta true", at?.value === true && at?.source === "geometry", JSON.stringify(at));
  check("12 stand informado", at?.standName === "B2", JSON.stringify(at));
  // En movimiento → false (no dispara en rodaje por la puerta).
  const moving = svc.evaluateParking(parkSnap({ groundspeed: 12 }));
  check("12 en movimiento false", moving?.value === false, JSON.stringify(moving));
  // Sin freno → false.
  const nobrake = svc.evaluateParking(parkSnap({ parkingBrake: false }));
  check("12 sin freno false", nobrake?.value === false, JSON.stringify(nobrake));
  // Lejos de rampas → false/geometry.
  const far = svc.evaluateParking(parkSnap({ latitude: 0, longitude: 0.005 }));
  check("12 lejos false", far?.value === false, JSON.stringify(far));
  // Sin rampas en ningún aeropuerto → ausente (sin fallback deliberado).
  const svc2 = new RunwayProximityService(async () => ({
    icao: "NORAMP", runways: [], ramps: [],
    source_file: "x", source_mtime: 1, found: true,
  }));
  svc2.configureFlight({ departIcao: "NORAMP", arriveIcao: null, planRwy: null });
  await (svc2 as any).ensureLoaded("NORAMP");
  const absent = svc2.evaluateParking(parkSnap());
  check("12 sin rampas ausente", absent === null, JSON.stringify(absent));
}

// ── Resultado ───────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} verificación(es) FALLIDA(S)`);
  process.exit(1);
} else {
  console.log("\nTodas las verificaciones del proveedor superadas.");
}
