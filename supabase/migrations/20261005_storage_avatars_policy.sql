-- ============================================================================
-- Migración: acceso al bucket `avatars` (avatares de usuario) y `flight-photos`
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-05
--
-- Causa del síntoma "avatar no se muestra aunque la imagen está en el bucket":
-- el Desktop guarda y renderiza URLs PÚBLICAS (`getPublicUrl`). Si el bucket
-- es privado o `storage.objects` no tiene una policy de lectura, esas URLs
-- responden 403/400 y la UI cae al icono genérico.
--
-- Este script:
--   1) Marca los buckets como públicos (habilita la ruta /object/public sin
--      depender de RLS para la descarga).
--   2) Añade policies de escritura por dueño (carpeta raíz = auth.uid()) y una
--      policy de lectura autenticada. El código sube a `{userId}/...` (ver
--      AccountView), lo que permite el control por carpeta.
--
-- Nota: los avatares subidos antes con ruta plana `{userId}-...` no quedan
-- cubiertos por la policy por-carpeta de escritura, pero SÍ se leen porque el
-- bucket es público. Para re-subir, usar el botón de Cuenta (nueva ruta).
--
-- Aplicar: Supabase Dashboard → SQL Editor → pegar y ejecutar (idempotente).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Buckets públicos (descarga sin RLS).
-- ---------------------------------------------------------------------------
UPDATE storage.buckets SET public = true WHERE id = 'avatars';
UPDATE storage.buckets SET public = true WHERE id = 'flight-photos';

-- ---------------------------------------------------------------------------
-- 2) Policies de `storage.objects` para `avatars`.
--    Escritura (insert/update/delete): solo dueño de la carpeta `{userId}/...`.
--    Lectura: autenticados (respaldo cuando el bucket es privado).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "avatars_select_authenticated" ON storage.objects;
CREATE POLICY "avatars_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 3) Policies equivalentes para `flight-photos` (misma convención `{userId}/`).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "flight_photos_select_authenticated" ON storage.objects;
CREATE POLICY "flight_photos_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'flight-photos');

DROP POLICY IF EXISTS "flight_photos_insert_own" ON storage.objects;
CREATE POLICY "flight_photos_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'flight-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "flight_photos_update_own" ON storage.objects;
CREATE POLICY "flight_photos_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'flight-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'flight-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "flight_photos_delete_own" ON storage.objects;
CREATE POLICY "flight_photos_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'flight-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- Verificación:
--   select id, public from storage.buckets where id in ('avatars','flight-photos');
--   select policyname, cmd from pg_policies
--     where schemaname = 'storage' and tablename = 'objects'
--       and policyname like '%avatar%';
-- ============================================================================
