/**
 * Pantalla PRE-VUELO (fly v2): se usa desde la fase de PRE-VUELO en adelante.
 *
 * Toma como punto de partida la pantalla de la fase BOARDING con un único
 * cambio: se elimina el monitor de embarque y en su lugar (misma fila,
 * columna izquierda) se implementa el IFE completo. La columna derecha
 * (último anuncio) y el panel de cabina inferior se conservan idénticos.
 *
 * El IFE se reutiliza sin modificaciones (IfeScreen): portada de bienvenida,
 * menú con mapa interactivo y reproducción del video de seguridad dentro del
 * propio monitor.
 */
import IfeScreen from "../ife/IfeScreen";
import type { IfeFlightInfo, IfeGuest } from "../ife/IfeTypes";
import type { IfeTelemetry } from "../ife/IfeFlightMapView";
import AnnouncementPanelV2 from "./AnnouncementPanelV2";
import BoardingCabinLayoutPanel from "./BoardingCabinLayoutPanel";
import type { AnnouncementInfo, Pasajero } from "../../types";
import type { AttributeState } from "../../passengers/types";
import type { CabinLayout } from "../../types/cabinLayout";

interface PreVueloScreenProps {
  ifeFlight: IfeFlightInfo;
  ifeGuest: IfeGuest | null;
  ifeOriginCoords?: [number, number] | null;
  ifeDestCoords?: [number, number] | null;
  ifeGetTelemetry?: () => IfeTelemetry | null;
  ifeGetFlownPath?: () => Array<[number, number]>;
  announcement: AnnouncementInfo | null;
  announcementPlaying: boolean;
  announcementGenerating: boolean;
  announcementError?: string | null;
  getSpeakerName: (role: string) => string;
  layout: CabinLayout | null;
  layoutLoading: boolean;
  layoutPassengers: Pasajero[];
  boardedCount: number;
  paxAverages: AttributeState | null;
  boardingMusicName: string | null;
}

export default function PreVueloScreen({
  ifeFlight,
  ifeGuest,
  ifeOriginCoords,
  ifeDestCoords,
  ifeGetTelemetry,
  ifeGetFlownPath,
  announcement,
  announcementPlaying,
  announcementGenerating,
  announcementError,
  getSpeakerName,
  layout,
  layoutLoading,
  layoutPassengers,
  boardedCount,
  paxAverages,
  boardingMusicName,
}: PreVueloScreenProps) {
  return (
    <div id="vuelo-estado-prevuelo" className="space-y-6 animate-fadeIn">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna Izquierda: IFE (reemplaza al monitor de embarque) */}
        <div className="min-w-0">
          <IfeScreen
            flight={ifeFlight}
            guest={ifeGuest}
            originCoords={ifeOriginCoords}
            destCoords={ifeDestCoords}
            getTelemetry={ifeGetTelemetry}
            getFlownPath={ifeGetFlownPath}
          />
        </div>

        {/* Columna Derecha: último anuncio (igual que BOARDING) */}
        <div className="space-y-5">
          <AnnouncementPanelV2
            announcement={announcement}
            isPlaying={announcementPlaying}
            isGenerating={announcementGenerating}
            generatingError={announcementError}
            getSpeakerName={getSpeakerName}
            className="h-full"
          />
        </div>
      </div>

      {/* Panel de cabina inferior (igual que BOARDING) */}
      <BoardingCabinLayoutPanel
        layout={layout}
        loading={layoutLoading}
        passengers={layoutPassengers}
        boardedCount={boardedCount}
        paxAverages={paxAverages}
        boardingMusicName={boardingMusicName}
      />
    </div>
  );
}
