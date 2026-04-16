-- ─────────────────────────────────────────────────────────────────────────────
-- 010_committed_start.sql
-- Records the original planned_start at the time a task is committed, enabling
-- ghost card display and working-day slip calculation in the UI.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Add committed_start column ────────────────────────────────────────────

alter table phase_tasks
  add column if not exists committed_start date;

-- Back-fill: existing committed tasks are assumed not yet moved,
-- so committed_start = current planned_start is a safe starting point.
update phase_tasks
set committed_start = planned_start
where committed = true
  and committed_start is null;


-- ── 2. Replace commit_week_now — now stamps committed_start + committed_at ───

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

  update phase_tasks
  set
    committed       = true,
    committed_week  = p_week_number,
    committed_at    = now(),
    committed_start = planned_start   -- snapshot the plan at commit time
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
