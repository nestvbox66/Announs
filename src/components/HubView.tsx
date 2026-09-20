/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { 
  Award, 
  Clock, 
  TrendingUp, 
  History, 
  MapPin, 
  PlaneTakeoff, 
  ChevronRight, 
  UserCheck, 
  Sparkles,
  Heart,
  BarChart3,
  BookOpen,
  User,
  Users,
  Calendar,
  Map,
  Lock,
  LogIn,
  Mail,
  Eye,
  EyeOff
} from "lucide-react";
import { VueloReciente, Logro } from "../types";
import PassportView from "./PassportView";
import AccountView from "./AccountView";
import FlightDetailView from "./flight/FlightDetailView";
import { FlightHistoryService, FlightHistoryEntry } from "../services/FlightHistoryService";

interface HubViewProps {
  vuelos: VueloReciente[];
  logros: Logro[];
  onStartFlightShortcut: () => void;
  isLoggedIn?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
}

export default function HubView({ 
  vuelos, 
  logros, 
  onStartFlightShortcut,
  isLoggedIn = false,
  onLogin,
  onLogout
}: HubViewProps) {
  const { t, i18n } = useTranslation();
  const [subView, setSubView] = useState<"overview" | "stats" | "passport" | "account">("overview");
  const [selectedFlight, setSelectedFlight] = useState<VueloReciente | null>(null);
  // Historial real desde Supabase (`public.flights` del usuario autenticado).
  const [recentFlights, setRecentFlights] = useState<FlightHistoryEntry[] | null>(null);
  const [flightsLoading, setFlightsLoading] = useState(false);
  const [flightsError, setFlightsError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{ username: string; avatar: string; createdAt: string } | null>(null);

  useEffect(() => {
    if (!isLoggedIn) return;

    let cancelled = false;

    const loadProfile = async () => {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (cancelled || authErr || !user) return;

      const { data, error } = await supabase
        .from("users")
        .select("username, avatar, created_at, preferred_language")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled || error || !data) return;

      setUserProfile({
        username: data.username || "",
        avatar: data.avatar || "",
        createdAt: data.created_at || "",
      });

      if (data.preferred_language) {
        i18n.changeLanguage(data.preferred_language);
        localStorage.setItem("announs_language", data.preferred_language);
      }
    };

    loadProfile();
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  // Historial de vuelos recientes: datos reales del usuario autenticado.
  useEffect(() => {
    if (!isLoggedIn) {
      setRecentFlights(null);
      setFlightsError(null);
      setFlightsLoading(false);
      return;
    }
    let cancelled = false;
    const loadHistory = async () => {
      setFlightsLoading(true);
      setFlightsError(null);
      const result = await FlightHistoryService.loadRecentFlights();
      if (cancelled) return;
      if (result.success) {
        setRecentFlights(result.data ?? []);
      } else {
        setFlightsError(result.error ?? "No se pudo cargar el historial.");
        setRecentFlights(null);
      }
      setFlightsLoading(false);
    };
    void loadHistory();
    return () => { cancelled = true; };
  }, [isLoggedIn, historyReloadKey]);

  /**
   * Filas de la tabla: datos reales cuando la consulta terminó, mocks de la
   * prop solo como respaldo previo a la primera carga. Cada fila real lleva su
   * `flight_id` y marca de stats pendientes para el detalle.
   */
  const tableRows: VueloReciente[] = (() => {
    if (recentFlights === null) return vuelos;
    return recentFlights.map((entry) => ({
      id: entry.flightId,
      flightId: entry.flightId,
      codigo: entry.flightNumber,
      origen: entry.departIcao,
      origenCiudad: entry.departCity,
      destino: entry.arriveIcao,
      destinoCiudad: entry.arriveCity,
      fecha: entry.departLabel,
      fpmLanding: 0,
      satisfaccionMedia: 0,
      puntuacion: 0,
      duracion: entry.durationLabel,
      aerolinea: entry.airline,
      isPlaceholderStats: true,
    }));
  })();
  const historyLoaded = recentFlights !== null;

  // Render Full Screen Flight Detail view if selected
  if (selectedFlight) {
    return <FlightDetailView flight={selectedFlight} onBack={() => setSelectedFlight(null)} />;
  }

  // Let's map country flags or stamps for the passport stamp representation
  const countryStamps: { [key: string]: { flag: string; city: string; stampColor: string } } = {
    "l-1": { flag: "🇦🇷", city: "Ushuaia / El Calafate", stampColor: "border-[#45AFFF] text-[#45AFFF]" },
    "l-2": { flag: "🇨🇱", city: "Santiago de Chile", stampColor: "border-[#43E600] text-[#43E600]" },
    "l-3": { flag: "🇪🇸", city: "Madrid Barajas", stampColor: "border-[#E68B00] text-[#E68B00]" },
    "l-4": { flag: "🇺🇸", city: "Chicago O'Hare", stampColor: "border-[#E600D2] text-[#E600D2]" },
    "l-5": { flag: "🇧🇷", city: "São Paulo Airport", stampColor: "border-[#43E600] text-[#43E600]" },
    "l-6": { flag: "🇬🇧", city: "London Heathrow", stampColor: "border-[#45AFFF] text-[#45AFFF]" },
  };

  const totalXP = vuelos.reduce((sum, v) => sum + v.puntuacion, 24500);
  const totalPasajeros = 24558 + vuelos.length * 142;
  const totalHoras = 158;
  const averageSatisfaccion = Math.round(vuelos.reduce((sum, v) => sum + v.satisfaccionMedia, 0) / vuelos.length);
  const averageFPM = Math.round(vuelos.reduce((sum, v) => sum + v.fpmLanding, 0) / vuelos.length);

  const avatarInitials = userProfile?.username
    ? userProfile.username.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "--";

  const memberSince = userProfile?.createdAt
    ? new Intl.DateTimeFormat(i18n.language, { month: "short", year: "numeric" }).format(new Date(userProfile.createdAt))
    : "---";

  const getAirlineBadge = (aerolinea: string) => {
    const cleanName = aerolinea ? aerolinea.toLowerCase() : "";
    if (cleanName.includes("argentinas")) {
      return (
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-sky-500 border border-sky-300 text-white font-mono font-extrabold text-[10px] flex items-center justify-center shadow-inner shrink-0 scale-95">
            AR
          </span>
          <span className="font-semibold text-white/95">{aerolinea}</span>
        </div>
      );
    }
    if (cleanName.includes("bondi")) {
      return (
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-amber-400 border border-amber-300 text-slate-900 font-mono font-extrabold text-[10px] flex items-center justify-center shadow-inner shrink-0 scale-95">
            FB
          </span>
          <span className="font-semibold text-white/95">{aerolinea}</span>
        </div>
      );
    }
    if (cleanName.includes("smart")) {
      return (
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-[#E600D2] border border-fuchsia-400 text-white font-mono font-extrabold text-[10px] flex items-center justify-center shadow-inner shrink-0 scale-95">
            WJ
          </span>
          <span className="font-semibold text-white/95">{aerolinea}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded bg-slate-600 border border-slate-500 text-white font-mono font-extrabold text-[10px] flex items-center justify-center shadow-inner shrink-0 scale-95">
          PA
        </span>
        <span className="font-semibold text-white/95">{aerolinea}</span>
      </div>
    );
  };

  if (!isLoggedIn) {
    const handleLocalLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError(null);
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setAuthError(error.message);
        return;
      }
      if (onLogin) onLogin();
    };

    return (
      <div id="disconnected-hub-container" className="max-w-md mx-auto my-12 animate-fadeIn">
        <div className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-8 shadow-2xl space-y-6 relative overflow-hidden">
          {/* Decorative neon corner accent */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#45AFFF]/5 rounded-bl-full pointer-events-none"></div>
          
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-[#001b33]/60 border border-[#3B7EB2]/40 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-7 h-7 text-[#45AFFF] animate-pulse" />
            </div>
            <h2 className="font-display font-black text-lg tracking-wider text-[#45AFFF] uppercase mt-2">
              {t("login.title")}
            </h2>
            <p className="text-[11px] text-white/60 font-mono max-w-xs mx-auto">
              {t("login.description")}
            </p>
          </div>

          <form onSubmit={handleLocalLogin} className="space-y-4">
            {/* Campo correo */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.email_label")}
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="w-3.5 h-3.5 text-[#45AFFF]/60" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-[#00172e] text-white font-mono text-xs pl-9 pr-3 py-2.5 rounded border border-[#3B7EB2]/40 focus:outline-none focus:border-[#45AFFF] transition-all"
                  placeholder={t("login.email_placeholder")}
                />
              </div>
            </div>

            {/* Campo contraseña */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.password_label")}
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="w-3.5 h-3.5 text-[#45AFFF]/60" />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-[#00172e] text-white font-mono text-xs pl-9 pr-9 py-2.5 rounded border border-[#3B7EB2]/40 focus:outline-none focus:border-[#45AFFF] transition-all"
                  placeholder={t("login.password_placeholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-3.5 h-3.5 text-[#45AFFF]/60 hover:text-[#45AFFF] transition-colors" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-[#45AFFF]/60 hover:text-[#45AFFF] transition-colors" />
                  )}
                </button>
              </div>
            </div>

            {/* Ingresar button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#45AFFF] hover:bg-[#45AFFF]/85 active:scale-[0.98] text-[#00345C] border border-[#45AFFF]/30 py-3 rounded font-mono font-extrabold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? t("login.authenticating") : t("login.login_button")}
            </button>
          </form>

          {/* Separator block */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-[1px] bg-white/10"></div>
            <span className="text-[9px] text-white/40 font-mono uppercase tracking-widest whitespace-nowrap">{t("login.or_continue_with")}</span>
            <div className="flex-1 h-[1px] bg-white/10"></div>
          </div>

          {authError && (
            <div className="bg-red-900/30 border border-red-500/40 rounded px-3 py-2 text-[11px] font-mono text-red-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
              {authError}
            </div>
          )}

          {/* Google SSO Login */}
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              setAuthError(null);
              setLoading(true);
              const { error } = await supabase.auth.signInWithOAuth({ provider: "google" });
              setLoading(false);
              if (error) {
                setAuthError(error.message);
              }
            }}
            className="w-full bg-[#00172e]/60 hover:bg-[#00345C]/50 border border-[#3B7EB2]/40 hover:border-[#45AFFF]/40 text-white py-3 rounded font-mono font-bold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.137 4.2a5.7 5.7 0 0 1-5.7-5.7 5.7 5.7 0 0 1 5.7-5.7c2.14 0 3.987.818 5.353 2.15l3.1-3.1C20.35 4.3 16.59 2.5 12.24 2.5a10 10 0 0 0-10 10 10 10 0 0 0 10 10c5.38 0 9.8-3.9 9.8-9.8 0-.6-.05-1.15-.16-1.715h-9.64z"
                />
              </svg>
            )}
            {loading ? t("login.authenticating") : t("login.google_button")}
          </button>

          {/* Secure disclaimer footer */}
          <div className="text-[9px] text-white/45 font-mono text-center pt-2 leading-relaxed">
                        {t("login.disclaimer")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="hub-view-container" className="space-y-6">
      {/* Upper Info Grid banner */}
      <div id="hub-upper-banner" className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-[#3B7EB2]/50 pb-4 gap-4">
        <div>
          <div className="text-xs text-[#45AFFF]/60 font-mono tracking-widest uppercase mb-1">{t("hub.subtitle")}</div>
          <h1 className="font-display font-extrabold text-3xl tracking-tight text-[#45AFFF]">
            {t("hub.title")}
          </h1>
        </div>
        
        {/* Navigation Selector: Debug bar styling */}
        <div className="flex flex-wrap gap-2 bg-[#001b33]/40 p-1 border border-[#3B7EB2]/40 rounded">
          <button
            onClick={() => setSubView("overview")}
            className={`px-3 py-1.5 rounded-[4px] font-mono text-[11px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
              subView === "overview"
                ? "bg-[#45AFFF] text-[#00345C] shadow-sm"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            {t("hub.tabs.overview")}
          </button>
          <button
            onClick={() => setSubView("stats")}
            className={`px-3 py-1.5 rounded-[4px] font-mono text-[11px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
              subView === "stats"
                ? "bg-[#45AFFF] text-[#00345C] shadow-sm"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
{t("hub.tabs.stats")}
          </button>
          <button
            onClick={() => setSubView("passport")}
            className={`px-3 py-1.5 rounded-[4px] font-mono text-[11px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
              subView === "passport"
                ? "bg-[#45AFFF] text-[#00345C] shadow-sm"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            {t("hub.tabs.passport")}
          </button>
          <button
            onClick={() => setSubView("account")}
            className={`px-3 py-1.5 rounded-[4px] font-mono text-[11px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
              subView === "account"
                ? "bg-[#45AFFF] text-[#00345C] shadow-sm"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            {t("hub.tabs.account")}
          </button>
        </div>
      </div>

      {subView === "overview" && (
        <>
          <div id="hub-grid-stats" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Profile Card & Career Stats */}
            <div 
              id="profile-career-card"
              className="lg:col-span-1 bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 flex flex-col justify-between shadow-md"
            >
              <div>
                <div className="flex items-center gap-4 border-b border-white/20 pb-4 mb-4">
                  <div className="w-14 h-14 rounded-full bg-[#00345C] border border-white/80 flex items-center justify-center font-display font-bold text-xl shrink-0 overflow-hidden">
                    {userProfile?.avatar ? (
                      <img src={userProfile.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-[#45AFFF]" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-base text-white">{userProfile?.username || "---"}</span>
                      <span className="bg-[#43E600]/25 text-[#43E600] border border-[#43E600]/40 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded">
                        PRO
                      </span>
                    </div>
                    <div className="text-xs text-[#45AFFF] font-mono">{t("overview.rank_undefined")}</div>
                    <div className="text-[10px] text-white/60">{t("overview.member_since", { date: memberSince })}</div>
                  </div>
                </div>

                <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider mb-3">{t("overview.career_stats")}</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-xs text-white/80 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#E68B00]" />
                      {t("overview.total_hours")}
                    </span>
                    <span className="font-mono text-sm font-bold text-white">{totalHoras} hrs</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-xs text-white/80 flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-[#45AFFF]" />
                      {t("overview.total_score")}
                    </span>
                    <span className="font-mono text-sm font-bold text-[#45AFFF]">{totalXP.toLocaleString()} XP</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-xs text-white/80 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#45AFFF]" />
                      {t("overview.passengers")}
                    </span>
                    <span className="font-mono text-sm font-bold text-white">{totalPasajeros.toLocaleString()} pax</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-xs text-white/80 flex items-center gap-1.5">
                      <Heart className="w-3.5 h-3.5 text-[#E600D2]" />
                      {t("overview.avg_satisfaction")}
                    </span>
                    <span className="font-mono text-sm font-bold text-[#43E600]">{averageSatisfaccion}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/80 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-[#43E600]" />
                      {t("overview.avg_landing")}
                    </span>
                    <span className="font-mono text-sm font-bold text-[#45AFFF]">{averageFPM} FPM</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section of Achievements - Passport Stamp Look */}
            <div 
              id="achievements-passport-card"
              className="lg:col-span-2 bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md"
            >
              <div className="flex items-center justify-between border-b border-white/20 pb-3 mb-4">
                <h3 className="text-sm font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                  <Award className="w-4 h-4" /> Logros y Pasaporte de Vuelos
                </h3>
                <span className="text-xs font-mono text-white/70">
                  Desbloqueados: {logros.filter(l => l.desbloqueado).length} de {logros.length}
                </span>
              </div>

              {/* Visual representations of stamp passport badges */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4" id="passport-stamp-grid">
                {logros.map((item) => {
                  const stamp = countryStamps[item.id] || { flag: "✈️", city: "Mundial", stampColor: "border-[#3B7EB2] text-white/40" };
                  return (
                    <div 
                      key={item.id}
                      id={`achievement-stamp-${item.id}`}
                      className={`relative p-3 rounded-[5px] border flex flex-col justify-between h-28 overflow-hidden transition-all duration-300 ${
                        item.desbloqueado 
                          ? `${stamp.stampColor} bg-[#00345C]/40 rotate-[-1deg] shadow-md hover:rotate-0 hover:scale-105` 
                          : "border-white/20 bg-black/20 text-white/35 opacity-60"
                      }`}
                    >
                      {/* Stamp Circular backdrop element */}
                      <div className="absolute right-[-10px] top-[-10px] text-5xl opacity-10 select-none font-mono">
                        {stamp.flag}
                      </div>

                      <div className="flex items-start justify-between">
                        <span className="text-lg">{item.desbloqueado ? stamp.flag : "🔒"}</span>
                        {item.desbloqueado && (
                          <span className="text-[9px] font-mono bg-white/10 px-1 py-0.5 rounded text-white font-bold">
                            SELLADO
                          </span>
                        )}
                      </div>

                      <div className="z-10">
                        <h4 className="text-xs font-bold leading-tight line-clamp-1 truncate">{item.titulo}</h4>
                        <p className="text-[10px] leading-tight text-white/70 mt-1 line-clamp-2">
                          {item.descripcion}
                        </p>
                      </div>

                      <div className="flex justify-between items-center text-[9px] font-mono mt-1 pt-1 border-t border-white/5 text-white/50">
                        <span>{item.desbloqueado ? stamp.city : "Bloqueado"}</span>
                        <span>{item.fechaDesbloqueo ? item.fechaDesbloqueo : "---"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Historial de Vuelos Recientes Table */}
          <div 
            id="recent-flights-section"
            className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-md animate-fadeIn"
          >
            <div className="flex items-center justify-between border-b border-white/20 pb-3 mb-4">
              <h3 className="text-sm font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
                <History className="w-4 h-4 text-[#E68B00]" /> Historial de Vuelos Recientes
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse" id="flights-table">
                <thead>
                  <tr className="border-b border-white/20 text-xs font-mono text-[#45AFFF]/80">
                    <th className="py-2.5 px-3">Aerolínea</th>
                    <th className="py-2.5 px-3">N° de Vuelo</th>
                    <th className="py-2.5 px-3">Ruta</th>
                    <th className="py-2.5 px-3">Fecha y Hora</th>
                    <th className="py-2.5 px-3">Duración</th>
                    <th className="py-2.5 px-3 text-center">Valoración</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-xs text-white/90">
                  {flightsLoading ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-3 text-center">
                        <div className="flex items-center justify-center gap-2 text-white/60 font-mono text-xs">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Cargando tu historial de vuelos…
                        </div>
                      </td>
                    </tr>
                  ) : flightsError ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-3 text-center">
                        <div className="space-y-2">
                          <p className="text-xs font-mono text-red-300">No se pudo cargar el historial: {flightsError}</p>
                          <button
                            type="button"
                            onClick={() => setHistoryReloadKey((k) => k + 1)}
                            className="bg-[#2C6591]/50 border border-white/20 hover:bg-[#45AFFF]/15 text-white px-3 py-1.5 rounded-[5px] font-mono text-[11px] transition-all cursor-pointer"
                          >
                            Reintentar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : historyLoaded && tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 px-3 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <PlaneTakeoff className="w-8 h-8 text-[#45AFFF]/40" />
                          <p className="text-sm font-bold text-white/80">Aún no registraste ningún vuelo</p>
                          <p className="text-[11px] font-mono text-white/50 max-w-sm">
                            Cuando completes tu primer vuelo con Announs, aparecerá aquí tu historial.
                          </p>
                          <button
                            type="button"
                            onClick={onStartFlightShortcut}
                            className="mt-1 bg-[#45AFFF] hover:bg-[#45AFFF]/85 text-[#00345C] px-4 py-2 rounded font-mono font-extrabold text-[11px] uppercase tracking-widest transition-all cursor-pointer"
                          >
                            Iniciar mi primer vuelo
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : tableRows.map((flight) => {
                    const isPhStats = flight.isPlaceholderStats === true;
                    const ratingVal = isPhStats ? "—" : (flight.satisfaccionMedia / 10).toFixed(1);

                    return (
                      <tr 
                        key={flight.id} 
                        id={`flight-row-${flight.id}`}
                        onClick={() => setSelectedFlight(flight)}
                        className="hover:bg-white/5 transition-colors group cursor-pointer"
                      >
                        <td className="py-3 px-3">
                          {getAirlineBadge(flight.aerolinea)}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-[#45AFFF] group-hover:translate-x-0.5 transition-transform">
                          {flight.codigo}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold flex items-center gap-1.5">
                            <span>{flight.origen}</span>
                            <span className="text-white/45">➔</span>
                            <span>{flight.destino}</span>
                            <span className="text-[10px] text-white/50 font-normal">
                              ({flight.origenCiudad.split(" ")[0]} ➔ {flight.destinoCiudad.split(" ")[0]})
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-white/70 whitespace-nowrap">{flight.fecha}</td>
                        <td className="py-3 px-3 font-mono text-white/70">{flight.duracion}</td>
                        <td className="py-3 px-3 text-center">
                          <div
                            className="inline-flex items-center gap-1 bg-black/20 px-2.5 py-0.5 rounded-[4px] border border-white/10 font-mono font-bold text-white"
                            title={isPhStats ? "La valoración estará disponible próximamente" : undefined}
                          >
                            <UserCheck className="w-3 h-3 text-[#43E600] scale-90" />
                            <span className={isPhStats ? "text-white/40" : "text-[#43E600]"}>{ratingVal}</span>
                            <span className="text-[9px] text-white/40 font-normal">/10</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {subView === "stats" && (() => {
        const statsVuelosTotal = 142 + vuelos.length;
        const statsDistanciaTotal = statsVuelosTotal * 412 + 350;
        const statsDuracionPromedio = "1h 48m";
        const statsAeropuertosUnicos = 26 + Math.min(vuelos.length, 6);
        const statsPuntuacionRating = (vuelos.length > 0 ? (vuelos.reduce((sum, v) => sum + v.satisfaccionMedia, 0) / vuelos.length / 10) : 8.8).toFixed(1);
        const statsRachaActual = 12;

        const statsMedianaVS = vuelos.length > 0 ? Math.round(vuelos.reduce((sum, v) => sum + Math.abs(v.fpmLanding), 0) / vuelos.length) : 118;
        const statsVueloMasLargoDur = "4h 15m";
        const statsVueloMasLargoDtn = 1650;
        const statsMejorRacha = 24;
        const statsPaisesVisitados = 8;

        const mesesData = [
          { name: "Ene", flights: 12, hClass: "h-[40%]" },
          { name: "Feb", flights: 18, hClass: "h-[60%]" },
          { name: "Mar", flights: 22, hClass: "h-[75%]" },
          { name: "Abr", flights: 15, hClass: "h-[50%]" },
          { name: "May", flights: 28, hClass: "h-[95%]" },
          { name: "Jun", flights: 19, hClass: "h-[65%]" },
          { name: "Jul", flights: 14, hClass: "h-[45%]" },
          { name: "Ago", flights: 25, hClass: "h-[85%]" },
          { name: "Sep", flights: 30, hClass: "h-full" },
          { name: "Oct", flights: 16, hClass: "h-[53%]" },
          { name: "Nov", flights: 22, hClass: "h-[75%]" },
          { name: "Dic", flights: 27, hClass: "h-[90%]" },
        ];

        return (
          <div id="stats-dashboard-screen" className="space-y-6 animate-fadeIn">
            {/* Header / Volver bar */}
            <div className="flex bg-[#001b33]/60 p-4 rounded-[5px] border border-[#3B7EB2]/30 items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-sm font-mono font-bold text-[#45AFFF] uppercase tracking-wider">
                    Análisis Estadístico
                  </h2>
                  <p className="text-[10px] text-white/50 font-mono">Panel Global de Estadísticas de Carrera</p>
                </div>
              </div>
            </div>

            {/* Title: Estadísticas de Carrera */}
            <div id="stats-section-title" className="border-b border-white/10 pb-2">
              <h3 className="text-base font-display font-extrabold text-[#45AFFF] flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#45AFFF]" /> ESTADÍSTICAS DE CARRERA
              </h3>
            </div>

            {/* Row 1: KPI Indicators */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" id="stats-kpi-row">
              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-4 shadow-sm flex flex-col justify-between h-24">
                <span className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">VUELOS</span>
                <span className="text-2xl font-mono font-extrabold text-white">{statsVuelosTotal}</span>
                <span className="text-[9px] text-white/40 font-mono">Registrados</span>
              </div>
              
              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-4 shadow-sm flex flex-col justify-between h-24">
                <span className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">DISTANCIA</span>
                <span className="text-xl font-mono font-extrabold text-white">{statsDistanciaTotal.toLocaleString()} <span className="text-xs text-white/60">MN</span></span>
                <span className="text-[9px] text-white/40 font-mono">Millas Náuticas</span>
              </div>

              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-4 shadow-sm flex flex-col justify-between h-24">
                <span className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">DURACIÓN PROMEDIO</span>
                <span className="text-xl font-mono font-extrabold text-white">{statsDuracionPromedio}</span>
                <span className="text-[9px] text-white/40 font-mono">Tiempo Promedio</span>
              </div>

              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-4 shadow-sm flex flex-col justify-between h-24">
                <span className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">AEROPUERTOS</span>
                <span className="text-2xl font-mono font-extrabold text-white">{statsAeropuertosUnicos}</span>
                <span className="text-[9px] text-white/40 font-mono">Terminales Conectadas</span>
              </div>

              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-4 shadow-sm flex flex-col justify-between h-24">
                <span className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">PUNTAJE PROMEDIO</span>
                <span className="text-xl font-mono font-extrabold text-[#43E600]">{statsPuntuacionRating}<span className="text-xs text-white/50">/10</span></span>
                <span className="text-[9px] text-white/40 font-mono">Aprobación Pasajeros</span>
              </div>

              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-4 shadow-sm flex flex-col justify-between h-24">
                <span className="text-[10px] font-mono text-[#45AFFF]/80 uppercase tracking-wider">RACHA</span>
                <span className="text-2xl font-mono font-extrabold text-[#E68B00]">{statsRachaActual} <span className="text-xs font-normal text-white/60">DÍAS</span></span>
                <span className="text-[9px] text-white/40 font-mono">Actividad Consecutiva</span>
              </div>
            </div>

            {/* Row 2: Performance Indicators (Rendimiento) */}
            <div className="space-y-3">
              <h4 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/5 pb-1">
                RENDIMIENTO DE COCKPIT
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4" id="stats-performance-row">
                <div className="bg-[#00345C]/35 border border-white/10 rounded-[5px] p-3 text-center">
                  <span className="text-[9px] font-mono text-white/50 block uppercase">MEDIANA DE VS</span>
                  <span className="text-lg font-mono font-extrabold text-[#43E600]">{statsMedianaVS} FPM</span>
                  <span className="text-[9px] text-white/30 block mt-0.5">Tasa de Descenso Aterrizaje</span>
                </div>

                <div className="bg-[#00345C]/35 border border-white/10 rounded-[5px] p-3 text-center">
                  <span className="text-[9px] font-mono text-white/50 block uppercase">VUELO MÁS LARGO (DUR.)</span>
                  <span className="text-lg font-mono font-extrabold text-white">{statsVueloMasLargoDur}</span>
                  <span className="text-[9px] text-white/30 block mt-0.5">Tiempo Máximo en Aire</span>
                </div>

                <div className="bg-[#00345C]/35 border border-white/10 rounded-[5px] p-3 text-center">
                  <span className="text-[9px] font-mono text-white/50 block uppercase">VUELO MÁS LARGO (DIST.)</span>
                  <span className="text-lg font-mono font-extrabold text-white">{statsVueloMasLargoDtn.toLocaleString()} MN</span>
                  <span className="text-[9px] text-white/30 block mt-0.5">Millas Máximas Cruzadas</span>
                </div>

                <div className="bg-[#00345C]/35 border border-white/10 rounded-[5px] p-3 text-center">
                  <span className="text-[9px] font-mono text-white/50 block uppercase">MEJOR RACHA</span>
                  <span className="text-lg font-mono font-extrabold text-[#E68B00]">{statsMejorRacha} DÍAS</span>
                  <span className="text-[9px] text-white/30 block mt-0.5">Récord Histórico Personal</span>
                </div>

                <div className="bg-[#00345C]/35 border border-white/10 rounded-[5px] p-3 text-center col-span-2 md:col-span-1">
                  <span className="text-[9px] font-mono text-white/50 block uppercase">PAÍSES VISITADOS</span>
                  <span className="text-lg font-mono font-extrabold text-[#45AFFF]">{statsPaisesVisitados} URBES</span>
                  <span className="text-[9px] text-white/30 block mt-0.5">Espacios Aéreos Soberanos</span>
                </div>
              </div>
            </div>

            {/* Row 3: Distribution Graphs/Indicators - Treemap / Mapa de Árbol */}
            <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-sm space-y-4">
              <h4 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1.5 flex items-center justify-between">
                <span>DISTRIBUCIÓN DE OPERACIÓN: MAPA DE ÁRBOL (TREEMAP)</span>
                <span className="text-[9px] text-[#43E600] font-bold">FLOTA & PARTICIPACIÓN HORARIA</span>
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 min-h-[200px]">
                {/* 50% Share - Boeing 737-800 */}
                <div className="md:col-span-6 bg-[#001b33]/40 border border-white/10 rounded p-4 flex flex-col justify-between hover:bg-[#001b33]/60 transition-all duration-300 cursor-pointer relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-[#43E600]"></div>
                  <div className="space-y-1 pl-2">
                    <span className="text-[10px] font-mono text-white/50 block">PARTICIPACIÓN DIRECTA — 50%</span>
                    <h5 className="font-mono text-sm font-bold text-white flex items-center gap-1.5">
                      <span>✈️</span> Boeing 737-800 NG
                    </h5>
                    <p className="text-[11px] text-white/70">
                      Modelo principal de operaciones de rango medio. Utilizado por Aerolíneas Argentinas y Flybondi.
                    </p>
                  </div>
                  
                  <div className="flex gap-2 items-center flex-wrap mt-3 pl-2">
                    <span className="px-2 py-0.5 rounded bg-sky-500 font-mono text-[9px] font-extrabold flex items-center gap-1">
                      AR <span>30%</span>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-800 font-mono text-[9px] font-extrabold flex items-center gap-1">
                      FB <span>20%</span>
                    </span>
                    <span className="text-[10px] text-white/40 ml-auto font-mono">79 Horas Bloque</span>
                  </div>
                </div>

                {/* Right columns further partitioned */}
                <div className="md:col-span-6 grid grid-rows-2 gap-3">
                  {/* Row 1: Airbus A320neo - 35% */}
                  <div className="bg-[#001b33]/40 border border-[#3B7EB2]/30 rounded p-4 flex flex-col justify-between hover:bg-[#001b33]/60 transition-all duration-300 cursor-pointer relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-[#45AFFF]"></div>
                    <div className="space-y-1 pl-2">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-mono text-white/50 block font-semibold">PARTICIPACIÓN — 35%</span>
                        <span className="px-1.5 py-0.5 rounded bg-[#E600D2] font-mono text-[8px] font-extrabold">WJ 35%</span>
                      </div>
                      <h5 className="font-mono text-xs font-bold text-white flex items-center gap-1.5">
                        <span>✈️</span> Airbus A320neo
                      </h5>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-white/60 font-mono mt-2 pl-2">
                      <span>Operado 100% por JetSMART</span>
                      <span className="text-white/40">55 Horas</span>
                    </div>
                  </div>

                  {/* Row 2: Embraer E190 - 15% */}
                  <div className="bg-[#001b33]/40 border border-white/5 rounded p-4 flex flex-col justify-between hover:bg-[#001b33]/60 transition-all duration-300 cursor-pointer relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-[#E600D2]"></div>
                    <div className="space-y-1 pl-2">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-mono text-white/50 block">PARTICIPACIÓN — 15%</span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-500 font-mono text-[8px] font-extrabold">AR 15%</span>
                      </div>
                      <h5 className="font-mono text-xs font-bold text-white flex items-center gap-1.5">
                        <span>✈️</span> Embraer E190
                      </h5>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-white/60 font-mono mt-2 pl-2">
                      <span>Vectores Regionales (AR Austral)</span>
                      <span className="text-white/40">24 Horas</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 4: Rutas más realizadas & Actividad Mensual Bar Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Rutas más realizadas */}
              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-sm lg:col-span-2 space-y-4">
                <h4 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1.5">
                  RUTAS MÁS REALIZADAS
                </h4>

                <div className="divide-y divide-white/5 space-y-2 text-xs">
                  {/* Ruta 1 */}
                  <div className="flex justify-between items-center pt-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold font-mono">
                        <span className="text-[#43E600]">AEP</span>
                        <span className="text-white/40">➔</span>
                        <span className="text-[#45AFFF]">BAR</span>
                      </div>
                      <div className="text-[10px] text-white/55">Aeroparque ➔ Bariloche (Patagonia)</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-extrabold text-white">18 veces</div>
                      <div className="text-[10px] text-white/40">710 MN</div>
                    </div>
                  </div>

                  {/* Ruta 2 */}
                  <div className="flex justify-between items-center pt-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold font-mono">
                        <span className="text-[#43E600]">AEP</span>
                        <span className="text-white/40">➔</span>
                        <span className="text-[#45AFFF]">COR</span>
                      </div>
                      <div className="text-[10px] text-white/55">Aeroparque ➔ Córdoba (Pampa)</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-extrabold text-white font-mono">14 veces</div>
                      <div className="text-[10px] text-white/40">345 MN</div>
                    </div>
                  </div>

                  {/* Ruta 3 */}
                  <div className="flex justify-between items-center pt-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold font-mono">
                        <span className="text-[#43E600]">EZE</span>
                        <span className="text-white/40">➔</span>
                        <span className="text-[#45AFFF]">MDZ</span>
                      </div>
                      <div className="text-[10px] text-white/55">Ezeiza Int. ➔ Mendoza (Andes)</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-extrabold text-white">11 veces</div>
                      <div className="text-[10px] text-white/40">524 MN</div>
                    </div>
                  </div>

                  {/* Ruta 4 */}
                  <div className="flex justify-between items-center pt-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold font-mono">
                        <span className="text-[#43E600]">AEP</span>
                        <span className="text-white/40">➔</span>
                        <span className="text-[#45AFFF]">IGR</span>
                      </div>
                      <div className="text-[10px] text-white/55">Aeroparque ➔ Iguazú (Selva Misionera)</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-extrabold text-white">9 veces</div>
                      <div className="text-[10px] text-white/40">580 MN</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bar Chart section */}
              <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-sm lg:col-span-3 space-y-4">
                <h4 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-1.5 flex items-center justify-between">
                  <span>ACTIVIDAD DE VUELOS POR MES</span>
                  <span className="text-[9px] text-white/40 font-mono uppercase font-normal">Frecuencia Cockpit</span>
                </h4>

                {/* Styled Flexible Bar Charts using pure Tailwind markup */}
                <div className="flex items-end justify-between h-48 pt-4 pb-2 px-1 bg-[#001b33]/40 border border-[#3B7EB2]/10 rounded" id="bar-chart-container">
                  {mesesData.map((mes, index) => (
                    <div key={index} className="flex flex-col items-center flex-1 group relative">
                      {/* Floating tooltip on hover */}
                      <div className="absolute top-[-30px] rounded bg-[#00345C] text-[10px] font-mono text-[#43E600] border border-white/10 px-1 py-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20 pointer-events-none">
                        {mes.flights} vls
                      </div>

                      {/* Bar Fill */}
                      <div className="w-4 sm:w-6 bg-black/15 hover:bg-black/25 rounded-t-sm flex items-end h-[110px] pb-0.5">
                        <div className={`w-full bg-[#45AFFF] group-hover:bg-[#43E600] rounded-t-sm transition-all duration-300 ${mes.hClass}`}></div>
                      </div>

                      {/* Tick Label */}
                      <span className="text-[10px] font-mono text-white/50 group-hover:text-white mt-1 pt-0.5 border-t border-white/5 w-full text-center">
                        {mes.name}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="text-[10px] text-white/60 text-right font-mono">
                  Total acumulado promedio mensual: <strong className="text-[#45AFFF]">21.8 vuelos / mes</strong>
                </div>
              </div>
            </div>


          </div>
        );
      })()}

      {subView === "passport" && (
        <PassportView onBack={() => setSubView("overview")} />
      )}

      {subView === "account" && (
        <AccountView onBack={() => setSubView("overview")} onLogout={onLogout} />
      )}
    </div>
  );
}
