/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";
import { AnnouncementInfo } from "../../types";

interface AnnouncementPanelV2Props {
  announcement: AnnouncementInfo | null;
  isPlaying: boolean;
  isGenerating: boolean;
  generatingError?: string | null;
  getSpeakerName: (role: string) => string;
  className?: string;
}

interface VoiceChannelDef {
  role: "captain" | "crew" | "gate";
  labelKey: string;
}

const VOICE_CHANNELS: VoiceChannelDef[] = [
  { role: "captain", labelKey: "flight_view.commander" },
  { role: "crew", labelKey: "flight_view.crew_chief" },
  { role: "gate", labelKey: "flight_view.role_gate" },
];

/**
 * Sandbox V2: tarjeta grande de último anuncio con transcripción amplia y
 * barra horizontal de canales de voz justo debajo. No se usa en producción.
 */
export default function AnnouncementPanelV2({
  announcement,
  isPlaying,
  isGenerating,
  generatingError,
  getSpeakerName,
  className = "",
}: AnnouncementPanelV2Props) {
  const { t } = useTranslation();

  const roleLabel = (role: string | undefined): string => {
    switch (role) {
      case "captain":
        return t("flight_view.role_captain");
      case "crew":
        return t("flight_view.role_crew");
      default:
        return t("flight_view.role_gate");
    }
  };

  const status = isPlaying
    ? {
        label: t("flight_view.on_air"),
        text: "text-[#E600D2]",
        dot: "bg-[#E600D2]",
      }
    : isGenerating
      ? {
          label: t("flight_view.generating"),
          text: "text-[#E68B00]",
          dot: "bg-[#E68B00]",
        }
      : {
          label: t("flight_view.muted"),
          text: "text-white/40",
          dot: "bg-white/25",
        };

  const activeRole = announcement?.speaker_role;

  return (
    <div
      className={`bg-[#001d35]/80 border border-[#3B7EB2]/50 rounded-[5px] shadow-xl flex flex-col overflow-hidden min-h-[300px] ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#3B7EB2]/30 px-5 py-2.5">
        <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2 font-bold min-w-0">
          <Radio className="w-4 h-4 text-[#E600D2] shrink-0" />
          <span className="truncate">{t("flight_view.last_announcement")}</span>
        </h3>
        <span
          className={`flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-widest shrink-0 ${status.text}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${isPlaying ? "animate-pulse" : ""}`} />
          {status.label}
        </span>
      </div>

      <div className="flex-1 min-h-[140px] mx-4 mt-3 mb-3 rounded-[5px] border border-[#3B7EB2]/35 bg-black/45 p-4 flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
        <p
          aria-live="polite"
          className="flex-1 min-h-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed font-mono text-white/95"
        >
          {generatingError ? (
            <span className="text-red-400">{generatingError}</span>
          ) : announcement?.text ? (
            `"${announcement.text}"`
          ) : isGenerating ? (
            <span className="text-white/60">{t("flight_view.generating_announcement")}</span>
          ) : (
            <span className="text-white/35">{t("flight_view.no_recent_announcements")}</span>
          )}
        </p>

        {announcement && (
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-3 text-[9.5px] font-mono text-white/50 shrink-0">
            <span className="truncate">
              {t("flight_view.narration")}{" "}
              <strong className="text-white font-bold">{getSpeakerName(announcement.speaker_role)}</strong>
            </span>
            <span className="text-[#45AFFF] uppercase font-black text-[8px] tracking-wider bg-[#45AFFF]/10 px-1.5 py-0.5 rounded border border-[#45AFFF]/20 shrink-0">
              {roleLabel(announcement.speaker_role)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 px-4 pb-3" role="list" aria-label={t("flight_view.crew_channels")}>
        {VOICE_CHANNELS.map((channel) => {
          const isActive = activeRole === channel.role;
          const isSpeaking = isActive && isPlaying;

          return (
            <div
              key={channel.role}
              role="listitem"
              title={`${t(channel.labelKey)}: ${getSpeakerName(channel.role)}`}
              className={`relative flex items-center justify-center gap-1.5 border rounded-[4px] px-2 py-1.5 transition-colors duration-300 ${
                isActive
                  ? "border-[#E600D2] bg-[#E600D2]/15 text-[#E600D2] shadow-[0_0_12px_rgba(230,0,210,0.25)]"
                  : "border-[#3B7EB2]/40 bg-[#001224]/70 text-white/55 hover:border-[#45AFFF]/60 hover:text-white/80"
              }`}
            >
              {isActive && (
                <span className="relative flex w-1.5 h-1.5 shrink-0">
                  {isSpeaking && (
                    <span className="absolute inline-flex w-full h-full rounded-full bg-[#E600D2] opacity-75 animate-ping" />
                  )}
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#E600D2]" />
                </span>
              )}
              <span className="text-[11px] font-sans font-bold tracking-wide truncate">
                {getSpeakerName(channel.role)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
