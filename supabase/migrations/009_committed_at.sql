-- ─────────────────────────────────────────────────────────────────────────────
-- 009_committed_at.sql
-- Adds committed_at timestamp to phase_tasks so daily PPC can be scoped to
-- tasks that were committed on or before each calc_date, giving an accurate
-- per-day baseline rather than a coarse per-week one.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Add committed_at column ────────────────────────────────────────────────

alter table phase_tasks
  add column if not exists committed_at timestamptz;

-- Back-fill existing committed tasks with a plausible timestamp.
-- We don't know the real commit time, so use the start of their committed week
-- (Monday 08:00 UTC) as a safe conservative default — they won't be excluded
-- from any historical PPC that was already calculated.
update phase_tasks
set committed_at = (
  date_trunc('week',
    make_date(extract(year from now())::integer, 1, 4)
    + ((committed_week - 1) * 7)
  ) + interval '8 hours'
)
where committed = true
  and committed_at is null
  and committed_week is not null;


-- ── 2. Update commit_week_now to record committed_at ─────────────────────────

create or replace function commit_week_now(p_project_id uuid, p_week_number integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  week_mon   date;
  week_sun   date;
  task_count integer;
begin
  if not (
    is_super_admin()
    or has_project_role(p_project_id, 'project_admin')
    or has_project_role(p_project_id, 'planner')
  ) then
    raise exception 'Insufficient permissions';
  end if;

  week_mon := (
    date_trunc('week',
      make_date(extract(year from now())::integer, 1, 4)
      + ((p_week_number - 1) * 7)
    )
  )::date;

  if week_mon < (current_date - 182) then
    week_mon := (
      date_trunc('week',
        make_date(extract(year from now())::integer + 1, 1, 4)
        + ((p_week_number - 1) * 7)
      )
    )::date;
  end if;

  week_sun := week_mon + 6;

  insert into wwp_commits (project_id, week_number, is_auto)
  values (p_project_id, p_week_number, false)
  on conflict (project_id, week_number) do nothing;

  -- Mark uncommitted tasks and record the exact commit timestamp
  update phase_tasks
  set
    committed      = true,
    committed_week = p_week_number,
    committed_at   = now()
  where project_id   = p_project_id
    and phase        = 'wwp'
    and planned_start between week_mon and week_sun
    and committed    = false;

  get diagnostics task_count = row_count;

  return json_build_object(
    'week_number',     p_week_number,
    'tasks_committed', task_count,
    'week_start',      week_mon,
    'week_end',        week_sun
  );
end;
$$;


-- ── 3. Update _calc_daily_ppc to use committed_at ─────────────────────────────
-- A task only enters the planned_count for a given day if it was committed
-- on or before that day (committed_at::date <= p_date).
-- Tasks committed after p_date are excluded — they weren't in the plan yet.
-- Tasks with NULL committed_at (legacy rows) are included for safety.

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
  if extract(isodow from p_date) in (6, 7) then return; end if;

  p_week_num := extract(week from p_date)::integer;

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
    where pt.project_id     = p_project_id
      and pt.committed      = true
      and pt.committed_week = p_week_num
      and pt.planned_start  <= p_date
      -- Only count tasks that were in the committed plan by this date
      and (pt.committed_at is null or pt.committed_at::date <= p_date)
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
