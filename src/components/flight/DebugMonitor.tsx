/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DebugMonitor — ventana popup/modal de depuración que muestra variables
 * agrupadas por origen con actualización en tiempo real (1s).
 */

import React, { useEffect, useState, useMemo, useRef } from "react";
import { X, Clock, Activity, Plane, FileText, Layers, Variable, Timer, AlertTriangle, MoonStar, GitBranch } from "lucide-react";
import { FlightContext } from "../../services/FlightContext";
import type { FlightController } from "../../services/FlightController";
import { NarrativeEngine } from "../../narrative/NarrativeEngine";
import { Scheduler } from "../../services/Scheduler";
import { EventCatalogService } from "../../events/EventCatalogService";
import type { RuleEngine } from "../../services/RuleEngine";
import { secondsToHHMM, secondsToTimeRemaining } from "../../utils/timeUtils";
import { getCountryKey } from "../../utils/flightUtils";
import DelayTimeline from "./DelayTimeline";
import { NarrativeTransition } from "../../scenarios/narrative/NarrativeTransition";

// ── Unidades por telemetría ─────────────────────────────────────
const TELEMETRY_UNITS: Record<string, string> = {
  altitude: "ft",
  groundspeed: "kts",
  verticalSpeed: "fpm",
  heading: "°",
  latitude: "°",
  longitude: "°",
  indicated_airspeed: "kts",
  true_airspeed: "kts",
  pitch: "°",
  bank: "°",
  engN1: "RPM",
  engN2: "RPM",
  zuluTime: "s",
  localTime: "s",
  remainingTime: "s",
  temperature: "°C",
  windSpeed: "kts",
  windDirection: "°",
  agl: "ft",
  flapsPosition: "°",
  simPhase: "",
  // Nuevas variables para preflight_capt_delay_parked
  planeInParkingState: "",
  simOnGround: "",
  // Posición en pista de despegue
  onAnyRunway: "",
};

function formatValue(key: string, value: unknown, units?: Record<string, string>): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-white/30 italic">—</span>;
  }
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex items-center gap-1 text-[#43E600] font-bold">
        <span>✅</span> true
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-red-400 font-bold">
        <span>❌</span> false
      </span>
    );
  }
  if (typeof value === "number") {
    const unit = (units ?? TELEMETRY_UNITS)[key] ?? "";
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return (
      <span className="text-[#45AFFF] font-mono">
        {formatted}
        {unit ? <span className="text-white/40 ml-1">{unit}</span> : null}
      </span>
    );
  }
  if (typeof value === "object") {
    try {
      const str = JSON.stringify(value);
      if (str.length > 80) return <span className="text-white/60 font-mono text-[11px] break-all">{str.slice(0, 80)}…</span>;
      return <span className="text-white/60 font-mono text-[11px] break-all">{str}</span>;
    } catch {
      return <span className="text-white/60">{String(value)}</span>;
    }
  }
  return <span className="text-white/80">{String(value)}</span>;
}

function timeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const s = Math.floor(diffMs / 1000);
  if (s < 2) return "ahora";
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m ${s % 60}s`;
  return `hace ${m}m`;
}

function Section({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-[5px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#002440]/60 hover:bg-[#00345C]/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider">
          <Icon className="w-3.5 h-3.5" />
          {title}
          {typeof count === "number" && (
            <span className="bg-white/10 text-white/60 px-1.5 py-0.5 rounded text-[10px] leading-none">{count}</span>
          )}
        </span>
        <span className="text-white/40 text-xs">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="p-2 bg-black/20">{children}</div>}
    </div>
  );
}

function KeyValueGrid({ data, units }: { data: Record<string, unknown>; units?: Record<string, string> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div className="text-[11px] font-mono text-white/30 italic px-1 py-1">Sin datos</div>;
  }
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
        >
          <span className="font-mono text-[11px] text-white/60 truncate" title={k}>
            {k}
          </span>
          <span className="font-mono text-[11px] shrink-0 max-w-[60%] text-right truncate" title={String(v ?? "")}>
            {formatValue(k, v, units)}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface DebugMonitorProps {
  isOpen: boolean;
  onClose: () => void;
  flightContext: FlightContext | null;
  flightController?: FlightController | null;
  narrativeEngine?: NarrativeEngine | null;
  scheduler?: Scheduler | null;
  ruleEngine?: RuleEngine | null;
  /** Variables resueltas del último evento (opcional, si el caller las provee) */
  lastEventVariables?: Record<string, unknown> | null;
}

export default function DebugMonitor({
  isOpen,
  onClose,
  flightContext,
  flightController,
  narrativeEngine,
  scheduler,
  ruleEngine,
  lastEventVariables,
}: DebugMonitorProps) {
  const [tick, setTick] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<number>(() => Date.now());
  const prevTelemetryRef = useRef<string>("");

  // Polling 1s sin afectar rendimiento (solo re-render del modal)
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      // Detectar cambio real para timestamp
      try {
        const tel = flightContext?.getTelemetry();
        const key = tel ? JSON.stringify(tel) : "";
        if (key !== prevTelemetryRef.current) {
          prevTelemetryRef.current = key;
          setLastUpdate(Date.now());
        }
      } catch {}
    }, 1000);
    return () => window.clearInterval(id);
  }, [isOpen, flightContext]);

  // Diagnóstico: confirmar qué telemetría llega al monitor (y desde dónde)
  useEffect(() => {
    if (!isOpen) return;
    let ctxTel: Record<string, unknown> = {};
    try {
      ctxTel = (flightContext?.getDebugSnapshot()?.telemetry ?? {}) as Record<string, unknown>;
    } catch {}
    const ctrlTel = flightController?.getTelemetry?.() ?? null;
    console.log('[DebugMonitor] 🔍 Datos de telemetría:', {
      flightContextTelemetry: ctxTel,
      controllerTelemetry: ctrlTel,
      keysContext: Object.keys(ctxTel),
      controllerIsNull: ctrlTel === null,
    });
    console.log('[DebugMonitor] seatbeltOn:', (ctxTel as any)?.seatbeltOn, '/ controller:', (ctrlTel as any)?.seatbeltOn);
    console.log('[DebugMonitor] zuluTime:', (ctxTel as any)?.zuluTime, '/ controller:', (ctrlTel as any)?.zuluTime);
    console.log('[DebugMonitor] planeInParkingState:', (ctxTel as any)?.planeInParkingState, '/ controller:', (ctrlTel as any)?.planeInParkingState);
    console.log('[DebugMonitor] simOnGround:', (ctxTel as any)?.simOnGround, '/ controller:', (ctrlTel as any)?.simOnGround);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tick]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const snapshot = useMemo(() => {
    // Depend on tick to refresh
    void tick;
    try {
      return flightContext?.getDebugSnapshot() ?? null;
    } catch {
      return null;
    }
  }, [flightContext, tick]);

  const narrativeInfo = useMemo(() => {
    void tick;
    try {
      if (narrativeEngine) return narrativeEngine.getDebugInfo();
      if (scheduler) {
        const eng = (scheduler as any).narrativeEngine as NarrativeEngine | undefined;
        if (eng) return eng.getDebugInfo();
      }
      return null;
    } catch {
      return null;
    }
  }, [narrativeEngine, scheduler, tick]);

  const telemetry = (snapshot?.telemetry ?? {}) as Record<string, unknown>;
  // Solo mostrar variables activas (filtrar null/undefined de campos comentados en TelemetryData)
  const activeTelemetry = useMemo(() => {
    const entries = Object.entries(telemetry).filter(([, v]) => v !== null && v !== undefined && v !== "");
    return Object.fromEntries(entries) as Record<string, unknown>;
  }, [telemetry]);
  const flight = (snapshot?.flight ?? {}) as Record<string, unknown>;
  const simbrief = (snapshot?.simbrief ?? null) as Record<string, unknown> | null;
  const fsm = snapshot?.fsm as Record<string, unknown> | undefined;
  const announcement = snapshot?.announcement as Record<string, unknown> | undefined;

  // Variables de eventos resueltas: prefer lastEventVariables, sino construir
  // un merge representativo (flight + telemetry + simbrief) para depurar
  const eventVars: Record<string, unknown> = useMemo(() => {
    if (lastEventVariables && Object.keys(lastEventVariables).length > 0) return lastEventVariables;
    // Fallback: mostrar qué pasaría al resolver variables de evento actual
    const merged: Record<string, unknown> = {};
    // flight vars
    for (const [k, v] of Object.entries(flight)) merged[`flight.${k}`] = v;
    // telemetry seleccionadas (incluye nuevas vars para delay parked)
    for (const [k, v] of Object.entries(telemetry)) {
      if (["altitude", "groundspeed", "heading", "verticalSpeed", "zuluTime", "planeInParkingState", "simOnGround", "atcOnParkingSpot", "seatbeltOn"].includes(k)) {
        merged[`telemetry.${k}`] = v;
      }
    }
    if (simbrief) {
      const flat = simbrief as any;
      if (flat.general?.flight_number) merged["simbrief.flight_number"] = flat.general.flight_number;
      if (flat.origin?.icao_code) merged["simbrief.origin"] = flat.origin.icao_code;
      if (flat.destination?.icao_code) merged["simbrief.destination"] = flat.destination.icao_code;
    }
    return merged;
  }, [lastEventVariables, flight, telemetry, simbrief]);

  // Controller telemetry extra
  const controllerTelemetry = useMemo(() => {
    void tick;
    try {
      return flightController?.getTelemetry() as unknown as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }, [flightController, tick]);

  // ── Eventos de Demora (preflight_capt_delay_parked / taxi) ─────────────────────
  const getEventThreshold = (eventKey: string): number => {
    // 1) Override por vuelo (cargado desde events.default_delay_ms de la DB)
    try {
      const override = (flightContext as any)?.getDelayOverride?.(eventKey);
      if (typeof override === "number" && !Number.isNaN(override) && override > 0) {
        console.log(`[DebugMonitor] threshold ${eventKey}: usando override DB/vuelo ${override}ms`);
        return override;
      }
    } catch {}
    // 2) RuleEngine (usa la misma precedencia que la evaluación real)
    try {
      const re: any = ruleEngine as any;
      const schedRE: any = (scheduler as any)?.ruleEngine;
      const engine = re ?? schedRE;
      if (engine?.getEventThreshold) {
        const ctx: any = flightContext as any;
        const t = ctx ? engine.getEventThreshold(eventKey, ctx) : engine.getEventThreshold(eventKey);
        if (typeof t === "number" && !Number.isNaN(t) && t > 0) return t;
      }
    } catch {}
    // 3) Catálogo en código
    const ev: any = EventCatalogService.get(eventKey) as any;
    return ev?.default_delay_ms || 600000;
  };

  const getScheduledSeconds = (flightData: Record<string, unknown>): number | null => {
    let raw = (flightData as any)?.scheduledTakeoffTime ?? (flightData as any)?.scheduled_takeoff_time;
    if (typeof raw === "number" && !Number.isNaN(raw)) {
      // Normalizar epoch (segundos desde 1970) a segundos del día UTC
      if (raw > 86400 && raw < 4102444800) raw = raw % 86400;
      return raw;
    }
    const dep = (flightData as any)?.departureTime;
    if (typeof dep === "string" && dep.trim() !== "") {
      const hm = /^(\d{1,2}):(\d{2})$/.exec(dep.trim());
      if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60;
      const asDate = Date.parse(dep);
      if (!Number.isNaN(asDate)) {
        const d = new Date(asDate);
        return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      }
      const asNum = Number(dep);
      if (!Number.isNaN(asNum) && asNum > 0) return asNum > 86400 ? asNum % 86400 : asNum;
    }
    return null;
  };

  const calculateTimeRemaining = (currentTime: unknown, scheduledTime: unknown, departureTime?: unknown): number | null => {
    let ct: number | null = null;
    let st: number | null = null;
    if (typeof currentTime === "number" && !Number.isNaN(currentTime)) ct = currentTime;
    else if (typeof currentTime === "string" && !Number.isNaN(Number(currentTime))) ct = Number(currentTime);
    if (typeof scheduledTime === "number" && !Number.isNaN(scheduledTime)) st = scheduledTime;
    else if (typeof departureTime === "string" && departureTime) {
      const dep = String(departureTime).trim();
      const hm = /^(\d{1,2}):(\d{2})$/.exec(dep);
      if (hm) st = Number(hm[1]) * 3600 + Number(hm[2]) * 60;
      else {
        const asDate = Date.parse(dep);
        if (!Number.isNaN(asDate)) {
          const d = new Date(asDate);
          st = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
        }
      }
    }
    if (ct == null || st == null) return null;
    return st - ct;
  };

  const isDelayThresholdExceeded = (eventKey: string): boolean => {
    // Delegar a RuleEngine si está disponible para garantizar mismas variables que la evaluación real
    try {
      const re: any = ruleEngine as any;
      const schedRE: any = (scheduler as any)?.ruleEngine;
      const engine = re ?? schedRE;
      if (engine?.isDelayExceeded) {
        const ctx: any = flightContext as any;
        if (ctx) return engine.isDelayExceeded(eventKey, ctx);
      }
      if (engine?.isDelayThresholdExceeded) {
        const ctx: any = flightContext as any;
        if (ctx) return engine.isDelayExceeded ? engine.isDelayExceeded(eventKey, ctx) : false;
      }
    } catch {}
    const threshold = getEventThreshold(eventKey);
    const currentTime: any = (telemetry as any)?.zuluTime ?? (telemetry as any)?.zulu_time;
    const scheduledTime: any = (flight as any)?.scheduledTakeoffTime ?? (flight as any)?.scheduled_takeoff_time;
    const timeRemaining = calculateTimeRemaining(currentTime, scheduledTime, (flight as any)?.departureTime);
    if (timeRemaining == null) return false;
    return timeRemaining <= threshold / 1000;
  };

  const getDelayEventState = (eventKey: string): string => {
    // Estado independiente por evento (Map en RuleEngine)
    try {
      const re: any = ruleEngine as any;
      const schedRE: any = (scheduler as any)?.ruleEngine ?? (scheduler as any)?.["ruleEngine"];
      const engine = re ?? schedRE;
      if (engine?.getDelayEventState) {
        const st = engine.getDelayEventState(eventKey);
        if (st?.triggered) return "✅ Disparado";
      }
    } catch {}
    // One-shot: disparado (NarrativeEngine)
    try {
      const ne: any = narrativeEngine as any;
      if (ne?.isStepCompleted?.(eventKey) === true) return "✅ Disparado";
      if (ne?.hasFired?.(eventKey) === true) return "✅ Disparado";
      const schedEng: any = (scheduler as any)?.narrativeEngine;
      if (schedEng?.isStepCompleted?.(eventKey) === true) return "✅ Disparado";
      if (schedEng?.hasFired?.(eventKey) === true) return "✅ Disparado";
    } catch {}
    try {
      const re: any = ruleEngine as any;
      const schedRE: any = (scheduler as any)?.ruleEngine ?? (scheduler as any)?.["ruleEngine"];
      const engine = re ?? schedRE;
      if (engine?.isEvaluating) {
        const ctx = flightContext as any;
        if (ctx && engine.isEvaluating(eventKey, ctx)) return "⏳ Evaluando";
        if (engine.isEvaluating(eventKey)) return "⏳ Evaluando";
      }
      if (engine?.hasExecuted?.(eventKey) === true) return "✅ Disparado";
    } catch {}
    // Fallback: si la demora está superada y sigue en BOARDING/en tierra, está evaluando
    if (isDelayThresholdExceeded(eventKey)) return "⏳ Evaluando";
    return "⛔ Inactivo";
  };

  const delayEvents = useMemo(() => {
    void tick;
    const keys = ["preflight_capt_delay_parked", "preflight_capt_delay_taxi", "preflight_capt_delay_takeoff"];
    // Cálculo de tiempos base (compartidos) con fallback a departureTime
    const currentTimeRaw: any = (telemetry as any)?.zuluTime;
    const currentTimeNum: number | null = typeof currentTimeRaw === "number" && !Number.isNaN(currentTimeRaw) ? currentTimeRaw : null;
    const scheduledSec = getScheduledSeconds(flight);
    const departureTimeStr: any = (flight as any)?.departureTime;
    return keys.map((key) => {
      // Umbral independiente por evento (600000 vs 900000)
      const threshold = getEventThreshold(key);
      // Tiempo restante independiente por evento (mismo current/scheduled pero umbral distinto)
      const timeRemaining = scheduledSec !== null && currentTimeNum !== null ? scheduledSec - currentTimeNum : calculateTimeRemaining(currentTimeRaw, (flight as any)?.scheduledTakeoffTime, departureTimeStr);
      // isDelayed independiente: timeRemaining <= threshold/1000
      const isDelayed = timeRemaining !== null ? timeRemaining <= threshold / 1000 : isDelayThresholdExceeded(key);
      const currentPhase: any = (fsm as any)?.currentState ?? (snapshot as any)?.fsm?.currentState ?? "—";
      const schedulerPhase: string = (() => {
        try {
          return (scheduler as any)?.getCurrentPhase?.() ?? "—";
        } catch {
          return "—";
        }
      })();
      const state = getDelayEventState(key);
      const lastEvaluation = new Date().toISOString();
      // preferred_condition (informativa): leer restrictions del paso en el escenario
      // cargado. Si el paso declara `preferred_condition: "is_night_flight"`, mostrar
      // si la condición se cumple (no bloquea la ejecución).
      const preferredCondition = (() => {
        try {
          const eng: any = narrativeEngine ?? (scheduler as any)?.getNarrativeEngine?.() ?? null;
          const step = eng?.findStepByEventKey?.(key) ?? null;
          return (step as any)?.restrictions?.preferred_condition ?? null;
        } catch {
          return null;
        }
      })();
      const isNightFlight = (() => {
        if (preferredCondition !== "is_night_flight") return null;
        try {
          const re: any = ruleEngine ?? (scheduler as any)?.ruleEngine ?? null;
          if (re?.isNightFlight) {
            const ctx: any = flightContext as any;
            return ctx ? re.isNightFlight(ctx) : re.isNightFlight();
          }
        } catch {}
        return false;
      })();
      // Formateos sin reemplazar originales
      const currentTimeDisplay = typeof currentTimeNum === "number" ? secondsToHHMM(currentTimeNum) : "--:--";
      const scheduledTimeDisplay = scheduledSec !== null ? secondsToHHMM(scheduledSec) : "--:--";
      const timeRemainingDisplay = timeRemaining != null ? secondsToTimeRemaining(timeRemaining) : "--:--";
      // Logs específicos por evento (no mezclar)
      console.log(`[DebugMonitor] Evento de demora ${key}:`, {
        eventKey: key,
        thresholdMs: threshold,
        currentTime: currentTimeNum,
        currentTimeDisplay,
        scheduledTime: scheduledSec,
        scheduledTimeDisplay,
        timeRemaining,
        timeRemainingDisplay,
        isDelayed,
        currentPhase,
        state,
        preferredCondition,
        isNightFlight,
        triggered: (()=>{ try{ const re:any=ruleEngine??(scheduler as any)?.ruleEngine; return re?.getDelayEventState?.(key)?.triggered ?? null; }catch{return null}})(),
      });
      // Mantener compat: también log genérico anterior
      console.log("[DebugMonitor] Evento de demora:", {
        eventKey: key,
        currentTime: currentTimeNum,
        currentTimeDisplay,
        scheduledTime: scheduledSec,
        scheduledTimeDisplay,
        timeRemaining,
        timeRemainingDisplay,
        threshold: `${threshold / 60000} min`,
        isDelayed,
        currentPhase,
        state,
      });
      return {
        key,
        label: key,
        state,
        // Originales (segundos) — independientes por evento solo en isDelayed/threshold, tiempos base compartidos
        currentTime: currentTimeNum,
        scheduledTime: scheduledSec,
        timeRemaining,
        // Formateados
        currentTimeDisplay,
        scheduledTimeDisplay,
        timeRemainingDisplay,
        threshold,
        isDelayed,
        currentPhase,
        schedulerPhase,
        lastEvaluation,
        // Restricción informativa preferred_condition (is_night_flight)
        preferredCondition,
        isNightFlight,
        // Estado interno por evento para depuración
        delayState: (()=>{ try{ const re:any=ruleEngine??(scheduler as any)?.ruleEngine; return re?.getDelayEventState?.(key) ?? null; }catch{return null}})(),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, telemetry, flight, fsm, snapshot, narrativeEngine, scheduler, ruleEngine]);

  // ── Transición PRE_FLIGHT → TAXI (espejo de FlightPhaseDetector.computePhase) ──
  const taxiTransition = useMemo(() => {
    void tick;
    const raw = telemetry as Record<string, any>;
    const groundspeed = typeof raw.groundspeed === "number" ? raw.groundspeed : 0;
    const parkingBrake = raw.parkingBrake as boolean | undefined;
    const simOnGround = raw.simOnGround as boolean | undefined;
    const atcOnParkingSpot = raw.atcOnParkingSpot as boolean | undefined;
    const numEngines: number | undefined =
      (raw.numberOfEngines as number | undefined) ?? (raw.numEngines as number | undefined);

    // Réplica de FlightPhaseDetector.allEnginesRunning (incluye alias de compatibilidad)
    const isEngineOn = (index: number): boolean => {
      if (index === 1) {
        return (raw.engineCombustion1 ?? raw.engCombustion1 ?? raw.engineRunning) === true;
      }
      return (raw[`engineCombustion${index}`] ?? raw[`engCombustion${index}`]) === true;
    };
    let allEnginesRunning: boolean;
    const engineDetail: Record<number, boolean | undefined> = { 1: undefined, 2: undefined, 3: undefined, 4: undefined };
    for (let i = 1; i <= 4; i++) {
      const v = raw[`engineCombustion${i}`] ?? raw[`engCombustion${i}`] ?? (i === 1 ? raw.engineRunning : undefined);
      engineDetail[i] = v === undefined ? undefined : v === true;
    }
    if (numEngines === 0) {
      allEnginesRunning = false;
    } else if (typeof numEngines !== "number" || !Number.isFinite(numEngines) || numEngines <= 0) {
      allEnginesRunning = isEngineOn(1);
    } else {
      allEnginesRunning = true;
      for (let i = 1; i <= numEngines; i++) {
        if (!isEngineOn(i)) {
          allEnginesRunning = false;
          break;
        }
      }
    }

    const hasAdvancedGroundData = simOnGround !== undefined && atcOnParkingSpot !== undefined;
    const isOnGround = simOnGround === true;
    const isMoving = groundspeed > 5;
    const isParkingBrakeOff = parkingBrake === false;
    const isNotAtParkingSpot = atcOnParkingSpot === false;
    const allConditionsMet =
      hasAdvancedGroundData &&
      isOnGround &&
      isMoving &&
      isParkingBrakeOff &&
      isNotAtParkingSpot &&
      allEnginesRunning;

    const currentPhase: string =
      ((fsm as any)?.currentState as string | undefined) ??
      ((snapshot as any)?.fsm?.currentState as string | undefined) ??
      "—";

    const status = !hasAdvancedGroundData
      ? ({ label: "🔴 Bloqueado", hint: "sin telemetría avanzada (simOnGround/atcOnParkingSpot)", tone: "blocked" } as const)
      : allConditionsMet
        ? ({ label: "🟢 Listo", hint: "todas las condiciones cumplidas → TAXI", tone: "ready" } as const)
        : ({ label: "🟡 Esperando", hint: "faltan condiciones para TAXI", tone: "waiting" } as const);

    return {
      hasAdvancedGroundData,
      isOnGround,
      isMoving,
      isParkingBrakeOff,
      isNotAtParkingSpot,
      allEnginesRunning,
      allConditionsMet,
      groundspeed,
      parkingBrake,
      simOnGround,
      atcOnParkingSpot,
      numEngines,
      engineDetail,
      currentPhase,
      status,
      lastEvaluation: new Date(lastUpdate).toLocaleString("es-ES"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, telemetry, fsm, snapshot, lastUpdate]);

  // ── Origen de la última transición (Scheduler.lastTransitionInfo) ──
  const transitionOrigin = useMemo(() => {
    void tick;
    try {
      const info = (scheduler as any)?.getLastTransitionInfo?.() as
        | { phase?: string; from?: string | null; source?: string; label?: string; time?: string }
        | null
        | undefined;
      if (info?.label) {
        const label = info.label;
        const isFallback = /fallback/i.test(label);
        return { label, isFallback, phase: info.phase ?? "—", from: info.from ?? "—", time: info.time ?? "—" };
      }
      const label = (scheduler as any)?.getLastTransitionSource?.() as string | undefined;
      if (label) {
        return { label, isFallback: /fallback/i.test(label), phase: "—", from: "—", time: "—" };
      }
    } catch {}
    return { label: "❓ Desconocido", isFallback: false, phase: "—", from: "—", time: "—" };
  }, [tick, scheduler]);

  // ── Ancla transition_to_taxi (preconditions.type === 'phase_transition') ──
  const taxiAnchorEvent = useMemo(() => {
    void tick;
    const engines: any =
      (narrativeEngine as any) ??
      (scheduler as any)?.getNarrativeEngine?.() ??
      (scheduler as any)?.narrativeEngine ??
      null;
    const re: any = (ruleEngine as any) ?? (scheduler as any)?.ruleEngine ?? null;
    let step: any = null;
    try {
      step = engines?.findStepByEventKey?.("transition_to_taxi") ?? null;
    } catch {
      step = null;
    }
    const conditions = step?.preconditions?.conditions ?? step?.preconditions ?? undefined;
    let detail: any = null;
    try {
      if (re?.getPhaseTransitionDetail) {
        detail = re.getPhaseTransitionDetail(conditions, flightContext as any);
      }
    } catch {
      detail = null;
    }
    // Fallback sin RuleEngine: reutilizar la evaluación espejo ya calculada
    if (!detail) {
      detail = {
        isOnGround: taxiTransition.isOnGround,
        isMoving: taxiTransition.isMoving,
        isParkingBrakeOff: taxiTransition.isParkingBrakeOff,
        isNotAtParkingSpot: taxiTransition.isNotAtParkingSpot,
        allEnginesRunning: taxiTransition.allEnginesRunning,
        allConditionsMet: taxiTransition.allConditionsMet,
        groundspeedThreshold: 5,
        targetPhase: "TAXI",
        raw: {
          simOnGround: taxiTransition.simOnGround,
          groundspeed: taxiTransition.groundspeed,
          parkingBrake: taxiTransition.parkingBrake,
          atcOnParkingSpot: taxiTransition.atcOnParkingSpot,
          numEngines: taxiTransition.numEngines,
          engineCombustion: taxiTransition.engineDetail,
        },
      };
    }
    let triggered = false;
    try {
      triggered =
        re?.hasExecuted?.("transition_to_taxi") === true ||
        engines?.isStepCompleted?.("transition_to_taxi") === true ||
        engines?.hasFired?.("transition_to_taxi") === true;
    } catch {
      triggered = false;
    }
    const stateLabel = triggered
      ? "✅ Disparado"
      : detail.allConditionsMet
        ? "✅ Listo"
        : "⏳ Esperando condiciones";
    return { found: !!step, conditions, detail, triggered, stateLabel };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, narrativeEngine, scheduler, ruleEngine, flightContext, taxiTransition]);

  // ── Pasos con transition === WAIT_CONDITION (tiempo real, sin efectos secundarios) ──
  const waitConditionSteps = useMemo(() => {
    void tick;
    const engines: any =
      (narrativeEngine as any) ??
      (scheduler as any)?.getNarrativeEngine?.() ??
      (scheduler as any)?.narrativeEngine ??
      null;
    const re: any = (ruleEngine as any) ?? (scheduler as any)?.ruleEngine ?? null;
    let steps: any[] = [];
    try {
      if (typeof engines?.getSteps === "function") steps = engines.getSteps();
      else if (Array.isArray(engines?.definition?.steps)) steps = engines.definition.steps;
    } catch {
      steps = [];
    }
    const isWait = (s: any): boolean =>
      s?.transition === (NarrativeTransition.WAIT_CONDITION as unknown) ||
      (s?.transition as unknown) === "WAIT_CONDITION";
    let currentKey: string | null = null;
    try {
      currentKey = engines?.currentStep?.()?.eventKey ?? null;
    } catch {
      currentKey = null;
    }
    const evaluatedAt = new Date(lastUpdate).toLocaleString("es-ES");
    return steps.filter(isWait).map((s: any) => {
      let evalDetail: { met: boolean | null; kind: string; rows: { label: string; ok: boolean; value: string }[]; summary: string } | null = null;
      try {
        if (typeof re?.evaluateWaitConditionDetail === "function") {
          evalDetail = re.evaluateWaitConditionDetail(s, flightContext as any);
        }
      } catch {
        evalDetail = null;
      }
      if (!evalDetail) {
        evalDetail = s?.preconditions
          ? { met: null, kind: String(s.preconditions?.type ?? "unknown"), rows: [], summary: "Sin RuleEngine disponible" }
          : { met: true, kind: "none", rows: [], summary: "Sin precondiciones" };
      }
      let triggered = false;
      try {
        triggered =
          re?.hasExecuted?.(s.eventKey) === true ||
          engines?.isStepCompleted?.(s.eventKey) === true ||
          engines?.hasFired?.(s.eventKey) === true;
      } catch {
        triggered = false;
      }
      const isCurrent = currentKey !== null && s.eventKey === currentKey;
      const status = triggered
        ? ({ label: "✅ Disparado", tone: "done" } as const)
        : evalDetail.met === true
          ? ({ label: "✅ Cumplida", tone: "ready" } as const)
          : evalDetail.met === false && isCurrent
            ? ({ label: "⏳ En espera", tone: "waiting" } as const)
            : evalDetail.met === false
              ? ({ label: "❌ Bloqueada", tone: "blocked" } as const)
              : ({ label: "❓ Sin datos", tone: "unknown" } as const);
      return {
        eventKey: String(s.eventKey),
        kind: evalDetail.kind,
        rows: evalDetail.rows,
        summary: evalDetail.summary,
        met: evalDetail.met,
        triggered,
        isCurrent,
        status,
        evaluatedAt,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, narrativeEngine, scheduler, ruleEngine, flightContext, lastUpdate]);

  // ── Variables de Crucero (cruise_time SimBrief + progreso + internacional) ──
  const cruiseVars = useMemo(() => {
    void tick;
    const flightData = flight as Record<string, any>;
    const tel = telemetry as Record<string, any>;
    const cruiseTimeSeconds: number | null =
      typeof flightData?.cruiseTimeSeconds === "number" && !Number.isNaN(flightData.cruiseTimeSeconds)
        ? flightData.cruiseTimeSeconds
        : null;
    const cruiseEntryTime: number | null =
      typeof flightData?.cruiseEntryTime === "number" && !Number.isNaN(flightData.cruiseEntryTime)
        ? flightData.cruiseEntryTime
        : null;
    const originICAO: string = String(flightData?.originICAO ?? "");
    const destICAO: string = String(flightData?.destICAO ?? "");

    // Preferir RuleEngine (misma lógica que los disparadores); fallback manual.
    let progress = 0;
    let sleeping = false;
    let international = flightData?.isInternational === true;
    let usedEngine = false;
    try {
      const re: any = (ruleEngine as any) ?? (scheduler as any)?.ruleEngine ?? null;
      if (re?.getCruiseProgress) {
        const ctx: any = flightContext as any;
        progress = Number(ctx ? re.getCruiseProgress(ctx) : re.getCruiseProgress()) || 0;
        usedEngine = true;
      }
      if (re?.isPassengersSleeping) {
        const ctx: any = flightContext as any;
        sleeping = (ctx ? re.isPassengersSleeping(ctx) : re.isPassengersSleeping()) === true;
      }
      if (re?.isInternationalFlight) {
        const ctx: any = flightContext as any;
        international = (ctx ? re.isInternationalFlight(ctx) : re.isInternationalFlight()) === true;
      }
    } catch {
      usedEngine = false;
    }
    if (!usedEngine) {
      // Cálculo manual espejo de RuleEngine.getCruiseProgress/isPassengersSleeping
      if (cruiseTimeSeconds && cruiseTimeSeconds > 0 && cruiseEntryTime !== null) {
        const zulu = Number(tel?.zuluTime);
        if (!Number.isNaN(zulu)) {
          progress = Math.min(Math.max((zulu - cruiseEntryTime) / cruiseTimeSeconds, 0), 1);
        }
      }
      const local = Number(tel?.localTime);
      if (progress >= 0.25 && progress < 0.80 && !Number.isNaN(local)) {
        const h = Math.floor((local % 86400) / 3600);
        sleeping = h >= 23 || h < 6;
      }
    }

    return {
      cruiseTimeSeconds,
      cruiseEntryTime,
      progress,
      sleeping,
      international,
      originICAO,
      destICAO,
      originCountry: originICAO ? getCountryKey(originICAO) : "—",
      destCountry: destICAO ? getCountryKey(destICAO) : "—",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, flight, telemetry, ruleEngine, scheduler, flightContext]);

  // ── Estado de espera del orquestador (timers, audio, pasos manuales) ──
  const waitSnapshot = useMemo(() => {
    void tick;
    try {
      const orch: any = (scheduler as any)?.getNarrativeOrchestrator?.() ?? null;
      if (typeof orch?.getWaitSnapshot === "function") return orch.getWaitSnapshot();
    } catch {}
    return null;
  }, [tick, scheduler]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Monitor de variables"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#00172e] border border-[#3B7EB2]/50 rounded-[8px] shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3B7EB2]/30 bg-[#002440]/80 shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#43E600]" />
            <h2 className="font-mono font-black text-sm text-[#45AFFF] uppercase tracking-wider">
              Monitor de Variables
            </h2>
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-white/40">
              <Clock className="w-3 h-3" />
              {timeAgo(lastUpdate)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[10px] font-mono text-white/30">actualización 1s</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar monitor"
              className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
          {/* Telemetría — solo variables activas en TelemetryData */}
          <Section title="Telemetría (simulador)" icon={Activity} count={Object.keys(activeTelemetry).length} defaultOpen={true}>
            <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-white/5">
              <span className="text-[10px] font-mono text-white/30">Fuente: FlightController / FlightContext.telemetry (solo activas)</span>
              <span className="text-[10px] font-mono text-white/40 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgo(lastUpdate)}
              </span>
            </div>
            <KeyValueGrid data={activeTelemetry} units={TELEMETRY_UNITS} />
            {controllerTelemetry && Object.keys(controllerTelemetry).length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <div className="text-[10px] font-mono text-white/40 mb-1 px-2">Controller.getTelemetry() (directo)</div>
                <KeyValueGrid data={controllerTelemetry} units={TELEMETRY_UNITS} />
              </div>
            )}
          </Section>

          {/* Vuelo */}
          <Section title="Vuelo (FlightContext)" icon={Plane} count={Object.keys(flight).length} defaultOpen={true}>
            <KeyValueGrid
              data={flight}
              units={{
                flightNumber: "",
                gate: "",
                departureTime: "",
              }}
            />
            {fsm && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <div className="text-[10px] font-mono text-white/40 mb-1 px-2">FSM</div>
                <KeyValueGrid data={fsm as Record<string, unknown>} />
              </div>
            )}
            {announcement && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <div className="text-[10px] font-mono text-white/40 mb-1 px-2">Announcement</div>
                <KeyValueGrid data={announcement as Record<string, unknown>} />
              </div>
            )}
          </Section>

          {/* Variables de Crucero */}
          <Section title="✈️ Variables de Crucero" icon={Plane} count={7} defaultOpen={true}>
            <div className="text-[10px] font-mono text-white/30 px-2 pb-1.5 mb-1 border-b border-white/5">
              Progreso de crucero (cruise_time SimBrief vs zuluTime) · actualización 1s
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">CRUISE_TIME</span>
                <span className="font-mono text-[11px] text-[#45AFFF]">
                  {cruiseVars.cruiseTimeSeconds !== null
                    ? `${cruiseVars.cruiseTimeSeconds}s (${secondsToTimeRemaining(cruiseVars.cruiseTimeSeconds)})`
                    : <span className="text-white/30 italic">— (sin SimBrief)</span>}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">CRUISE_PROGRESS</span>
                <span className="font-mono text-[11px] text-[#45AFFF]">
                  {cruiseVars.progress.toFixed(2)} <span className="text-white/40">({Math.round(cruiseVars.progress * 100)}%)</span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">PASSENGERS_SLEEPING</span>
                <span>{formatValue("PASSENGERS_SLEEPING", cruiseVars.sleeping)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">IS_INTERNATIONAL</span>
                <span className="font-mono text-[11px]">
                  {formatValue("IS_INTERNATIONAL", cruiseVars.international)}
                  {cruiseVars.originICAO || cruiseVars.destICAO ? (
                    <span className="text-white/40 ml-1">({cruiseVars.originICAO || "—"} → {cruiseVars.destICAO || "—"})</span>
                  ) : null}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">originCountry</span>
                <span className="font-mono text-[11px] text-white/80">{cruiseVars.originCountry}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">destCountry</span>
                <span className="font-mono text-[11px] text-white/80">{cruiseVars.destCountry}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                <span className="font-mono text-[11px] text-white/60">cruiseEntryTime</span>
                <span className="font-mono text-[11px] text-[#45AFFF]">
                  {cruiseVars.cruiseEntryTime !== null
                    ? `${secondsToHHMM(cruiseVars.cruiseEntryTime)} UTC`
                    : <span className="text-white/30 italic">— (aún no en CRUISE)</span>}
                </span>
              </div>
            </div>
          </Section>

          {/* SimBrief */}
          <Section title="SimBrief" icon={FileText} count={simbrief ? Object.keys(simbrief).length : 0} defaultOpen={false}>
            {simbrief ? (
              <KeyValueGrid data={simbrief as Record<string, unknown>} />
            ) : (
              <div className="text-[11px] font-mono text-white/30 italic px-2 py-2">
                Sin datos SimBrief (importá un vuelo)
              </div>
            )}
          </Section>

          {/* Narrativa */}
          <Section title="Narrativa (NarrativeEngine)" icon={Layers} count={narrativeInfo?.totalSteps} defaultOpen={true}>
            {narrativeInfo ? (
              <div className="space-y-1">
                <KeyValueGrid
                  data={
                    {
                      scenario: narrativeInfo.scenario,
                      currentStep: narrativeInfo.currentStepKey,
                      stepIndex: narrativeInfo.currentIndex,
                      totalSteps: narrativeInfo.totalSteps,
                      hasNextStep: narrativeInfo.hasNextStep,
                      isCompleted: narrativeInfo.isCompleted,
                    } as Record<string, unknown>
                  }
                />
                {waitSnapshot && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <div className="text-[10px] font-mono text-white/40 mb-1 px-2">Estado de espera (orquestador)</div>
                    <KeyValueGrid
                      data={
                        {
                          esperandoAudio: waitSnapshot.waitingForAudio,
                          pasosManualesPendientes: waitSnapshot.pendingUserSteps.length > 0 ? waitSnapshot.pendingUserSteps.join(", ") : "—",
                          eventosExternosPendientes: waitSnapshot.pendingExternalSteps.length > 0 ? waitSnapshot.pendingExternalSteps.join(", ") : "—",
                          timersOrquestador: waitSnapshot.pendingTimerIds.length > 0 ? waitSnapshot.pendingTimerIds.join(", ") : "—",
                          timersSistema: waitSnapshot.scheduledTimers.length > 0
                            ? waitSnapshot.scheduledTimers.map((t) => `${t.id} (${t.event}, ${Math.round(t.remainingMs / 1000)}s)`).join(", ")
                            : "—",
                        } as Record<string, unknown>
                      }
                    />
                  </div>
                )}
                {narrativeInfo.definitionSteps.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <div className="text-[10px] font-mono text-white/40 mb-1 px-2">Pasos del escenario</div>
                    <div className="flex flex-wrap gap-1 px-2">
                      {narrativeInfo.definitionSteps.map((k, i) => {
                        const isActive = i === narrativeInfo.currentIndex && !narrativeInfo.isCompleted;
                        return (
                          <span
                            key={`${k}-${i}`}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                              isActive
                                ? "bg-[#43E600]/20 border-[#43E600]/40 text-[#43E600] font-bold"
                                : "bg-white/5 border-white/10 text-white/50"
                            }`}
                            title={`#${i}: ${k}`}
                          >
                            {isActive ? "▶ " : ""}
                            {k}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] font-mono text-white/30 italic px-2 py-2">Sin NarrativeEngine disponible</div>
            )}
          </Section>

          {/* Eventos de Demora */}
          <Section title="Eventos de Demora" icon={Timer} count={delayEvents.length} defaultOpen={true}>
            <div className="text-[10px] font-mono text-white/30 px-2 pb-1.5 mb-1 border-b border-white/5">
              Evaluación delay_detection (zuluTime vs scheduledTakeoffTime / threshold)
            </div>
            {delayEvents.length === 0 ? (
              <div className="text-[11px] font-mono text-white/30 italic px-2 py-2">Sin eventos de demora</div>
            ) : (
              <div className="space-y-2">
                {delayEvents.map((ev) => (
                  <div key={ev.key} className="border border-white/10 rounded-[5px] overflow-hidden bg-white/[0.02]">
                    <div className="flex items-center justify-between px-2 py-1.5 bg-white/[0.04] border-b border-white/5">
                      <span className="font-mono text-[11px] font-bold text-[#ffb340] flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" />
                        {ev.label}
                      </span>
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/80">
                        {ev.state}
                      </span>
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">Hora actual (UTC)</span>
                        <span className="font-mono text-[11px] text-[#45AFFF]">
                          {ev.currentTimeDisplay} <span className="text-white/40 ml-1">({ev.currentTime != null ? `${ev.currentTime}s` : "—"})</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">Hora salida (UTC)</span>
                        <span className="font-mono text-[11px] text-[#45AFFF]">
                          {ev.scheduledTimeDisplay} <span className="text-white/40 ml-1">({ev.scheduledTime != null && ev.scheduledTime !== "" ? `${String(ev.scheduledTime)}${typeof ev.scheduledTime === "number" ? "s" : ""}` : "—"})</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">threshold</span>
                        <span className="font-mono text-[11px] text-[#45AFFF]">{ev.threshold}ms<span className="text-white/40 ml-1">({(ev.threshold / 60000).toFixed(1)} min)</span></span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">Tiempo restante</span>
                        <span className="font-mono text-[11px] text-[#45AFFF]">
                          {ev.timeRemainingDisplay} <span className="text-white/40 ml-1">({ev.timeRemaining != null ? `${ev.timeRemaining}s` : "—"})</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">isDelayed (umbral superado)</span>
                        <span>{ev.isDelayed ? <span className="inline-flex items-center gap-1 text-[#43E600] font-bold text-[11px]">✅ true</span> : <span className="inline-flex items-center gap-1 text-red-400 font-bold text-[11px]">❌ false</span>}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">currentPhase (fsm)</span>
                        <span className="font-mono text-[11px] text-white/80">{String(ev.currentPhase)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">fase (scheduler)</span>
                        <span className="font-mono text-[11px] text-white/80">{String((ev as any).schedulerPhase ?? "—")}</span>
                      </div>
                      {ev.preferredCondition && (
                        <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04] border border-white/5 bg-white/[0.02]">
                          <span className="font-mono text-[11px] text-[#45AFFF]/90 flex items-center gap-1">
                            <MoonStar className="w-3 h-3" />
                            preferred_condition: {String(ev.preferredCondition)}
                          </span>
                          <span className="text-[11px] font-bold">
                            {ev.preferredCondition === "is_night_flight" ? (
                              ev.isNightFlight ? (
                                <span className="inline-flex items-center gap-1 text-[#43E600]">✅ se cumple</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-400">❌ no se cumple</span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 text-white/50">—</span>
                            )}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">lastEvaluation</span>
                        <span className="font-mono text-[10px] text-white/40">{ev.lastEvaluation}</span>
                      </div>
                      {/* Línea de tiempo visual */}
                      <div className="px-2 py-2 border-t border-white/5 bg-black/10">
                        <DelayTimeline
                          eventKey={ev.key}
                          currentTime={typeof ev.currentTime === "number" ? ev.currentTime : NaN}
                          scheduledTakeoff={typeof ev.scheduledTime === "number" ? ev.scheduledTime : NaN}
                          thresholdMs={ev.threshold}
                          label={ev.label}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Transiciones */}
          <Section title="Transiciones" icon={GitBranch} count={1} defaultOpen={true}>
            <div className="text-[10px] font-mono text-white/30 px-2 pb-1.5 mb-1 border-b border-white/5">
              Evaluación PRE_FLIGHT → TAXI (misma lógica que FlightPhaseDetector · actualización 1s)
            </div>
            <div className="mx-0 mb-2 px-2 py-1.5 rounded border border-white/10 bg-black/30 font-mono text-[11px] text-white/80">
              <span className="text-white/50">FASE:</span> {taxiTransition.currentPhase}
              {" · "}<span className="text-white/50">TAXI:</span> {taxiTransition.status.label}
              {" · "}<span className="text-white/50">ANCLA:</span> {taxiAnchorEvent.stateLabel}
              {" · "}<span className="text-white/50">WAIT pendientes:</span> {waitConditionSteps.filter((w) => w.status.tone === "waiting" || w.status.tone === "blocked").length}/{waitConditionSteps.length}
              {" · "}<span className="text-white/50">ORIGEN:</span> {transitionOrigin.label}
            </div>
            <div className="border border-white/10 rounded-[5px] overflow-hidden bg-white/[0.02]">
              <div className="flex items-center justify-between px-2 py-1.5 bg-white/[0.04] border-b border-white/5">
                <span className="font-mono text-[11px] font-bold text-[#45AFFF]">
                  Transición a TAXI (PRE_FLIGHT → TAXI)
                </span>
                <span
                  className={`font-mono text-[11px] px-1.5 py-0.5 rounded border font-bold ${
                    taxiTransition.status.tone === "ready"
                      ? "bg-[#43E600]/15 border-[#43E600]/40 text-[#43E600]"
                      : taxiTransition.status.tone === "blocked"
                        ? "bg-red-500/15 border-red-500/40 text-red-400"
                        : "bg-yellow-500/15 border-yellow-500/40 text-yellow-300"
                  }`}
                >
                  {taxiTransition.status.label}
                </span>
              </div>
              <div className="p-2 space-y-0.5">
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider px-2 pt-1">
                  Condiciones:
                </div>
                {[
                  {
                    label: "SIM ON GROUND",
                    ok: taxiTransition.isOnGround,
                    value: taxiTransition.simOnGround === undefined ? "—" : String(taxiTransition.simOnGround),
                  },
                  {
                    label: "GROUND SPEED > 5",
                    ok: taxiTransition.isMoving,
                    value: `${Number.isInteger(taxiTransition.groundspeed) ? taxiTransition.groundspeed : taxiTransition.groundspeed.toFixed(2)} nudos`,
                  },
                  {
                    label: "PARKING BRAKE OFF",
                    ok: taxiTransition.isParkingBrakeOff,
                    value: taxiTransition.parkingBrake === undefined ? "—" : taxiTransition.parkingBrake ? "puesto (true)" : "liberado (false)",
                  },
                  {
                    label: "NOT AT PARKING SPOT",
                    ok: taxiTransition.isNotAtParkingSpot,
                    value: taxiTransition.atcOnParkingSpot === undefined ? "—" : String(taxiTransition.atcOnParkingSpot),
                  },
                  {
                    label: "ALL ENGINES RUNNING",
                    ok: taxiTransition.allEnginesRunning,
                    value:
                      taxiTransition.numEngines === undefined
                        ? `motor1=${String(taxiTransition.engineDetail[1] ?? "—")}`
                        : `N=${taxiTransition.numEngines} [1:${String(taxiTransition.engineDetail[1] ?? "—")} 2:${String(taxiTransition.engineDetail[2] ?? "—")} 3:${String(taxiTransition.engineDetail[3] ?? "—")} 4:${String(taxiTransition.engineDetail[4] ?? "—")}]`,
                  },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]"
                  >
                    <span className="font-mono text-[11px] text-white/60">{c.label}</span>
                    <span className={`font-mono text-[11px] font-bold ${c.ok ? "text-[#43E600]" : "text-red-400"}`}>
                      {c.ok ? "✅" : "❌"} <span className="font-normal text-white/60">= {c.value}</span>
                    </span>
                  </div>
                ))}
                {!taxiTransition.hasAdvancedGroundData && (
                  <div className="mx-2 mt-1 px-2 py-1.5 rounded border border-red-500/30 bg-red-500/10 font-mono text-[11px] text-red-300">
                    ⚠️ Sin telemetría avanzada: se usa detección fallback (altitude + doorsClosed + motor1).
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04] border-t border-white/5 mt-1 pt-2">
                  <span className="font-mono text-[11px] text-white/60">Estado general</span>
                  <span className="font-mono text-[11px] font-bold text-white/80">
                    {taxiTransition.allConditionsMet ? "✅" : "❌"} {taxiTransition.status.hint}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                  <span className="font-mono text-[11px] text-white/60">📌 Origen</span>
                  <span
                    className={`font-mono text-[11px] font-bold ${
                      transitionOrigin.isFallback ? "text-yellow-400" : "text-green-400"
                    }`}
                    title={transitionOrigin.from !== "—" ? `${transitionOrigin.from} → ${transitionOrigin.phase} · ${transitionOrigin.time}` : transitionOrigin.time}
                  >
                    {transitionOrigin.label}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                  <span className="font-mono text-[11px] text-white/60">Fase actual (fsm)</span>
                  <span className="font-mono text-[11px] text-white/80">{taxiTransition.currentPhase}</span>
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                  <span className="font-mono text-[11px] text-white/60">Última evaluación</span>
                  <span className="font-mono text-[10px] text-white/40">{taxiTransition.lastEvaluation}</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Pasos en espera (WAIT_CONDITION) */}
          <Section title="Pasos en espera (WAIT_CONDITION)" icon={Timer} count={waitConditionSteps.length} defaultOpen={true}>
            <div className="text-[10px] font-mono text-white/30 px-2 pb-1.5 mb-1 border-b border-white/5">
              Precondiciones de pasos WAIT_CONDITION del escenario cargado · actualización 1s
            </div>
            {waitConditionSteps.length === 0 ? (
              <div className="text-[11px] font-mono text-white/30 italic px-2 py-2">
                Sin pasos WAIT_CONDITION en el escenario actual
              </div>
            ) : (
              <div className="space-y-2">
                {waitConditionSteps.map((w) => (
                  <div key={w.eventKey} className="border border-white/10 rounded-[5px] overflow-hidden bg-white/[0.02]">
                    <div className="flex items-center justify-between px-2 py-1.5 bg-white/[0.04] border-b border-white/5">
                      <span className="font-mono text-[11px] font-bold text-[#45AFFF]">
                        {w.eventKey}
                        {w.isCurrent && <span className="ml-1 text-[#43E600]">▶</span>}
                      </span>
                      <span
                        className={`font-mono text-[11px] px-1.5 py-0.5 rounded border font-bold ${
                          w.status.tone === "ready" || w.status.tone === "done"
                            ? "bg-[#43E600]/15 border-[#43E600]/40 text-[#43E600]"
                            : w.status.tone === "blocked"
                              ? "bg-red-500/15 border-red-500/40 text-red-400"
                              : w.status.tone === "waiting"
                                ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-300"
                                : "bg-white/5 border-white/10 text-white/60"
                        }`}
                      >
                        Estado: {w.status.label}
                      </span>
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider px-2 pt-1">
                        Precondiciones (type: {w.kind}):
                      </div>
                      {w.rows.length === 0 ? (
                        <div className="px-2 py-1 font-mono text-[11px] text-white/40 italic">{w.summary}</div>
                      ) : (
                        w.rows.map((c) => (
                          <div key={c.label} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                            <span className="font-mono text-[11px] text-white/60">{c.label}</span>
                            <span className={`font-mono text-[11px] font-bold ${c.ok ? "text-[#43E600]" : "text-red-400"}`}>
                              {c.ok ? "✅" : "❌"} <span className="font-normal text-white/60">= {c.value}</span>
                            </span>
                          </div>
                        ))
                      )}
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04] border-t border-white/5 mt-1 pt-2">
                        <span className="font-mono text-[11px] text-white/60">Resultado</span>
                        <span className="font-mono text-[11px] font-bold text-white/80">
                          {w.met === true ? "✅" : w.met === false ? "❌" : "❓"} {w.summary}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-white/[0.04]">
                        <span className="font-mono text-[11px] text-white/60">Última evaluación</span>
                        <span className="font-mono text-[10px] text-white/40">{w.evaluatedAt}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Variables de eventos */}
          <Section title="Variables de eventos (resueltas)" icon={Variable} count={Object.keys(eventVars).length} defaultOpen={true}>
            <div className="text-[10px] font-mono text-white/30 px-2 pb-1.5 mb-1 border-b border-white/5">
              Merge representativo de flight + telemetry + simbrief (o último EventContext si está disponible)
            </div>
            <KeyValueGrid data={eventVars} />
          </Section>

          {/* Footer meta */}
          <div className="flex items-center justify-between px-2 py-2 text-[10px] font-mono text-white/25 border-t border-white/5">
            <span>Tipografía monospace · booleanos con color · actualización 1s</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#43E600] animate-pulse" />
              en vivo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
