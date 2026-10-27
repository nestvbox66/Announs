/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FlyPageV2 — Sandbox del rediseño UI/UX de la vista FLY (`/fly-v2`).
 *
 * Iteración 1 — Home `/fly` (fuente de verdad: `docs/ui-spec-fly.md`):
 * - Global Navigation Bar persistente (~64px, gradiente sistema, logotipo y
 *   separador #45AFFF).
 * - Layout "PLOT A FLIGHT" (márgenes 64px, grilla 12 columnas).
 * - 4 Flight Action Tiles (3 columnas c/u, gutter 24px, radio 0px,
 *   imagen con `mix-blend-mode: soft-light`, hover revela descripción).
 *
 * Iteración 2 — Flight Setup `/fly/setup` (`src/components/fly-v2/FlySetupView.tsx`):
 * - Grilla 12 columnas: zona izquierda (3 col, summary + voces),
 *   zona derecha (9 col, tabber doble, workspace, barra de ejecución).
 * - Conmutador de sandbox (solo dev) entre Home, Setup, Campaign y Lookup,
 *   sin alterar la spec.
 *
 * Iteración 3 — Campaign Overview `/fly/campaign`
 * (`src/components/fly-v2/FlyCampaignView.tsx`):
 * - Breadcrumb FLY > CAMPAIGN, hero banner de 12 columnas (~170px).
 * - Split 3/9: briefing + completion box; 3 tarjetas de etapas con
 *   banner de aerolínea, ruta, barra de estado y CTA SEND TO SIMBRIEF.
 *
 * Iteración 4 — Flight Lookup `/fly/lookup`
 * (`src/components/fly-v2/FlyLookupView.tsx`):
 * - Breadcrumb FLY > FLIGHT LOOKUP, split 2/10: stack de filtros con
 *   autocompletado + tabla de resultados con selección que desbloquea
 *   el CTA SEND TO SIMBRIEF.
 *
 * Iteración 5 — Navegación del sandbox:
 * - Estado local `sandboxView` (home por defecto) como enrutador interno.
 * - Tiles del Home conectadas: SIMBRIEF IMPORT / CUSTOM FLIGHT → setup,
 *   ISLAND HOPPING → campaign, FLIGHT LOOKUP → lookup.
 * - Breadcrumbs FLY > como botones de retorno al Home.
 *
 * Rama: `feature/redesign-fly-screen`.
 * Stack: React 19 + Tailwind CSS.
 */

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
// @ts-ignore — asset PNG del logotipo (mismo del menú lateral de navegación).
import logoImg from "../components/Announs Logo.png";
import { FlySetupView } from "../components/fly-v2/FlySetupView";
import { FlyCampaignView } from "../components/fly-v2/FlyCampaignView";
import { FlyLookupView } from "../components/fly-v2/FlyLookupView";
import VueloActualViewV2 from "../components/flight-v2/VueloActualViewV2";
import type { SandboxStartPreferences } from "../components/flight-v2/sandboxStartPreferences";
import {
  fetchLatestSimBriefPlan,
  resolveSimbriefPilotId,
} from "../services/simbriefImport";
import {
  loadActiveCampaigns,
  type Campaign,
} from "../services/CampaignService";
import { C, FONT_BAHN, HEADER_GRADIENT } from "../components/fly-v2/tokens";
import { FlightState } from "../types";
import type {
  Pasajero,
  SimBriefData,
  ConfigVoces,
  ConfigAudio,
  UltimoAnuncio,
  VueloReciente,
} from "../types";

export interface FlyPageV2Props {
  currentState: FlightState;
  onStateChange: (state: FlightState) => void;
  simBriefData: SimBriefData;
  /** OFP crudo compartido (App): alimenta setup (horarios) y sesión (monitor). */
  simbriefRawData?: any;
  voicesConfig: ConfigVoces;
  audioConfig: ConfigAudio;
  copilotVolume: number;
  onCopilotVolumeChange: (v: number) => void;
  passengers: Pasajero[];
  onPassengerClick: (p: Pasajero) => void;
  lastAnnouncement: UltimoAnuncio | null;
  onTriggerAnnouncement: (tipo: "bienvenida" | "seguridad" | "turbulencia" | "descenso" | "aterrizaje") => void;
  onSimulateAction: (action: string) => void;
  landingFpm: number;
  onLandingFpmChange: (fpm: number) => void;
  onResetSimulation: (finishedFlight?: VueloReciente | null) => void;
  onTriggerBriefImport: (realData?: unknown, rawData?: unknown) => void;
  onNavigateToAccount?: () => void;
}

/* Tokens compartidos del sistema FLY (ver `src/components/fly-v2/tokens.ts`). */

/* ------------------------- Global Navigation ------------------------- */

type NavItem = { label: string; active: boolean };

const NAV_ITEMS: NavItem[] = [
  { label: "FLY", active: true },
  { label: "USER HUB", active: false },
  { label: "SETTINGS", active: false },
];

/** Alto compacto de la barra de navegación (similar al de la experiencia original). */
const NAV_BAR_HEIGHT = 64;

function FlyGlobalNavBar() {
  return (
    <header
      data-testid="fly-global-nav"
      className="w-full"
      style={{
        height: NAV_BAR_HEIGHT,
        margin: 0,
        background: HEADER_GRADIENT,
        borderBottom: "1px solid rgba(69, 175, 255, 0.35)",
      }}
    >
      <div className="relative mx-auto flex h-full max-w-none items-center px-16">
        {/* Identidad de marca — logotipo (mismo asset del menú lateral). */}
        <img
          data-testid="fly-brand"
          src={logoImg}
          alt="ANNOUNS"
          referrerPolicy="no-referrer"
          style={{
            height: 30,
            width: "auto",
            objectFit: "contain",
            filter: "brightness(1.1) contrast(1.05)",
            userSelect: "none",
          }}
        />

        {/* Navegación central */}
        <nav
          aria-label="Secciones principales"
          className="pointer-events-none absolute inset-0 flex items-stretch justify-center"
        >
          <ul className="flex h-full items-stretch gap-14">
            {NAV_ITEMS.map((item) => (
              <li key={item.label} className="relative flex h-full items-center">
                {/* Glow radial localizado detrás de la palabra activa */}
                {item.active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{
                      width: 180,
                      height: 44,
                      background:
                        "radial-gradient(ellipse at center, rgba(69, 175, 255, 0.25) 0%, rgba(69, 175, 255, 0) 70%)",
                    }}
                  />
                )}
                <span
                  className={item.active ? "text-white" : ""}
                  style={{
                    position: "relative",
                    fontFamily: FONT_BAHN,
                    fontWeight: 700,
                    fontStretch: "semi-condensed",
                    textTransform: "uppercase",
                    fontSize: 15,
                    letterSpacing: "0.08em",
                    lineHeight: 1,
                    color: item.active ? C.white : "rgba(219, 240, 255, 0.7)",
                    opacity: 1,
                  }}
                >
                  {item.label}
                </span>
                {/* Subrayado exacto del ancho del texto, al ras del borde inferior */}
                {item.active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0"
                    style={{ height: 4, background: C.sky }}
                  />
                )}
              </li>
            ))}
          </ul>
        </nav>

        {/* Espaciador derecho para simetría visual (el track central es absoluto) */}
        <div aria-hidden="true" style={{ width: 140 }} />
      </div>
    </header>
  );
}

