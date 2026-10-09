/**
 * Verificación del motor de pasajeros — Paso 1 (tipos + arquetipos + engine).
 *
 * Cubre: rangos al abordar, deterioro exacto por tick, modulación por fase,
 * boost con recuperación por arquetipo, mitigate dentro/fuera de ventana,
 * piso de entretenimiento, score con penalización por varianza, silencio de
 * cabina, y reset.
 *
 * Uso: npx tsx scripts/passenger-engine.verify.ts
 */
import { FlightPhase } from "../src/engine/FlightEngine";
import {
  BASE_DECAY_PER_MIN,
  ENTERTAINMENT_DECAY_FLOOR,
  PassengerEngine,
  SILENCE_PENALTY,
  SILENCE_THRESHOLD_SEC,
  TRACKED_PASSENGER_COUNT,
  VARIANCE_PENALTY,
} from "../src/passengers/PassengerEngine";
import type { ArchetypeDefinition } from "../src/passengers/types";
import { ATTRIBUTE_KEYS } from "../src/passengers/types";
import {
  EVENT_EFFECTS,
  getEventEffects,
  normalizeEffects,
} from "../src/passengers/effectsMap";
import {
  PASSENGER_SCORE_FLOOR,
  PASSENGER_XP_MAX_PCT,
  passengerScoreFactor,
  resolvePassengerBonus,
  toPassengerAttributesSummary,
} from "../src/services/FlightCompletionBonuses";
import {
  TURBULENCE_COOLDOWN_SEC,
  TURBULENCE_DAMAGE,
  TURBULENCE_SUSTAIN_SEC,
  TURBULENCE_THRESHOLDS,
  TurbulenceDetector,
  classifyVs,
} from "../src/passengers/turbulence";
import {
  filterParamsToSignature,
  parseRpcSignatureHint,
} from "../src/services/rpcSignature";
import { FlightEvents } from "../src/events/flightEvents";
import { BoardingEventCatalog } from "../src/events/boarding/BoardingEventCatalog";
import { EventCatalog } from "../src/events/EventCatalog";
import { EventCatalogService } from "../src/events/EventCatalogService";

// ── Helpers ────────────────────────────────────────────────────────────

let failures = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

/** RNG determinista secuencial (no depende de Math.random). */
function seqRng(): () => number {
  let i = 0;
  return () => {
    i++;
    return (i % 100) / 100;
  };
}

/** Arquetipo neutro (multiplicadores 1.0) para matemática exacta. */
const NEUTRAL: ArchetypeDefinition = {
  id: "neutral",
  name: "Neutro (test)",
  deteriorationMultipliers: {
    saciedad: 1,
    confortFisiologico: 1,
    calma: 1,
    entretenimiento: 1,
  },
  recoveryMultipliers: {
    saciedad: 1,
    confortFisiologico: 1,
    calma: 1,
    entretenimiento: 1,
  },
};

const FEARFUL: ArchetypeDefinition = {
  id: "fearful_flyer",
  name: "Miedo a volar (test)",
  deteriorationMultipliers: {
    saciedad: 1,
    confortFisiologico: 1,
    calma: 2,
    entretenimiento: 1,
  },
  recoveryMultipliers: {
    saciedad: 1,
    confortFisiologico: 1,
    calma: 1.5,
    entretenimiento: 1,
  },
  boardingRanges: { calma: [20, 50] },
};

// ── Casos ──────────────────────────────────────────────────────────────

console.log("[1] Arranque: 10 pasajeros, rangos al abordar");
{
  const engine = new PassengerEngine({ rng: seqRng() });
  engine.startFlight();
  const state = engine.getState();
  check("trackea 10 pasajeros", state.passengers.length === TRACKED_PASSENGER_COUNT);
  let inRange = true;
  for (const p of state.passengers) {
    if (
      p.attributes.saciedad < 80 || p.attributes.saciedad > 100 ||
      p.attributes.confortFisiologico < 85 || p.attributes.confortFisiologico > 100 ||
      p.attributes.calma < 20 || p.attributes.calma > 100 ||
      p.attributes.entretenimiento < 60 || p.attributes.entretenimiento > 100
    ) {
      inRange = false;
    }
  }
  check("atributos dentro de rangos default", inRange);
}

