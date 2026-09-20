# Changelog

Todas las modificaciones notables de este proyecto se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0-alpha] - 2026-09-20

### Añadido
- Tracking de vuelo: grabación en memoria del recorrido con downsampling por
  delta (rumbo > 2°, altitud > 500 ft, velocidad > 20 kt, forzado cada 60 s),
  hitos de despegue/toque, empaquetado GeoJSON `LineString` y persistencia en
  `flight_paths` + resumen (`air_time`, `distance_nm`, `departure_time`,
  `arrival_time`, `departure_date`) en `flights` al cerrar el vuelo (AT_GATE o
  botón Finalizar). Incluye trazas `[FLUSH_DEBUG]` y buffer conservado ante
  fallos (reintentable).
- Detalle de vuelo rediseñado en el User HUB: cabecera (vuelo/aerolínea/
  aeronave + foto), panel de ruta (ICAOs, nombres, horas, distancia), mapa
  interactivo del track (Leaflet) y gráfico Velocidad+Altitud vs. tiempo
  (Recharts, doble eje Y).
- Historial de vuelos recientes con datos reales de Supabase (`flights` del
  usuario, ordenado por `created_at DESC`): columnas Aerolínea, N° de Vuelo,
  Ruta, Fecha y Hora, Duración y Valoración (placeholder); loading, vacío y
  error con reintento; navegación al detalle por `flight_id`.

### Cambiado
- Pantallas de configuración de eventos (Vuelo Actual y Backoffice local):
  los anclas de transición de fase ya no se listan ni se persisten como
  opciones configurables por el usuario.
- Versión visible en el sidebar: muestra la versión real del build en vez del
  mock `v.0.1.0`.
- Detector de fases `simOnGround`/AGL-aware: fases de tierra, `TAKEOFF`,
  `CLIMB`, `APPROACH` y `LANDING` independientes de la elevación del
  aeropuerto (corrige CLIMB prematuro en campos elevados).
- Soporte `radio_height_gt/lt` en precondiciones `phase_transition`.
- Rama `delay_detection` con `time_stopped_gt` delega a `evaluateTimeStopped`
  (corrige `taxitogate_crew_delay_apologies` disparado por itinerario).

### Corregido
- Formato de tiempos al cierre del vuelo: `departure_time`/`arrival_time`
  (`time`) y `departure_date` (`date`) en UTC, en vez de ISO completo que
  Postgres rechazaba con `22007`.
- (Backend, repo edge functions, ya desplegado) alias `TAXI_IN → TAXI_TO_GATE`
  y `FLIGHT_COMPLETED → AT_GATE` en `scenarios-active`.

## [0.7.0-alpha] - 2026-09-20

### Añadido
- Narrativa completa de un vuelo GATE → AT_GATE en todas sus fases para el
  escenario `standard_commercial_flight`.
- Fail-closed para anclas `phase_transition` con `conditions` no reconocidas:
  se evalúan como no cumplidas (con advertencia única) en vez de caer en
  silencio a la receta clásica de TAXI.

### Corregido
- Mapeo de fase al cargar escenarios: `TAXI_IN → TAXI_TO_GATE` y
  `FLIGHT_COMPLETED → AT_GATE`. Sin esto, el Desktop pedía `phase=TAXI_IN`
  (HTTP 400 `INVALID_PHASE`), la fase quedaba sin pasos y el fallback saltaba a
  AT_GATE en 5 s, dejando TAXI_TO_GATE mudo.
- Provenance direccional TAXI vs TAXI_IN con un latch de arribo monotónico:
  una detección espuria de TAKEOFF durante la aproximación/rodadura ya no
  degrada la llegada a salida.
- `TAKEOFF` exige VS ≥ −100: deja de dispararse en el tramo final por debajo de
  500 ft, eliminando transiciones `APPROACH → TAKEOFF` inválidas.
- `transition_to_landing` reconoce `gear_down`: el ancla completa al bajar el
  tren (en aproximación) y la narrativa entra en LANDING antes del toque, sin
  pisarse con el rodaje.

## [0.6.0-alpha] - 2026-09-11

### Añadido
- Integración completa con MSFS vía SimConnect
- FlightController con telemetría en tiempo real
- Sistema de eventos narrativos con detección automática de fases
- Eventos de demora: parked, taxi, takeoff
- Transiciones automáticas: TAXI→TAKEOFF, TAKEOFF→CLIMB, CLIMB→CRUISE
- Sistema de música de embarque y desembarque
- Monitor de variables para depuración
- Variables de crucero: cruise_time, CRUISE_PROGRESS, PASSENGERS_SLEEPING, is_international
- Preferencias de usuario persistentes (idioma y voces)

### Cambiado
- Arquitectura de configuración de eventos (migración a flight_event_config)
- Sistema de detección de fases basado en telemetría real

### Corregido
- Sincronización de FlightContext con datos de SimBrief
- Carga de scheduler_rule y preconditions desde el snapshot
- Manejo de WAIT_CONDITION opcionales

## [0.5.0-alpha]

### Añadido
- Versión inicial con arquitectura básica
