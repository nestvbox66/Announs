/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { useTranslation } from "react-i18next";
// @ts-ignore
import logoImg from "./Announs Logo.png";
import { 
  User, 
  Settings, 
  Plane, 
  Users, 
  Wifi, 
  WifiOff, 
  Activity,
  Terminal,
  Volume2
} from "lucide-react";

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  isConnected: boolean;
  activeFlightCode?: string;
  copilotVolume: number;
  isLoggedIn?: boolean;
}

export default function Sidebar({
  currentView,
  onViewChange,
  isConnected,
  activeFlightCode = "AR1842",
  copilotVolume,
  isLoggedIn = false
}: SidebarProps) {
  const { t } = useTranslation();
  const menuItems = isLoggedIn 
    ? [
        { id: "hub", label: t("sidebar.hub"), icon: User },
        { id: "vuelo", label: t("sidebar.vuelo"), icon: Plane },
        { id: "config", label: t("sidebar.config"), icon: Settings },
      ]
    : [
        { id: "hub", label: t("sidebar.hub"), icon: User },
      ];

  return (
    <aside 
      id="sidebar-container"
      className="w-72 bg-[#002440] border-r border-[#3B7EB2] flex flex-col justify-between h-screen sticky top-0 shrink-0 select-none z-10"
    >
      {/* Upper Branding Area */}
      <div>
        <div id="brand-logo-area" className="p-6 border-b border-[#3B7EB2]/50 flex flex-col items-center justify-center">
          <div className="flex items-center justify-center mb-2">
            <img 
              src={logoImg} 
              alt="Announs Logo" 
              className="w-48 h-auto object-contain filter brightness-110 contrast-105"
              id="announs-logo-img"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>

        {/* Navigation Items */}
        <nav id="sidebar-navigation" className="p-4 space-y-2 mt-4">
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => onViewChange(item.id)}
                className={`w-full flex items-center gap-4 px-4 py-3 rounded-none text-xs font-bold tracking-wider uppercase transition-all duration-200 border-y border-transparent border-l-2 ${
                  isActive
                    ? "bg-[#45AFFF]/10 border-l-[#45AFFF] text-[#45AFFF] font-black"
                    : "bg-transparent text-[#45AFFF]/70 hover:text-white hover:bg-[#2C6591]/20 border-l-transparent"
                }`}
              >
                <IconComponent 
                  className={`w-4 h-4 transition-transform duration-300 ${
                    isActive ? "scale-110 text-[#43E600]" : "text-[#45AFFF]"
                  }`} 
                />
                <span className="tracking-widest">{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#43E600] animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Status Panel - Custom Design with Glasses and Borders */}
      <div className="p-4 border-t border-[#3B7EB2]/50 bg-[#001b33]/60">
        <div id="sim-status-card" className="bg-[#2C6591]/20 border border-white/20 rounded-[5px] p-3 text-xs mb-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-white/70">CONEXIÓN AL SIMULADOR:</span>
            {isConnected ? (
              <span className="flex items-center gap-1.5 text-[#43E600] font-bold">
                <Wifi className="w-3.5 h-3.5" />
                CONECTADO
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[#E68B00] font-bold">
                <WifiOff className="w-3.5 h-3.5" />
                DESCONECTADO
              </span>
            )}
          </div>
          
          <div className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] text-white/90 font-mono">
            <span>MSFS 2020</span>
          </div>
        </div>

        {/* Application Credits/Version info */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-mono text-[#45AFFF]/50">
          <Terminal className="w-3 h-3" />
          <span>Announs Desktop. v.0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
