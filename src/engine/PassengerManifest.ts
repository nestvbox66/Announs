import namesData from "../data/names.json";
import type { Pasajero, Incidencia } from "../types";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRegionFromICAO(icao: string): string {
  const prefix = (icao || "")[0]?.toUpperCase() || "";
  const map: Record<string, string> = {
    S: "SA",
    K: "US",
    C: "US",
    E: "EU",
    L: "EU",
    B: "EU",
    O: "ME",
    D: "AF",
    F: "AF",
    G: "AF",
    H: "AF",
    N: "AF",
    R: "AS",
    U: "AS",
    V: "AS",
    W: "AS",
    Y: "AS",
    Z: "AS",
  };
  return map[prefix] || "US";
}

const COUNTRY_CODES: Record<string, string> = {
  SA: "AR",
  US: "US",
  EU: "ES",
  AS: "CN",
  ME: "SA",
  AF: "ZA",
};

const COUNTRY_NAMES: Record<string, string> = {
  SA: "Argentina",
  US: "United States",
  EU: "Spain",
  AS: "China",
  ME: "Saudi Arabia",
  AF: "South Africa",
};

function buildSeatPool(totalPax: number) {
  const primera = Math.round(totalPax * 0.1);
  const ejecutiva = Math.round(totalPax * 0.2);
  const economy = totalPax - primera - ejecutiva;

  const letters = ["A", "B", "C", "D", "E", "F"];
  const seats: { clase: string; label: string }[] = [];
  let row = 1;

  const pushSeats = (count: number, clase: string, startRow: number, rowsNeeded: number) => {
    let assigned = 0;
    for (let r = startRow; assigned < count && r < startRow + rowsNeeded; r++) {
      for (const l of letters) {
        if (assigned >= count) break;
        seats.push({ clase, label: `${String(r).padStart(2, "0")}${l}` });
        assigned++;
      }
    }
  };

  pushSeats(primera, "Primera", 1, 2);
  pushSeats(ejecutiva, "Ejecutiva", 3, 5);
  pushSeats(economy, "Económica", 8, 30);

  return seats;
}

export function generateManifest(paxCount: number, originICAO: string): Pasajero[] {
  const region = getRegionFromICAO(originICAO);
  const pool = (namesData as any)[region] || (namesData as any)["US"];
  const nombresM: string[] = pool.nombresM || (namesData as any)["US"].nombresM;
  const nombresF: string[] = pool.nombresF || (namesData as any)["US"].nombresF;
  const apellidos: string[] = pool.apellidos || (namesData as any)["US"].apellidos;

  const seatPool = buildSeatPool(paxCount);

  const manifest: Pasajero[] = [];

  for (let i = 0; i < paxCount; i++) {
    const isMale = Math.random() < 0.5;
    const nombres = isMale ? nombresM : nombresF;
    const nombre = pick(nombres);
    const apellido = pick(apellidos);
    const seat = seatPool[i] || { clase: "Económica", label: `99${String.fromCharCode(65 + (i % 6))}` };
    const genero: "M" | "F" = isMale ? "M" : "F";

    manifest.push({
      id: `pax-${String(i + 1).padStart(3, "0")}`,
      nombre: `${nombre} ${apellido}`,
      nacionalidad: COUNTRY_NAMES[region] || "United States",
      nacionalidadCodigo: COUNTRY_CODES[region] || "US",
      asiento: seat.label,
      edad: randInt(18, 75),
      miedo: genero === "F" ? randInt(15, 60) : randInt(5, 35),
      satisfaccion: randInt(70, 100),
      hambre: randInt(10, 80),
      bano: randInt(5, 50),
      genero,
      clase: seat.clase as "Primera" | "Ejecutiva" | "Económica",
      incidencias: [] as Incidencia[],
      alert: false,
    });
  }

  return manifest;
}

export function checkThresholds(passenger: Pasajero): Pasajero {
  const alert =
    passenger.satisfaccion < 30 ||
    passenger.miedo > 70 ||
    passenger.hambre > 80;

  return alert !== passenger.alert
    ? { ...passenger, alert }
    : passenger;
}
