-- ─────────────────────────────────────────────────────────────────────────────
-- 004_wwp_commits.sql
-- Weekly Work Plan commitment baseline + auto-commit scheduler
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. wwp_commits: one record per project per ISO week ───────────────────────

create table if not exists wwp_commits (
  id            uuid        primary key default gen_random_uuid(),
  project_id    uuid        not null references projects(id) on delete cascade,
  week_number   integer     not null,
  committed_at  timestamptz not null default now(),
  committed_by  uuid        references profiles(id),   -- null = auto-committed
  is_auto       boolean     not null default false,
  unique (project_id, week_number)
);

alter table wwp_commits enable row level security;

-- All project members can see commit records
create policy "wwp_commits_select" on wwp_commits
  for select using (
    is_super_admin() or is_project_member(project_id)
  );

-- Admins and planners can insert manually (auto-commits use security definer fn)
create policy "wwp_commits_insert" on wwp_commits
  for insert with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );


-- ── 2. Add committed fields to phase_tasks ────────────────────────────────────

alter table phase_tasks
  add column if not exists committed      boolean default false,
  add column if not exists committed_week integer;

create index if not exists idx_phase_tasks_committed_week
  on phase_tasks(project_id, committed_week)
  where committed = true;


-- ── 3. Auto-commit function ───────────────────────────────────────────────────
-- Runs every 15 minutes via pg_cron.
-- For each project with commit settings, checks whether the local day/time
-- matches the configured commit window and no commit exists yet for next week.

create or replace function auto_commit_wwp()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  proj          record;
  local_now     timestamptz;
  local_date    date;
  local_dow     integer;   -- 1=Mon … 7=Sun (isodow)
  local_time    time;
  commit_dow    integer;
  commit_time   time;
  next_mon      date;
  next_sun      date;
  next_week_num integer;
begin
  for proj in
    select
      id,
      coalesce(settings->>'wwp_commit_timezone', 'Europe/London') as tz,
      coalesce(settings->>'wwp_commit_day',      'friday')        as day_name,
      coalesce(settings->>'wwp_commit_time',     '17:00')         as time_str
    from projects
    where settings ? 'wwp_commit_day'
  loop
    begin
      -- Convert to project-local time
      local_now  := now() at time zone proj.tz;
      local_date := local_now::date;
      local_dow  := extract(isodow from local_now)::integer;
      local_time := local_now::time;

      -- Resolve configured day → isodow
      commit_dow := case lower(proj.day_name)
        when 'monday'    then 1
        when 'tuesday'   then 2
        when 'wednesday' then 3
        when 'thursday'  then 4
        when 'friday'    then 5
        when 'saturday'  then 6
        when 'sunday'    then 7
        else 5
      end;

      commit_time := proj.time_str::time;

      -- Not the right day or time yet
      if local_dow <> commit_dow then continue; end if;
      if local_time < commit_time then continue; end if;

      -- The week being committed = the ISO week starting next Monday
      next_mon      := date_trunc('week', local_date)::date + 7;
      next_sun      := next_mon + 6;
      next_week_num := extract(week from next_mon)::integer;

      -- Already committed this week for this project
      if exists (
        select 1 from wwp_commits
        where project_id = proj.id
          and week_number = next_week_num
      ) then continue; end if;

      -- Insert commit record (auto)
      insert into wwp_commits (project_id, week_number, is_auto)
      values (proj.id, next_week_num, true);

      -- Mark matching tasks as committed, matched by planned_start date range
      -- (avoids week_number field mismatches from earlier bugs)
      update phase_tasks
      set
        committed      = true,
        committed_week = next_week_num
      where
        project_id    = proj.id
        and phase     = 'wwp'
        and planned_start between next_mon and next_sun
        and committed = false;

    exception when others then
      raise warning 'auto_commit_wwp: project % — %', proj.id, sqlerrm;
    end;
  end loop;
end;
$$;


-- ── 4. pg_cron schedule ───────────────────────────────────────────────────────
-- NOTE: pg_cron must be enabled in your Supabase project first:
--   Dashboard → Database → Extensions → search "pg_cron" → Enable
-- If the job already exists from a previous run, drop it first.

select cron.unschedule('auto-commit-wwp')
  where exists (select 1 from cron.job where jobname = 'auto-commit-wwp');

select cron.schedule(
  'auto-commit-wwp',
  '*/15 * * * *',
  'select auto_commit_wwp()'
);
