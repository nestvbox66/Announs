-- ============================================================================
-- Migración: efecto de distorsión en música de embarque (default del piloto)
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-07
--
-- Objetivo: persistir la preferencia "aplicar efecto de distorsión a la
-- música de embarque" (`boarding_music_distortion`, default true = "Sí").
-- ============================================================================

ALTER TABLE public.setting_general
  ADD COLUMN IF NOT EXISTS boarding_music_distortion boolean NOT NULL DEFAULT true;
