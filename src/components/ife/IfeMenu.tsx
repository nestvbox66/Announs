/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Menú principal del IFE (fase 1: maquetado). Contenedor 16:9 con fondo
 * fotográfico, topbar de estado, 4 tarjetas verticales (Your Trip activa
 * con split vertical animado) y barra inferior de hardware. Estilo
 * editorial plano, sin blur salvo en la topbar.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { Menu, Home, ArrowLeft, ArrowRight, Plane, Map as MapIcon, MapPin, ChevronUp } from "lucide-react";
import type { IfeFlightInfo } from "./IfeTypes";
import { IfeTopBar, IfeBottomBar, IfeTopIconButton } from "./IfeChrome";
import IfeFlightMapView, { type IfeTelemetry } from "./IfeFlightMapView";
import fondoIfe2 from "../../assets/FondoIFE2.jpg";

const MAGENTA = "#C81A5A";
const CARD_DARK = "rgba(20,10,30,0.75)";

interface IfeMenuProps {
  flight: IfeFlightInfo;
  onHome: () => void;
  originCoords?: [number, number] | null;
  destCoords?: [number, number] | null;
  getTelemetry?: () => IfeTelemetry | null;
  getFlownPath?: () => Array<[number, number]>;
}

export default function IfeMenu({
  flight,
  onHome,
  originCoords,
  destCoords,
  getTelemetry,
  getFlownPath,
}: IfeMenuProps) {
  const { t } = useTranslation();
  const [isYourTripOpen, setIsYourTripOpen] = useState(false);
  const [isFlightMapOpen, setIsFlightMapOpen] = useState(false);

  const remaining = t("ife.menu.remaining", { time: flight.remainingLabel });
  const toDestination = t("ife.menu.to_destination", {
    time: flight.remainingLabel,
    dest: flight.destIcao,
  });

  const passiveCards: Array<{ key: string; label: string }> = [
    { key: "pair", label: t("ife.menu.pair_device") },
    { key: "entertainment", label: t("ife.menu.ent_title") },
    { key: "kids", label: t("ife.menu.kids") },
  ];

  const handleBack = () => {
    // Nivel-consciente: si los sub-cards están abiertos, solo se cierran;
    // en la raíz del home, recién ahí se vuelve a welcome.
    if (isYourTripOpen) {
      setIsYourTripOpen(false);
    } else {
      onHome();
    }
  };

  // Vista de mapa en vivo (reemplaza al menú; IfeMenu permanece montado para
  // conservar el estado y volver con Your Trip abierto).
  if (isFlightMapOpen) {
    return (
      <IfeFlightMapView
        flightNumber={flight.flightNumber}
        originIcao={flight.originIcao}
        destIcao={flight.destIcao}
        originCoords={originCoords}
        destCoords={destCoords}
        getTelemetry={getTelemetry}
        getFlownPath={getFlownPath}
        onClose={() => setIsFlightMapOpen(false)}
      />
    );
  }

  return (
    <div
      id="ife-menu"
      className="relative w-full aspect-video overflow-hidden bg-black animate-fadeIn"
      style={{ fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }}
    >
      {/* Fondo fotográfico */}
      <img
        src={fondoIfe2}
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: "center 30%" }}
      />
      {/* Overlay sutil para legibilidad */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.12) 42%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col w-full h-full">
        <IfeTopBar
          remaining={remaining}
          left={
            <>
              <IfeTopIconButton icon={Menu} label="Menu" size={20} />
              <IfeTopIconButton icon={Home} label={t("ife.menu.home")} onClick={onHome} size={20} />
              <IfeTopIconButton icon={ArrowLeft} label={t("ife.menu.back")} onClick={handleBack} size={20} />
            </>
          }
        />

        {/* ── Área principal: fila de tarjetas ────────────────── */}
        <div className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden">
          {/* Card 1 — Your Trip (activa, con split vertical animado) */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsYourTripOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsYourTripOpen(true);
              }
            }}
            className="relative shrink-0 w-[22%] h-full border-r border-white/20 cursor-pointer"
            style={{ backgroundColor: CARD_DARK }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {!isYourTripOpen ? (
                <motion.div
                  key="trip-single"
                  className="flex flex-col h-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <div className="flex-1 flex flex-col items-center justify-center gap-5 px-4">
                    <Plane className="w-16 h-16 text-white" strokeWidth={1.5} />
                    <div className="flex flex-col items-center">
                      <span className="text-white" style={{ fontSize: 22, fontWeight: 300 }}>
                        {t("ife.menu.trip_title")}
                      </span>
                      <span
                        className="mt-2"
                        style={{ width: 24, height: 2, backgroundColor: MAGENTA }}
                      />
                    </div>
                    <span className="text-white/60" style={{ fontSize: 12, fontWeight: 400 }}>
                      {toDestination}
                    </span>
                  </div>
                  <div
                    className="h-7 shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: MAGENTA }}
                  >
                    <ChevronUp className="w-4 h-4 text-white" strokeWidth={2} />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="trip-split"
                  className="flex flex-col h-full overflow-hidden"
                  initial={{ height: 0 }}
                  animate={{ height: "100%" }}
                  exit={{ height: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {/* Sub-card A — Flight Map (50% superior) */}
                  <motion.button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsFlightMapOpen(true);
                    }}
                    className="flex-1 flex flex-col items-center justify-center gap-3 border-b border-white/15 hover:bg-[rgba(200,26,90,0.18)] transition-colors cursor-pointer"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  >
                    <MapIcon className="w-12 h-12 text-white" strokeWidth={1.5} />
                    <span className="text-white text-center px-2" style={{ fontSize: 18, fontWeight: 300 }}>
                      {t("ife.menu.flight_map")}
                    </span>
                  </motion.button>

                  {/* Sub-card B — Your Destination (50% inferior) */}
                  <motion.button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      console.log("[IFE] Your Destination");
                    }}
                    className="flex-1 flex flex-col items-center justify-center gap-3 hover:bg-[rgba(200,26,90,0.18)] transition-colors cursor-pointer"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  >
                    <MapPin className="w-12 h-12 text-white" strokeWidth={1.5} />
                    <span className="text-white text-center px-2" style={{ fontSize: 18, fontWeight: 300 }}>
                      {t("ife.menu.destination")}
                    </span>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Cards 2–4 — estáticas */}
          {passiveCards.map((card) => (
            <div
              key={card.key}
              className="relative shrink-0 w-[26%] h-full border-r border-white/20 flex items-end justify-center pb-10"
            >
              <span
                className="text-white text-center px-6"
                style={{
                  fontSize: 18,
                  fontWeight: 500,
                  textShadow: "0 0.5px 3px rgba(0,0,0,0.65)",
                }}
              >
                {card.label}
              </span>
              <ArrowRight
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white"
                strokeWidth={1.5}
                style={{ opacity: 0.2 }}
              />
            </div>
          ))}

          {/* Peek del siguiente card (5%) para indicar scroll */}
          <div className="shrink-0 w-[5%] h-full" aria-hidden />
        </div>

        <IfeBottomBar />
      </div>
    </div>
  );
}
