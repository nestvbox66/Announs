import airlinesData from "../data/airlines.json";

interface AirlineEntry {
  IATA: string;
  ICAO: string;
  Aerolinea: string;
  CallSign: string;
  Pais: string;
  Observaciones: string;
}

const airlines = airlinesData as AirlineEntry[];

export function getAirlineName(code: string): string {
  const key = (code || "").toUpperCase().trim();
  if (!key) return code;

  // ICAO primero: el IATA se comparte entre aerolíneas y un `find` único
  // puede devolver la entrada equivocada (p. ej. "DL" figura también en
  // registros históricos). Solo si no hay match ICAO se prueba IATA.
  const byIcao = airlines.find((a) => a.ICAO.toUpperCase() === key);
  if (byIcao) return byIcao.Aerolinea;
  const entry = airlines.find(
    (a) => a.IATA && a.IATA.toUpperCase() === key
  );

  return entry ? entry.Aerolinea : key;
}