console.log("[2] Override de arquetipo al abordar (miedo a volar calma 20-50)");
{
  const engine = new PassengerEngine({ archetypes: [FEARFUL], rng: seqRng() });
  engine.startFlight();
  const ok = engine
    .getState()
    .passengers.every((p) => p.attributes.calma >= 20 && p.attributes.calma <= 50);
  check("calma en [20,50] para fearful", ok);
}

console.log("[3] Deterioro exacto: 60 min cruise, arquetipo neutro");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  const before = engine.getState().passengers[0].attributes;
  engine.tick(3600, FlightPhase.CRUISE); // clamp 30s → 30s efectivos
  const after = engine.getState().passengers[0].attributes;
  // MAX_DT_SEC=30: 30s en CRUISE (x0.8), saciedad base 0.15/min
  const expectedDrop = (BASE_DECAY_PER_MIN.saciedad / 60) * 30 * 0.8;
  check(
    "saciedad cae lo esperado (con clamp)",
    approx(before.saciedad - after.saciedad, expectedDrop),
    `esperado ${expectedDrop}, real ${before.saciedad - after.saciedad}`
  );
  check("elapsedSeconds respeta clamp", engine.getState().elapsedSeconds === 30);
}

console.log("[4] Fase modula: climb desgasta confort más que cruise");
{
  const mk = () => {
    const e = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
    e.startFlight();
    return e;
  };
  const eClimb = mk();
  const eCruise = mk();
  eClimb.tick(30, FlightPhase.CLIMB);
  eCruise.tick(30, FlightPhase.CRUISE);
  const dropClimb =
    90 - eClimb.getState().passengers[0].attributes.confortFisiologico;
  const dropCruise =
    90 - eCruise.getState().passengers[0].attributes.confortFisiologico;
  check("climb (1.3x + extra 1.5x) > cruise (0.8x)", dropClimb > dropCruise);
}

console.log("[5] Boost con recuperación por arquetipo + clamp 100");
{
  const engine = new PassengerEngine({ archetypes: [FEARFUL], rng: () => 0.5 });
  engine.startFlight();
  const before = engine.getState().passengers[0].attributes.calma;
  engine.applyAnnouncementEffects([{ attribute: "calma", amount: 10, mode: "boost" }]);
  const after = engine.getState().passengers[0].attributes.calma;
  // fearful recupera calma x1.5 → +15 (clamp 100 si excede)
  check(
    "boost calma +15 (x1.5)",
    approx(after, Math.min(100, before + 15)),
    `antes ${before}, despues ${after}`
  );
}

console.log("[6] Mitigate: dentro de ventana recupera, fuera es no-op");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  const base = engine.getState().passengers[0].attributes.calma;
  engine.applyNegativeEvent({ attribute: "calma", amount: 20 });
  const damaged = engine.getState().passengers[0].attributes.calma;
  check("daño inmediato -20", approx(base - damaged, 20));
  engine.tick(60, FlightPhase.CRUISE); // dentro de 120s
  engine.applyAnnouncementEffects([{ attribute: "calma", amount: 8, mode: "mitigate" }]);
  const mitigated = engine.getState().passengers[0].attributes.calma;
  check("mitigate dentro de ventana suma +8", mitigated > damaged);

  // Segundo evento, ventana expirada → no-op
  // (el tick clampa a 30s por llamada: avanzar de a 30s)
  engine.applyNegativeEvent({ attribute: "calma", amount: 10 });
  const damaged2 = engine.getState().passengers[0].attributes.calma;
  for (let i = 0; i < 7; i++) engine.tick(30, FlightPhase.CRUISE); // +210s > 120s
  engine.applyAnnouncementEffects([{ attribute: "calma", amount: 8, mode: "mitigate" }]);
  const after2 = engine.getState().passengers[0].attributes.calma;
  check("mitigate fuera de ventana es no-op", after2 <= damaged2);

  // Sin evento activo → no regala puntos
  const engine2 = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine2.startFlight();
  const b = engine2.getState().passengers[0].attributes.calma;
  engine2.applyAnnouncementEffects([{ attribute: "calma", amount: 8, mode: "mitigate" }]);
  const a = engine2.getState().passengers[0].attributes.calma;
  check("mitigate sin evento no suma gratis", a <= b);
}

console.log("[7] Piso de entretenimiento por deterioro (25)");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  for (let i = 0; i < 200; i++) engine.tick(30, FlightPhase.CRUISE);
  const min = Math.min(
    ...engine.getState().passengers.map((p) => p.attributes.entretenimiento)
  );
  check(
    "entretenimiento no baja de 25 por tiempo",
    min >= ENTERTAINMENT_DECAY_FLOOR - 1e-9,
    `min ${min}`
  );
}

