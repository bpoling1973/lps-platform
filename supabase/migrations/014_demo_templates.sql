-- ─────────────────────────────────────────────────────────────────────────────
-- 014_demo_templates.sql
-- Adds demo template support:
--   • is_demo_template flag on projects
--   • clone_project_as_demo() — deep-clones a project, re-anchoring all dates
--     to the current Monday so the board always looks live
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Add template flag ──────────────────────────────────────────────────────

alter table projects
  add column if not exists is_demo_template boolean not null default false;


-- ── 2. Clone function ─────────────────────────────────────────────────────────
-- Copies: project settings, milestones, phase_tasks (all phases), task_dependencies,
-- constraints.  Committed state and PPC records are NOT copied — the clone
-- starts as a fresh, uncommitted project.
-- Dates are shifted by (current Monday − source.start_date) working days so the
-- board is always centred on the live week.

create or replace function clone_project_as_demo(
  p_source_project_id uuid,
  p_new_name          text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source      projects%rowtype;
  v_new_proj_id uuid;
  v_caller_id   uuid;
  v_new_start   date;
  v_offset      integer;          -- calendar days to add to every date
  v_ms_map      jsonb := '{}'::jsonb;   -- old milestone_id → new milestone_id
  v_task_map    jsonb := '{}'::jsonb;   -- old task_id      → new task_id

  r             record;
  v_new_id      uuid;
  v_new_date    date;
  v_day_stats   jsonb;
begin
  -- ── Auth ──────────────────────────────────────────────────────────────────
  if not (
    is_super_admin()
    or has_project_role(p_source_project_id, 'project_admin')
  ) then
    raise exception 'Only project admins can clone a project';
  end if;

  v_caller_id := auth.uid();

  -- ── Load source ───────────────────────────────────────────────────────────
  select * into v_source from projects where id = p_source_project_id;
  if not found then
    raise exception 'Source project not found';
  end if;

  -- ── Date offset ───────────────────────────────────────────────────────────
  -- Anchor new project to the current ISO Monday
  v_new_start := date_trunc('week', current_date)::date;
  v_offset    := v_new_start - v_source.start_date;  -- may be negative

  -- ── Create project ────────────────────────────────────────────────────────
  insert into projects (tenant_id, name, start_date, end_date, settings, is_demo_template)
  values (
    v_source.tenant_id,
    p_new_name,
    v_new_start,
    case when v_source.end_date is not null then v_source.end_date + v_offset end,
    v_source.settings,
    false   -- clone is a live project, not itself a template
  )
  returning id into v_new_proj_id;

  -- Add caller as project_admin of the new project
  insert into project_members (project_id, user_id, role, joined_at)
  values (v_new_proj_id, v_caller_id, 'project_admin', now());

  -- ── Milestones ────────────────────────────────────────────────────────────
  for r in
    select * from milestones
    where project_id = p_source_project_id
    order by position
  loop
    insert into milestones (project_id, name, planned_date, forecast_date, rag_status, position)
    values (
      v_new_proj_id,
      r.name,
      r.planned_date + v_offset,
      case when r.forecast_date is not null then r.forecast_date + v_offset end,
      r.rag_status,
      r.position
    )
    returning id into v_new_id;

    v_ms_map := v_ms_map || jsonb_build_object(r.id::text, v_new_id::text);
  end loop;

  -- ── Phase tasks ───────────────────────────────────────────────────────────
  for r in
    select * from phase_tasks
    where project_id = p_source_project_id
    order by planned_start nulls last
  loop
    -- Reset day_statuses: same length array, all 'not_started'
    if r.day_statuses is not null and jsonb_array_length(r.day_statuses) > 0 then
      select jsonb_agg('"not_started"'::jsonb)
      into   v_day_stats
      from   generate_series(1, jsonb_array_length(r.day_statuses));
    else
      v_day_stats := r.day_statuses;
    end if;

    insert into phase_tasks (
      project_id, phase, title, trade, gang_id,
      planned_start, duration_days, zone,
      milestone_id,
      status, day_statuses,
      week_number, position
      -- Deliberately omit: committed, committed_week, committed_at, committed_start,
      --                     owner_id (members differ), predecessor_id (legacy)
    )
    values (
      v_new_proj_id,
      r.phase,
      r.title,
      r.trade,
      r.gang_id,
      case when r.planned_start is not null then r.planned_start + v_offset end,
      r.duration_days,
      r.zone,
      case when r.milestone_id is not null
        then (v_ms_map ->> r.milestone_id::text)::uuid
      end,
      'not_started',
      v_day_stats,
      -- Recalculate week_number from re-anchored date
      case when r.planned_start is not null
        then extract(week from (r.planned_start + v_offset))::integer
      end,
      r.position
    )
    returning id into v_new_id;

    v_task_map := v_task_map || jsonb_build_object(r.id::text, v_new_id::text);
  end loop;

  -- ── Task dependencies ─────────────────────────────────────────────────────
  for r in
    select * from task_dependencies where project_id = p_source_project_id
  loop
    -- Only copy if both ends were cloned (guards against orphaned deps)
    if (v_task_map ->> r.task_id::text) is not null
    and (v_task_map ->> r.predecessor_id::text) is not null
    then
      insert into task_dependencies (project_id, task_id, predecessor_id, lag_days)
      values (
        v_new_proj_id,
        (v_task_map ->> r.task_id::text)::uuid,
        (v_task_map ->> r.predecessor_id::text)::uuid,
        r.lag_days
      );
    end if;
  end loop;

  -- ── Constraints ───────────────────────────────────────────────────────────
  for r in
    select c.*
    from   constraints c
    join   phase_tasks pt on pt.id = c.phase_task_id
    where  pt.project_id = p_source_project_id
  loop
    if (v_task_map ->> r.phase_task_id::text) is not null then
      insert into constraints (phase_task_id, description, owner_name, owner_email, due_date, status)
      values (
        (v_task_map ->> r.phase_task_id::text)::uuid,
        r.description,
        r.owner_name,
        r.owner_email,
        case when r.due_date is not null then r.due_date + v_offset end,
        'open'   -- always reset to open in the clone
      );
    end if;
  end loop;

  -- ── Done ──────────────────────────────────────────────────────────────────
  return json_build_object(
    'project_id',   v_new_proj_id,
    'project_name', p_new_name,
    'start_date',   v_new_start,
    'offset_days',  v_offset
  );
end;
$$;

grant execute on function clone_project_as_demo(uuid, text) to authenticated;
