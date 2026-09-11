import React from "react";
import { CheckCircle, SkipForward, Loader2 } from "lucide-react";
import { NarrativeStep } from "../../scenarios/narrative/NarrativeStep";

export interface StepHistoryEntry {
  step: NarrativeStep;
  index: number;
  mode: "manual" | "auto" | "skipped";
  timestamp: string;
}

interface StepHistoryProps {
  entries: StepHistoryEntry[];
}

export default function StepHistory({ entries }: StepHistoryProps) {
  if (entries.length === 0) {
    return (
      <div className="text-[10px] font-mono text-white/40 italic">
        Sin historial de pasos todavia
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
        Historial
      </span>

      <div className="flex flex-col divide-y divide-white/5 max-h-40 overflow-y-auto">
        {entries.map((entry) => (
          <div
            key={entry.step.eventKey + "-" + entry.index + "-" + entry.timestamp}
            className="flex items-center gap-2 py-1 text-[10px] font-mono"
          >
            {entry.mode === "skipped" ? (
              <SkipForward className="w-3 h-3 text-[#45AFFF]" />
            ) : (
              <CheckCircle className="w-3 h-3 text-[#43E600]" />
            )}

            <span className="text-white/40 shrink-0">
              {entry.index + 1}.
            </span>

            <span
              className={
                entry.mode === "skipped"
                  ? "text-white/45 line-through"
                  : "text-white/85"
              }
            >
              {entry.step.eventKey}
            </span>

            <span
              className={
                entry.mode === "skipped"
                  ? "text-[#45AFFF]/70 ml-auto shrink-0"
                  : "text-[#43E600]/70 ml-auto shrink-0"
              }
            >
              ({entry.mode === "skipped" ? "omitido" : entry.mode})
            </span>

            <span className="text-white/30 shrink-0">{entry.timestamp}</span>
          </div>
        ))}

        {entries.length > 0 && (
          <div className="flex items-center gap-2 py-1 text-[10px] font-mono text-white/35">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>fin del historial</span>
          </div>
        )}
      </div>
    </div>
  );
}