console.log("[8] Score + penalización por varianza");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  const s = engine.getSummary("test-flight");
  check("summary no nulo", s !== null);
  if (s) {
    check("overall 0-100", s.overallScore >= 0 && s.overallScore <= 100);
    check("sin varianza extrema → penalty 0", s.variancePenaltyApplied === 0);
  }
  // Forzar varianza: hundir 3/10 bajo 40 (>20%)
  for (let i = 0; i < 3; i++) {
    engine.applyNegativeEvent({ attribute: "calma", amount: 90 });
    engine.applyNegativeEvent({ attribute: "saciedad", amount: 90 });
    engine.applyNegativeEvent({ attribute: "confortFisiologico", amount: 90 });
    engine.applyNegativeEvent({ attribute: "entretenimiento", amount: 90 });
    void i;
  }
  const s2 = engine.getSummary("test-flight");
  // Los 3 eventos golpean a TODOS (no por pasajero), así que todos caen:
  // 100% bajo 40 → penalty aplica igualmente.
  check(
    "varianza alta → penalty 7",
    s2 !== null && s2.variancePenaltyApplied === VARIANCE_PENALTY
  );
}

console.log("[9] Silencio de cabina: 15+ min sin anuncios → -5 entretenimiento");
{
  const silent = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  silent.startFlight();
  for (let i = 0; i < SILENCE_THRESHOLD_SEC / 30 + 1; i++) {
    silent.tick(30, FlightPhase.CRUISE);
  }
  const silentEnt = silent.getState().passengers[0].attributes.entretenimiento;

  const chatty = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  chatty.startFlight();
  for (let i = 0; i < SILENCE_THRESHOLD_SEC / 30 + 1; i++) {
    chatty.tick(30, FlightPhase.CRUISE);
    chatty.applyAnnouncementEffects([]); // cualquier anuncio resetea timer
  }
  const chattyEnt = chatty.getState().passengers[0].attributes.entretenimiento;
  check(
    "silencio prolongado penaliza vs. vuelo comunicado",
    silentEnt <= chattyEnt - SILENCE_PENALTY + 1e-6,
    `silencio ${silentEnt}, comunicado ${chattyEnt}`
  );
}

console.log("[10] Reset + getSummary vacío + tick sin iniciar");
{
  const engine = new PassengerEngine({ rng: seqRng() });
  engine.tick(60, FlightPhase.CRUISE); // no-op sin startFlight
  check("summary null sin iniciar", engine.getSummary("x") === null);
  engine.startFlight();
  engine.reset();
  check("reset limpia estado", !engine.isStarted() && engine.getSummary("x") === null);
  const avgs = engine.getAverages();
  check(
    "averages vacío en ceros",
    ATTRIBUTE_KEYS.every((k) => avgs[k] === 0)
  );
}

// ── Resultado ──────────────────────────────────────────────────────────

console.log("[11] effectsMap: cobertura total del catálogo local");
{
  const catalogKeys = new Set<string>([
    ...Object.keys(FlightEvents),
    ...BoardingEventCatalog.keys(),
    ...Object.keys(EventCatalog),
  ]);
  const mapKeys = new Set(Object.keys(EVENT_EFFECTS));
  const missing = [...catalogKeys].filter((k) => !mapKeys.has(k));
  check("toda clave del catálogo tiene efectos", missing.length === 0, missing.join(","));
  const orphan = [...mapKeys].filter((k) => !catalogKeys.has(k));
  check("ninguna entrada huérfana (sin EventDefinition)", orphan.length === 0, orphan.join(","));
  let valid = true;
  for (const [key, effects] of Object.entries(EVENT_EFFECTS)) {
    for (const e of effects) {
      if (!ATTRIBUTE_KEYS.includes(e.attribute)) valid = false;
      if (!Number.isFinite(e.amount)) valid = false;
      if (e.mode !== "boost" && e.mode !== "mitigate") valid = false;
      if (e.mode === "mitigate" && e.amount <= 0) valid = false;
    }
    void key;
  }
  check("efectos válidos (atributo/monto/modo)", valid);
  const resolved = [...mapKeys].every((k) => EventCatalogService.get(k) !== undefined);
  check("toda clave del mapa resuelve en EventCatalogService", resolved);
}

