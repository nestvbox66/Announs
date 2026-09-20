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
  Terminal,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import ConnectionStatus from "./flight/ConnectionStatus";
import type { FlightController } from "../services/FlightController";
import { APP_VERSION } from "../version";

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  isConnected: boolean;
  activeFlightCode?: string;
  copilotVolume: number;
  isLoggedIn?: boolean;
  flightController?: FlightController | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export default function Sidebar({
  currentView,
  onViewChange,
  isConnected,
  activeFlightCode = "",
  copilotVolume,
  isLoggedIn = false,
  flightController = null,
  collapsed = false,
  onToggleCollapsed,
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
      className={`${collapsed ? "w-16" : "w-72"} bg-[#002440] border-r border-[#3B7EB2] flex flex-col justify-between h-screen sticky top-0 shrink-0 select-none z-10 transition-all duration-300`}
    >
      {/* Upper Branding Area */}
      <div>
        <div id="brand-logo-area" className={`border-b border-[#3B7EB2]/50 flex flex-col items-center justify-center ${collapsed ? "py-3" : "p-6"}`}>
          {!collapsed && (
            <img 
              src={logoImg} 
              alt="Announs Logo" 
              className="w-48 h-auto object-contain filter brightness-110 contrast-105"
              id="announs-logo-img"
              referrerPolicy="no-referrer"
            />
          )}
          {/* Toggle expandir/colapsar */}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              id="sidebar-toggle"
              title={collapsed ? "Expandir menú" : "Colapsar menú"}
              className={`${collapsed ? "" : "mt-3"} flex items-center justify-center w-7 h-7 rounded hover:bg-white/10 text-[#45AFFF]/70 hover:text-white transition-colors cursor-pointer`}
            >
              {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <nav id="sidebar-navigation" className={`space-y-2 ${collapsed ? "p-2 mt-2 flex flex-col items-center" : "p-4 mt-4"}`}>
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => onViewChange(item.id)}
                title={collapsed ? item.label : undefined}
                className={`${collapsed ? "justify-center w-11 px-0" : "justify-start w-full px-4"} flex items-center gap-4 py-3 rounded-none text-xs font-bold tracking-wider uppercase transition-all duration-200 border-y border-transparent border-l-2 ${
                  isActive
                    ? "bg-[#45AFFF]/10 border-l-[#45AFFF] text-[#45AFFF] font-black"
                    : "bg-transparent text-[#45AFFF]/70 hover:text-white hover:bg-[#2C6591]/20 border-l-transparent"
                }`}
              >
                <IconComponent 
                  className={`w-4 h-4 transition-transform duration-300 shrink-0 ${
                    isActive ? "scale-110 text-[#43E600]" : "text-[#45AFFF]"
                  }`} 
                />
                {!collapsed && <span className="tracking-widest">{item.label}</span>}
                {!collapsed && isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#43E600] animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Status Panel - Estado de conexión con simuladores */}
      <div className={`border-t border-[#3B7EB2]/50 bg-[#001b33]/60 ${collapsed ? "px-0 py-2" : "p-4"}`}>
        <ConnectionStatus flightController={flightController} compact={collapsed} />

        {!collapsed && (
          <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-mono text-[#45AFFF]/50">
            <Terminal className="w-3 h-3" />
            <span>Announs Desktop. v{APP_VERSION}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
