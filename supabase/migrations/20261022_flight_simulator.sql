-- ============================================================================
-- Migración: simulador utilizado por vuelo (`flights.simulator`)
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-22
--
-- Objetivo: registrar qué simulador operó cada vuelo para la estadística
-- "Distribución por Simulador" del HUB (torta MSFS2024 vs XPLANE12).
-- Valores permitidos: 'MSFS2024' y 'XPLANE12'. NULL = histórico / mock.
-- ============================================================================

ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS simulator text;

ALTER TABLE public.flights
  DROP CONSTRAINT IF EXISTS flights_simulator_check;

ALTER TABLE public.flights
  ADD CONSTRAINT flights_simulator_check
  CHECK (simulator IS NULL OR simulator IN ('MSFS2024', 'XPLANE12'));

COMMENT ON COLUMN public.flights.simulator IS
  'Simulador que operó el vuelo: MSFS2024 o XPLANE12 (NULL = histórico/mock).';
