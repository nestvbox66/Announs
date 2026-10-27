import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { Pasajero } from "../../types";
import type { AttributeState } from "../../passengers/types";
import {
  buildPhysicalColumns,
  normalizeSeatLabel,
  type CabinCellType,
  type CabinLayout,
} from "../../types/cabinLayout";

interface BoardingCabinLayoutPanelProps {
  layout: CabinLayout | null;
  loading: boolean;
  passengers: Pasajero[];
  boardedCount: number;
  paxAverages: AttributeState | null;
  boardingMusicName: string | null;
}

interface MetricDefinition {
  key: keyof Pick<AttributeState, "saciedad" | "confortFisiologico" | "calma" | "entretenimiento">;
  labelKey: string;
  color: string;
}

const METRICS: MetricDefinition[] = [
  { key: "saciedad", labelKey: "flight_view.attr_satiety", color: "#43E600" },
  { key: "calma", labelKey: "flight_view.attr_calm", color: "#E600D2" },
  { key: "entretenimiento", labelKey: "flight_view.attr_entertainment", color: "#E68B00" },
  { key: "confortFisiologico", labelKey: "flight_view.attr_comfort", color: "#F5C400" },
];

const LEGEND_CHIPS = [
  { labelKey: "flight_view.layout_legend_free", chipClass: "border-[#5b9ec4] bg-[#8ed0ee] text-[#0b2a3a]" },
  { labelKey: "flight_view.layout_legend_occupied", chipClass: "border-[#b25f06] bg-[#ff9f1c] text-[#2a1a05]" },
  { labelKey: "flight_view.layout_legend_blocked", chipClass: "border-[#4a3a2a] bg-[#2a1e12] text-[#8a7a68]" },
  { labelKey: "flight_view.layout_legend_galley", chipClass: "border-[#facc15] bg-[#fef9e7] text-[#7a5c00]" },
  { labelKey: "flight_view.layout_legend_lavatory", chipClass: "border-[#a855f7] bg-[#f5eafe] text-[#6b21a8]" },
  { labelKey: "flight_view.layout_legend_exit", chipClass: "border-[#c2410c] bg-[#ffd9a0] text-[#7c2d12]" },
];

function cellShortLabel(type: CabinCellType): string {
  if (type === "galley") return "G";
  if (type === "lavatory") return "WC";
  if (type === "emergency_exit") return "EXIT";
  return "";
}

