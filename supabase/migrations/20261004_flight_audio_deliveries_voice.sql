-- ============================================================================
-- Script: agregar narrador al historial de audios (Dashboard → SQL Editor)
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-04
--
-- Agrega `voice_id` (voz de `voices_stock` que narró el anuncio) a
-- `public.flight_audio_deliveries`. Requiere la tabla ya creada
-- (migración 20261003 o creación manual previa). Sin FK para no bloquear
-- el INSERT del Edge si la voz se elimina del catálogo después.
-- Idempotente: se puede ejecutar varias veces sin error.
-- ============================================================================

ALTER TABLE public.flight_audio_deliveries
  ADD COLUMN IF NOT EXISTS voice_id uuid NULL;

-- Verificación:
-- select voice_id, count(*) from public.flight_audio_deliveries
-- group by voice_id order by count(*) desc;
