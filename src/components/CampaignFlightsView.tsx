/**
 * CampaignFlightsView — pestaña "Campañas" del HUB.
 *
 * Colección de tarjetas con los vuelos de campaña finalizados del usuario
 * (`flight_status = 'ended'`), de más recientes a más antiguos. Cada tarjeta
 * replica la proporción imagen + información de la tarjeta de campaña de la
 * pantalla Volar, y agrega los resultados del vuelo: puntos ganados y
 * experiencia de los pasajeros.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Heart, Users, Loader2 } from "lucide-react";
import type { VueloReciente } from "../types";
import {
  formatMultiplier,
  loadCampaignFlightHistory,
  type CampaignFlightHistoryEntry,
} from "../services/CampaignService";

interface CampaignFlightsViewProps {
  onBack: () => void;
  onOpenFlight: (flight: VueloReciente) => void;
}

function formatFlightDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(locale.startsWith("es") ? "es-ES" : "en-US", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Número de vuelo completo (código + número, sin duplicar si ya viene junto). */
function formatFullFlightNumber(airlineCode: string, flightNumber: string): string {
  const code = (airlineCode || "").trim().toUpperCase();
  const num = (flightNumber || "").trim().toUpperCase();
  if (!num || num === "—") return code || "—";
  if (code && num.startsWith(code)) return num;
  if (code) return `${code}${num}`;
  return num;
}

export default function CampaignFlightsView({ onBack, onOpenFlight }: CampaignFlightsViewProps) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<CampaignFlightHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadCampaignFlightHistory();
      if (cancelled) return;
      if (res.success) {
        setEntries(res.data);
        setError(null);
      } else {
        setEntries([]);
        setError(res.error ?? t("hub.campaigns.error"));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openDetail = (entry: CampaignFlightHistoryEntry) => {
    onOpenFlight({
      id: entry.flightId,
      flightId: entry.flightId,
      codigo: entry.flightNumber,
      origen: entry.originIcao,
      origenCiudad: entry.originIcao,
      destino: entry.destinationIcao,
      destinoCiudad: entry.destinationIcao,
      fecha: formatFlightDate(entry.createdAt, i18n.language),
      fpmLanding: 0,
      satisfaccionMedia: entry.globalSatisfaction ?? 0,
      puntuacion: entry.totalXp ?? 0,
      duracion: "—",
      aerolinea: entry.campaignTitle,
    });
  };

  return (
    <div id="campaign-flights-section" className="space-y-4">
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <Trophy className="w-4 h-4 text-[#E68B00]" />
        <h3 className="text-sm font-mono text-[#E68B00] uppercase tracking-wider">
          {t("hub.campaigns.title")}
        </h3>
        {entries !== null && (
          <span className="text-[11px] font-mono text-white/40">
            {t("hub.campaigns.count", { count: entries.length })}
          </span>
        )}
      </div>

      {entries === null ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-[#E68B00] animate-spin" />
        </div>
      ) : error ? (
        <p className="py-4 px-3 text-center text-[11px] font-mono text-red-300">{error}</p>
      ) : entries.length === 0 ? (
        <div className="py-8 px-3 text-center">
          <p className="text-xs font-mono text-white/40 italic">
            {t("hub.campaigns.empty")}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-3 px-4 py-2 rounded-[5px] text-[11px] font-mono font-bold text-[#45AFFF] border border-[#45AFFF]/40 bg-[#45AFFF]/15 hover:bg-[#45AFFF]/30 transition-all cursor-pointer"
          >
            {t("hub.campaigns.back")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {entries.map((entry) => (
            <div
              key={entry.flightId}
              role="button"
              tabIndex={0}
              aria-label={t("hub.campaigns.aria", { campaign: entry.campaignTitle, origin: entry.originIcao, dest: entry.destinationIcao })}
              title={t("hub.campaigns.open_tooltip")}
              onClick={() => openDetail(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetail(entry);
                }
              }}
              className="relative bg-black/25 border border-[#E68B00]/40 rounded-[5px] overflow-hidden flex flex-col cursor-pointer hover:border-[#E68B00] transition-colors"
            >
              {entry.campaignImageUrl && (
                <img
                  src={entry.campaignImageUrl}
                  alt={entry.campaignTitle}
                  loading="lazy"
                  className="w-full h-32 object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <div className="p-4 flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-sans font-black text-white uppercase">
                    {entry.campaignTitle}
                  </div>
                  {entry.xpMultiplier !== null && entry.xpMultiplier > 1 && (
                    <span className="shrink-0 bg-[#E68B00]/15 border border-[#E68B00]/50 rounded-[4px] px-2 py-0.5 font-mono font-extrabold text-[11px] text-[#E68B00]">
                      {formatMultiplier(entry.xpMultiplier)} XP
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-mono font-extrabold text-[#45AFFF]">
                    {entry.originIcao} → {entry.destinationIcao}
                  </div>
                  <div className="text-xs font-mono font-bold text-white/85 whitespace-nowrap">
                    {formatFlightDate(entry.createdAt, i18n.language)}
                  </div>
                </div>
                {(entry.originName || entry.destinationName) && (
                  <div className="text-[11px] font-sans text-white/50 leading-snug">
                    {entry.originName || entry.originIcao} → {entry.destinationName || entry.destinationIcao}
                  </div>
                )}
                {(entry.airlineCode || entry.aircraftIcao) && (
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {entry.airlineCode && (
                      <div className="flex flex-col">
                        <span className="text-[11px] font-mono font-bold text-white/85">
                          {formatFullFlightNumber(entry.airlineCode, entry.flightNumber)}
                        </span>
                        {entry.airlineName && (
                          <span className="text-[11px] font-sans text-white/50 leading-snug">{entry.airlineName}</span>
                        )}
                      </div>
                    )}
                    {entry.aircraftIcao && (
                      <div className="flex flex-col">
                        <span className="text-[11px] font-mono font-bold text-white/85">{entry.aircraftIcao}</span>
                        {entry.aircraftName && (
                          <span className="text-[11px] font-sans text-white/50 leading-snug">{entry.aircraftName}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="border-t border-white/10 mt-1 pt-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-white/60 flex items-center gap-1.5">
                      <Trophy className="w-3 h-3 text-[#E68B00]" />
                      {t("hub.campaigns.points")}
                    </span>
                    <span className="font-mono text-xs font-extrabold text-[#43E600]">
                      {entry.totalXp === null ? "—" : `+${entry.totalXp.toLocaleString("en-US")} XP`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-white/60 flex items-center gap-1.5">
                      <Heart className="w-3 h-3 text-[#E600D2]" />
                      {t("hub.campaigns.pax_satisfaction")}
                    </span>
                    <span className="font-mono text-xs font-bold text-white">
                      {entry.globalSatisfaction === null ? "—" : `${Math.round(entry.globalSatisfaction)}%`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-white/60 flex items-center gap-1.5">
                      <Users className="w-3 h-3 text-[#45AFFF]" />
                      {t("hub.campaigns.pax_xp")}
                    </span>
                    <span className="font-mono text-xs font-bold text-white">
                      {entry.passengerXpAwarded === null
                        ? "—"
                        : `+${entry.passengerXpAwarded.toLocaleString("en-US")} XP`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
