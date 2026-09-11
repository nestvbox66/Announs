import React from "react";
import { AnnouncementInfo } from "../../types";

interface VoiceIndicatorProps {
  announcement: AnnouncementInfo | null;
  isPlaying: boolean;
  getSpeakerName: (role: string) => string;
}

interface ChannelDef {
  role: "captain" | "crew" | "gate";
  label: string;
  badge: string;
  color: string;
  icon: string;
}

const CHANNELS: ChannelDef[] = [
  { role: "captain", label: "Comandante", badge: "Capitán", color: "#2563eb", icon: "🎙️" },
  { role: "crew", label: "Jefe de Tripulación", badge: "Tripulación", color: "#16a34a", icon: "🎤" },
  { role: "gate", label: "Agente de Puerta", badge: "Agente de Puerta", color: "#ea580c", icon: "📢" },
];

/**
 * Canales de voz según el speaker_role del anuncio real en reproducción:
 *  - captain: 🎙️ azul
 *  - crew:    🎤 verde
 *  - gate:    📢 naranja
 * El canal cuyo rol coincide con el anuncio actual se ilumina en tiempo real.
 */
export default function VoiceIndicator({
  announcement,
  isPlaying,
  getSpeakerName,
}: VoiceIndicatorProps) {
  return (
    <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-4 text-white">
      <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider border-b border-white/10 pb-2 font-bold">
        Canales de Voz de Tripulación
      </h3>

      <div className="space-y-3">
        {CHANNELS.map((ch) => {
          const active = isPlaying && announcement?.speaker_role === ch.role;
          return (
            <div
              key={ch.role}
              className="p-3 rounded-[5px] border transition-all duration-300 flex items-center justify-between"
              style={
                active
                  ? {
                      borderColor: ch.color,
                      backgroundColor: `${ch.color}1a`,
                      boxShadow: `0 0 15px ${ch.color}40`,
                    }
                  : {
                      borderColor: "rgba(255,255,255,0.05)",
                      backgroundColor: "rgba(0,0,0,0.25)",
                    }
              }
            >
              <div className="flex items-center gap-3">
                <div
                  className="p-2 rounded-full relative transition-colors duration-300"
                  style={
                    active
                      ? { backgroundColor: `${ch.color}33`, color: ch.color }
                      : { backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }
                  }
                >
                  <span className="text-sm leading-none">{ch.icon}</span>
                  {active && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-ping"
                      style={{ backgroundColor: ch.color }}
                    />
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-mono text-white/45 block uppercase font-bold">
                    {ch.label}
                  </span>
                  <span
                    className="text-[12px] font-sans font-black tracking-wide"
                    style={active ? { color: ch.color } : { color: "#ffffff" }}
                  >
                    {getSpeakerName(ch.role)}
                  </span>
                </div>
              </div>
              <span
                className="text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider"
                style={
                  active
                    ? { backgroundColor: ch.color, color: "#000000" }
                    : { backgroundColor: "rgba(0,0,0,0.4)", color: "rgba(255,255,255,0.3)" }
                }
              >
                {active ? "Hablando" : "A la escucha"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
