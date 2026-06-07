/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VueloReciente, Logro, Pasajero, SimBriefData, ConfigVoces, ConfigAudio, UltimoAnuncio } from "./types";

export const vuelosRecientes: VueloReciente[] = [
  {
    id: "v-1",
    codigo: "AR1842",
    origen: "SABE",
    origenCiudad: "Buenos Aires (Aeroparque)",
    destino: "SACO",
    destinoCiudad: "Córdoba",
    fecha: "04 Jun 2026",
    fpmLanding: -145,
    satisfaccionMedia: 96,
    puntuacion: 4850,
    duracion: "1h 10m",
    aerolinea: "Aerolíneas Argentinas"
  },
  {
    id: "v-2",
    codigo: "LA2411",
    origen: "SAEZ",
    origenCiudad: "Buenos Aires (Ezeiza)",
    destino: "SCEL",
    destinoCiudad: "Santiago de Chile",
    fecha: "30 May 2026",
    fpmLanding: -90,
    satisfaccionMedia: 88,
    puntuacion: 5200,
    duracion: "1h 55m",
    aerolinea: "LATAM"
  },
  {
    id: "v-3",
    codigo: "G3 7453",
    origen: "SBGR",
    origenCiudad: "São Paulo (Guarulhos)",
    destino: "SABE",
    destinoCiudad: "Buenos Aires",
    fecha: "25 May 2026",
    fpmLanding: -210,
    satisfaccionMedia: 79,
    puntuacion: 3900,
    duracion: "2h 45m",
    aerolinea: "Gol Linhas Aéreas"
  },
  {
    id: "v-4",
    codigo: "WJ 3410",
    origen: "SABE",
    origenCiudad: "Buenos Aires (Aeroparque)",
    destino: "SASA",
    destinoCiudad: "Salta",
    fecha: "18 May 2026",
    fpmLanding: -120,
    satisfaccionMedia: 94,
    puntuacion: 4600,
    duracion: "2h 05m",
    aerolinea: "JetSMART"
  },
  {
    id: "v-5",
    codigo: "AR1240",
    origen: "SACO",
    origenCiudad: "Córdoba",
    destino: "SAZN",
    destinoCiudad: "Neuquén",
    fecha: "10 May 2026",
    fpmLanding: -115,
    satisfaccionMedia: 91,
    puntuacion: 4200,
    duracion: "1h 30m",
    aerolinea: "Aerolíneas Argentinas"
  }
];

export const listaLogros: Logro[] = [
  {
    id: "l-1",
    titulo: "Piloto Patagónico",
    descripcion: "Completa 5 vuelos con origen o destino en el sur argentino.",
    icono: "Plane",
    desbloqueado: true,
    fechaDesbloqueo: "22 May 2026",
    tipo: "vuelos"
  },
  {
    id: "l-2",
    titulo: "Seda en los Mandos",
    descripcion: "Registra un aterrizaje impecable de menos de -100 FPM.",
    icono: "Zap",
    desbloqueado: true,
    fechaDesbloqueo: "30 May 2026",
    tipo: "aterrizaje"
  },
  {
    id: "l-3",
    titulo: "Anfitrión Supremo",
    descripcion: "Mantén la satisfacción promedio por encima del 95% en un vuelo de larga duración.",
    icono: "Heart",
    desbloqueado: false,
    tipo: "pasajeros"
  },
  {
    id: "l-4",
    titulo: "Primer Oficial de SimBrief",
    descripcion: "Realiza tu primera importación oficial de plan de vuelo desde SimBrief.",
    icono: "FileInput",
    desbloqueado: true,
    fechaDesbloqueo: "15 May 2026",
    tipo: "vuelos"
  },
  {
    id: "l-5",
    titulo: "Cruzando la Cordillera",
    descripcion: "Realiza la ruta transandina entre Buenos Aires y Santiago con turbulencia extrema bajo control.",
    icono: "Compass",
    desbloqueado: false,
    tipo: "vuelos"
  },
  {
    id: "l-6",
    titulo: "Calma de Hierro",
    descripcion: "Logra tranquilizar a un pasajero con nivel de miedo superior a 90%.",
    icono: "Shield",
    desbloqueado: false,
    tipo: "pasajeros"
  }
];

