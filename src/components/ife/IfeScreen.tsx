/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contenedor del IFE: alterna entre la portada de bienvenida y el menú
 * principal con transición visual. Cuando el motor dispara
 * `taxi_crew_safety_brief` en modo PACK, el video de seguridad de la
 * comunidad interrumpe la pantalla actual y se reproduce DENTRO del propio
 * monitor IFE (como la pantalla de entretenimiento a bordo); al terminar
 * (fin, error u "Omitir") se vuelve a la pantalla anterior y la narrativa
 * avanza.
 */
import { useEffect, useState } from "react";
import type { IfeFlightInfo, IfeGuest } from "./IfeTypes";
import type { IfeTelemetry } from "./IfeFlightMapView";
import IfeWelcome from "./IfeWelcome";
import IfeMenu from "./IfeMenu";
import IfeSafetyVideo from "./IfeSafetyVideo";
import {
  safetyVideoPackService,
  type SafetyVideoPlayRequest,
} from "../../services/SafetyVideoPackService";

interface IfeScreenProps {
  flight: IfeFlightInfo;
  guest: IfeGuest | null;
  originCoords?: [number, number] | null;
  destCoords?: [number, number] | null;
  getTelemetry?: () => IfeTelemetry | null;
  getFlownPath?: () => Array<[number, number]>;
}

export default function IfeScreen({
  flight,
  guest,
  originCoords,
  destCoords,
  getTelemetry,
  getFlownPath,
}: IfeScreenProps) {
  const [screen, setScreen] = useState<"welcome" | "menu">("welcome");
  const [safetyRequest, setSafetyRequest] = useState<SafetyVideoPlayRequest | null>(null);

  // El video de seguridad se reproduce dentro del monitor IFE: al llegar la
  // solicitud se interrumpe la pantalla actual (se conserva para volver).
  useEffect(() => {
    return safetyVideoPackService.onPlayRequest((req) => {
      setSafetyRequest(req);
      // Llevar el monitor a la vista para que la reproducción sea visible.
      requestAnimationFrame(() => {
        try {
          document
            .getElementById("ife-screen")
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch {
          // scroll no disponible: la reproducción sigue igual
        }
      });
    });
  }, []);

  const handleSafetyFinished = () => {
    if (safetyRequest) {
      safetyVideoPackService.notifyPlaybackFinished(safetyRequest.eventKey);
      setSafetyRequest(null);
    }
  };

  return (
    <div id="ife-screen" className="w-full">
      {safetyRequest ? (
        <IfeSafetyVideo
          src={safetyRequest.objectUrl ?? safetyRequest.remoteUrl}
          packageName={safetyRequest.packageName}
          remaining={flight.remainingLabel}
          onFinished={handleSafetyFinished}
        />
      ) : screen === "welcome" ? (
        <IfeWelcome flight={flight} guest={guest} onStart={() => setScreen("menu")} />
      ) : (
        <IfeMenu
          flight={flight}
          onHome={() => setScreen("welcome")}
          originCoords={originCoords}
          destCoords={destCoords}
          getTelemetry={getTelemetry}
          getFlownPath={getFlownPath}
        />
      )}
    </div>
  );
}
