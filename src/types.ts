/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum FlightState {
  NoIniciado = "A",
  PreEmbarque = "B",
  EnVuelo = "C",
  Aterrizado = "D"
}

export interface Incidencia {
  id: string;
  tiempo: string; // tiempo de vuelo transcurrido, p.ej. "00:12" o "Antes de despegue"
  tipo: "miedo" | "servicio" | "turbulencia" | "satisfaccion" | "info" | "otros";
  titulo: string;
  descripcion: string;
  impactoMiedo: number; // variación
  impactoSatisfaccion: number; // variación
}

export interface Pasajero {
  id: string;
  nombre: string;
  nacionalidad: string;
  nacionalidadCodigo: string; // AR, US, ES, BR, etc.
  asiento: string; // p.ej. "12C"
  edad: number;
  miedo: number; // 0 a 100
  satisfaccion: number; // 0 a 100
  hambre: number; // 0 a 100
  bano: number; // 0 a 100 (necesidad de ir al baño, 100 es urgente)
  genero: "M" | "F" | "O";
  clase: "Ejecutiva" | "Económica" | "Primera";
  incidencias: Incidencia[];
}

export interface VueloReciente {
  id: string;
  codigo: string; // AR1842
  origen: string; // SABE
  origenCiudad: string; // Buenos Aires
  destino: string; // SACO
  destinoCiudad: string; // Córdoba
  fecha: string;
  fpmLanding: number; // -120 fpm
  satisfaccionMedia: number; // 94%
  puntuacion: number; // score 4500 XP
  duracion: string; // "1h 15m"
  aerolinea: string; // "Aerolíneas Argentinas"
}

export interface Logro {
  id: string;
  titulo: string;
  descripcion: string;
  icono: string; // nombre de icono a renderizar
  desbloqueado: boolean;
  fechaDesbloqueo?: string;
  tipo: "vuelos" | "aterrizaje" | "pasajeros" | "secreto";
}

export interface SimBriefData {
  username: string;
  nombrePiloto: string;
  vueloCodigo: string;
  origen: string;
  destino: string;
  aerolinea: string;
  avion: string; // A320, B738, etc.
  cruisingAltitude: string; // FL320
  blockTime: string; // "75 min"
  pasajerosCount: number;
}

export interface ConfigVoces {
  idiomaCapitan: "Español (ES)" | "Español (AR)" | "Inglés (US)" | "Inglés (UK)";
  idiomaTripulacion: "Español (ES)" | "Español (AR)" | "Inglés (US)" | "Inglés (UK)" | "Bilingüe (ES/EN)" | "Ninguno";
  volumenVoz: number; // 0-100
  timbreVoz: "agudo" | "medio" | "grave";
  efectoRadio: boolean;
}

export interface ConfigAudio {
  eqGrave: number; // -10 a 10
  eqMedio: number;
  eqAgudo: number;
  musicaEmbarque: boolean;
  volumenAmbiente: number;
  ruidoCabina: boolean;
}

export interface UltimoAnuncio {
  id: string;
  tiempo: string;
  tipo: "bienvenida" | "seguridad" | "turbulencia" | "descenso" | "aterrizaje" | "desembarque";
  texto: string;
  reproduciendo: boolean;
  duracion: number; // en segundos, p.ej. 15
}