console.log("[12] effectsMap: valores aprobados (spot checks)");
{
  const meal = getEventEffects("cruise_crew_service_info");
  check(
    "servicio comidas = saciedad +15 boost",
    meal.length === 1 && meal[0].attribute === "saciedad" && meal[0].amount === 15 && meal[0].mode === "boost"
  );
  const mealLegacy = getEventEffects("cruise_crew_service_info1");
  check("variante legacy info1 mapea igual", JSON.stringify(mealLegacy) === JSON.stringify(meal));
  const belt = getEventEffects("common_capt_seatbelt");
  check(
    "cinturones capitán = calma +4 mitigate",
    belt.length === 1 && belt[0].attribute === "calma" && belt[0].amount === 4 && belt[0].mode === "mitigate"
  );
  const stay = getEventEffects("taxitogate_crew_ramining_seating");
  check(
    "permanecer sentado = confort −2 boost",
    stay.length === 1 && stay[0].attribute === "confortFisiologico" && stay[0].amount === -2
  );
  check("evento especial = []", getEventEffects("captain_special_event").length === 0);
  check("clave desconocida = []", getEventEffects("no_existe_xyz").length === 0);
  check(
    "demora takeoff registrada (TAXI, 15min)",
    FlightEvents.preflight_capt_delay_takeoff?.default_delay_ms === 900000
  );
}

console.log("[13] normalizeEffects: tolera ambas formas remotas");
{
  const arr = normalizeEffects([{ attribute: "calma", amount: 5, mode: "boost" }]);
  check("array directo pasa", arr.length === 1 && arr[0].amount === 5);
  const wrapped = normalizeEffects({
    effects: [{ attribute: "calma", amount: 5, mode: "boost" }],
  });
  check("objeto {effects} se desenvuelve", wrapped.length === 1);
  check("null → []", normalizeEffects(null).length === 0);
  check("undefined → []", normalizeEffects(undefined).length === 0);
  check(
    "entradas inválidas se descartan",
    normalizeEffects([
      { attribute: "invalido", amount: 5, mode: "boost" },
      { attribute: "calma", amount: NaN, mode: "boost" },
      { attribute: "calma", amount: 5, mode: "otro" },
      "texto",
      null,
    ]).length === 0
  );
}

console.log("[14] engine consume el mapa (punta a punta local)");{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  const before = engine.getState().passengers[0].attributes.saciedad;
  engine.applyAnnouncementEffects(getEventEffects("cruise_crew_service_info"));
  const after = engine.getState().passengers[0].attributes.saciedad;
  check("anuncio de comida suma +15 (clamp 100)", approx(after, Math.min(100, before + 15)));
}

console.log("[15] historial + breakdown por arquetipo (monitor)");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL, FEARFUL], rng: seqRng() });
  engine.startFlight();
  check("historial vacío al arrancar", engine.getHistory().length === 0);
  engine.applyAnnouncementEffects(
    [{ attribute: "saciedad", amount: 15, mode: "boost" }],
    "cruise_crew_service_info"
  );
  engine.applyNegativeEvent({ attribute: "calma", amount: 20 });
  engine.applyAnnouncementEffects(
    [{ attribute: "calma", amount: 8, mode: "mitigate" }],
    "common_capt_seatbelt"
  );
  engine.applyAnnouncementEffects(
    [{ attribute: "calma", amount: 2, mode: "mitigate" }],
    "common_crew_seatbelt"
  ); // sin evento activo → missed
  const kinds = engine.getHistory().map((h) => h.kind);
  check(
    "historial registra boost/negative/mitigate/missed en orden",
    JSON.stringify(kinds) ===
      JSON.stringify(["announcement_boost", "negative", "announcement_mitigate", "mitigate_missed"])
  );
  const labels = engine.getHistory().map((h) => h.label);
  check("historial guarda la clave del anuncio", labels[0] === "cruise_crew_service_info");
  const bd = engine.getArchetypeBreakdown();
  check(
    "breakdown cubre los 10 pasajeros",
    bd.reduce((sum, b) => sum + b.count, 0) === TRACKED_PASSENGER_COUNT
  );
  check(
    "breakdown trae promedios por arquetipo",
    bd.every((b) => b.name !== "" && ATTRIBUTE_KEYS.every((k) => Number.isFinite(b.averages[k])))
  );
  engine.reset();
  check("reset limpia historial", engine.getHistory().length === 0);
}

