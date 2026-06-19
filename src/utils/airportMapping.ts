const AIRPORTS: Record<string, string> = {
  SABE: "Buenos Aires",
  SAEZ: "Ezeiza",
  SACO: "Córdoba",
  SCEL: "Santiago de Chile",
  SBGR: "São Paulo",
  SASA: "Salta",
  SAZN: "Neuquén",
  SAWH: "Ushuaia",
  SAWG: "Río Gallegos",
  SAZM: "Mar del Plata",
  SARE: "Resistencia",
  SATU: "Tucumán",
  SAME: "Mendoza",
  SAOC: "San Juan",
  SAVC: "Comodoro Rivadavia",
  SAVR: "Viedma",
  SAVY: "El Calafate",
  KLAX: "Los Angeles",
  KJFK: "New York",
  KORD: "Chicago",
  KATL: "Atlanta",
  KDFW: "Dallas",
  KDEN: "Denver",
  KSFO: "San Francisco",
  KSEA: "Seattle",
  KMIA: "Miami",
  KLAS: "Las Vegas",
  KMCO: "Orlando",
  KBOS: "Boston",
  KPHL: "Philadelphia",
  KCLT: "Charlotte",
  KPHX: "Phoenix",
  KIAH: "Houston",
  KDCA: "Washington",
  EGLL: "London",
  EGKK: "London Gatwick",
  LFPG: "Paris",
  LEMD: "Madrid",
  LEBL: "Barcelona",
  LIMC: "Milan",
  LIRF: "Rome",
  EDDF: "Frankfurt",
  EDDM: "Munich",
  EHAM: "Amsterdam",
  EKCH: "Copenhagen",
  ESGG: "Gothenburg",
  BIKF: "Reykjavik",
  OMDB: "Dubai",
  OTBD: "Doha",
  OEJN: "Jeddah",
  OERK: "Riyadh",
  OBBI: "Bahrain",
  RJTT: "Tokyo",
  RJBB: "Osaka",
  RKSI: "Seoul",
  ZBAA: "Beijing",
  ZSSS: "Shanghai",
  VHHH: "Hong Kong",
  WSSS: "Singapore",
  VTBS: "Bangkok",
  WMKK: "Kuala Lumpur",
  RPLL: "Manila",
  FACT: "Cape Town",
  FAOR: "Johannesburg",
  FNLU: "Luanda",
  DTTA: "Tunis",
  HECA: "Cairo",
  GMMN: "Casablanca",
  DNAA: "Abuja",
  DNMM: "Lagos",
};

export function getAirportName(icao: string): string {
  const key = (icao || "").toUpperCase().trim();
  return AIRPORTS[key] || "";
}

export function formatETA(minutes: number): string {
  if (minutes <= 0 || !isFinite(minutes)) return "--";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

const AIRPORT_TIMEZONES: Record<string, string> = {
  SABE: "America/Argentina/Buenos_Aires",
  SAEZ: "America/Argentina/Buenos_Aires",
  SACO: "America/Argentina/Cordoba",
  SASA: "America/Argentina/Salta",
  SAZN: "America/Argentina/Neuquen",
  SAWH: "America/Argentina/Ushuaia",
  SAWG: "America/Argentina/Rio_Gallegos",
  SAZM: "America/Argentina/Mar_del_Plata",
  SARE: "America/Argentina/Resistencia",
  SATU: "America/Argentina/Tucuman",
  SAME: "America/Argentina/Mendoza",
  SAOC: "America/Argentina/San_Juan",
  SAVC: "America/Argentina/Comodoro_Rivadavia",
  SAVR: "America/Argentina/Viedma",
  SAVY: "America/Argentina/El_Calafate",
  SCEL: "America/Santiago",
  SBGR: "America/Sao_Paulo",
  KLAX: "America/Los_Angeles",
  KJFK: "America/New_York",
  KORD: "America/Chicago",
  KATL: "America/New_York",
  KDFW: "America/Chicago",
  KDEN: "America/Denver",
  KSFO: "America/Los_Angeles",
  KSEA: "America/Los_Angeles",
  KMIA: "America/New_York",
  KLAS: "America/Los_Angeles",
  KMCO: "America/New_York",
  KBOS: "America/New_York",
  KPHL: "America/New_York",
  KCLT: "America/New_York",
  KPHX: "America/Phoenix",
  KIAH: "America/Chicago",
  KDCA: "America/New_York",
  EGLL: "Europe/London",
  EGKK: "Europe/London",
  LFPG: "Europe/Paris",
  LEMD: "Europe/Madrid",
  LEBL: "Europe/Madrid",
  LIMC: "Europe/Rome",
  LIRF: "Europe/Rome",
  EDDF: "Europe/Berlin",
  EDDM: "Europe/Berlin",
  EHAM: "Europe/Amsterdam",
  EKCH: "Europe/Copenhagen",
  ESGG: "Europe/Stockholm",
  BIKF: "Atlantic/Reykjavik",
  OMDB: "Asia/Dubai",
  OTBD: "Asia/Qatar",
  OEJN: "Asia/Riyadh",
  OERK: "Asia/Riyadh",
  OBBI: "Asia/Bahrain",
  RJTT: "Asia/Tokyo",
  RJBB: "Asia/Tokyo",
  RKSI: "Asia/Seoul",
  ZBAA: "Asia/Shanghai",
  ZSSS: "Asia/Shanghai",
  VHHH: "Asia/Hong_Kong",
  WSSS: "Asia/Singapore",
  VTBS: "Asia/Bangkok",
  WMKK: "Asia/Kuala_Lumpur",
  RPLL: "Asia/Manila",
  FACT: "Africa/Johannesburg",
  FAOR: "Africa/Johannesburg",
  FNLU: "Africa/Luanda",
  DTTA: "Africa/Tunis",
  HECA: "Africa/Cairo",
  GMMN: "Africa/Casablanca",
  DNAA: "Africa/Lagos",
  DNMM: "Africa/Lagos",
};

export function getAirportTimezone(icao: string): string {
  const key = (icao || "").toUpperCase().trim();
  return AIRPORT_TIMEZONES[key] || "UTC";
}

export function parseMETAR(metar: string): { temperature: string; windSpeed: string; windGust: string; windDir: string } {
  const defaults = { temperature: "--°C", windSpeed: "--", windGust: "--", windDir: "--" };
  if (!metar || typeof metar !== "string") return defaults;

  // Extract temperature: "24/18" → 24°C
  const tempMatch = metar.match(/\s(\d{2})\/\d{2}\s/);
  const temperature = tempMatch ? `${parseInt(tempMatch[1])}°C` : defaults.temperature;

  // Extract wind: "17011G20KT" or "17011KT"
  const windMatch = metar.match(/(\d{3})(\d{2})G?(\d{0,2})KT/);
  let windSpeed = defaults.windSpeed;
  let windGust = defaults.windGust;
  let windDir = defaults.windDir;

  if (windMatch) {
    windDir = windMatch[1];
    windSpeed = `${parseInt(windMatch[2])} KT`;
    windGust = windMatch[3] ? `${parseInt(windMatch[3])} KT` : "";
  }

  return { temperature, windSpeed, windGust, windDir };
}
