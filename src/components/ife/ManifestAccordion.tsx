/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Acordeón genérico colapsado por defecto: aloja el manifiesto de
 * pasajeros reubicado bajo el IFE una vez cerradas las puertas.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Users } from "lucide-react";

interface ManifestAccordionProps {
  title: string;
  countLabel: string;
  children: ReactNode;
}

export default function ManifestAccordion({ title, countLabel, children }: ManifestAccordionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div
      id="ife-manifest-accordion"
      className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 shadow-lg overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-white/5 transition-colors cursor-pointer"
      >
        <span className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-[#45AFFF]" /> {title}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-mono bg-[#45AFFF]/15 px-2 py-0.5 rounded text-white/80 border border-white/10">
            {countLabel}
          </span>
          <span className="text-[10px] font-mono uppercase text-white/40 hidden sm:inline">
            {open ? t("ife.manifest.collapse") : t("ife.manifest.expand")}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-white/60 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && <div className="px-4 pb-4 animate-fadeIn">{children}</div>}
    </div>
  );
}
