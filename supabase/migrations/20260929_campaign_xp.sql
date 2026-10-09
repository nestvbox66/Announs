-- ============================================================================
-- Migración: asociación de vuelos con campañas + bonus multiplicador
-- Proyecto: Announs Desktop
-- Fecha: 2026-09-29
--
-- Objetivo: reservar el vuelo de campaña vigente al importar el plan
-- (`flights`) y persistir el bonus multiplicador (`flight_xp_breakdown`),
-- recibiéndolo en la RPC `process_flight_completion`.
--
-- Parte 1 (esta migración, idempotente): columnas nuevas.
-- Parte 2 (manual, ver bloque comentado abajo): agregar el parámetro
--   `p_campaign_multiplier` a la función `process_flight_completion`,
--   aplicar `total = round((base + bonus) * mult)` y exponer
--   `campaign_xp_awarded`. Hasta aplicarla, el Desktop reintenta la RPC sin
--   el parámetro (fallback automático: resto de XP intacto, campaña en 0).
-- ============================================================================

ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS campaign_id uuid NULL,
  ADD COLUMN IF NOT EXISTS campaign_flight_id uuid NULL,
  ADD COLUMN IF NOT EXISTS campaign_xp_multiplier numeric NULL;

ALTER TABLE public.flight_xp_breakdown
  ADD COLUMN IF NOT EXISTS campaign_xp numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Parte 2 — aplicar sobre la definición REAL de process_flight_completion
-- (ajustar nombres/tipos a los existentes). Plantilla del cambio mínimo:
--
--   CREATE OR REPLACE FUNCTION public.process_flight_completion(
--     ...params existentes...,
--     p_campaign_multiplier numeric DEFAULT 1.0
--   ) ...
--   -- dentro del cuerpo, donde se calcula el total del vuelo:
--   --   v_subtotal := v_base_xp + v_bonus_total;
--   --   v_mult := CASE
--   --     WHEN p_campaign_multiplier IS NULL OR p_campaign_multiplier < 1
--   --     THEN 1.0 ELSE p_campaign_multiplier END;
--   --   v_total := round(v_subtotal * v_mult);
--   --   v_campaign_xp := v_total - v_subtotal;
--   -- persistir v_campaign_xp en flight_xp_breakdown.campaign_xp y
--   -- exponerlo como campaign_xp_awarded en el resultado.
--
-- Verificación tras aplicar ambas partes (como usuario autenticado):
--   select campaign_xp from public.flight_xp_breakdown
--   order by created_at desc limit 5;
-- ---------------------------------------------------------------------------
