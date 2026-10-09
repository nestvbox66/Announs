-- ============================================================================
-- Migración: satisfacción de pasajeros + XP de pasajeros
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-02
--
-- Objetivo: persistir al cierre del vuelo (solo `flight_status = 'ended'`)
--   * `flights.global_satisfaction` (0-100, score final del motor)
--   * `flights.passenger_attributes_summary` (JSONB con niveles de NECESIDAD
--     0-100, bajo = bien: { hunger, bladder, fear, boredom } = 100 - el
--     promedio de satisfacción de { saciedad, confortFisiologico, calma,
--     entretenimiento })
--   * `flights.passenger_xp_awarded` (XP otorgada, proporcional al base con
--     techo del 20% y piso de score 40; nunca negativa)
--   y recibir `p_passenger` en la RPC `process_flight_completion`.
--
-- Parte 1 (esta migración, idempotente): columnas nuevas con defaults.
--   La policy `flights_update_own` (migración 20260926) ya permite al Desktop
--   actualizar su propia fila, así que no se agregan policies.
-- Parte 2 (manual, ver bloque comentado abajo): agregar el parámetro
--   `p_passenger` a la función `process_flight_completion` y sumarlo al
--   total. Hasta aplicarla, el Desktop reintenta la RPC sin el parámetro
--   (fallback automático: resto de XP intacto, pasajeros en 0) y los campos
--   de `flights` igual quedan persistidos por el UPDATE directo.
-- ============================================================================

ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS global_satisfaction numeric NULL,
  ADD COLUMN IF NOT EXISTS passenger_attributes_summary jsonb NULL,
  ADD COLUMN IF NOT EXISTS passenger_xp_awarded numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Parte 2 — aplicar sobre la definición REAL de process_flight_completion
-- (ajustar nombres/tipos a los existentes). Plantilla del cambio mínimo:
--
--   CREATE OR REPLACE FUNCTION public.process_flight_completion(
--     ...params existentes...,
--     p_passenger numeric DEFAULT 0
--   ) ...
--   -- dentro del cuerpo, donde se suman los bonos al total del vuelo:
--   --   v_total := v_total + COALESCE(p_passenger, 0);
--   -- (opcional) persistir el desglose en flight_xp_breakdown si se agrega
--   --   la columna `passenger_xp_awarded` a esa tabla también.
--
-- Verificación tras aplicar ambas partes (como usuario autenticado):
--   select global_satisfaction, passenger_xp_awarded,
--          passenger_attributes_summary
--   from public.flights
--   where flight_status = 'ended'
--   order by created_at desc limit 5;
-- ---------------------------------------------------------------------------
