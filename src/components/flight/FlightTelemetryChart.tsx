/**
 * FlightTelemetryChart — Velocidad y Altitud sincronizadas a lo largo del vuelo.
 *
 * Fuente: coordenadas GeoJSON `[lon, lat, altitud(ft), velocidad(kt),
 * segundosTranscurridos?]` de `public.flight_paths`. En `useMemo` se parsean a
 * filas `{ t, altitud, velocidad }` donde `t` son los minutos transcurridos
 * desde el inicio del vuelo.
 *
 * El eje X es temporal (type="number"), no secuencial: con downsampling por
 * delta, las fases estables (crucero, pocos puntos) deben expandirse según el
 * tiempo real que ocupan y mostrar su meseta plana, no comprimirse como un
 * pico. Doble eje Y: altitud (izq) y velocidad (der) con dominios
 * independientes.
 *
 * Compatibilidad: tracks viejos sin 5.º elemento caen a interpolación uniforme
 * entre `started_at`/`ended_at` (y a índice si tampoco hay tiempos).
 */
import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { FlightPathPoint } from "../../services/FlightPathRecorder";

interface FlightTelemetryChartProps {
  coordinates: FlightPathPoint[];
  startedAt: string | null;
  endedAt: string | null;
}

interface ChartRow {
  t: number;
  altitud: number;
  velocidad: number;
}

const MAX_PLOT_POINTS = 600;

const thousands = new Intl.NumberFormat("en-US");
const hhmm = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });

function toMs(iso: string | null): number {
  if (!iso) return NaN;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

export default function FlightTelemetryChart({ coordinates, startedAt, endedAt }: FlightTelemetryChartProps) {
  const { data, startMs } = useMemo(() => {
    const start = toMs(startedAt);
    if (coordinates.length === 0) return { data: [] as ChartRow[], startMs: start };

    // Diezmado uniforme sobre el índice para no saturar el gráfico.
    const stride = Math.max(1, Math.ceil(coordinates.length / MAX_PLOT_POINTS));
    const sampled: { coord: FlightPathPoint; index: number }[] = [];
    for (let i = 0; i < coordinates.length; i += stride) {
      sampled.push({ coord: coordinates[i], index: i });
    }
    // Garantizar el último punto del track.
    const lastIndex = coordinates.length - 1;
    if (sampled.length === 0 || sampled[sampled.length - 1].index !== lastIndex) {
      sampled.push({ coord: coordinates[lastIndex], index: lastIndex });
    }

    // ¿Trae el track tiempo por punto (5.º elemento)?
    const withTime = sampled.every(({ coord }) => Number.isFinite(Number(coord?.[4])));

    // Interpolación uniforme como respaldo (tracks viejos): reparte el tiempo
    // total entre inicio y fin según la posición relativa en el track.
    const end = toMs(endedAt);
    const totalMin = Number.isFinite(start) && Number.isFinite(end) && end > start
      ? (end - start) / 60000
      : NaN;

    const rows: ChartRow[] = [];
    for (const { coord, index } of sampled) {
      const altitud = Number(coord?.[2]);
      const velocidad = Number(coord?.[3]);
      if (!Number.isFinite(altitud) || !Number.isFinite(velocidad)) continue;
      let t: number;
      if (withTime) {
        t = Number(coord[4]) / 60;
      } else if (Number.isFinite(totalMin) && coordinates.length > 1) {
        t = (totalMin * index) / (coordinates.length - 1);
      } else {
        t = index;
      }
      rows.push({
        t: Math.round(t * 100) / 100,
        altitud: Math.round(altitud),
        velocidad: Math.round(velocidad * 10) / 10,
      });
    }
    return { data: rows, startMs: start };
  }, [coordinates, startedAt, endedAt]);

  if (data.length < 2) {
    return (
      <div
        id="flight-telemetry-empty"
        className="h-[420px] bg-[#00172e]/60 border border-white/10 rounded-[5px] flex flex-col items-center justify-center gap-2 text-center p-6"
      >
        <span className="text-4xl">📈</span>
        <p className="text-sm font-bold text-white/80">Sin datos de telemetría</p>
        <p className="text-[11px] font-mono text-white/50 max-w-md">
          La telemetría del recorrido se deriva del track guardado en{" "}
          <span className="text-[#45AFFF]/80">flight_paths</span>.
        </p>
      </div>
    );
  }

  const formatTick = (v: number): string => {
    if (Number.isFinite(startMs)) return hhmm.format(new Date(startMs + v * 60000));
    return `+${Math.round(v)}m`;
  };

  const timeRange = (() => {
    const end = toMs(endedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(end)) return null;
    return `${hhmm.format(new Date(startMs))} – ${hhmm.format(new Date(end))}`;
  })();

  return (
    <div className="bg-[#00172e]/60 border border-white/10 rounded-[5px] p-4">
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10, fontFamily: "monospace" }}
              axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
              tickLine={false}
              tickFormatter={formatTick}
              minTickGap={48}
              label={{ value: "Tiempo de vuelo", position: "insideBottom", offset: -2, fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
            />
            <YAxis
              yAxisId="altitud"
              orientation="left"
              domain={[0, "auto"]}
              tick={{ fill: "#45AFFF", fontSize: 10, fontFamily: "monospace" }}
              axisLine={{ stroke: "#45AFFF55" }}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${v}`)}
              label={{ value: "ALT (ft)", angle: -90, position: "insideLeft", fill: "#45AFFF", fontSize: 10 }}
            />
            <YAxis
              yAxisId="velocidad"
              orientation="right"
              domain={[0, "auto"]}
              tick={{ fill: "#43E600", fontSize: 10, fontFamily: "monospace" }}
              axisLine={{ stroke: "#43E60055" }}
              tickLine={false}
              label={{ value: "SPD (kts)", angle: 90, position: "insideRight", fill: "#43E600", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#00172e", border: "1px solid rgba(69,175,255,0.4)", borderRadius: 5, fontSize: 11, fontFamily: "monospace" }}
              labelStyle={{ color: "#45AFFF" }}
              labelFormatter={(label: number) => formatTick(label)}
              formatter={(value: number | string, name: string) => {
                const num = Number(value);
                const text = Number.isFinite(num) ? thousands.format(num) : String(value);
                return name === "altitud" ? [`${text} ft`, "Altitud"] : [`${text} kts`, "Velocidad"];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }}
              formatter={(v: string) => (v === "altitud" ? "Altitud (ft)" : "Velocidad (kts)")}
            />
            <Line yAxisId="altitud" type="monotone" dataKey="altitud" name="altitud" stroke="#45AFFF" strokeWidth={2} dot={false} />
            <Line yAxisId="velocidad" type="monotone" dataKey="velocidad" name="velocidad" stroke="#43E600" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] font-mono text-white/40">
        {data.length} muestras · eje X temporal{timeRange ? ` · ${timeRange}` : ""}
      </p>
    </div>
  );
}
