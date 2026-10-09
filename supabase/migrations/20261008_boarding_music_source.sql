-- ============================================================================
-- Migración: fuente de música de embarque (IA vs pack comunidad)
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-08
--
-- Objetivo: persistir la fuente de música de embarque/desembarque del piloto
-- (`boarding_music_source`: 'ia' = pista del catálogo `boarding_music`,
-- 'pack' = audio de la comunidad `packages.package_type = 'boarding_audio'`).
-- Default 'ia' (comportamiento histórico).
-- ============================================================================

ALTER TABLE public.setting_general
  ADD COLUMN IF NOT EXISTS boarding_music_source text NOT NULL DEFAULT 'ia';