console.log("[16] anti-duplicados: mismo anuncio 2 veces en <10s se cobra 1");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  const fx = [{ attribute: "saciedad" as const, amount: 15, mode: "boost" as const }];
  engine.applyAnnouncementEffects(fx, "cruise_crew_service_info");
  const once = engine.getState().passengers[0].attributes.saciedad;
  engine.applyAnnouncementEffects(fx, "cruise_crew_service_info"); // duplicado
  const twice = engine.getState().passengers[0].attributes.saciedad;
  check("segunda aplicación no suma", twice === once);
  check(
    "duplicado queda en historial",
    engine.getHistory().some((h) => h.kind === "duplicate_ignored")
  );
  engine.tick(11, FlightPhase.CRUISE); // fuera de la ventana de 10s
  engine.applyAnnouncementEffects(fx, "cruise_crew_service_info");
  const later = engine.getState().passengers[0].attributes.saciedad;
  check("fuera de ventana vuelve a aplicar", later >= once);
}

console.log("[17] fallback RPC: recorte a la firma real del servidor");
{
  // Hint real observado (PGRST202): sin p_disc_beacon ni p_campaign_multiplier.
  const hint =
    "Could not find the function public.process_flight_completion(p_a, p_campaign_multiplier, p_disc_beacon) in the schema cache | " +
    "hint=Perhaps you meant to call the function public.process_flight_completion(p_a)";
  const sig = parseRpcSignatureHint(hint);
  check("parsea firma del hint", sig !== null && sig.has("p_a") && !sig.has("p_disc_beacon"));
  const filtered = filterParamsToSignature(
    { p_a: 1, p_disc_beacon: 2, p_campaign_multiplier: 3 },
    sig!
  );
  check(
    "recorta a la intersección",
    filtered !== null && JSON.stringify(filtered) === JSON.stringify({ p_a: 1 })
  );
  check("sin hint → null", parseRpcSignatureHint("otro error") === null);
  const full = { p_a: 1 };
  check(
    "sin nada que recortar → null",
    filterParamsToSignature(full, new Set(["p_a", "p_b"])) === null
  );
}

console.log("[18] bonus de pasajeros: proporcional al base, con techo y piso");
{
  check("piso configurado en 40", PASSENGER_SCORE_FLOOR === 40);
  check("techo configurado en 20%", PASSENGER_XP_MAX_PCT === 0.2);
  check("null → factor 0", passengerScoreFactor(null) === 0);
  check("NaN → factor 0", passengerScoreFactor(NaN) === 0);
  check("39.9 → factor 0", passengerScoreFactor(39.9) === 0);
  check("40 → factor 0 (continuo, sin salto)", passengerScoreFactor(40) === 0);
  check("70 → factor 0.5", approx(passengerScoreFactor(70), 0.5));
  check("100 → factor 1", passengerScoreFactor(100) === 1);
  check(">100 se acota a 1", passengerScoreFactor(150) === 1);
  check("score null → 0 XP", resolvePassengerBonus(null, 200) === 0);
  check("base 0 → 0 XP", resolvePassengerBonus(100, 0) === 0);
  check("base negativa → 0 XP", resolvePassengerBonus(100, -50) === 0);
  check("score bajo piso → 0 XP", resolvePassengerBonus(30, 200) === 0);
  check("score 100 + base 200 → techo 40 XP", resolvePassengerBonus(100, 200) === 40);
  check("score 70 + base 200 → 20 XP", resolvePassengerBonus(70, 200) === 20);
  // Proporcionalidad por duración: mismo score, mismo ratio sobre el base.
  const short = resolvePassengerBonus(85, 200);
  const long = resolvePassengerBonus(85, 3000);
  check(
    "misma atención → mismo % del base (corta vs larga)",
    approx(short / 200, long / 3000),
    `${short}/200 vs ${long}/3000`
  );
  // Nunca supera el techo.
  check("acotado al 20% del base", long <= Math.round(3000 * 0.2));
  // Monotonía en score.
  const at60 = resolvePassengerBonus(60, 1000);
  const at90 = resolvePassengerBonus(90, 1000);
  check("monótono creciente en score", at90 > at60, `${at60} vs ${at90}`);
  // Resumen de atributos: niveles de necesidad (100 - satisfacción).
  const summary = toPassengerAttributesSummary({ saciedad: 90, confortFisiologico: 80, calma: 70, entretenimiento: 60 });
  check(
    "mapea a hunger/bladder/fear/boredom invertidos",
    summary !== null && summary.hunger === 10 && summary.bladder === 20 && summary.fear === 30 && summary.boredom === 40,
    JSON.stringify(summary)
  );
  check("promedios null → null", toPassengerAttributesSummary(null) === null);
}

