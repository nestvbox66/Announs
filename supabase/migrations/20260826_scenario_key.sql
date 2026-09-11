-- ============================================================================
-- Migración: configuración de eventos por escenario
-- Proyecto: Announs Desktop
-- Fecha: 2026-08-26
--
-- Objetivo: vincular la configuración de eventos a escenarios.
--   * `user_event_defaults`  -> columna `scenario_key` (config por defecto del
--                               usuario POR ESCENARIO)
--   * `flight_event_config`  -> columna `scenario_key` (config específica de un
--                               vuelo POR ESCENARIO)
--   * `flights`              -> columna `scenario_key` (escenario del vuelo)
--   * `users`                -> columna `default_scenario_key` (escenario por
--                               defecto del usuario, default `standard_commercial_flight`)
--
-- La migración es idempotente: se puede ejecutar varias veces sin error.
--
-- Convención de valores de `value` / `enabled_switch`: SIEMPRE en minúsculas
-- (`off` | `pack` | `ia`). El Desktop normaliza a minúsculas al guardar y a
-- mayúsculas al cargar para la UI. Las restricciones CHECK de la DB (si las
-- hay) deben permitir únicamente 'off', 'pack', 'ia'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. user_event_defaults
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_event_defaults (
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_key   text NOT NULL,
  value       text NOT NULL DEFAULT 'ia',
  scenario_key text NOT NULL DEFAULT 'standard_commercial_flight',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_event_defaults
  ADD COLUMN IF NOT EXISTS scenario_key text NOT NULL DEFAULT 'standard_commercial_flight';

-- Índice único por usuario + evento + escenario (evita duplicados en el upsert).
-- NOTA: si existiera una constraint única heredada sobre (user_id, event_key)
-- (modelo pre-escenario), habrá que eliminarla para permitir una fila por
-- escenario. Ejemplo: ALTER TABLE user_event_defaults DROP CONSTRAINT <nombre>;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'user_event_defaults'
      AND indexname = 'user_event_defaults_user_event_scenario_uidx'
  ) THEN
    CREATE UNIQUE INDEX user_event_defaults_user_event_scenario_uidx
      ON public.user_event_defaults (user_id, event_key, scenario_key);
  END IF;
END $$;

-- Restricción CHECK: solo se permiten valores de switch en minúsculas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_event_defaults_value_check'
  ) THEN
    ALTER TABLE public.user_event_defaults
      ADD CONSTRAINT user_event_defaults_value_check
      CHECK (value IN ('off', 'pack', 'ia'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. flight_event_config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flight_event_config (
  flight_id     uuid NOT NULL REFERENCES public.flights (id) ON DELETE CASCADE,
  event_key     text NOT NULL,
  value         text NOT NULL DEFAULT 'ia',
  source        text NOT NULL DEFAULT 'user',
  scenario_key  text NOT NULL DEFAULT 'standard_commercial_flight',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flight_event_config
  ADD COLUMN IF NOT EXISTS scenario_key text NOT NULL DEFAULT 'standard_commercial_flight';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'flight_event_config'
      AND indexname = 'flight_event_config_flight_event_scenario_uidx'
  ) THEN
    CREATE UNIQUE INDEX flight_event_config_flight_event_scenario_uidx
      ON public.flight_event_config (flight_id, event_key, scenario_key);
  END IF;
END $$;

-- Restricción CHECK: solo se permiten valores de switch en minúsculas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flight_event_config_value_check'
  ) THEN
    ALTER TABLE public.flight_event_config
      ADD CONSTRAINT flight_event_config_value_check
      CHECK (value IN ('off', 'pack', 'ia'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. flights.scenario_key
-- ---------------------------------------------------------------------------
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS scenario_key text DEFAULT 'standard_commercial_flight';

-- Vuelos existentes sin scenario_key → standard_commercial_flight.
UPDATE public.flights
  SET scenario_key = 'standard_commercial_flight'
  WHERE scenario_key IS NULL OR scenario_key = '';

-- ---------------------------------------------------------------------------
-- 4. users.default_scenario_key (escenario por defecto del usuario)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_scenario_key text NOT NULL DEFAULT 'standard_commercial_flight';

-- ---------------------------------------------------------------------------
-- 5. Backfill de filas existentes sin scenario_key (si se insertaron con NULL)
-- ---------------------------------------------------------------------------
UPDATE public.user_event_defaults
  SET scenario_key = 'standard_commercial_flight'
  WHERE scenario_key IS NULL OR scenario_key = '';

UPDATE public.flight_event_config
  SET scenario_key = 'standard_commercial_flight'
  WHERE scenario_key IS NULL OR scenario_key = '';

-- ---------------------------------------------------------------------------
-- 6. RLS: permitir lecturas del usuario autenticado sobre sus propias filas.
--    (Las policies reales pueden vivir en el proyecto remoto; aquí se asegura
--     un comportamiento coherente para la anon key con sesión.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_event_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_event_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_event_defaults'
      AND policyname = 'user_event_defaults_select_own'
  ) THEN
    CREATE POLICY user_event_defaults_select_own
      ON public.user_event_defaults FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_event_defaults'
      AND policyname = 'user_event_defaults_insert_own'
  ) THEN
    CREATE POLICY user_event_defaults_insert_own
      ON public.user_event_defaults FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_event_defaults'
      AND policyname = 'user_event_defaults_update_own'
  ) THEN
    CREATE POLICY user_event_defaults_update_own
      ON public.user_event_defaults FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'flight_event_config'
      AND policyname = 'flight_event_config_select_own'
  ) THEN
    CREATE POLICY flight_event_config_select_own
      ON public.flight_event_config FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.flights f
          WHERE f.id = flight_id AND f.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'flight_event_config'
      AND policyname = 'flight_event_config_insert_own'
  ) THEN
    CREATE POLICY flight_event_config_insert_own
      ON public.flight_event_config FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.flights f
          WHERE f.id = flight_id AND f.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'flight_event_config'
      AND policyname = 'flight_event_config_update_own'
  ) THEN
    CREATE POLICY flight_event_config_update_own
      ON public.flight_event_config FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.flights f
          WHERE f.id = flight_id AND f.user_id = auth.uid()
        )
      );
  END IF;
END $$;
