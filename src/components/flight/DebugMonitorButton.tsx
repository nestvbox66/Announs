/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DebugMonitorButton — botón pequeño que abre el Monitor de variables.
 */

import React from "react";
import { Search, BarChart3 } from "lucide-react";

interface DebugMonitorButtonProps {
  onClick: () => void;
  variant?: "icon" | "full";
  className?: string;
}

export default function DebugMonitorButton({ onClick, variant = "full", className = "" }: DebugMonitorButtonProps) {
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Abrir monitor de variables"
        title="Monitor de variables (depuración)"
        className={`inline-flex items-center justify-center w-8 h-8 rounded-[5px] bg-[#002440]/60 border border-[#3B7EB2]/40 text-[#45AFFF] hover:bg-[#00345C] hover:text-white hover:border-[#45AFFF]/50 transition-all ${className}`}
      >
        <Search className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir monitor de variables"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-[#002440]/60 border border-[#3B7EB2]/40 text-[#45AFFF] hover:bg-[#00345C] hover:text-white hover:border-[#45AFFF]/50 transition-all text-[11px] font-mono font-bold uppercase tracking-wider ${className}`}
    >
      <BarChart3 className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Monitor</span>
      <span className="sm:hidden">🔍</span>
    </button>
  );
}

// Variante compacta con emoji según spec (opcional)
export function DebugMonitorButtonEmoji({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded bg-[#00172e]/80 border border-[#3B7EB2]/30 text-white/70 hover:text-white hover:border-[#45AFFF]/40 transition-colors text-xs font-mono ${className}`}
    >
      <span>🔍</span> Monitor
    </button>
  );
}
