/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PassengerStatusPanel — UI mínima Fase 1 (PDF §8).
 * Promedios agregados de la muestra trackeada + semáforo + score.
 * Sin detalle por pasajero (eso reusa PasajeroSlideOver en otro paso).
 */

import type { AttributeState } from "../../passengers/types";

const ROWS: Array<{ key: keyof AttributeState; label: string }> = [
  { key: "saciedad", label: "Saciedad" },
  { key: "confortFisiologico", label: "Confort" },
  { key: "calma", label: "Calma" },
  { key: "entretenimiento", label: "Entretenimiento" },
];

/** Semáforo: verde ≥70, amarillo ≥40, rojo <40. */
export function semaphoreColor(value: number): string {
  if (value >= 70) return "#43E600";
  if (value >= 40) return "#F5A623";
  return "#E5484D";
}

interface Props {
  averages: AttributeState | null;
  started: boolean;
  /** Etiqueta transitoria (daño o mitigación): 3.4s y se desvanece sola. */
  flash?: { id: number; text: string; tone: "neg" | "pos"; fading: boolean } | null;
}

export default function PassengerStatusPanel({ averages, started, flash = null }: Props) {
  const score =
    averages !== null
      ? (averages.saciedad +
          averages.confortFisiologico +
          averages.calma +
          averages.entretenimiento) /
        4
      : null;

  return (
    <div className="bg-[#2C6591]/20 rounded-[5px] border border-white/20 p-5 shadow-lg space-y-3">
      <div className="flex justify-between items-center border-b border-white/10 pb-2">
        <h3 className="text-xs font-mono text-[#45AFFF] uppercase tracking-wider font-bold">
          Estado de cabina
        </h3>
        {score !== null && (
          <span
            className="text-[11px] font-mono font-black px-2 py-0.5 rounded border"
            style={{
              color: semaphoreColor(score),
              borderColor: `${semaphoreColor(score)}55`,
              backgroundColor: `${semaphoreColor(score)}15`,
            }}
          >
            {Math.round(score)}
          </span>
        )}
      </div>

      {!started || averages === null ? (
        <p className="text-[11px] font-mono text-white/40">
          Sin muestra activa (iniciá el vuelo).
        </p>
      ) : (
        <div className="space-y-2">
          {ROWS.map(({ key, label }) => {
            const value = averages[key];
            const color = semaphoreColor(value);
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/60 w-28 shrink-0">
                  {label}
                </span>
                <div className="flex-1 h-2 rounded bg-black/45 overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{ width: `${Math.round(value)}%`, backgroundColor: color }}
                  />
                </div>
                <span
                  className="text-[10px] font-mono font-bold w-8 text-right"
                  style={{ color }}
                >
                  {Math.round(value)}
                </span>
              </div>
            );
          })}
          <p className="text-[9px] font-mono text-white/30 pt-1">
            Muestra de 10 pax · 100 = mejor estado
          </p>
          {flash !== null && (
            <p
              key={flash.id}
              className={`text-[10px] font-mono font-bold pt-1 transition-opacity duration-500 animate-fadeIn ${
                flash.fading ? "opacity-0" : "opacity-100"
              }`}
              style={{
                color: flash.tone === "neg" ? "#E5484D" : "#43E600",
              }}
            >
              {flash.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
