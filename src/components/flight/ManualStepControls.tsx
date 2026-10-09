import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Play, SkipForward } from "lucide-react";
import { NarrativeStep } from "../../scenarios/narrative/NarrativeStep";

interface ManualStepControlsProps {
  step: NarrativeStep | null;
  index: number;
  total: number;
  displayName: string;
  onNext: () => void;
  onSkip: () => void;
  busy: boolean;
}

export default function ManualStepControls({
  step,
  index,
  total,
  displayName,
  onNext,
  onSkip,
  busy,
}: ManualStepControlsProps) {
  const { t } = useTranslation();

  // El efecto va ANTES de cualquier return anticipado (Rules of Hooks):
  // antes, cuando `step` pasaba de null a objeto, cambiaba el orden de
  // hooks entre renders y React rompía ("Rendered more hooks...").
  useEffect(() => {
    if (!step) return;
    console.log(
      `[ManualStepControls] Botón: "Siguiente paso" (paso pendiente: ${step.eventKey}, ${Math.min(index + 1, total)}/${total})`
    );
  }, [step, index, total]);

  if (!step) {
    return (
      <div className="text-[10px] font-mono text-white/40 italic">
        {t("manual_step.none")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-mono font-extrabold tracking-widest text-[#45AFFF]/80 uppercase">
          {t("manual_step.next_label")}
        </span>
        <span className="text-[11px] font-mono text-white font-bold">
          {step.eventKey}
          {displayName ? (
            <span className="text-white/50 font-normal"> ({displayName})</span>
          ) : null}
        </span>
        <span className="text-[10px] font-mono text-white/55">
          {t("manual_step.step_of", { current: Math.min(index + 1, total), total })}
          {step.optional ? (
            <span className="text-[#45AFFF]/80">{t("manual_step.optional")}</span>
          ) : null}
          <span className="text-[#43E600]/80">{t("manual_step.pending")}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            console.log(
              `[ManualStepControls] Usuario hizo clic en "Siguiente paso" (${step.eventKey})`
            );
            onNext();
          }}
          disabled={busy}
          className="bg-[#43E600] hover:bg-[#3cd000] disabled:bg-[#43E600]/40 disabled:cursor-not-allowed text-black font-black px-4 py-1.5 rounded-[5px] text-[11px] font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer text-center"
        >
          <Play className="w-3 h-3 fill-black" strokeWidth={3} />
          {t("manual_step.next_btn")}
        </button>

        {step.optional && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="bg-[#002440] hover:bg-[#00345C] disabled:bg-[#002440]/50 disabled:cursor-not-allowed text-white/80 hover:text-white border border-[#3B7EB2]/45 px-3 py-1.5 rounded-[5px] text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <SkipForward className="w-3 h-3" />
            {t("manual_step.skip_btn")}
          </button>
        )}
      </div>
    </div>
  );
}
