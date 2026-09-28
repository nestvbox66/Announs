-- ============================================================================
-- Migración: foto de la sesión en el reporte de vuelo
-- Proyecto: Announs Desktop
-- Fecha: 2026-09-26
--
-- Objetivo: persistencia real de la "Foto de la Sesión" del reporte de vuelo.
--   * `public.flights` -> columna `photo_url` (URL pública de la foto).
--   * Bucket `flight-photos` (público, para renderizar con <img> sin firmar).
--   * Policies de Storage: lectura pública; escritura solo en la carpeta
--     propia (`{userId}/...`), que es la ruta que usa el Desktop:
--     `{userId}/{flightId}_session_photo.jpg`.
--   * Policy de UPDATE propia en `flights` (por si el proyecto aún no la
--     tiene; el Desktop ya actualiza sus filas para el resto de campos).
--
-- La migración es idempotente: se puede ejecutar varias veces sin error.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. flights.photo_url
-- ---------------------------------------------------------------------------
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS photo_url text;

-- ---------------------------------------------------------------------------
-- 2. Bucket `flight-photos` (público: lectura vía URL pública)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('flight-photos', 'flight-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ---------------------------------------------------------------------------
-- 3. Policies de Storage sobre `storage.objects`
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'flight-photos public read'
  ) THEN
    CREATE POLICY "flight-photos public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'flight-photos');
  END IF;

  -- Solo el dueño puede subir dentro de su propia carpeta `{userId}/...`.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'flight-photos insert own folder'
  ) THEN
    CREATE POLICY "flight-photos insert own folder"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'flight-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'flight-photos update own folder'
  ) THEN
    CREATE POLICY "flight-photos update own folder"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'flight-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'flight-photos delete own folder'
  ) THEN
    CREATE POLICY "flight-photos delete own folder"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'flight-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. UPDATE propio en `flights` (el Desktop guarda `photo_url` en su fila).
--    Idempotente: solo se crea si no existe una policy con ese nombre.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'flights'
      AND policyname = 'flights_update_own'
  ) THEN
    CREATE POLICY flights_update_own
      ON public.flights FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
