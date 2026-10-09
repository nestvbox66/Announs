/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portada inmersiva del IFE (estilo "Welcome Aboard", lenguaje Oryx One):
 * mismo contenedor 16:9 y chrome que el home, tarjetas planas oscuras con
 * acento magenta y CTA flat. Interior compactado para caber en el
 * presupuesto de ~402px de área de contenido.
 */
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Plane, Armchair, CalendarClock, MapPin, Play } from "lucide-react";
import type { IfeFlightInfo, IfeGuest } from "./IfeTypes";
import { IfeTopBar, IfeBottomBar } from "./IfeChrome";
import fondoIfe from "../../assets/FondoIFE.jpg";

const MAGENTA = "#C92C5D";
const CARD_DARK = "rgba(20,25,45,0.75)";

interface IfeWelcomeProps {
  flight: IfeFlightInfo;
  guest: IfeGuest | null;
  onStart: () => void;
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p
      className="uppercase truncate"
      style={{ fontSize: 10, letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)", fontWeight: 400 }}
    >
      {children}
    </p>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Plane;
  label: string;
  value: string;
}) {
  return (
    <div className="p-3 flex items-center gap-2.5" style={{ backgroundColor: CARD_DARK, height: 56 }}>
      <Icon className="w-[18px] h-[18px] text-white/80 shrink-0" strokeWidth={1.5} />
      <div className="min-w-0">
        <Label>{label}</Label>
        <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 400 }}>
          {value}
        </p>
      </div>
    </div>
  );
}

export default function IfeWelcome({ flight, guest, onStart }: IfeWelcomeProps) {
  const { t } = useTranslation();
  const firstName = guest?.name ? guest.name.split(" ")[0] : null;
  const greeting = firstName
    ? t("ife.welcome.greeting_named", { name: firstName })
    : t("ife.welcome.greeting_generic");
  const remaining = t("ife.menu.remaining", { time: flight.remainingLabel });

  return (
    <div
      id="ife-welcome"
      className="relative w-full aspect-video overflow-hidden bg-black animate-fadeIn"
      style={{ fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }}
    >
      {/* Fondo (imagen actual, sin cambios) */}
      <img
        src={fondoIfe}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: "center 30%" }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.32) 45%, rgba(0,0,0,0.66) 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col w-full h-full">
        <IfeTopBar
          remaining={remaining}
          left={
            <img
              src={flight.logoUrl}
              alt={flight.airlineName}
              className="h-8 w-auto max-w-[130px] object-contain bg-white/95 px-2 py-1 rounded-[2px]"
            />
          }
        />

        {/* Contenido principal (compacto: 24px horiz, 16px vert) */}
        <main className="flex-1 min-h-0 flex flex-col px-6 pt-4 pb-4">
          {/* Top section: aeronave + bienvenida */}
          <div className="text-left">
            <Label>{flight.aircraftName || flight.airlineName}</Label>
            <h1
              className="mt-1 mb-3 leading-tight text-white"
              style={{ fontSize: 24, fontWeight: 300, letterSpacing: "0.02em" }}
            >
              {greeting}
            </h1>
          </div>

          {/* Bottom section: 2 columnas (contenido | CTA) */}
          <div className="mt-3 grid grid-cols-[1fr_340px] gap-6 items-center">
            {/* LEFT COLUMN */}
            <div>
              {/* Row 1: ROUTE (ancha) */}
              <div
                className="p-3 flex flex-col justify-center"
                style={{ backgroundColor: CARD_DARK, borderLeft: `2px solid ${MAGENTA}`, height: 68 }}
              >
                <p
                  className="uppercase flex items-center gap-1.5"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    color: "rgba(255,255,255,0.5)",
                    fontWeight: 400,
                  }}
                >
                  <MapPin className="w-[14px] h-[14px] text-white/80" strokeWidth={1.5} />
                  {t("ife.welcome.card_route")}
                </p>
                <p className="mt-0.5 text-white leading-tight" style={{ fontSize: 18, fontWeight: 300 }}>
                  {flight.originIcao} <span style={{ color: MAGENTA }}>→</span> {flight.destIcao}
                </p>
              </div>

              {/* Row 2: FLIGHT NO. | SEAT */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <InfoCard
                  icon={Plane}
                  label={t("ife.welcome.card_flight")}
                  value={flight.flightNumber}
                />
                <InfoCard
                  icon={Armchair}
                  label={t("ife.welcome.card_seat")}
                  value={guest ? guest.seat : "—"}
                />
              </div>

              {/* Row 3: DEPARTURE | ARRIVAL */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <InfoCard
                  icon={CalendarClock}
                  label={`${flight.originIcao} · ${t("ife.welcome.departure")}`}
                  value={flight.departureLocal}
                />
                <InfoCard
                  icon={CalendarClock}
                  label={`${flight.destIcao} · ${t("ife.welcome.arrival")}`}
                  value={flight.arrivalLocal}
                />
              </div>
            </div>

            {/* RIGHT COLUMN: CTA (propia columna de grid, sin overlap) */}
            <div className="flex justify-center items-center h-full">
              <button
                type="button"
                id="ife-btn-start"
                onClick={onStart}
                className="relative text-white uppercase flex items-center justify-center gap-2 cursor-pointer transition-all hover:brightness-110 active:brightness-95"
                style={{
                  backgroundColor: MAGENTA,
                  width: 180,
                  height: 44,
                  borderRadius: 2,
                  fontSize: 12,
                  letterSpacing: "0.15em",
                  fontWeight: 500,
                }}
              >
                <Play className="w-3.5 h-3.5 text-white" strokeWidth={2} fill="white" />
                {t("ife.welcome.start")}
              </button>
            </div>
          </div>
        </main>

        <IfeBottomBar />
      </div>
    </div>
  );
}
