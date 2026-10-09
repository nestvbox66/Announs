/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Video de seguridad en la pantalla IFE (In-Flight Entertainment). Reutiliza
 * el chrome compartido (topbar + botonera inferior de hardware) para que el
 * monitor mantenga su tamaño y aspecto: el video vive en el área de contenido
 * por encima de la barra inferior, encajado con `object-contain` (letterbox)
 * para preservar su relación de aspecto sin pisar los botones.
 */
import { useTranslation } from "react-i18next";
import { Film } from "lucide-react";
import { IfeTopBar, IfeBottomBar } from "./IfeChrome";

interface IfeSafetyVideoProps {
  /** URL local cacheada (object URL) o remota de Supabase Storage. */
  src: string;
  /** Nombre del package para la cabecera. */
  packageName: string;
  /** Tiempo remanente ya traducido para la topbar (igual que el menú). */
  remaining: string;
  /** Se invoca al terminar el video, al fallar o al pulsar "Omitir". */
  onFinished: () => void;
}

export default function IfeSafetyVideo({ src, packageName, remaining, onFinished }: IfeSafetyVideoProps) {
  const { t } = useTranslation();
  return (
    <div
      id="ife-safety-video"
      className="relative w-full aspect-video overflow-hidden bg-black animate-fadeIn flex flex-col"
      style={{ fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }}
    >
      <IfeTopBar
        remaining={remaining}
        left={
          <span className="flex items-center gap-2 text-white/85">
            <Film className="w-[18px] h-[18px]" strokeWidth={1.75} />
            <span
              className="uppercase select-none truncate max-w-[220px]"
              style={{ fontSize: 12, letterSpacing: "0.14em", fontWeight: 600 }}
            >
              {packageName}
            </span>
          </span>
        }
      />

      {/* Área de contenido: el video se encaja preservando su aspecto
          (letterbox) sin invadir la botonera inferior. */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
        <video
          src={src}
          className="h-full w-full object-contain"
          controls
          autoPlay
          playsInline
          preload="auto"
          onEnded={onFinished}
          onError={onFinished}
        />
        {/* Omitir: cierra el video y libera la narrativa (equivale a fin). */}
        <button
          type="button"
          onClick={onFinished}
          className="absolute bottom-3 right-3 bg-black/60 hover:bg-black/85 text-white text-[11px] font-mono font-bold uppercase tracking-wider border border-white/25 rounded px-3 py-1.5 cursor-pointer transition-colors"
        >
          {t("safety_pack.skip")} ⏭
        </button>
      </div>

      <IfeBottomBar />
    </div>
  );
}
