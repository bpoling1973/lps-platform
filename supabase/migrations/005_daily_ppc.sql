-- ─────────────────────────────────────────────────────────────────────────────
-- 005_daily_ppc.sql
-- Daily PPC calculation — one record per project per working day
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. daily_ppc table ────────────────────────────────────────────────────────

create table if not exists daily_ppc (
  id             uuid        primary key default gen_random_uuid(),
  project_id     uuid        not null references projects(id) on delete cascade,
  calc_date      date        not null,
  planned_count  integer     not null default 0,
  complete_count integer     not null default 0,
  ppc_percent    numeric(5,2) generated always as (
    case when planned_count > 0
    then round((complete_count::numeric / planned_count::numeric) * 100, 2)
    else null
    end
  ) stored,
  calculated_at  timestamptz not null default now(),
  is_auto        boolean     not null default true,
  unique (project_id, calc_date)
);

alter table daily_ppc enable row level security;

create policy "daily_ppc_select" on daily_ppc
  for select using (is_super_admin() or is_project_member(project_id));

create policy "daily_ppc_insert" on daily_ppc
  for insert with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

create policy "daily_ppc_update" on daily_ppc
  for update using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

create index if not exists idx_daily_ppc_project_date
  on daily_ppc(project_id, calc_date desc);


-- ── 2. Core calculation function ──────────────────────────────────────────────
-- Counts committed task-day segments for a given project and date,
-- scoped to that date's ISO week (the current committed week only).
-- Overwrites any existing record for that date.

create or replace function _calc_daily_ppc(p_project_id uuid, p_date date, p_is_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_week_num    integer;
  planned_cnt   integer;
  complete_cnt  integer;
begin
  -- Only run on working days (Mon–Fri, isodow 1–5)
  if extract(isodow from p_date) in (6, 7) then return; end if;

  p_week_num := extract(week from p_date)::integer;

  -- For each committed task in this week, determine which segment
  -- corresponds to p_date by counting working days from planned_start.
  -- segment index is 0-based: Monday of a Mon-start task = index 0.
  with task_seg as (
    select
      pt.day_statuses,
      pt.duration_days,
      (
        select (count(*) - 1)::integer
        from generate_series(pt.planned_start, p_date, '1 day'::interval) gs(d)
        where extract(isodow from gs.d) not in (6, 7)
      ) as seg_idx
    from phase_tasks pt
    where pt.project_id    = p_project_id
      and pt.committed     = true
      and pt.committed_week = p_week_num
      and pt.planned_start <= p_date
  )
  select
    count(*)::integer,
    count(*) filter (
      where seg_idx >= 0
        and seg_idx < duration_days
        and (day_statuses->>(seg_idx)) = 'complete'
    )::integer
  into planned_cnt, complete_cnt
  from task_seg
  where seg_idx >= 0
    and seg_idx < duration_days;

  insert into daily_ppc
    (project_id, calc_date, planned_count, complete_count, calculated_at, is_auto)
  values
    (p_project_id, p_date, coalesce(planned_cnt, 0), coalesce(complete_cnt, 0), now(), p_is_auto)
  on conflict (project_id, calc_date)
  do update set
    planned_count  = excluded.planned_count,
    complete_count = excluded.complete_count,
    calculated_at  = excluded.calculated_at,
    is_auto        = excluded.is_auto;
end;
$$;


-- ── 3. Auto-calculation function (called by pg_cron) ─────────────────────────
-- Runs every 15 minutes. For each project with ppc_calc_time set, checks
-- whether local time has passed the threshold and today's record is missing.

create or replace function auto_calc_daily_ppc()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  proj        record;
  local_now   timestamptz;
  local_date  date;
  local_time  time;
  local_dow   integer;
  calc_time   time;
begin
  for proj in
    select
      id,
      coalesce(settings->>'wwp_commit_timezone', 'Europe/London') as tz,
      coalesce(settings->>'ppc_calc_time', '18:00')               as calc_time_str
    from projects
    -- Run for any project that has either ppc_calc_time or commit settings
    where settings ? 'ppc_calc_time'
       or settings ? 'wwp_commit_day'
  loop
    begin
      local_now  := now() at time zone proj.tz;
      local_date := local_now::date;
      local_time := local_now::time;
      local_dow  := extract(isodow from local_now)::integer;
      calc_time  := proj.calc_time_str::time;

      -- Skip weekends
      if local_dow in (6, 7) then continue; end if;

      -- Not time yet
      if local_time < calc_time then continue; end if;

      -- Already calculated today
      if exists (
        select 1 from daily_ppc
        where project_id = proj.id
          and calc_date  = local_date
      ) then continue; end if;

      perform _calc_daily_ppc(proj.id, local_date, true);

    exception when others then
      raise warning 'auto_calc_daily_ppc: project % — %', proj.id, sqlerrm;
    end;
  end loop;
end;
$$;


-- ── 4. Manual recalculation RPC (callable from the UI) ───────────────────────
-- Admins can trigger a recalculation for any date. Always overwrites.

create or replace function recalc_daily_ppc(p_project_id uuid, p_date date)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only project admins and planners may trigger this
  if not (
    is_super_admin()
    or has_project_role(p_project_id, 'project_admin')
    or has_project_role(p_project_id, 'planner')
  ) then
    raise exception 'Insufficient permissions';
  end if;

  perform _calc_daily_ppc(p_project_id, p_date, false);

  return (
    select row_to_json(r) from (
      select planned_count, complete_count, ppc_percent, calculated_at
      from daily_ppc
      where project_id = p_project_id and calc_date = p_date
    ) r
  );
end;
$$;


-- ── 5. pg_cron: add daily PPC to the existing 15-minute schedule ──────────────

select cron.unschedule('auto-calc-daily-ppc')
  where exists (select 1 from cron.job where jobname = 'auto-calc-daily-ppc');

select cron.schedule(
  'auto-calc-daily-ppc',
  '*/15 * * * *',
  'select auto_calc_daily_ppc()'
);