/* --------------------------- Action Tiles ---------------------------- */

/**
 * Fondos fijos de las tarjetas del Home (`public/fly-v2/`).
 * Contrato para subir imágenes: ver `TILE_IMAGE_CONTRACT` abajo.
 */
const TILE_IMAGE_SIMBRIEF = "/fly-v2/tile-simbrief.jpg";
const TILE_IMAGE_CAMPAIGN_FALLBACK = "/fly-v2/tile-campaign-fallback.jpg";
const TILE_IMAGE_LOOKUP = "/fly-v2/tile-lookup.jpg";
const TILE_IMAGE_CUSTOM = "/fly-v2/tile-custom.jpg";

/**
 * Contrato de imágenes de las tarjetas del Home.
 * - Carpeta: `public/fly-v2/` (se sirve como `/fly-v2/<nombre>`).
 * - Nombres: `tile-simbrief.jpg`, `tile-campaign-fallback.jpg`,
 *   `tile-lookup.jpg`, `tile-custom.jpg` (la tarjeta de campaña usa la
 *   imagen de la campaña activa y solo usa su fallback si no hay ninguna).
 * - Resolución: tarjetas verticales de ~400×500px a 1920px (altura 80% del
 *   viewport restante, mín. 440px). Subir al menos 800×1000px, ideal
 *   1200×1500px (vertical 2:3). Se encuadran con `cover` centrado.
 * Si el archivo falta o rompe, la tarjeta conserva su fondo de sistema.
 */
