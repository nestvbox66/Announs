# Changelog

Todas las modificaciones notables de este proyecto se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
