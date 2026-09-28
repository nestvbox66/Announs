-- ============================================================================
-- RLS para public.flight_xp_breakdown (bonos XP de disciplina)
-- ============================================================================
-- Contexto: el Desktop (rol `authenticated`) hace UPDATE de las columnas
-- disc_* y, como fallback, INSERT si la RPC aún no creó la fila. Sin estas
-- policies, el UPDATE devuelve 0 filas en silencio y el INSERT falla con
-- 42501 "new row violates row-level security policy", por lo que los bonos
-- nunca se persisten (solo quedan base_time_xp y total_flight_xp de la RPC).
--
-- Cómo aplicar: Supabase Dashboard → SQL Editor → pegar y ejecutar.
-- Idempotente: se puede ejecutar varias veces sin error.
-- ============================================================================

alter table public.flight_xp_breakdown enable row level security;

drop policy if exists "flight_xp_breakdown_select_own" on public.flight_xp_breakdown;
create policy "flight_xp_breakdown_select_own"
  on public.flight_xp_breakdown for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "flight_xp_breakdown_insert_own" on public.flight_xp_breakdown;
create policy "flight_xp_breakdown_insert_own"
  on public.flight_xp_breakdown for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "flight_xp_breakdown_update_own" on public.flight_xp_breakdown;
create policy "flight_xp_breakdown_update_own"
  on public.flight_xp_breakdown for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Verificación (como usuario autenticado, debe devolver las filas propias):
-- select id, flight_id from public.flight_xp_breakdown limit 5;