const TILE_IMAGE_CONTRACT = {
  dir: "public/fly-v2/",
  width: 1200,
  height: 1500,
} as const;
void TILE_IMAGE_CONTRACT;

/**
 * Velo/opacidad de fondo para legibilidad (prueba de diseño). Se usa en la
 * banda del título y, con el mismo valor, en toda la tarjeta al hacer hover.
 */
const TILE_SCRIM_RGBA = "rgba(0, 18, 32, 0.45)";

/** Colores de borde en hover con brillo elevado (mismo grosor, más luminoso). */
const HOVER_BORDER_GREEN = "#6BFF00";
const HOVER_BORDER_MAGENTA = "#FF00FF";

interface FlightActionTileProps {
  title: string;
  description: string;
  baseFill: string;
  border: string;
  borderWidth?: number;
  /**
   * Color de borde al hacer hover/focus (spec §4: las tarjetas estándar
   * "sharpens to #45AFFF at 100% opacity"). Sin valor, el borde no cambia.
   */
  hoverBorder?: string;
  /** Fondo fotográfico (`cover` centrado); null = solo fondo de sistema. */
  imageUrl?: string | null;
  metaLeft?: string;
  metaRight?: string;
  testId: string;
  /** Navegación del sandbox: vista destino al activar la tarjeta. */
  onAction?: () => void;
}

/**
 * Días calendario restantes hasta el fin de la campaña (hoy = 0).
 * Acepta `end_date` como fecha (`YYYY-MM-DD`) o ISO con hora.
 */
function daysUntilCampaignEnd(endDate: string): number {
  const normalized = endDate.includes("T") ? endDate : `${endDate}T00:00:00Z`;
  const end = new Date(normalized);
  if (Number.isNaN(end.getTime())) return 0;
  const now = new Date();
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const endUTC = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
  return Math.max(0, Math.round((endUTC - todayUTC) / 86400000));
}

/**
 * Tarjeta de acción de vuelo.
 * - Marco rectangular estricto (radio 0).
 * - Foto de fondo (`cover` centrada) sobre el fill base + capa atmosférica
 *   en `soft-light` y viñeta inferior para legibilidad.
 * - Hover/focus revela la descripción operativa bajo el título.
 */
function FlightActionTile({
  title,
  description,
  baseFill,
  border,
  borderWidth = 1,
  hoverBorder,
  imageUrl,
  metaLeft,
  metaRight,
  testId,
  onAction,
}: FlightActionTileProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = !!imageUrl && !imageBroken;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onAction}
      className="group relative col-span-3 block w-full cursor-pointer overflow-hidden text-center focus:outline-none"
      style={{
        background: baseFill,
        borderRadius: 0,
        height: "100%",
        minHeight: 440,
      }}
    >
      {/* Foto de fondo de la tarjeta (fija o de la campaña activa) */}
      {showImage && (
        <img
          src={imageUrl as string}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setImageBroken(true)}
          className="pointer-events-none absolute inset-0"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
      )}
      {/* Integración visual de imagen: capa atmosférica mezclada en soft-light */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          mixBlendMode: "soft-light",
          background:
            "radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 45%)," +
            "linear-gradient(115deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 38%)," +
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 7px)," +
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      {/* Viñeta inferior para legibilidad del título */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,22,38,0) 45%, rgba(0,22,38,0.55) 100%)",
        }}
      />
      {/* Velo de legibilidad: al hacer hover/focus se oscurece toda la
          tarjeta con la MISMA opacidad que la banda del título. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ background: TILE_SCRIM_RGBA }}
      />
      {/* Bordes dibujados como overlays en la MISMA geometría (inset-0):
          el borde base y el de hover coinciden exactamente, así el hover solo
          cambia el color/brillo y NO engrosa. (Antes el borde base era el
          nativo del botón —fuera del padding-box— y el overlay se dibujaba
          por dentro: se veían 2px + 2px = engrosado). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ border: `${borderWidth}px solid ${border}` }}
      />
      {hoverBorder && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ border: `${borderWidth}px solid ${hoverBorder}` }}
        />
      )}

      {/* Metadatos superiores (solo tarjeta campaign) */}
      {(metaLeft ?? metaRight) && (
        <span
          className="absolute left-0 right-0 top-0 flex items-start justify-between"
          style={{ margin: 16 }}
        >
          <span
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              fontStretch: "semi-condensed",
              fontSize: 12,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: C.white,
              lineHeight: 1.2,
            }}
          >
            {metaLeft}
          </span>
          <span
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 400,
              fontStretch: "condensed",
              fontSize: 12,
              color: "rgba(219, 240, 255, 0.8)",
              lineHeight: 1.2,
            }}
          >
            {metaRight}
          </span>
        </span>
      )}

      {/* Título central + descripción operativa revelada en hover.
          El título es el único elemento en flujo (siempre centrado), de modo
          que todas las tarjetas alinean su título sin importar el largo de
          la descripción. La descripción va absoluta, colgando debajo, y NO
          reserva espacio (antes empujaba el título hacia arriba cuando era
          larga, p. ej. la campaña). Se revela en hover/focus (spec §4). */}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="relative block w-full">
          {/* Banda de opacidad a todo lo ancho de la línea del título para
              máxima legibilidad sobre la foto. */}
          <span
            style={{
              display: "block",
              width: "100%",
              textAlign: "center",
              padding: "8px 24px",
              background: TILE_SCRIM_RGBA,
              fontFamily: FONT_BAHN,
              fontWeight: 700,
              fontSize: 26,
              textTransform: "uppercase",
              color: C.white,
              lineHeight: 1.15,
              letterSpacing: "0.02em",
              textShadow: "0 1px 3px rgba(0,0,0,0.75)",
            }}
          >
            {title}
          </span>
          {/* Capa externa: centrado horizontal bajo el título (translateX).
              Capa interna: revelado animado (translateY/opacidad) como CLASES
              —el estado base no puede ser inline o ganaría sobre
              `group-hover:*`—. Sombra fuerte para contraste sobre imágenes. */}
          <span
            className="absolute left-1/2 top-full"
            style={{ width: 260, marginTop: 10, transform: "translateX(-50%)" }}
          >
            <span
              className="block translate-y-2 opacity-0 transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
              style={{
                fontFamily: FONT_BAHN,
                fontWeight: 400,
                fontStretch: "condensed",
                fontSize: 14,
                color: C.ice,
                lineHeight: 1.45,
                textAlign: "center",
                textShadow:
                  "0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.9)",
              }}
            >
              {description}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