console.log("[19] detector de turbulencia: tiers, histéresis, cooldown, fases");
{
  check("daños 4/8/12", TURBULENCE_DAMAGE.leve === 4 && TURBULENCE_DAMAGE.moderada === 8 && TURBULENCE_DAMAGE.severa === 12);
  check("sostenimiento 6s", TURBULENCE_SUSTAIN_SEC === 6);
  check("cooldown 180s", TURBULENCE_COOLDOWN_SEC === 180);
  check("cruise tiene umbrales", Array.isArray(TURBULENCE_THRESHOLDS[FlightPhase.CRUISE]));
  check("tierra sin umbrales (GATE)", TURBULENCE_THRESHOLDS[FlightPhase.GATE] === undefined);
  check("tierra sin umbrales (TAXI)", TURBULENCE_THRESHOLDS[FlightPhase.TAXI] === undefined);

  // Pico instantáneo no dispara (6s sostenidos a 1s por muestra).
  {
    const d = new TurbulenceDetector();
    let fired = null;
    for (let i = 0; i < 5; i++) fired = d.sample(1200, 1, FlightPhase.CRUISE);
    check("5s sobre umbral no dispara", fired === null);
    fired = d.sample(1200, 1, FlightPhase.CRUISE);
    check("6s sostenidos disparan leve", fired !== null && fired.level === "leve" && fired.amount === 4);
  }
  // Un tick aislado no dispara.
  {
    const d = new TurbulenceDetector();
    const one = d.sample(3000, 1, FlightPhase.CRUISE);
    check("pico de 1s no dispara", one === null);
  }
  // Nivel por pico máximo del episodio (escala dentro del episodio).
  {
    const d = new TurbulenceDetector();
    for (let i = 0; i < 5; i++) d.sample(1200, 1, FlightPhase.CRUISE);
    const fired = d.sample(2800, 1, FlightPhase.CRUISE);
    check("episodio que escala a severa dispara severa", fired !== null && fired.level === "severa" && fired.amount === 12);
  }
  // Cooldown: segundo episodio inmediato se ignora; tras el cooldown dispara.
  {
    const d = new TurbulenceDetector();
    for (let i = 0; i < 6; i++) d.sample(1200, 1, FlightPhase.CRUISE);
    let second: ReturnType<TurbulenceDetector["sample"]> = null;
    for (let i = 0; i < 6; i++) second = d.sample(1200, 1, FlightPhase.CRUISE);
    check("episodio en cooldown se ignora", second === null);
    for (let i = 0; i < TURBULENCE_COOLDOWN_SEC; i++) d.sample(0, 1, FlightPhase.CRUISE);
    let third: ReturnType<TurbulenceDetector["sample"]> = null;
    for (let i = 0; i < 6; i++) third = d.sample(1200, 1, FlightPhase.CRUISE);
    check("tras el cooldown vuelve a disparar", third !== null && third.level === "leve");
  }
  // Histéresis: caer bajo la banda libera; la banda muerta mantiene.
  {
    const d = new TurbulenceDetector();
    for (let i = 0; i < 5; i++) d.sample(1200, 1, FlightPhase.CRUISE);
    d.sample(0, 1, FlightPhase.CRUISE); // liberación total
    let fired: ReturnType<TurbulenceDetector["sample"]> = null;
    for (let i = 0; i < 6; i++) fired = d.sample(1200, 1, FlightPhase.CRUISE);
    check("tras liberar, el conteo arranca de cero", fired !== null);
  }
  // Fase tierra: nunca dispara.
  {
    const d = new TurbulenceDetector();
    let fired: ReturnType<TurbulenceDetector["sample"]> = null;
    for (const phase of [FlightPhase.GATE, FlightPhase.TAXI, FlightPhase.PRE_FLIGHT, FlightPhase.AT_GATE, null, undefined]) {
      for (let i = 0; i < 10; i++) fired = d.sample(5000, 1, phase as FlightPhase);
    }
    check("en tierra / sin fase nunca dispara", fired === null);
  }
  // Fail-closed: NaN, dt inválido.
  {
    const d = new TurbulenceDetector();
    check("VS NaN no dispara", d.sample(NaN, 1, FlightPhase.CRUISE) === null);
    check("VS string no dispara", d.sample("x", 1, FlightPhase.CRUISE) === null);
    check("dt 0 no dispara", d.sample(3000, 0, FlightPhase.CRUISE) === null);
    check("dt negativo no dispara", d.sample(3000, -1, FlightPhase.CRUISE) === null);
  }
  // Umbrales por fase: climb tolera VS alto normal.
  {
    const d = new TurbulenceDetector();
    let fired: ReturnType<TurbulenceDetector["sample"]> = null;
    for (let i = 0; i < 10; i++) fired = d.sample(2500, 1, FlightPhase.CLIMB);
    check("2500 fpm en CLIMB no dispara (normal)", fired === null);
    for (let i = 0; i < 6; i++) fired = d.sample(2500, 1, FlightPhase.CRUISE);
    check("2500 fpm en CRUISE dispara (anormal)", fired !== null);
  }
  // Clasificador puro (lo que muestra el monitor) + snapshot de estado.
  {
    check("classifyVs tier 1 en cruise", classifyVs(1200, FlightPhase.CRUISE) === 1);
    check("classifyVs tier 3 en cruise", classifyVs(3000, FlightPhase.CRUISE) === 3);
    check("classifyVs 0 bajo umbral", classifyVs(100, FlightPhase.CRUISE) === 0);
    check("classifyVs 0 sin fase", classifyVs(5000, null) === 0);
    check("classifyVs 0 en tierra", classifyVs(5000, FlightPhase.TAXI) === 0);
    const d = new TurbulenceDetector();
    for (let i = 0; i < 3; i++) d.sample(1200, 1, FlightPhase.CRUISE);
    const snap = d.getSnapshot();
    check("snapshot acumula 3s y pico tier 1", snap.sustainedSec === 3 && snap.peakTier === 1);
    check("snapshot sin cooldown ni evento aún", snap.cooldownLeftSec === 0 && snap.lastEvent === null);
    for (let i = 0; i < 3; i++) d.sample(1200, 1, FlightPhase.CRUISE);
    const snap2 = d.getSnapshot();
    check("snapshot registra último evento leve", snap2.lastEvent !== null && snap2.lastEvent.level === "leve" && snap2.lastEvent.amount === 4);
    check("snapshot entra en cooldown", snap2.cooldownLeftSec === TURBULENCE_COOLDOWN_SEC);
  }
}

