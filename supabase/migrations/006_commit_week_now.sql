-- ─────────────────────────────────────────────────────────────────────────────
-- 006_commit_week_now.sql
-- Manual "commit this week" RPC callable from the board UI by admins/planners.
-- Allows bootstrapping projects that missed the auto-commit window.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Derive Monday of the given ISO week in the current or next year.
  -- ISO week 1 always contains Jan 4. Monday of week N = trunc(jan4 + (N-1)*7).
  week_mon := (
    date_trunc('week',
      make_date(extract(year from now())::integer, 1, 4)
      + ((p_week_number - 1) * 7)
    )
  )::date;

  -- If derived Monday is more than 26 weeks in the past, try next year
  -- (handles week numbers near year boundary)
  if week_mon < (current_date - 182) then
    week_mon := (
      date_trunc('week',
        make_date(extract(year from now())::integer + 1, 1, 4)
        + ((p_week_number - 1) * 7)
      )
    )::date;
  end if;

  week_sun := week_mon + 6;

  -- Insert commit record (idempotent)
  insert into wwp_commits (project_id, week_number, is_auto)
  values (p_project_id, p_week_number, false)
  on conflict (project_id, week_number) do nothing;

  -- Mark all uncommitted tasks in this week as committed
  update phase_tasks
  set
    committed      = true,
    committed_week = p_week_number
  where project_id   = p_project_id
    and phase        = 'wwp'
    and planned_start between week_mon and week_sun
    and committed    = false;

  get diagnostics task_count = row_count;

  return json_build_object(
    'week_number',    p_week_number,
    'tasks_committed', task_count,
    'week_start',     week_mon,
    'week_end',       week_sun
  );
end;
$$;
