-- 015_rnc_daily_tracking.sql
-- Enhance rnc_entries for daily granularity and admin-configurable categories.
-- Run in Supabase SQL editor.

-- ── 1. Change category from enum → text (idempotent) ─────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'rnc_entries' and column_name = 'category'
      and data_type <> 'text'
  ) then
    alter table rnc_entries alter column category type text using category::text;
  end if;
end;
$$;

-- ── 2. Add project_id for direct RLS without joining through ppc_records ──────
alter table rnc_entries
  add column if not exists project_id uuid references projects(id) on delete cascade;

-- ── 3. Add entry_date for daily granularity ───────────────────────────────────
alter table rnc_entries
  add column if not exists entry_date date;

-- ── 4. Make ppc_record_id nullable (idempotent) ───────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'rnc_entries' and column_name = 'ppc_record_id'
      and is_nullable = 'NO'
  ) then
    alter table rnc_entries alter column ppc_record_id drop not null;
  end if;
end;
$$;

-- ── 5. Backfill project_id and entry_date from linked ppc_records ─────────────
update rnc_entries e
set
  project_id = p.project_id,
  entry_date  = coalesce(e.entry_date, p.week_ending)
from ppc_records p
where e.ppc_record_id = p.id
  and (e.project_id is null or e.entry_date is null);

-- ── 6. Indexes ────────────────────────────────────────────────────────────────
create index if not exists idx_rnc_entries_project_date
  on rnc_entries(project_id, entry_date);

create index if not exists idx_rnc_entries_phase_task
  on rnc_entries(phase_task_id);

-- ── 7. Drop old RLS policies (they assume ppc_record_id is non-null) ──────────
drop policy if exists "rnc_entries_select" on rnc_entries;
drop policy if exists "rnc_entries_insert" on rnc_entries;

-- ── 8. New RLS: use project_id directly; fall back to ppc_record join ─────────
drop policy if exists "rnc_entries_select_v2" on rnc_entries;
drop policy if exists "rnc_entries_insert_v2" on rnc_entries;
create policy "rnc_entries_select_v2" on rnc_entries for select
  using (
    is_super_admin()
    or (project_id is not null and is_project_member(project_id))
    or (project_id is null and ppc_record_id is not null
        and is_project_member(
          (select project_id from ppc_records where id = ppc_record_id)
        ))
  );

create policy "rnc_entries_insert_v2" on rnc_entries for insert
  with check (
    is_super_admin()
    or (project_id is not null and is_project_member(project_id))
    or (project_id is null and ppc_record_id is not null
        and is_project_member(
          (select project_id from ppc_records where id = ppc_record_id)
        ))
  );
