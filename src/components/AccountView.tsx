/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { 
  User, 
  Mail, 
  Award, 
  Calendar, 
  Check, 
  X, 
  Database, 
  Save, 
  ShieldCheck, 
  Activity, 
  FileText, 
  Smartphone,
  Plane,
  Upload,
  Sparkles,
  ArrowLeft,
  Info,
  LogOut
} from "lucide-react";

interface AccountViewProps {
  onBack: () => void;
  onLogout?: () => void;
}

interface AccountData {
  username: string;
  email: string;
  avatarUrl: string;
  subscriptionType: string;
  pilotSince: string;
  subscriptionExpiry: string;
  userLevel: number;
  userXP: number;
  simbriefPilotId: string;
  simbriefUnits: "KGS" | "LBS";
  preferredLanguage: string;
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return "---";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateStr;
  }
};

export default function AccountView({ onBack, onLogout }: AccountViewProps) {
  const [dbData, setDbData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Form states (editable)
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [simbriefPilotId, setSimbriefPilotId] = useState("");
  const [simbriefUnits, setSimbriefUnits] = useState<"KGS" | "LBS">("KGS");
  const [preferredLanguage, setPreferredLanguage] = useState("es");

  // Custom avatar input helper
  const [customAvatarInput, setCustomAvatarInput] = useState("");
  const [showNotification, setShowNotification] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !user) {
        setLoading(false);
        return;
      }

      const uid = user.id;
      setUserId(uid);

      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", uid)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoading(false);
        return;
      }

      const row: AccountData = {
        username: data?.username || "",
        email: data?.email || user.email || "",
        avatarUrl: data?.avatar || "👨‍✈️",
        subscriptionType: data?.subscription_tier || "base",
        pilotSince: data?.created_at || "",
        subscriptionExpiry: data?.subscription_enddate || "",
        userLevel: data?.user_level ?? 1,
        userXP: data?.user_xp ?? 0,
        simbriefPilotId: data?.simbrief_pilot_id || "",
        simbriefUnits: data?.simbrief_units || "KGS",
        preferredLanguage: data?.preferred_language || "es"
      };

      if (!cancelled) {
        setDbData(row);
        setUsername(row.username);
        setAvatarUrl(row.avatarUrl);
        setSimbriefPilotId(row.simbriefPilotId);
        setSimbriefUnits(row.simbriefUnits);
        setPreferredLanguage(row.preferredLanguage);
        setLoading(false);
      }
    };

    loadData();

    return () => { cancelled = true; };
  }, []);

  // Handle pilot account logout
  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      onBack();
    }
  };

  // Handle local avatar upload
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) return;

    setIsUploadingAvatar(true);
    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "png";
      const filePath = `${userId}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error("Error al subir avatar:", uploadError);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      if (urlData?.publicUrl) {
        setAvatarUrl(urlData.publicUrl);
      }
    } catch (err) {
      console.error("Error inesperado al subir avatar:", err);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Save handler
  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);

    const simbriefPilotIdNum = simbriefPilotId.trim()
      ? parseInt(simbriefPilotId, 10) || null
      : null;

    const updatePayload = {
      username,
      avatar: avatarUrl,
      simbrief_units: simbriefUnits,
      simbrief_pilot_id: simbriefPilotIdNum,
      preferred_language: preferredLanguage
    };

    console.log("Payload a guardar:", updatePayload);

    const { error } = await supabase
      .from("users")
      .update(updatePayload)
      .eq("id", userId);

    setSaving(false);

    if (error) {
      return;
    }

    // Refresh local data after save
    if (dbData) {
      setDbData({
        ...dbData,
        username,
        avatarUrl,
        simbriefPilotId,
        simbriefUnits,
        preferredLanguage
      });
    }

    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
    }, 4000);
  };

  // Revert all form states to currently saved state
  const handleCancel = () => {
    if (dbData) {
      setUsername(dbData.username);
      setAvatarUrl(dbData.avatarUrl);
      setSimbriefPilotId(dbData.simbriefPilotId);
      setSimbriefUnits(dbData.simbriefUnits);
    }
    setCustomAvatarInput("");
    onBack();
  };

  // Progress percentage calculation for visual feedback
  const currentLevel = dbData?.userLevel ?? 1;
  const currentXP = dbData?.userXP ?? 0;
  const xpNextLevel = (currentLevel + 1) * 1000;
  const xpCurrentLevelFloor = currentLevel * 1000;
  const levelProgressPercent = Math.max(0, Math.min(100, Math.round(((currentXP - xpCurrentLevelFloor) / (xpNextLevel - xpCurrentLevelFloor)) * 100)));

  return (
    <div className="space-y-6 animate-fadeIn pb-12" id="account-settings-container">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row bg-[#001b33]/60 p-4 rounded-[5px] border border-[#3B7EB2]/30 items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-mono font-bold text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
              <User className="w-4 h-4" /> PERFIL Y AJUSTES DE CUENTA
            </h2>
            <p className="text-[10px] text-white/50 font-mono">Configura tu Licencia, Membresía e Integraciones de SimBrief</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={handleLogout}
            className="bg-red-950/40 border border-red-500/40 hover:bg-red-500/20 text-red-400 px-3 py-2 rounded-[4px] text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" /> CERRAR SESIÓN
          </button>
        </div>
      </div>

      {/* Toast Notification for Success */}
      {showNotification && (
        <div id="toast-success-banner" className="bg-[#43E600]/15 border border-[#43E600] text-white p-3 rounded-[4px] flex items-center justify-between text-xs font-mono animate-scaleUp">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#43E600] animate-bounce" />
            <span>AJUSTES DEL PILOTO GUARDADOS EN LA BASE DE DATOS</span>
          </div>
          <button onClick={() => setShowNotification(false)} className="text-white/60 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Pilot Identity Badge card */}
        <div className="space-y-6 lg:col-span-1">
          {/* Avatar selector card */}
          <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-md space-y-4 text-center">
            <h3 className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2 text-left">
              IDENTIDAD DIGITAL
            </h3>

            {/* Simulated Live Avatar Frame */}
            <div className="relative w-24 h-24 mx-auto rounded-full border-2 border-[#45AFFF] flex items-center justify-center text-4xl bg-gradient-to-br from-[#00172e] to-[#2C6591] overflow-hidden shadow-lg group">
              {avatarUrl.startsWith("data:") || avatarUrl.startsWith("http") ? (
                <img 
                  src={avatarUrl} 
                  alt="Custom Avatar" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="select-none text-5xl transform group-hover:scale-110 transition-transform">{avatarUrl || "👨‍✈️"}</span>
              )}
              {isUploadingAvatar && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-[10px] font-mono text-[#45AFFF]">
                  Cargando...
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-sm font-bold text-white font-mono uppercase tracking-wider">{username}</span>
              <p className="text-[10px] text-white/50 font-mono tracking-tight">{dbData?.email}</p>
            </div>



              {/* URL or Upload option */}
              <div className="pt-2 border-t border-white/5 space-y-2 text-left">
                <span className="text-[10px] text-white/50 font-mono block">Subir desde dispositivo:</span>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-[#3B7EB2]/40 hover:border-[#45AFFF]/50 cursor-pointer rounded bg-black/15 hover:bg-black/25 transition-all">
                    <div className="flex flex-col items-center justify-center pt-2 pb-2">
                      <Upload className="w-4 h-4 text-[#45AFFF] mb-1" />
                      <p className="text-[9px] font-mono text-white/60">Seleccionar Imagen</p>
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleAvatarUpload} 
                      className="hidden" 
                    />
                  </label>
                </div>
              </div>

              {/* Manual URL link input */}
              <div className="text-left space-y-1 pt-1">
                <span className="text-[9px] text-[#45AFFF] font-mono block">O pega URL externa de avatar:</span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={customAvatarInput}
                    onChange={(e) => setCustomAvatarInput(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 bg-black/25 text-white placeholder-white/30 font-mono text-[10px] px-2 py-1 rounded border border-white/10 focus:outline-none focus:border-[#45AFFF]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customAvatarInput.trim()) {
                        setAvatarUrl(customAvatarInput.trim());
                        setCustomAvatarInput("");
                      }
                    }}
                    className="bg-[#00345C] hover:bg-[#45AFFF]/20 border border-[#3B7EB2]/40 text-[#45AFFF] px-2 text-[10px] rounded transition-all font-mono"
                  >
                    Usar
                  </button>
                </div>
              </div>
          </div>

          {/* Level and XP progress displays as requested */}
          <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-md space-y-4">
            <h3 className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2 flex items-center justify-between">
              <span>NIVEL Y EXPERIENCIA</span>
              <span className="text-[#43E600] font-mono text-xs">LVL {dbData?.userLevel ?? 1}</span>
            </h3>

            {/* Beautiful visual XP Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between items-end text-xs font-mono">
                <span className="text-[#45AFFF] text-[10px]">PROGRESO AL SIGUIENTE NIVEL</span>
                <span className="text-white text-[11px] font-bold">{levelProgressPercent}%</span>
              </div>
              <div className="w-full bg-black/30 rounded-full h-2.5 overflow-hidden border border-white/5">
                <div 
                  className="bg-gradient-to-r from-[#45AFFF] to-[#43E600] h-full rounded-full transition-all duration-1000"
                  style={{ width: `${levelProgressPercent}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[10px] font-mono text-white/50">
                <span>{xpCurrentLevelFloor} XP</span>
                <span className="text-[#43E600] font-semibold">{dbData?.userXP ?? 0} XP total</span>
                <span>{xpNextLevel} XP</span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: General settings & Subscriptions info */}
        <div className="space-y-6 lg:col-span-2">
          <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-md space-y-6">
            <h3 className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2">
              DATOS GENERALES DE USUARIO
            </h3>

            {/* Form grid info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Usuario */}
              <div className="space-y-1.5">
                <label className="text-xs text-[#45AFFF]/90 font-mono font-bold uppercase tracking-wider block">
                  Usuario
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black/25 text-white font-mono text-xs px-3 py-2 rounded border border-white/10 focus:outline-none focus:border-[#45AFFF]/50"
                  placeholder="ID de piloto"
                />
              </div>

              {/* Correo */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/50 font-mono block font-bold uppercase tracking-wider">
                  Correo Electrónico
                </label>
                <div className="w-full bg-black/40 text-white/50 font-mono text-xs px-3 py-2 rounded border border-white/5 cursor-not-allowed flex items-center justify-between">
                  <span>{dbData?.email}</span>
                  <span className="text-[8px] bg-white/5 text-white/30 px-1.5 py-0.5 rounded uppercase">Verificado</span>
                </div>
              </div>

              {/* Piloto Desde */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/60 font-mono block font-bold uppercase tracking-wider">
                  Piloto desde
                </label>
                <div className="w-full bg-[#00172e]/50 text-white/80 font-mono text-xs px-3 py-2 rounded border border-white/10 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-[#E68B00]" />
                  <span>{formatDate(dbData?.pilotSince || "")}</span>
                </div>
              </div>

              {/* Vencimiento de la suscripción - BADGE */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/60 font-mono block font-bold uppercase tracking-wider">
                  Vencimiento de la suscripción
                </label>
                <div className="w-full bg-[#00172e]/50 text-[#43E600] font-mono text-xs px-3 py-2 rounded border border-white/10 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#43E600]" />
                  <span>{formatDate(dbData?.subscriptionExpiry || "")}</span>
                </div>
              </div>
              </div>

            {/* Idioma de preferencia */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#45AFFF]/90 font-mono font-bold uppercase tracking-wider block">
                Idioma de Preferencia
              </label>
              <select
                value={preferredLanguage}
                onChange={(e) => setPreferredLanguage(e.target.value)}
                className="w-full bg-black/25 text-white font-mono text-xs px-3 py-2 rounded border border-white/10 focus:outline-none focus:border-[#45AFFF]/50 appearance-none cursor-pointer"
              >
                <option value="es" className="bg-[#00345C]">Español</option>
                <option value="en" className="bg-[#00345C]">English</option>
              </select>
            </div>

            {/* Subscription Type selection area */}
            <div className="space-y-3 pt-2">
              <label className="text-xs text-[#45AFFF] font-mono font-bold uppercase tracking-wider block">
                Tipo de Suscripción
              </label>
              
              {(() => {
                const subscription_tier = (dbData?.subscriptionType || "base").toLowerCase();
                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {/* Subscription Card 1: Base */}
                      <div
                        className={`p-4 rounded border text-left flex flex-col justify-between h-28 select-none transition-all duration-300 ${
                          subscription_tier === "base"
                            ? "bg-black/30 border-[#45AFFF] ring-1 ring-[#45AFFF]/30"
                            : "bg-black/10 border-white/5 opacity-40"
                        }`}
                      >
                        <div className="w-full flex justify-between items-start">
                          <span className="text-xs font-mono text-white/60 uppercase">MATE BASE</span>
                          {subscription_tier === "base" && <span className="w-2.5 h-2.5 rounded-full bg-[#45AFFF]"></span>}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white uppercase font-mono">Plan Standard</h4>
                          <p className="text-[9px] text-white/40 font-mono leading-none mt-1">Bitácora simple MSFS</p>
                        </div>
                      </div>

                      {/* Subscription Card 2: Lite */}
                      <div
                        className={`p-4 rounded border text-left flex flex-col justify-between h-28 select-none transition-all duration-300 ${
                          subscription_tier === "lite"
                            ? "bg-[#E68B00]/10 border-[#E68B00] ring-1 ring-[#E68B00]/30"
                            : "bg-black/10 border-white/5 opacity-40"
                        }`}
                      >
                        <div className="w-full flex justify-between items-start">
                          <span className="text-xs font-mono text-[#E68B00] uppercase font-bold">LITE EDITION</span>
                          {subscription_tier === "lite" && <span className="w-2.5 h-2.5 rounded-full bg-[#E68B00]"></span>}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white uppercase font-mono">Plan Intermedio</h4>
                          <p className="text-[9px] text-white/40 font-mono leading-none mt-1">Soporta rutas y logs básicos</p>
                        </div>
                      </div>

                      {/* Subscription Card 3: Pro */}
                      <div
                        className={`p-4 rounded border text-left flex flex-col justify-between h-28 select-none transition-all duration-300 ${
                          subscription_tier === "pro"
                            ? "bg-[#43E600]/10 border-[#43E600] ring-1 ring-[#43E600]/30"
                            : "bg-black/10 border-white/5 opacity-40"
                        }`}
                      >
                        <div className="w-full flex justify-between items-start">
                          <span className="text-xs font-mono text-[#43E600] uppercase font-bold">FLIGHT CO-PILOT PRO</span>
                          {subscription_tier === "pro" && <span className="w-2.5 h-2.5 rounded-full bg-[#43E600] animate-pulse"></span>}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white uppercase font-mono">Premium Unlimited</h4>
                          <p className="text-[9px] text-white/40 font-mono leading-none mt-1">Pasaporte, despachador inteligente</p>
                        </div>
                      </div>
                    </div>

                    {/* Call-to-action (CTA) to upgrade / change plan */}
                    <div className="bg-[#00172e]/55 border border-[#43E600]/30 rounded p-4 mt-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 select-none">
                      <p className="text-[10px] text-white/70 font-mono leading-relaxed">
                        Si quieres modificar tu plan, utiliza el botón para ver las opciones?
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowNotification(true)}
                        className="bg-[#43E600] hover:bg-[#43E600]/85 text-slate-900 border border-[#43E600]/30 px-4 py-2 rounded font-mono font-bold text-[10px] transition-all uppercase tracking-wider whitespace-nowrap self-start sm:self-center cursor-pointer shadow-md"
                      >
                        MEJORAR PLAN A PRO ➔
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* INTEGRATIONS SUBSECTION: SimBrief settings */}
            <div className="pt-4 border-t border-white/10 space-y-4">
              <h4 className="text-xs font-mono font-bold text-[#45AFFF] uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#45AFFF]" /> INTEGRACIÓN SISTEMÁTICA CON SIMBRIEF
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#00172e]/30 p-4 rounded border border-[#3B7EB2]/15">
                {/* ID de Piloto SimBrief */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/80 font-mono block font-bold uppercase tracking-wider">
                    ID de Piloto SimBrief
                  </label>
                  <input
                    type="text"
                    value={simbriefPilotId}
                    onChange={(e) => setSimbriefPilotId(e.target.value)}
                    className="w-full bg-black/35 text-white font-mono text-xs px-3 py-2 rounded border border-white/10 focus:outline-none focus:border-[#45AFFF]/50"
                    placeholder="Ej. 249811"
                  />
                  <span className="text-[9px] text-white/40 font-mono block">
                    Utilizado para descargar planes de despacho (OFP) activos con un clic.
                  </span>
                </div>

                {/* Switch de Unidades SimBrief */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/80 font-mono block font-bold uppercase tracking-wider">
                    Unidades SimBrief
                  </label>
                  <div className="flex items-center gap-3 pt-1">
                    {/* Selector Switch representation */}
                    <div className="relative inline-flex items-center bg-black/45 border border-white/15 p-1 rounded-[5px] w-full max-w-[180px]">
                      <button
                        type="button"
                        onClick={() => setSimbriefUnits("KGS")}
                        className={`flex-1 py-1.5 text-center text-xs font-mono font-bold rounded transition-all cursor-pointer ${
                          simbriefUnits === "KGS"
                            ? "bg-[#45AFFF] text-[#00345C]"
                            : "text-white/60 hover:text-white"
                        }`}
                      >
                        KGS (Métrico)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimbriefUnits("LBS")}
                        className={`flex-1 py-1.5 text-center text-xs font-mono font-bold rounded transition-all cursor-pointer ${
                          simbriefUnits === "LBS"
                            ? "bg-[#45AFFF] text-[#00345C]"
                            : "text-white/60 hover:text-white"
                        }`}
                      >
                        LBS (Imperial)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ACTION FOOTER: Guardar | Cancelar */}
            <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={handleCancel}
                className="bg-black/20 hover:bg-[#E600D2]/25 border border-white/10 text-white/80 hover:text-white px-6 py-2.5 rounded-[4px] font-mono font-bold text-xs transition-all uppercase tracking-wider cursor-pointer flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> Cancelar
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="bg-[#43E600] hover:bg-[#43E600]/85 text-slate-900 border border-[#43E600]/50 px-8 py-2.5 rounded-[4px] font-mono font-extrabold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {saving ? "GUARDANDO..." : "Guardar Cambios"}
              </button>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
}