/* ------------------------------ Page --------------------------------- */

type SandboxView = "home" | "setup" | "flight" | "campaign" | "lookup";

export function FlyPageV2(props: FlyPageV2Props) {
  const { t } = useTranslation();
  // Enrutador interno del sandbox (no forma parte de la spec).
  const [sandboxView, setSandboxView] = useState<SandboxView>("home");
  const navigateHome = () => setSandboxView("home");

  // Sesión de vuelo V2: estado propio para no tocar el `currentState` de la
  // vista de producción (`/fly`). El clon V2 se monta con keep-alive para
  // conservar motores y telemetría al moverse dentro del sandbox.
  const [sandboxFlightState, setSandboxFlightState] =
    useState<FlightState>(FlightState.NoIniciado);
  const [sandboxFlightStarted, setSandboxFlightStarted] = useState(false);
  const [sandboxStartPreferences, setSandboxStartPreferences] =
    useState<SandboxStartPreferences | null>(null);

  // Oferta de campañas vigente: se obtiene ni bien se accede al Home para
  // vestir la tarjeta de campaña (fondo, título y días restantes reales).
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadActiveCampaigns();
      if (cancelled) return;
      if (res.success) setActiveCampaign(res.data?.[0] ?? null);
      setCampaignsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const campaignDaysLeft = activeCampaign
    ? daysUntilCampaignEnd(activeCampaign.endDate)
    : 0;

  // Importación real de SimBrief (usa el pilot ID del perfil).
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [needsPilotId, setNeedsPilotId] = useState(false);

  const handleSimbriefImportTile = async () => {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    setNeedsPilotId(false);
    try {
      const pilotId = await resolveSimbriefPilotId();
      if (!pilotId) {
        // Sin Pilot ID no hay nada que importar: se avisa y se ofrece ir a
        // configurarlo (el importador de la sesión hace lo mismo).
        setImportError(t("fly.home.import_error_no_pilot"));
        setNeedsPilotId(true);
        return;
      }
      const { plan, raw } = await fetchLatestSimBriefPlan(pilotId);
      props.onTriggerBriefImport(plan, raw);
      setSandboxView("setup");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setImportError(
        code === "simbrief_no_plan"
          ? t("fly.home.import_error_no_plan")
          : t("fly.home.import_error_generic"),
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <section
      id="fly-v2-sandbox"
      data-sandbox="fly-v2"
      style={{
        background: C.navyDeep,
        // El fondo azul oscuro cubre el máximo alto de la pantalla: llega
        // hasta el borde inferior, por detrás del menú de navegación inferior.
        minHeight: "100vh",
      }}
    >
      <FlyGlobalNavBar />

      {sandboxView === "home" ? (
      /* Contenido principal "PLOT A FLIGHT" */
      <main
        data-testid="fly-home"
        className="mx-auto w-full"
        style={{
          paddingLeft: 64,
          paddingRight: 64,
          paddingBottom: 64,
          paddingTop: 40,
        }}
      >
        <h1
          data-testid="fly-section-title"
          style={{
            fontFamily: FONT_BAHN,
            fontWeight: 700,
            fontStretch: "semi-condensed",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontSize: 15,
            color: C.ice,
            lineHeight: 1.2,
            marginBottom: 16,
          }}
        >
          {t("fly.home.section_title")}
        </h1>

        {/* Grilla de 4 tarjetas: 3 columnas de la grilla de 12 por tarjeta, gutter 24px */}
        <div
          data-testid="fly-action-grid"
          className="grid grid-cols-12"
          style={{
            gap: 24,
            height: `calc((100vh - ${NAV_BAR_HEIGHT}px - 40px - 34px - 16px - 64px) * 0.8)`,
            minHeight: 480,
          }}
        >
          <FlightActionTile
            testId="tile-simbrief-import"
            title={t("fly.home.simbrief_title")}
            description={t("fly.home.simbrief_description")}
            baseFill={C.greenBase}
            border={C.green}
            borderWidth={2}
            hoverBorder={HOVER_BORDER_GREEN}
            imageUrl={TILE_IMAGE_SIMBRIEF}
            onAction={handleSimbriefImportTile}
          />
          <FlightActionTile
            testId="tile-island-hopping"
            title={
              activeCampaign
                ? activeCampaign.title
                : campaignsLoaded
                  ? t("fly.home.no_campaign_title")
                  : t("fly.home.campaign_title")
            }
            description={
              activeCampaign?.description ||
              (campaignsLoaded
                ? t("fly.home.no_campaign_description")
                : t("fly.home.campaign_description"))
            }
            baseFill={C.navy}
            border={C.magenta}
            borderWidth={2}
            hoverBorder={HOVER_BORDER_MAGENTA}
            imageUrl={
              activeCampaign?.imageHomeUrl || TILE_IMAGE_CAMPAIGN_FALLBACK
            }
            metaLeft={
              activeCampaign ? t("fly.home.campaign_kicker") : undefined
            }
            metaRight={
              activeCampaign
                ? t("fly.home.campaign_ends_in", { days: campaignDaysLeft })
                : undefined
            }
            onAction={() => setSandboxView("campaign")}
          />
          <FlightActionTile
            testId="tile-flight-lookup"
            title={t("fly.home.lookup_title")}
            description={t("fly.home.lookup_description")}
            baseFill={C.navy}
            border={C.tabActive}
            borderWidth={1}
            hoverBorder={C.sky}
            imageUrl={TILE_IMAGE_LOOKUP}
            onAction={() => setSandboxView("lookup")}
          />
          <FlightActionTile
            testId="tile-custom-flight"
            title={t("fly.home.custom_title")}
            description={t("fly.home.custom_description")}
            baseFill={C.navy}
            border={C.tabActive}
            borderWidth={1}
            hoverBorder={C.sky}
            imageUrl={TILE_IMAGE_CUSTOM}
            onAction={() => setSandboxView("setup")}
          />
        </div>
      </main>
      ) : sandboxView === "setup" ? (
        <FlySetupView
          simBriefData={props.simBriefData}
          simbriefRawData={props.simbriefRawData}
          onNavigateHome={navigateHome}
          onStartFlight={(prefs) => {
            // START FLIGHT del sandbox: navega a la sesión V2 clonada y la
            // arranca con la situación elegida. No toca la vista original.
            setSandboxStartPreferences(prefs);
            setSandboxFlightState(FlightState.PreEmbarque);
            setSandboxFlightStarted(true);
            setSandboxView("flight");
          }}
        />
      ) : sandboxView === "campaign" ? (
        <FlyCampaignView onNavigateHome={navigateHome} />
      ) : sandboxView === "lookup" ? (
        <FlyLookupView
          onNavigateHome={navigateHome}
          onImportSimbrief={(plan, raw) => {
            props.onTriggerBriefImport(plan, raw);
            setSandboxView("setup");
          }}
          onNavigateToAccount={props.onNavigateToAccount}
        />
      ) : null}

      {/* Sesión de vuelo V2 (clon aislado). Se mantiene montada para no perder
          telemetría/motores al cambiar de pantalla dentro del sandbox. */}
      {sandboxFlightStarted && (
        <div
          id="fly-v2-active-flight-keepalive"
          style={{ display: sandboxView === "flight" ? undefined : "none" }}
        >
          <VueloActualViewV2
            currentState={sandboxFlightState}
            onStateChange={setSandboxFlightState}
            simBriefData={props.simBriefData}
            sharedSimbriefRaw={props.simbriefRawData}
            voicesConfig={props.voicesConfig}
            audioConfig={props.audioConfig}
            copilotVolume={props.copilotVolume}
            onCopilotVolumeChange={props.onCopilotVolumeChange}
            passengers={props.passengers}
            onPassengerClick={props.onPassengerClick}
            lastAnnouncement={props.lastAnnouncement}
            onTriggerAnnouncement={props.onTriggerAnnouncement}
            onSimulateAction={props.onSimulateAction}
            landingFpm={props.landingFpm}
            onLandingFpmChange={props.onLandingFpmChange}
            onResetSimulation={(finishedFlight) => {
              setSandboxFlightStarted(false);
              setSandboxFlightState(FlightState.NoIniciado);
              setSandboxStartPreferences(null);
              if (finishedFlight) {
                // Vuelo finalizado: Flight Report (detalle en el Hub).
                props.onResetSimulation(finishedFlight);
              } else {
                setSandboxView("setup");
              }
            }}
            onTriggerBriefImport={props.onTriggerBriefImport}
            onNavigateToAccount={props.onNavigateToAccount}
            autoStartPreferences={sandboxStartPreferences}
          />
        </div>
      )}

      {/* Aviso de importación SimBrief (solo sandbox, fuera del flujo de la spec). */}
      {(importing || importError) && (
        <div
          data-testid="fly-import-notice"
          role="status"
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 50,
            background: C.navyDeep,
            border: `1px solid ${C.sky}`,
            borderRadius: 0,
            padding: "8px 12px",
            fontFamily: FONT_BAHN,
            fontWeight: 400,
            fontStretch: "condensed",
            fontSize: 13,
            color: importError ? C.magenta : C.ice,
          }}
        >
          {importing ? t("fly.home.import_loading") : importError}
          {needsPilotId && !importing && (
            <button
              type="button"
              onClick={() => props.onNavigateToAccount?.()}
              className="cursor-pointer"
              style={{
                marginLeft: 12,
                background: C.tabActive,
                color: C.white,
                border: 0,
                borderRadius: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontStretch: "semi-condensed",
                textTransform: "uppercase",
                fontSize: 11,
                letterSpacing: "0.1em",
                padding: "6px 12px",
              }}
            >
              {t("fly.home.import_config_pilot")}
            </button>
          )}
        </div>
      )}

      {/* Conmutador del sandbox (solo dev): alterna Home / Setup / Campaign /
          Lookup sin alterar el layout especificado. Posición fija fuera del flujo.
          Oculto una vez iniciado el vuelo para no interferir con la sesión. */}
      {!sandboxFlightStarted && (
      <div
        data-sandbox-switch="fly-v2"
        className="flex"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 50,
          gap: 4,
          background: C.navyDeep,
          border: `1px solid ${C.sky}`,
          padding: 4,
        }}
      >
        {([
          "home",
          "setup",
          ...(sandboxFlightStarted ? (["flight"] as const) : []),
          "campaign",
          "lookup",
        ] as const).map((view) => {
          const isActive = view === sandboxView;
          return (
            <button
              key={view}
              type="button"
              onClick={() => setSandboxView(view)}
              aria-pressed={isActive}
              className="cursor-pointer"
              style={{
                background: isActive ? C.tabActive : "transparent",
                color: isActive ? C.white : C.ice,
                border: 0,
                borderRadius: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontStretch: "semi-condensed",
                textTransform: "uppercase",
                fontSize: 11,
                letterSpacing: "0.1em",
                padding: "6px 12px",
              }}
            >
              {view}
            </button>
          );
        })}
      </div>
      )}
    </section>
  );
}

export default FlyPageV2;
