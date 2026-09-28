-- ============================================================================
-- Migración: bonus de baliza (disc_beacon_lights_xp, 20 XP)
-- Proyecto: Announs Desktop
-- Fecha: 2026-09-28
--
-- Objetivo: persistir el bonus de LIGHT BEACON en `flight_xp_breakdown` y
-- recibirlo en la RPC `process_flight_completion`.
--
-- Parte 1 (esta migración, idempotente): columna nueva con default 0.
-- Parte 2 (manual, ver bloque comentado abajo): agregar el parámetro
--   `p_disc_beacon` a la función `process_flight_completion` y sumarlo al
--   total. Hasta aplicarla, el Desktop reintenta la RPC sin el parámetro
--   (fallback automático: resto de XP intacto, beacon en 0).
-- ============================================================================

ALTER TABLE public.flight_xp_breakdown
  ADD COLUMN IF NOT EXISTS disc_beacon_lights_xp numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Parte 2 — aplicar sobre la definición REAL de process_flight_completion
-- (ajustar nombres/tipos a los existentes). Plantilla del cambio mínimo:
--
--   CREATE OR REPLACE FUNCTION public.process_flight_completion(
--     ...params existentes...,
--     p_disc_beacon numeric DEFAULT 0
--   ) ...
--   -- dentro del cuerpo, donde se insertan/actualizan los bonos:
--   --   disc_beacon_lights_xp = COALESCE(p_disc_beacon, 0),
--   -- y sumar p_disc_beacon al total del vuelo (total_flight_xp).
--
-- Verificación tras aplicar ambas partes (como usuario autenticado):
--   select disc_beacon_lights_xp from public.flight_xp_breakdown
--   order by created_at desc limit 5;
-- ---------------------------------------------------------------------------
