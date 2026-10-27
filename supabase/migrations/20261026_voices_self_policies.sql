-- 20261026_voices_self_policies.sql
-- Asegura las policies de `voices` (preferencias de voces por usuario) y
-- lectura de `voices_stock`. Pegar en Supabase Dashboard -> SQL Editor y
-- ejecutar. Al final imprime el diagnóstico para verificar.
--
-- Causa típica del error "new row violates row-level security policy" aun
-- con una policy de INSERT visible: la policy existente solo define USING
-- (en INSERT solo se evalúa WITH CHECK), compara tipos incompatibles
-- (user_id text vs auth.uid() uuid) o convive con una policy restrictiva.

-- 1. Permisos base (sin GRANT el error sería otro, pero se aseguran igual).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voices TO authenticated;
GRANT SELECT ON public.voices_stock TO authenticated;

-- 2. RLS activado en ambas tablas.
ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voices_stock ENABLE ROW LEVEL SECURITY;

-- 3. Policies de autofestión en `voices` (se recrean para pisar versiones
-- defectuosas: USING sin WITH CHECK, chequeo a otra columna, rol erróneo).
-- El casteo a text cubre user_id uuid o text indistintamente.
DROP POLICY IF EXISTS voices_select_own ON public.voices;
CREATE POLICY voices_select_own ON public.voices
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS voices_insert_own ON public.voices;
CREATE POLICY voices_insert_own ON public.voices
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS voices_update_own ON public.voices;
CREATE POLICY voices_update_own ON public.voices
  FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS voices_delete_own ON public.voices;
CREATE POLICY voices_delete_own ON public.voices
  FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id::text);

-- 4. Constraint único que exige el upsert (user_id, voicestock_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voices_user_stock_unique'
  ) THEN
    ALTER TABLE public.voices
      ADD CONSTRAINT voices_user_stock_unique UNIQUE (user_id, voicestock_id);
  END IF;
END
$$;

-- 5. Lectura del catálogo para autenticados (solo suma; no toca escrituras
-- ni otras policies existentes de voices_stock).
DROP POLICY IF EXISTS voices_stock_select_all ON public.voices_stock;
CREATE POLICY voices_stock_select_all ON public.voices_stock
  FOR SELECT TO authenticated
  USING (true);

-- 6. Diagnóstico: revisar la salida tras ejecutar.
--    a) Debe listar las 4 policies de voices + la de voices_stock.
SELECT tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('voices', 'voices_stock')
 ORDER BY tablename, cmd;

--    b) Debe existir el unique (user_id, voicestock_id).
SELECT conname, pg_get_constraintdef(oid) AS definicion
  FROM pg_constraint
 WHERE conrelid = 'public.voices'::regclass;

--    c) Tipos de columna (user_id debería ser uuid o text, sin NOT NULL raros
--       sin default que bloqueen el insert de solo 3 columnas).
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'voices'
 ORDER BY ordinal_position;
