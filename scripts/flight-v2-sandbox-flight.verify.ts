/**
 * Verificación Fly V2 (sandbox): payload numérico del INSERT en `flights`.
 *
 * Regresión del log 2026-10-20: `ensureFlightRecordForStart` enviaba
 * `air_time: ""` / `block_time: ""` a columnas numeric, Postgres respondía
 * `invalid input syntax for type numeric: ""`, `flightId` quedaba `null`
 * y `audio-get` rechazaba los anuncios de GATE con 400 "Faltan parámetros".
 *
 * Uso: npx tsx scripts/flight-v2-sandbox-flight.verify.ts
 */
import {
  formatAirlineFlightCode,
  resolveGateVoiceId,
  toFlightMinutesOrNull,
} from "../src/components/flight-v2/sandboxStartPreferences";
import {
  buildGenericWidebodyLayout,
  buildSeatAssignments,
  listLayoutSeats,
  normalizeCabinLayout,
  normalizeSeatLabel,
  selectClosestCapacityLayout,
} from "../src/types/cabinLayout";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name} ${detail}`);
  }
}

check('cadena vacía -> null (nunca "" a numeric)', toFlightMinutesOrNull("") === null);
check("ausente -> null", toFlightMinutesOrNull(undefined) === null && toFlightMinutesOrNull(null) === null);
check("cero -> null", toFlightMinutesOrNull("0") === null && toFlightMinutesOrNull(0) === null);
check("no numérico -> null", toFlightMinutesOrNull("abc") === null);
check("1.5 h -> 90 min", toFlightMinutesOrNull("1.5") === 90);
check("2 h (número) -> 120 min", toFlightMinutesOrNull(2) === 120);

check("código ICAO + número -> KLM 890", formatAirlineFlightCode("KLM", "890") === "KLM 890");
check(
  "nombre completo + número -> AAL 155",
  formatAirlineFlightCode("American Airlines", "155") === "AAL 155",
);
check("sin aerolínea -> solo número", formatAirlineFlightCode("", "890") === "890");
check("sin número -> solo aerolínea", formatAirlineFlightCode("KLM", "") === "KLM");
check("número ya prefijado -> sin duplicar", formatAirlineFlightCode("KLM", "KLM890") === "KLM 890");

// Voz de puerta: los `gate_*` nunca deben resolverse a una voz `crew`.
const LANG = "lang-es";
const catalog = [
  { id: "gate-1", role: "gate", languages: [LANG] },
  { id: "gate-2", role: "gate", languages: ["lang-en"] },
  { id: "crew-1", role: "crew", languages: [LANG] },
  { id: "capt-1", role: "captain", languages: [LANG] },
];
check("gate elegida válida se respeta", resolveGateVoiceId(catalog, "gate-1", LANG) === "gate-1");
check("sin gate elegida -> primera gate del idioma", resolveGateVoiceId(catalog, "", LANG) === "gate-1");
check("gate en otro idioma -> gate del idioma", resolveGateVoiceId(catalog, "gate-2", LANG) === "gate-1");
check(
  "nunca cae a crew",
  resolveGateVoiceId(catalog, "crew-1", LANG) === "gate-1" &&
    resolveGateVoiceId(catalog, null, LANG) === "gate-1",
);
check(
  "sin voces gate en catálogo -> null (sin inventar crew)",
  resolveGateVoiceId([{ id: "crew-1", role: "crew", languages: [LANG] }], "", LANG) === null,
);

const layout = normalizeCabinLayout({
  id: "layout-test",
  name: "Test Layout",
  total_rows: 2,
  capacity: 4,
  columns: ["A", "B"],
  aisle_columns: [],
  cabin_classes: [{ name: "Primera", start_row: 1, end_row: 2 }],
  grid_data: {
    front_rows: 0,
    cells: [
      ["seat", "seat"],
      ["emergency_exit", "seat"],
    ],
  },
});

check("layout normaliza capacidad", layout.capacity === 4);
check("layout lista asientos incluyendo salidas", listLayoutSeats(layout).length === 4);
check(
  "layout no asigna mas pasajeros que asientos",
  buildSeatAssignments(layout, 10).length === 4,
);
check(
  "layout asigna asientos unicos",
  new Set(buildSeatAssignments(layout, 4).map((seat) => seat.asiento)).size === 4,
);
check("asiento con cero inicial se normaliza", normalizeSeatLabel("01A") === "1A");

const genericLayout = buildGenericWidebodyLayout();
check("layout genérico tiene 38 filas", genericLayout.total_rows === 38);
check("layout genérico tiene 296 plazas", genericLayout.capacity === 296);
check("layout genérico está marcado is_generic", genericLayout.is_generic === true);
check("layout genérico lista 296 asientos", listLayoutSeats(genericLayout).length === 296);

const capacityLayouts = [68, 138, 186].map((capacity) =>
  normalizeCabinLayout({
    name: `Layout ${capacity}`,
    capacity,
    total_rows: 1,
    columns: ["A"],
    aisle_columns: [],
    cabin_classes: [],
    grid_data: { front_rows: 0, cells: [["seat"]] },
  }),
);
check(
  "112 pax -> layout de 138 (menor capacidad suficiente)",
  selectClosestCapacityLayout(capacityLayouts, 112)?.capacity === 138,
);
check(
  "140 pax -> layout de 186",
  selectClosestCapacityLayout(capacityLayouts, 140)?.capacity === 186,
);
check(
  "200 pax -> layout mayor disponible",
  selectClosestCapacityLayout(capacityLayouts, 200)?.capacity === 186,
);
check(
  "50 pax -> layout menor disponible",
  selectClosestCapacityLayout(capacityLayouts, 50)?.capacity === 68,
);

if (failures > 0) {
  console.error(`\n${failures} verificacion(es) FALLARON`);
  process.exit(1);
} else {
  console.log("\nTodas las verificaciones de Fly V2 sandbox PASARON");
}
