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

  const entry = airlines.find(
    (a) => a.ICAO.toUpperCase() === key || (a.IATA && a.IATA.toUpperCase() === key)
  );

  return entry ? entry.Aerolinea : key;
}
