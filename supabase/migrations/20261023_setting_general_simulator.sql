-- ============================================================================
-- Migración: preferencia de simulador de vuelo del piloto
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-23
--
-- Objetivo: persistir la preferencia de simulador elegida en
-- Configuración / Generales (`setting_general.simulator`).
-- Valores permitidos: 'MSFS2024' y 'XPLANE12'. NULL = sin preferencia.
-- ============================================================================

ALTER TABLE public.setting_general
  ADD COLUMN IF NOT EXISTS simulator text;

ALTER TABLE public.setting_general
  DROP CONSTRAINT IF EXISTS setting_general_simulator_check;

ALTER TABLE public.setting_general
  ADD CONSTRAINT setting_general_simulator_check
  CHECK (simulator IS NULL OR simulator IN ('MSFS2024', 'XPLANE12'));

COMMENT ON COLUMN public.setting_general.simulator IS
  'Preferencia de simulador del piloto: MSFS2024 o XPLANE12 (NULL = sin preferencia).';
