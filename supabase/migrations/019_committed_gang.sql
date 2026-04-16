-- ─────────────────────────────────────────────────────────────────────────────
-- 019_committed_gang.sql
--
-- Records the gang and trade a task was in at commit time so that the UI can
-- anchor the ghost (committed-position shadow) to the original swimlane even
-- when the task is subsequently moved to a different gang or trade.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add committed_gang_id and committed_trade columns ──────────────────────

alter table phase_tasks
  add column if not exists committed_gang_id varchar,
  add column if not exists committed_trade   varchar;

-- Back-fill: existing committed tasks are assumed not to have moved gang/trade,
-- so current values are a safe starting point.
update phase_tasks
set
  committed_gang_id = gang_id,
  committed_trade   = trade
where committed = true
  and committed_gang_id is null;


-- ── 2. Replace commit_week_now — now snapshots gang + trade at commit ─────────

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
    committed         = true,
    committed_week    = p_week_number,
    committed_at      = now(),
    committed_start   = planned_start,   -- snapshot position at commit time
    committed_gang_id = gang_id,         -- snapshot swimlane at commit time
    committed_trade   = trade
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
