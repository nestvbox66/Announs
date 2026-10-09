-- ============================================================================
-- Migración: ritmo de embarque configurable (pax/min) — default del piloto
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-07
--
-- Objetivo: persistir el ritmo de embarque global del piloto
-- (`boarding_pax_per_minute`, pasajeros por minuto, default 60 = 1 pax/s, el
-- comportamiento histórico). Lo consume la pantalla de vuelo como default;
-- cada vuelo puede sobrescribirlo en pre-vuelo (solo memoria/local).
-- La columna legacy `passenger_boarding_time_seconds` no se toca.
-- ============================================================================

ALTER TABLE public.setting_general
  ADD COLUMN IF NOT EXISTS boarding_pax_per_minute integer NOT NULL DEFAULT 60;
