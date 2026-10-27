export const CABIN_CELL_TYPES = [
  "seat",
  "aisle",
  "galley",
  "lavatory",
  "emergency_exit",
  "empty",
] as const;

export type CabinCellType = (typeof CABIN_CELL_TYPES)[number];

export interface CabinClass {
  name: string;
  start_row: number;
  end_row: number;
}

export type CabinGrid = CabinCellType[][];

export type PhysicalColumn =
  | { kind: "seat"; letter: string; seatIndex: number }
  | { kind: "aisle"; gapAfter: number };

export interface CabinLayout {
  id: string;
  name: string;
  total_rows: number;
  front_rows: number;
  capacity: number;
  is_generic: boolean;
  columns: string[];
  aisle_columns: number[];
  cabin_classes: CabinClass[];
  grid: CabinGrid;
  created_at: string | null;
  updated_at: string | null;
}

export type ManifestSeatClass = "Primera" | "Ejecutiva" | "Económica";

export interface ManifestSeatAssignment {
  asiento: string;
  clase: ManifestSeatClass;
}

export const DEFAULT_COLUMNS = ["A", "B", "C", "D", "E", "F"];
export const DEFAULT_TOTAL_ROWS = 32;

export function isCabinCellType(value: unknown): value is CabinCellType {
  return typeof value === "string" && (CABIN_CELL_TYPES as readonly string[]).includes(value);
}

export function isSeatLikeCell(type: CabinCellType): boolean {
  return type === "seat" || type === "emergency_exit";
}

export function buildSeatLabel(rowNumber: number, column: string): string {
  return `${rowNumber}${column.toUpperCase()}`;
}

export function normalizeSeatLabel(value: unknown): string {
  // Un pasajero sin asiento (manifiesto externo) no debe romper el mapa:
  // se ignora en vez de lanzar en `trim()`.
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/^0+(?=\d)/, "");
}

export function displayedRowNumber(rowIndex: number, frontRows: number): number {
  return rowIndex - frontRows + 1;
}

export function countPassengerSeats(grid: CabinGrid, frontRows = 0): number {
  const start = Math.max(0, Math.floor(frontRows));
  let total = 0;
  for (let rowIndex = start; rowIndex < grid.length; rowIndex += 1) {
    for (const cell of grid[rowIndex]) {
      if (isSeatLikeCell(cell)) total += 1;
    }
  }
  return total;
}

export function buildPhysicalColumns(columns: string[], aisleColumns: number[]): PhysicalColumn[] {
  const gaps = new Set(aisleColumns);
  const result: PhysicalColumn[] = [];
  columns.forEach((letter, seatIndex) => {
    result.push({ kind: "seat", letter, seatIndex });
    if (gaps.has(seatIndex)) result.push({ kind: "aisle", gapAfter: seatIndex });
  });
  return result;
}

export function findCabinClassForRow(classes: CabinClass[], rowNumber: number): CabinClass | null {
  if (rowNumber < 1) return null;
  return classes.find((item) => rowNumber >= item.start_row && rowNumber <= item.end_row) ?? null;
}

function normalizeGridData(
  rawCells: unknown,
  totalRows: number,
  frontRows: number,
  columns: string[],
  aisleColumns: number[],
): CabinGrid {
  const rows = Math.max(0, Math.floor(totalRows)) + Math.max(0, Math.floor(frontRows));
  const descriptors = buildPhysicalColumns(columns, aisleColumns);
  const rawRows = Array.isArray(rawCells) ? (rawCells as unknown[]) : [];

  return Array.from({ length: rows }, (_, rowIndex) => {
    const rawRow = rawRows[rowIndex];
    return descriptors.map<CabinCellType>((descriptor, physicalIndex) => {
      if (descriptor.kind === "aisle") return "aisle";
      const value = Array.isArray(rawRow) ? (rawRow as unknown[])[physicalIndex] : undefined;
      if (!isCabinCellType(value) || value === "aisle") return "seat";
      return value;
    });
  });
}

function normalizeCabinClasses(raw: unknown): CabinClass[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      start_row: Number(item.start_row) || 1,
      end_row: Number(item.end_row) || 1,
    }));
}