function AircraftSeatMap({
  layout,
  passengers,
  boardedCount,
  onSelectPassenger,
}: {
  layout: CabinLayout;
  passengers: Pasajero[];
  boardedCount: number;
  onSelectPassenger: (passenger: Pasajero) => void;
}) {
  const { t } = useTranslation();
  const descriptors = buildPhysicalColumns(layout.columns, layout.aisle_columns);
  // Con la nariz a la izquierda, babor (primeras letras, ej. A-B-C) queda
  // abajo y estribor (últimas letras, ej. D-E-F) arriba: se invierte el
  // orden físico de visualización. Los datos (letras, etiquetas, pasillos)
  // no cambian, solo la fila de grilla en la que se dibuja cada columna.
  const displayDescriptors = [...descriptors].reverse();
  const boarded = passengers.slice(0, Math.max(0, Math.floor(boardedCount)));
  const passengerBySeat = new Map(
    boarded.map((passenger) => [normalizeSeatLabel(passenger.asiento), passenger]),
  );

  const templateColumns = `repeat(${Math.max(1, layout.grid.length)}, minmax(0, 1fr))`;
  const templateRows = displayDescriptors
    .map((descriptor) => (descriptor.kind === "aisle" ? "0.45fr" : "minmax(0, 1fr)"))
    .join(" ");

  const renderCell = (
    rowCells: CabinCellType[],
    rowIndex: number,
    displayIndex: number,
    descriptor: (typeof displayDescriptors)[number],
  ) => {
    const physicalIndex = descriptors.indexOf(descriptor);
    const cellType = rowCells[physicalIndex] ?? "empty";
    const position = { gridColumn: rowIndex + 1, gridRow: displayIndex + 1 };

    // Pasillo: misma interpretación que el editor del backoffice
    // (aisle_columns = índice de letra tras el cual se intercala el pasillo,
    //  separador físico sin letra propia). Se dibuja como franja libre del
    //  fuselaje con línea central discontinua.
    if (descriptor.kind === "aisle") {
      return (
        <div
          key={`aisle-${rowIndex}-${physicalIndex}`}
          style={position}
          className="relative min-h-0 min-w-0 bg-transparent"
          aria-hidden
        >
          <div className="absolute inset-x-[1px] top-1/2 border-t border-dashed border-slate-400/70" />
        </div>
      );
    }

    const rowNumber = rowIndex - layout.front_rows + 1;
    const seatLabel = rowNumber >= 1 ? `${rowNumber}${descriptor.letter}` : "";
    const passenger = seatLabel ? passengerBySeat.get(normalizeSeatLabel(seatLabel)) : undefined;
    const isOccupied = Boolean(passenger);
    const isSeat = cellType === "seat" || cellType === "emergency_exit";
    const isEmergency = cellType === "emergency_exit";
    const isBlocked = cellType === "empty";
    const label = isSeat ? seatLabel : cellShortLabel(cellType);

    const baseClass =
      "flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[2px] border text-[6px] font-mono font-bold leading-none transition-colors xl:text-[7px]";

    if (isSeat && isOccupied && passenger) {
      return (
        <button
          key={`cell-${rowIndex}-${physicalIndex}`}
          type="button"
          style={position}
          onClick={() => onSelectPassenger(passenger)}
          title={`${passenger.nombre} · ${seatLabel}`}
          aria-label={`${seatLabel} ${passenger.nombre}`}
          className={`${baseClass} cursor-pointer ${
            isEmergency
              ? "border-[#7c2d12] bg-[#ff9f1c] text-[#2a1a05] hover:bg-[#ffae3d]"
              : "border-[#b25f06] bg-[#ff9f1c] text-[#2a1a05] hover:bg-[#ffae3d]"
          }`}
        >
          {label}
        </button>
      );
    }

    if (isSeat && !isBlocked) {
      return (
        <div
          key={`cell-${rowIndex}-${physicalIndex}`}
          style={position}
          className={`${baseClass} ${
            isEmergency
              ? "border-[#c2410c] bg-[#ffd9a0] text-[#7c2d12] hover:bg-[#ffe3ba]"
              : "border-[#5b9ec4] bg-[#8ed0ee] text-[#0b2a3a] hover:bg-[#aedef2]"
          }`}
          title={seatLabel ? `${seatLabel} · ${t("flight_view.layout_empty")}` : undefined}
        >
          {label}
        </div>
      );
    }

    if (cellType === "galley") {
      return (
        <div
          key={`cell-${rowIndex}-${physicalIndex}`}
          style={position}
          className={`${baseClass} border-[#facc15] bg-[#fef9e7] text-[#7a5c00] hover:bg-[#fef3c7]`}
          title={seatLabel ? `${seatLabel} · Galley` : "Galley"}
        >
          {label}
        </div>
      );
    }

    if (cellType === "lavatory") {
      return (
        <div
          key={`cell-${rowIndex}-${physicalIndex}`}
          style={position}
          className={`${baseClass} border-[#a855f7] bg-[#f5eafe] text-[#6b21a8] hover:bg-[#ede9fe]`}
          title={seatLabel ? `${seatLabel} · WC` : "WC"}
        >
          {label}
        </div>
      );
    }

    return (
      <div
        key={`cell-${rowIndex}-${physicalIndex}`}
        style={position}
        className={`${baseClass} border-[#4a3a2a] bg-[#2a1e12] text-[#8a7a68]/80 hover:bg-[#3a2a1c]`}
        title={seatLabel ? `${seatLabel} · ${t("flight_view.layout_empty")}` : undefined}
      >
        {label}
      </div>
    );
  };

  return (
    <div className="relative flex h-full w-full items-center overflow-x-auto overflow-y-hidden" aria-label={t("flight_view.layout_aria")}>
      {/* Alas decorativas (no interactivas), detrás del fuselaje */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-[38%] top-1/2 h-[88%] w-[13%] -translate-x-1/2 -translate-y-[96%] rotate-[28deg] rounded-[4px] bg-slate-400/35" />
        <div className="absolute left-[38%] top-1/2 h-[88%] w-[13%] -translate-x-1/2 translate-y-[-4%] rotate-[-28deg] rounded-[4px] bg-slate-400/35" />
      </div>

      {/* Fuselaje horizontal: nariz a la izquierda, cola a la derecha */}
      <div className="relative z-10 flex h-[80%] w-full items-stretch rounded-l-[999px] rounded-r-[26px] border border-slate-300 bg-gradient-to-b from-white via-[#f4f7fa] to-[#dde5ec] py-1.5 pl-20 pr-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.4)]">
        {/* Ventanas de cabina (decoración) */}
        <div aria-hidden className="pointer-events-none absolute left-[10px] top-1/2 flex -translate-y-1/2 -rotate-6 gap-[3px]">
          <div className="h-[10px] w-[7px] rounded-l-full rounded-r-[2px] bg-[#0b2a3a]" />
          <div className="h-[10px] w-[7px] rounded-[2px] bg-[#0b2a3a]" />
        </div>
        {/* Cono de cola (decoración) */}
        <div aria-hidden className="pointer-events-none absolute right-[7px] top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full bg-slate-300" />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Números de fila */}
          <div className="grid shrink-0 gap-px" style={{ gridTemplateColumns: templateColumns }} aria-hidden>
            {layout.grid.map((_, rowIndex) => {
              const rowNumber = rowIndex - layout.front_rows + 1;
              return (
                <div
                  key={`rownum-${rowIndex}`}
                  className="flex items-center justify-center font-mono text-[5px] font-bold leading-none text-slate-400"
                >
                  {rowNumber >= 1 ? rowNumber : ""}
                </div>
              );
            })}
          </div>
          {/* Asientos y pasillos */}
          <div
            className="grid min-h-0 w-full flex-1 gap-px"
            style={{ gridTemplateColumns: templateColumns, gridTemplateRows: templateRows }}
          >
            {layout.grid.map((rowCells, rowIndex) =>
              displayDescriptors.map((descriptor, displayIndex) =>
                renderCell(rowCells, rowIndex, displayIndex, descriptor),
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PassengerPopover({
  passenger,
  onClose,
}: {
  passenger: Pasajero;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="absolute right-2 top-2 z-20 w-64 max-w-[calc(100%-1rem)] rounded-[6px] border border-[#45AFFF]/60 bg-[#001D35]/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#45AFFF]">
          {t("flight_view.passenger_details")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded border border-white/15 text-white/60 transition-colors hover:border-white/35 hover:text-white"
          aria-label={t("flight_view.close_details")}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <p className="mt-2 break-words font-display text-sm font-black leading-tight text-white">
        {passenger.nombre}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
        <div>
          <span className="block text-[8px] font-mono uppercase text-white/40">
            {t("flight_view.passenger_seat")}
          </span>
          <span className="font-mono font-bold text-[#8ED8F8]">{passenger.asiento}</span>
        </div>
        <div>
          <span className="block text-[8px] font-mono uppercase text-white/40">
            {t("flight_view.passenger_age")}
          </span>
          <span className="font-sans font-bold text-white/90">{passenger.edad}</span>
        </div>
        <div>
          <span className="block text-[8px] font-mono uppercase text-white/40">
            {t("flight_view.passenger_sex")}
          </span>
          <span className="font-sans font-bold text-white/90">
            {passenger.genero === "F"
              ? t("passenger_details.status.female")
              : t("passenger_details.status.male")}
          </span>
        </div>
        <div>
          <span className="block text-[8px] font-mono uppercase text-white/40">
            {t("flight_view.passenger_nationality")}
          </span>
          <span className="block truncate font-sans font-bold text-white/90">
            {passenger.nacionalidad}
          </span>
        </div>
        <div className="col-span-2">
          <span className="block text-[8px] font-mono uppercase text-white/40">
            {t("flight_view.passenger_class")}
          </span>
          <span className="font-sans font-bold text-[#45AFFF]">{passenger.clase}</span>
        </div>
      </div>
    </div>
  );
}

export default function BoardingCabinLayoutPanel({
  layout,
  loading,
  passengers,
  boardedCount,
  paxAverages,
  boardingMusicName,
}: BoardingCabinLayoutPanelProps) {
  const { t } = useTranslation();
  const [selectedPassenger, setSelectedPassenger] = React.useState<Pasajero | null>(null);

  React.useEffect(() => {
    setSelectedPassenger(null);
  }, [layout?.id]);

  const capacity = layout?.capacity ?? 0;
  const totalPassengers = passengers.length;
  const progress =
    totalPassengers > 0 ? Math.min(100, (boardedCount / totalPassengers) * 100) : 0;
  const progressLabel = Math.round(progress);

  return (
    <div className="grid min-h-[280px] grid-cols-1 overflow-hidden rounded-[5px] border border-[#3B7EB2]/60 bg-[#001D35]/85 shadow-xl lg:h-[300px] lg:grid-cols-[3fr_7fr]">
      <div className="flex min-h-0 flex-col gap-2.5 border-b border-[#3B7EB2]/35 p-2.5 lg:border-b-0 lg:border-r">
        <div className="grid grid-cols-2 gap-1.5">
          {METRICS.map((metric) => {
            const value = paxAverages ? Math.round(paxAverages[metric.key]) : null;
            return (
              <div
                key={metric.key}
                className="flex min-h-[82px] min-w-0 flex-col justify-between rounded-[5px] border bg-[#00172E]/85 px-2.5 py-2"
                style={{ borderColor: `${metric.color}99` }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="truncate text-[9px] font-mono font-bold uppercase tracking-tight xl:text-[10px]"
                    style={{ color: metric.color }}
                  >
                    {t(metric.labelKey)}
                  </span>
                  <span className="flex gap-px">
                    {[0.45, 0.65, 0.85, 1].map((opacity, index) => (
                      <span
                        key={index}
                        className="h-1.5 w-1.5 rounded-[1px]"
                        style={{ backgroundColor: metric.color, opacity }}
                      />
                    ))}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <strong className="font-display text-[27px] font-black leading-none text-white xl:text-[29px]">
                    {value ?? "--"}
                  </strong>
                  <span className="font-display text-[13px] font-black leading-none text-white/80">%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/55">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${value ?? 0}%`,
                      backgroundColor: metric.color,
                      boxShadow: `0 0 5px ${metric.color}`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="min-w-0 space-y-1 text-[8.5px] font-mono leading-tight">
          <div className="truncate">
            <span className="text-white/45">{t("flight_view.layout_label")} </span>
            <span className="font-bold text-white/90">
              {layout?.name || t("flight_view.layout_generic")}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="text-white/45">
              {t("flight_view.layout_total_pax")}{" "}
              <strong className="text-white/90">{capacity || "--"}</strong>
            </span>
            <span className="text-white/45">
              {t("flight_view.layout_passenger_rows")}{" "}
              <strong className="text-white/90">{layout?.total_rows ?? "--"}</strong>
            </span>
          </div>
          <div className="pt-0.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/45">{t("flight_view.layout_boarding")}</span>
              <strong className="text-white/90">{progressLabel}%</strong>
            </div>
            <div
              className="relative mt-1 h-1.5 w-full rounded-full bg-black/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressLabel}
            >
              <div
                className="h-full rounded-full bg-[#45AFFF] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
              <span
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#001D35] bg-[#45AFFF]"
                style={{ left: `${Math.max(1, Math.min(99, progress))}%` }}
              />
            </div>
          </div>
          <div className="truncate pt-0.5">
            <span className="text-white/45">{t("flight_view.layout_music")} </span>
            <strong className="text-[#43E600]">
              {boardingMusicName || t("music.no_music")}
            </strong>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {LEGEND_CHIPS.map((item) => (
            <span
              key={item.labelKey}
              className={`inline-flex items-center rounded-[2px] border px-1.5 py-px font-mono text-[8px] font-bold leading-tight ${item.chipClass}`}
            >
              {t(item.labelKey)}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-[240px] min-w-0 overflow-hidden bg-[#001426] p-2">
        {layout ? (
          <AircraftSeatMap
            layout={layout}
            passengers={passengers}
            boardedCount={boardedCount}
            onSelectPassenger={setSelectedPassenger}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] font-mono uppercase tracking-wider text-white/35">
            {loading ? t("flight_view.layout_loading") : t("flight_view.layout_unavailable")}
          </div>
        )}

        {selectedPassenger && (
          <PassengerPopover passenger={selectedPassenger} onClose={() => setSelectedPassenger(null)} />
        )}
      </div>
    </div>
  );
}