export const pasajerosMock: Pasajero[] = [
  {
    id: "p-1",
    nombre: "Federico Lértora",
    nacionalidad: "Argentina",
    nacionalidadCodigo: "AR",
    asiento: "04A",
    edad: 42,
    miedo: 15,
    satisfaccion: 92,
    hambre: 25,
    bano: 10,
    genero: "M",
    clase: "Primera",
    incidencias: [
      {
        id: "inc-1-1",
        tiempo: "Pre-Embarque",
        tipo: "satisfaccion",
        titulo: "Bebida de Bienvenida",
        descripcion: "Recibió su champán solicitado a tiempo. Excelente disposición.",
        impactoMiedo: 0,
        impactoSatisfaccion: 10
      },
      {
        id: "inc-1-2",
        tiempo: "00:15",
        tipo: "info",
        titulo: "Pregunta sobre el Clima",
        descripcion: "El pasajero consultó las condiciones meteorológicas en Córdoba.",
        impactoMiedo: -5,
        impactoSatisfaccion: 5
      }
    ]
  },
  {
    id: "p-2",
    nombre: "Mariana Silva",
    nacionalidad: "Brasil",
    nacionalidadCodigo: "BR",
    asiento: "12C",
    edad: 29,
    miedo: 65,
    satisfaccion: 78,
    hambre: 60,
    bano: 44,
    genero: "F",
    clase: "Económica",
    incidencias: [
      {
        id: "inc-2-1",
        tiempo: "Pre-Embarque",
        tipo: "miedo",
        titulo: "Ansiedad de despegue",
        descripcion: "Muestra nerviosismo al escuchar ruidos hidráulicos de las compuertas del tren.",
        impactoMiedo: 15,
        impactoSatisfaccion: -8
      }
    ]
  },
  {
    id: "p-3",
    nombre: "Jean-Pierre Dupont",
    nacionalidad: "Francia",
    nacionalidadCodigo: "FR",
    asiento: "02F",
    edad: 58,
    miedo: 5,
    satisfaccion: 85,
    hambre: 40,
    bano: 15,
    genero: "M",
    clase: "Primera",
    incidencias: [
      {
        id: "inc-3-1",
        tiempo: "00:10",
        tipo: "servicio",
        titulo: "Excelente Servicio de Café",
        descripcion: "Elogió la temperatura de la infusión exprés ofrecida en la cabina VIP.",
        impactoMiedo: 0,
        impactoSatisfaccion: 15
      }
    ]
  },
  {
    id: "p-4",
    nombre: "Sofía Martínez",
    nacionalidad: "Argentina",
    nacionalidadCodigo: "AR",
    asiento: "17E",
    edad: 9,
    miedo: 40,
    satisfaccion: 95,
    hambre: 85,
    bano: 20,
    genero: "F",
    clase: "Económica",
    incidencias: [
      {
        id: "inc-4-1",
        tiempo: "00:05",
        tipo: "satisfaccion",
        titulo: "Set de Dibujo Recibido",
        descripcion: "La tripulación le obsequió un cuaderno para pintar de Announs Airlines.",
        impactoMiedo: -10,
        impactoSatisfaccion: 20
      }
    ]
  },
  {
    id: "p-5",
    nombre: "Santiago Solari",
    nacionalidad: "Argentina",
    nacionalidadCodigo: "AR",
    asiento: "11B",
    edad: 34,
    miedo: 90,
    satisfaccion: 45,
    hambre: 10,
    bano: 85,
    genero: "M",
    clase: "Económica",
    incidencias: [
      {
        id: "inc-5-1",
        tiempo: "Pre-Embarque",
        tipo: "miedo",
        titulo: "Aerofobia Activa",
        descripcion: "Comentó tener un historial severo de pánico a volar. Solicita reaseguros constantes.",
        impactoMiedo: 25,
        impactoSatisfaccion: -15
      },
      {
        id: "inc-5-2",
        tiempo: "00:08",
        tipo: "turbulencia",
        titulo: "Pánico por Bache de Aire",
        descripcion: "Durante el ascenso inicial, un pozo de aire moderado causó un sobresalto severo. Comenzó a hiperventilar.",
        impactoMiedo: 20,
        impactoSatisfaccion: -20
      }
    ]
  },
  {
    id: "p-6",
    nombre: "Elena Rostova",
    nacionalidad: "Rusia",
    nacionalidadCodigo: "RU",
    asiento: "05D",
    edad: 31,
    miedo: 10,
    satisfaccion: 80,
    hambre: 50,
    bano: 30,
    genero: "F",
    clase: "Ejecutiva",
    incidencias: []
  },
  {
    id: "p-7",
    nombre: "Oliver Brown",
    nacionalidad: "Reino Unido",
    nacionalidadCodigo: "GB",
    asiento: "08C",
    edad: 48,
    miedo: 22,
    satisfaccion: 70,
    hambre: 90,
    bano: 60,
    genero: "M",
    clase: "Ejecutiva",
    incidencias: [
      {
        id: "inc-7-1",
        tiempo: "00:12",
        tipo: "servicio",
        titulo: "Retraso en Aperitivos",
        descripcion: "Su comida especial solicitada en reserva aún no fue clasificada por la tripulación.",
        impactoMiedo: 0,
        impactoSatisfaccion: -12
      }
    ]
  },
  {
    id: "p-8",
    nombre: "Alejandro Sanz",
    nacionalidad: "España",
    nacionalidadCodigo: "ES",
    asiento: "24F",
    edad: 25,
    miedo: 30,
    satisfaccion: 88,
    hambre: 20,
    bano: 15,
    genero: "M",
    clase: "Económica",
    incidencias: []
  }
];

