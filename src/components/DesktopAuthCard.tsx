/**
 * DesktopAuthCard — tarjeta de acceso del desktop (Tauri).
 *
 * Estructura y lógica portadas de la versión web (app.announs.net):
 * login con correo, registro con reglas de contraseña en vivo, recuperación
 * por correo y login con Google. Los mensajes de error se sanitizan con
 * `authErrorKey` (nunca se muestra el texto crudo de Supabase) y la estética
 * conserva el tema azul neón del desktop.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Mail,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  sendPasswordReset,
  signInWithGoogle,
  signUpWithEmail,
} from "../services/desktopAuth";
import { authErrorKey } from "../utils/authErrors";
import { PASSWORD_RULES, isPasswordValid } from "../utils/passwordRules";

type AuthMode = "login" | "signup" | "forgot";

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.2-5.137 4.2a5.7 5.7 0 0 1-5.7-5.7 5.7 5.7 0 0 1 5.7-5.7c2.14 0 3.987.818 5.353 2.15l3.1-3.1C20.35 4.3 16.59 2.5 12.24 2.5a10 10 0 0 0-10 10 10 10 0 0 0 10 10c5.38 0 9.8-3.9 9.8-9.8 0-.6-.05-1.15-.16-1.715h-9.64z"
      />
    </svg>
  );
}

const inputClass =
  "w-full bg-[#00172e] text-white font-mono text-xs pl-9 pr-9 py-2.5 rounded border border-[#3B7EB2]/40 focus:outline-none focus:border-[#45AFFF] transition-all";
const iconWrapClass = "absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none";
const iconClass = "w-3.5 h-3.5 text-[#45AFFF]/60";

export default function DesktopAuthCard({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setErrorKey(null);
    setNotice(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    setNotice(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setErrorKey(authErrorKey(error));
        return;
      }
      onLogin();
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    setNotice(null);
    // Mismas reglas que Supabase, validadas antes de la petición (como en web).
    if (!isPasswordValid(password)) {
      setErrorKey("auth_password_weak");
      return;
    }
    if (password !== confirmPassword) {
      setErrorKey("auth_password_mismatch");
      return;
    }
    setLoading(true);
    try {
      const { confirmEmail, error } = await signUpWithEmail(email.trim(), password);
      if (error) {
        setErrorKey(authErrorKey(error));
        return;
      }
      if (confirmEmail) {
        setNotice(t("login.signup_confirm_notice"));
        return;
      }
      onLogin();
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    setNotice(null);
    setLoading(true);
    try {
      const { error } = await sendPasswordReset(email.trim());
      if (error) {
        setErrorKey(authErrorKey(error));
        return;
      }
      // Supabase no revela si el correo existe (anti-enumeración).
      setNotice(t("login.forgot_sent_notice"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErrorKey(null);
    setNotice(null);
    setLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setErrorKey(authErrorKey(error));
      }
      // Éxito en desktop: el resultado llega por el deep link `onOpenUrl`.
    } finally {
      setLoading(false);
    }
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

        {/* Pestañas login / registro */}
        {mode !== "forgot" && (
          <div className="flex gap-2 bg-[#001b33]/40 p-1 border border-[#3B7EB2]/40 rounded">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-1.5 rounded font-mono font-bold text-[11px] uppercase tracking-widest transition-all cursor-pointer ${
                  mode === m
                    ? "bg-[#45AFFF]/20 text-[#45AFFF] border border-[#45AFFF]/40"
                    : "text-white/50 hover:text-white/80 border border-transparent"
                }`}
              >
                {t(`login.tab_${m}`)}
              </button>
            ))}
          </div>
        )}

        {errorKey && (
          <div role="alert" className="bg-red-900/30 border border-red-500/40 rounded px-3 py-2 text-[11px] font-mono text-red-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
            {t(`login.errors.${errorKey}`)}
          </div>
        )}

        {notice && (
          <div role="status" className="border border-[#43E600]/60 bg-[#43E600]/10 px-3 py-2 text-[11px] font-mono text-white/90 rounded">
            {notice}
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="desktop-email" className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.email_label")}
              </label>
              <div className="relative">
                <span className={iconWrapClass}>
                  <Mail className={iconClass} />
                </span>
                <input
                  id="desktop-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                  placeholder={t("login.email_placeholder")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="desktop-password" className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.password_label")}
              </label>
              <div className="relative">
                <span className={iconWrapClass}>
                  <Lock className={iconClass} />
                </span>
                <input
                  id="desktop-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputClass}
                  placeholder={t("login.password_placeholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t("login.hide_password") : t("login.show_password")}
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

            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-[11px] font-mono text-[#45AFFF]/80 hover:text-[#45AFFF] hover:underline cursor-pointer"
              >
                {t("login.forgot_link")}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#45AFFF] hover:bg-[#45AFFF]/85 active:scale-[0.98] text-[#00345C] border border-[#45AFFF]/30 py-3 rounded font-mono font-extrabold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Spinner /> : <LogIn className="w-4 h-4" />}
              {loading ? t("login.authenticating") : t("login.login_button")}
            </button>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="desktop-signup-email" className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.email_label")}
              </label>
              <div className="relative">
                <span className={iconWrapClass}>
                  <Mail className={iconClass} />
                </span>
                <input
                  id="desktop-signup-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                  placeholder={t("login.email_placeholder")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="desktop-signup-password" className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.password_label")}
              </label>
              <div className="relative">
                <span className={iconWrapClass}>
                  <Lock className={iconClass} />
                </span>
                <input
                  id="desktop-signup-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputClass}
                  placeholder={t("login.password_placeholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t("login.hide_password") : t("login.show_password")}
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
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1" aria-label={t("login.password_rules_label")}>
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password);
                  const Icon = met ? Check : X;
                  return (
                    <li
                      key={rule.id}
                      className={`flex items-center gap-1.5 font-mono text-[11px] ${met ? "text-[#43E600]" : "text-white/50"}`}
                    >
                      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {t(`login.password_rules.${rule.id}`)}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="desktop-signup-confirm" className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.confirm_password_label")}
              </label>
              <div className="relative">
                <span className={iconWrapClass}>
                  <Lock className={iconClass} />
                </span>
                <input
                  id="desktop-signup-confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={12}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className={inputClass}
                  placeholder={t("login.password_placeholder")}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#45AFFF] hover:bg-[#45AFFF]/85 active:scale-[0.98] text-[#00345C] border border-[#45AFFF]/30 py-3 rounded font-mono font-extrabold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Spinner /> : <UserPlus className="w-4 h-4" />}
              {loading ? t("login.signup_creating") : t("login.signup_button")}
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-[11px] text-white/60 font-mono leading-relaxed">
              {t("login.forgot_description")}
            </p>
            <div className="space-y-1.5">
              <label htmlFor="desktop-forgot-email" className="text-[10px] text-white/70 font-mono font-bold uppercase tracking-wider block">
                {t("login.email_label")}
              </label>
              <div className="relative">
                <span className={iconWrapClass}>
                  <Mail className={iconClass} />
                </span>
                <input
                  id="desktop-forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                  placeholder={t("login.email_placeholder")}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#45AFFF] hover:bg-[#45AFFF]/85 active:scale-[0.98] text-[#00345C] border border-[#45AFFF]/30 py-3 rounded font-mono font-extrabold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Spinner /> : <Send className="w-4 h-4" />}
              {loading ? t("login.forgot_sending") : t("login.forgot_button")}
            </button>

            <button
              type="button"
              onClick={() => switchMode("login")}
              className="w-full flex items-center justify-center gap-2 text-[11px] font-mono text-[#45AFFF]/80 hover:text-[#45AFFF] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("login.forgot_back")}
            </button>
          </form>
        )}

        {mode !== "forgot" && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-[1px] bg-white/10"></div>
              <span className="text-[9px] text-white/40 font-mono uppercase tracking-widest whitespace-nowrap">{t("login.or_continue_with")}</span>
              <div className="flex-1 h-[1px] bg-white/10"></div>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogle}
              className="w-full bg-[#00172e]/60 hover:bg-[#00345C]/50 border border-[#3B7EB2]/40 hover:border-[#45AFFF]/40 text-white py-3 rounded font-mono font-bold text-xs transition-all uppercase tracking-widest cursor-pointer shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Spinner /> : <GoogleIcon />}
              {loading ? t("login.authenticating") : t("login.google_button")}
            </button>
          </>
        )}

        <div className="text-[9px] text-white/45 font-mono text-center pt-2 leading-relaxed">
          {t("login.disclaimer")}
        </div>
      </div>
    </div>
  );
}
