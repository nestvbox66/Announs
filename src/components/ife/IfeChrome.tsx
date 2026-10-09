/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chrome compartido del IFE (topbar de estado + barra inferior de
 * hardware). Ambas pantallas (welcome y home) lo reutilizan para que la
 * "cromática" de sistema operativo sea idéntica. Estilo editorial plano.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Search,
  Bell,
  Settings,
  MoreHorizontal,
  Sun,
  Power,
  Minus,
  Volume2,
  Plus,
  Menu,
  Home,
  ArrowRight,
} from "lucide-react";

/** Marca mostrada en el centro de la topbar (nombre propio, no traducible). */
export const IFE_BRAND = "Announs IFE";

interface IfeTopBarProps {
  /** Contenido de la zona izquierda (logo, o hamburguesa/home/atrás). */
  left: ReactNode;
  /** Texto de tiempo remanente ya traducido (p. ej. "1h 43m Remaining"). */
  remaining: string;
}

/** Botón de icono de la topbar (18px, blanco 70% → 100%). */
export function IfeTopIconButton({
  icon: Icon,
  label,
  onClick,
  size = 18,
}: {
  icon: typeof Menu;
  label: string;
  onClick?: () => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="text-white/70 hover:text-white transition-colors cursor-pointer"
    >
      <Icon style={{ width: size, height: size }} strokeWidth={1.75} />
    </button>
  );
}

export function IfeTopBar({ left, remaining }: IfeTopBarProps) {
  const { t } = useTranslation();
  return (
    <header
      className="relative h-12 shrink-0 flex items-center justify-between px-4"
      style={{ backgroundColor: "rgba(15,20,35,0.85)", backdropFilter: "blur(6px)" }}
    >
      <div className="flex items-center gap-4">{left}</div>

      <span
        className="absolute left-1/2 -translate-x-1/2 text-white uppercase select-none"
        style={{ fontSize: 13, letterSpacing: "0.22em", fontWeight: 600 }}
      >
        {IFE_BRAND}
      </span>

      <div className="flex items-center gap-4">
        <span
          className="flex items-center gap-1.5 text-white/80"
          style={{ fontSize: 13, fontWeight: 400 }}
        >
          <Clock className="w-[18px] h-[18px]" strokeWidth={1.75} />
          {remaining}
        </span>
        <IfeTopIconButton icon={Search} label="Search" />
        <IfeTopIconButton icon={Bell} label="Notifications" />
        <IfeTopIconButton icon={Settings} label={t("ife.menu.settings")} />
      </div>
    </header>
  );
}

export function IfeBottomBar() {
  const icons = [MoreHorizontal, Sun, Power, Minus, Volume2, Plus, Menu, Home, ArrowRight];
  return (
    <footer
      className="h-14 shrink-0 flex items-center justify-center gap-7"
      style={{ backgroundColor: "#0A0A0A" }}
    >
      {icons.map((Icon, i) => (
        <Icon key={i} className="w-4 h-4 text-white/40" strokeWidth={1.75} />
      ))}
    </footer>
  );
}
