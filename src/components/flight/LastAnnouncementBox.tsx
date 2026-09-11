import React from "react";
import { Radio } from "lucide-react";
import { AnnouncementInfo } from "../../types";

interface LastAnnouncementBoxProps {
  announcement: AnnouncementInfo | null;
  isPlaying: boolean;
  isGenerating: boolean;
  getSpeakerName: (role: string) => string;
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case "captain":
      return "Capitán";
    case "crew":
      return "Tripulación de Cabina";
    case "gate":
      return "Agente de Puerta";
    default:
      return "Desconocido";
  }
}

/**
 * Muestra el último anuncio REAL generado/reproducido (datos de la Edge
 * Function `audio-get`), en lugar de datos mockeados. Si no hay anuncio,
 * muestra un mensaje informativo.
 */
export default function LastAnnouncementBox({
  announcement,
  isPlaying,
  isGenerating,
  getSpeakerName,
}: LastAnnouncementBoxProps) {
  return (
    <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-3">
      <div className="flex justify-between items-center border-b border-white/10 pb-2">
        <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-1.5 font-bold">
          <Radio className="w-4 h-4 text-[#43E600]" /> Último anuncio
        </h3>
      </div>

      <div className="bg-black/45 p-3.5 rounded-[5px] border border-[#3B7EB2]/30 text-xs font-sans relative overflow-hidden">
        <div className="absolute top-1 right-2 animate-pulse flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isPlaying ? "bg-[#43E600]" : isGenerating ? "bg-yellow-400" : "bg-white/20"
            }`}
          />
          <span className="text-[8px] font-mono text-white/30">
            {isPlaying ? "ON AIR" : isGenerating ? "GENERATING" : "MUTED"}
          </span>
        </div>

        <p className="text-white/95 italic leading-relaxed pt-1.5 font-medium min-h-[2.5rem]">
          {announcement?.text
            ? `"${announcement.text}"`
            : isGenerating
              ? "Generando anuncio..."
              : "Sin anuncios recientes"}
        </p>

        {announcement && (
          <div className="mt-3 pt-2.5 border-t border-white/15 flex justify-between items-center text-[9.5px] font-mono text-white/50">
            <span>
              NARRACIÓN:{" "}
              <strong className="text-white font-bold">
                {getSpeakerName(announcement.speaker_role)}
              </strong>
            </span>
            <span className="text-[#45AFFF] uppercase font-black text-[8px] tracking-wider bg-[#45AFFF]/10 px-1.5 py-0.5 rounded border border-[#45AFFF]/20">
              {roleLabel(announcement.speaker_role)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