export const defaultSimBrief: SimBriefData = {
  username: "capitán_msfs2024",
  nombrePiloto: "N. Sassano",
  vueloCodigo: "AR1842",
  origen: "SABE",
  destino: "SACO",
  aerolinea: "Aerolíneas Argentinas",
  avion: "Boeing 737-800",
  cruisingAltitude: "FL320 (32,000 pies)",
  blockTime: "75 minutos",
  pasajerosCount: 142
};

export const defaultVocesConfig: ConfigVoces = {
  idiomaCapitan: "Español (AR)",
  idiomaTripulacion: "Español (AR)",
  volumenVoz: 85,
  timbreVoz: "medio",
  efectoRadio: true
};

export const defaultAudioConfig: ConfigAudio = {
  eqGrave: 4,
  eqMedio: 1,
  eqAgudo: -2,
  musicaEmbarque: true,
  volumenAmbiente: 40,
  ruidoCabina: true
};

export const anunciosSimulados: UltimoAnuncio[] = [
  {
    id: "a-1",
    tiempo: "Pre-Embarque",
    tipo: "bienvenida",
    texto: "Señores pasajeros, en nombre de la tripulación de cabina y del comandante N. Sassano, les damos la bienvenida a bordo de este vuelo AR1842 con destino a la hermosa Ciudad de Córdoba. Estimamos un vuelo de 1 hora y 10 minutos con condiciones climáticas estables en ruta. Solicitamos acomodar sus equipajes de mano.",
    reproduciendo: false,
    duracion: 18
  },
  {
    id: "a-2",
    tiempo: "Antes del despegue",
    tipo: "seguridad",
    texto: "Por favor, presten atención a las indicaciones de seguridad. Asegúrense de tener el cinturón de seguridad abrochado, el respaldo del asiento en posición vertical y la mesa individual rebatida y asegurada para el despegue.",
    reproduciendo: false,
    duracion: 20
  },
  {
    id: "a-3",
    tiempo: "Durante el vuelo",
    tipo: "turbulencia",
    texto: "Señores pasajeros, el capitán ha encendido la señal de cinturones de seguridad debido a que estamos atravesando una zona de turbulencias ligeras sobre la provincia de Santa Fe. Les solicitamos permanecer en sus asientos con los cinturones abrochados.",
    reproduciendo: false,
    duracion: 15
  },
  {
    id: "a-4",
    tiempo: "Descenso",
    tipo: "descenso",
    texto: "Estimados clientes, hemos iniciado el descenso hacia el Aeropuerto de Córdoba. La temperatura actual es de 18 grados Celsius con viento calmo del sector norte. Les pedimos guardar sus dispositivos electrónicos.",
    reproduciendo: false,
    duracion: 12
  },
  {
    id: "a-5",
    tiempo: "Aterrizaje",
    tipo: "aterrizaje",
    texto: "Bienvenidos al Aeropuerto Internacional Ambrosio Taravella de Córdoba. Por motivos de seguridad, les rogamos permanezcan sentados con el cinturón de seguridad abrochado hasta que el avión se detenga por completo y el comandante apague la señal de cinturones.",
    reproduciendo: false,
    duracion: 14
  }
];