export function normalizeCabinLayout(raw: unknown): CabinLayout {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const columnsRaw = Array.isArray(record.columns)
    ? record.columns.filter((column): column is string => typeof column === "string" && column.length > 0)
    : [];
  const columns = columnsRaw.length > 0 ? columnsRaw : [...DEFAULT_COLUMNS];

  const totalRowsRaw = Number(record.total_rows);
  const totalRows =
    Number.isFinite(totalRowsRaw) && totalRowsRaw > 0 ? Math.floor(totalRowsRaw) : DEFAULT_TOTAL_ROWS;

  const aisleColumns = Array.isArray(record.aisle_columns)
    ? Array.from(
        new Set(
          (record.aisle_columns as unknown[])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < columns.length),
        ),
      ).sort((a, b) => a - b)
    : [];

  const gridRaw = record.grid_data;
  let gridRecord: Record<string, unknown> | null = null;
  if (gridRaw && typeof gridRaw === "object" && !Array.isArray(gridRaw)) {
    gridRecord = gridRaw as Record<string, unknown>;
  }
  const frontRowsRaw = gridRecord ? Number(gridRecord.front_rows) : 0;
  const frontRows = Number.isFinite(frontRowsRaw) && frontRowsRaw > 0 ? Math.floor(frontRowsRaw) : 0;
  const cellsRaw = gridRecord ? gridRecord.cells : gridRaw;
  const grid = normalizeGridData(cellsRaw, totalRows, frontRows, columns, aisleColumns);

  const capacityRaw = Number(record.capacity);
  const capacity =
    Number.isFinite(capacityRaw) && capacityRaw > 0 ? Math.floor(capacityRaw) : countPassengerSeats(grid, frontRows);

  return {
    id: typeof record.id === "string" ? record.id : "",
    name: typeof record.name === "string" ? record.name : "",
    total_rows: totalRows,
    front_rows: frontRows,
    capacity,
    is_generic: record.is_generic === true,
    columns,
    aisle_columns: aisleColumns,
    cabin_classes: normalizeCabinClasses(record.cabin_classes),
    grid,
    created_at: typeof record.created_at === "string" ? record.created_at : null,
    updated_at: typeof record.updated_at === "string" ? record.updated_at : null,
  };
}

function resolveManifestClass(layout: CabinLayout, rowNumber: number): ManifestSeatClass {
  const cabinClass = findCabinClassForRow(layout.cabin_classes, rowNumber);
  const name = (cabinClass?.name ?? "").toLowerCase();
  if (name.includes("primera") || name.includes("first")) return "Primera";
  if (name.includes("ejecutiva") || name.includes("business") || name.includes("premium")) return "Ejecutiva";
  return "Económica";
}

export function listLayoutSeats(layout: CabinLayout): ManifestSeatAssignment[] {
  const descriptors = buildPhysicalColumns(layout.columns, layout.aisle_columns);
  const seats: ManifestSeatAssignment[] = [];

  layout.grid.forEach((rowCells, rowIndex) => {
    const rowNumber = displayedRowNumber(rowIndex, layout.front_rows);
    if (rowNumber < 1) return;

    descriptors.forEach((descriptor, physicalIndex) => {
      if (descriptor.kind !== "seat") return;
      const cell = rowCells[physicalIndex] ?? "seat";
      if (!isSeatLikeCell(cell)) return;
      seats.push({
        asiento: buildSeatLabel(rowNumber, descriptor.letter),
        clase: resolveManifestClass(layout, rowNumber),
      });
    });
  });

  return seats;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function buildSeatAssignments(layout: CabinLayout, paxCount: number): ManifestSeatAssignment[] {
  const seats = listLayoutSeats(layout);
  const limit = Math.min(Math.max(0, Math.floor(paxCount)), seats.length);
  return shuffle(seats).slice(0, limit);
}

export function selectClosestCapacityLayout(
  layouts: CabinLayout[],
  paxCount: number,
): CabinLayout | null {
  const usable = layouts.filter((layout) => layout.capacity > 0).sort((a, b) => a.capacity - b.capacity);
  if (usable.length === 0) return null;
  const atOrAbove = usable.find((layout) => layout.capacity >= paxCount);
  return atOrAbove ?? usable[usable.length - 1] ?? null;
}

export function buildGenericWidebodyLayout(): CabinLayout {
  const columns = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const aisleColumns = [1, 5];
  const totalRows = 38;
  const frontRows = 1;
  const descriptors = buildPhysicalColumns(columns, aisleColumns);

  const grid: CabinGrid = Array.from({ length: frontRows + totalRows }, (_, rowIndex) =>
    descriptors.map<CabinCellType>((descriptor) => {
      if (descriptor.kind === "aisle") return "aisle";
      if (rowIndex < frontRows) {
        if (descriptor.letter === "A" || descriptor.letter === "B") return "galley";
        if (descriptor.letter === "C" || descriptor.letter === "G") return "lavatory";
        if (descriptor.letter === "H") return "galley";
        return "empty";
      }
      const rowNumber = rowIndex - frontRows + 1;
      if (rowNumber === totalRows) {
        if (descriptor.letter === "A" || descriptor.letter === "B" || descriptor.letter === "H") {
          return "galley";
        }
        if (descriptor.letter === "C" || descriptor.letter === "G") return "lavatory";
        return "empty";
      }
      if (rowNumber === 18 && (descriptor.letter === "A" || descriptor.letter === "H")) {
        return "emergency_exit";
      }
      return "seat";
    }),
  );

  return {
    id: "generic-widebody-296",
    name: "Genérico · Widebody Mediano (240-300 PAX)",
    total_rows: totalRows,
    front_rows: frontRows,
    capacity: countPassengerSeats(grid, frontRows),
    is_generic: true,
    columns,
    aisle_columns: aisleColumns,
    cabin_classes: [
      { name: "Primera", start_row: 1, end_row: 2 },
      { name: "Ejecutiva", start_row: 3, end_row: 6 },
      { name: "Económica", start_row: 7, end_row: totalRows },
    ],
    grid,
    created_at: null,
    updated_at: null,
  };
}