console.log("[20] turbulencia punta a punta: daño + mitigación en ventana");
{
  const engine = new PassengerEngine({ archetypes: [NEUTRAL], rng: () => 0.5 });
  engine.startFlight();
  const d = new TurbulenceDetector();
  let outcome: ReturnType<TurbulenceDetector["sample"]> = null;
  for (let i = 0; i < 6; i++) outcome = d.sample(2000, 1, FlightPhase.CRUISE);
  check("detector dispara moderada", outcome !== null && outcome.level === "moderada");
  const before = engine.getState().passengers[0].attributes.calma;
  engine.applyNegativeEvent({ attribute: "calma", amount: outcome!.amount });
  const damaged = engine.getState().passengers[0].attributes.calma;
  check("daño a calma aplicado", approx(before - damaged, outcome!.amount));
  engine.tick(60, FlightPhase.CRUISE); // dentro de la ventana de 120s
  const res = engine.applyAnnouncementEffects(
    [{ attribute: "calma", amount: 4, mode: "mitigate" }],
    "common_capt_seatbelt"
  );
  check("mitigación en ventana retorna mitigated=true", res.mitigated === true);
  check(
    "mitigación queda en historial",
    engine.getHistory().some((h) => h.kind === "announcement_mitigate")
  );
  const res2 = engine.applyAnnouncementEffects(
    [{ attribute: "calma", amount: 2, mode: "mitigate" }],
    "common_crew_seatbelt"
  );
  check("sin evento activo retorna mitigated=false", res2.mitigated === false);
}

if (failures > 0) {
  console.error(`\n${failures} verificación(es) FALLARON`);
  process.exit(1);
} else {
  console.log("\nTodas las verificaciones del motor de pasajeros PASARON");
}
