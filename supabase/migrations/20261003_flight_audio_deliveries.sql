-- ============================================================================
-- Migración: historial de audios entregados por vuelo
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-03
--
-- Objetivo: la Edge Function `audio-get` registra cada audio entregado con
-- éxito (texto + URL + posición) para alimentar la línea de tiempo de la
-- pestaña Anuncios del reporte de vuelo.
--
-- Tabla `public.flight_audio_deliveries`:
--   * flight_id (vuelo), event_id (evento de `events`)
--   * delivered_at (entrega, default now())
--   * audio_url (audio final entregado), message_text (texto plano)
--   * voice_id (voz de `voices_stock` que narró, sin FK)
--   * flight_path_index (índice del punto más cercano del recorrido, NULL si
--     no había recorrido persistido), latitude/longitude (posición al
--     disparar, NULL si el cliente no la envió)
--
-- RLS: lectura propia (el Desktop consulta sus vuelos). El INSERT lo hace la
-- Edge con service_role (bypasea RLS); igual se deja policy de inserción
-- propia por completitud.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.flight_audio_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL REFERENCES public.flights (id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  audio_url text NULL,
  message_text text NULL,
  flight_path_index integer NULL,
  latitude numeric NULL,
  longitude numeric NULL,
  -- Voz que narró (`voices_stock.id`, sin FK para no bloquear el INSERT).
  voice_id uuid NULL
);

CREATE INDEX IF NOT EXISTS flight_audio_deliveries_flight_time_idx
  ON public.flight_audio_deliveries (flight_id, delivered_at ASC);

ALTER TABLE public.flight_audio_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flight_audio_deliveries_select_own" ON public.flight_audio_deliveries;
CREATE POLICY "flight_audio_deliveries_select_own"
  ON public.flight_audio_deliveries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.flights f
      WHERE f.id = flight_audio_deliveries.flight_id
        AND f.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "flight_audio_deliveries_insert_own" ON public.flight_audio_deliveries;
CREATE POLICY "flight_audio_deliveries_insert_own"
  ON public.flight_audio_deliveries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.flights f
      WHERE f.id = flight_audio_deliveries.flight_id
        AND f.user_id = auth.uid()
    )
  );

-- Verificación (como usuario autenticado, tras un vuelo con anuncios):
-- select event_id, delivered_at, flight_path_index, latitude, longitude,
--        left(message_text, 60) as texto
-- from public.flight_audio_deliveries
-- order by delivered_at desc limit 10;
