-- 017_grant_recalc_ppc.sql
-- recalc_daily_ppc was defined in 005 without an explicit GRANT EXECUTE,
-- which prevents authenticated users from calling it via the PostgREST RPC API.
-- Migrations 013 and 014 showed the correct pattern; this backfills the grant.

grant execute on function recalc_daily_ppc(uuid, date) to authenticated;
