-- ============================================================================
-- Migración: catálogo de paquetes multimedia (Settings / Packages)
-- Proyecto: Announs Desktop
-- Fecha: 2026-10-06
--
-- Objetivo: garantizar el esquema que consume la pestaña Packages del
-- Desktop (servicio `PackagesService` + componentes `src/components/packages/`).
--
-- Tablas:
--   * public.packages: catálogo (package_name, package_desc, package_type
--     [boarding_audio | safety_video | airport_chime], package_url,
--     cover_image_url, duration_seconds, status [default pending],
--     airline_icao, package_enabled, user_id, created_at).
--   * public.user_package_preferences: preferencia personal del piloto por
--     paquete (user_id, package_id, is_enabled, updated_at; UNIQUE por par).
--
-- Storage: bucket público `packages` (rutas `{userId}/covers/...` y
-- `{userId}/media/...`; descarga vía getPublicUrl sin RLS).
--
-- Todo es idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS): seguro de
-- aplicar aunque las tablas ya existan.
-- Aplicar: Supabase Dashboard → SQL Editor → pegar y ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabla `public.packages`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name text NOT NULL,
  package_desc text NULL,
  package_type text NOT NULL
    CHECK (package_type IN ('boarding_audio', 'safety_video', 'airport_chime')),
  package_url text NULL,
  cover_image_url text NULL,
  duration_seconds integer NULL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  status text NOT NULL DEFAULT 'pending',
  airline_icao text NULL,
  package_enabled boolean NOT NULL DEFAULT true,
  user_id uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS packages_type_status_idx
  ON public.packages (package_type, status);
CREATE INDEX IF NOT EXISTS packages_airline_idx
  ON public.packages (airline_icao);

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "packages_select_all" ON public.packages;
CREATE POLICY "packages_select_all"
  ON public.packages FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "packages_insert_own" ON public.packages;
CREATE POLICY "packages_insert_own"
  ON public.packages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "packages_update_own" ON public.packages;
CREATE POLICY "packages_update_own"
  ON public.packages FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) Tabla `public.user_package_preferences`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_package_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages (id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, package_id)
);

CREATE INDEX IF NOT EXISTS user_package_preferences_user_idx
  ON public.user_package_preferences (user_id);

ALTER TABLE public.user_package_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_package_preferences_select_own" ON public.user_package_preferences;
CREATE POLICY "user_package_preferences_select_own"
  ON public.user_package_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_package_preferences_upsert_own" ON public.user_package_preferences;
CREATE POLICY "user_package_preferences_upsert_own"
  ON public.user_package_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_package_preferences_update_own" ON public.user_package_preferences;
CREATE POLICY "user_package_preferences_update_own"
  ON public.user_package_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3) Bucket público `packages` + policies de `storage.objects`.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('packages', 'packages', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "packages_select_authenticated" ON storage.objects;
CREATE POLICY "packages_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'packages');

DROP POLICY IF EXISTS "packages_insert_own" ON storage.objects;
CREATE POLICY "packages_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'packages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "packages_update_own" ON storage.objects;
CREATE POLICY "packages_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'packages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'packages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "packages_delete_own" ON storage.objects;
CREATE POLICY "packages_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'packages'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- Verificación:
--   select id, package_name, package_type, status from public.packages limit 5;
--   select id, public from storage.buckets where id = 'packages';
-- ============================================================================
