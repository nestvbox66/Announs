-- ============================================================================
-- Migración: columna `hard` en `airports` (aeropuertos difíciles)
-- Proyecto: Announs Desktop
-- Fecha: 2026-09-27
--
-- Objetivo: permitir el bonus XP `hard_airport_bonus_xp` (+30 XP) al
-- finalizar en un destino de operación compleja
-- (`FlightCompletionBonuses.resolveHardAirportBonus` consulta
-- `airports.hard` para el `dest_icao`).
--
-- La migración es idempotente: se puede ejecutar varias veces sin error.
-- El curado de qué aeropuertos llevan `hard = true` queda a cargo de un
-- UPDATE posterior (por defecto todos son `false`).
-- ============================================================================

ALTER TABLE public.airports
  ADD COLUMN IF NOT EXISTS hard boolean NOT NULL DEFAULT false;
