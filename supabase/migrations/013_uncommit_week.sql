-- ─────────────────────────────────────────────────────────────────────────────
-- 013_uncommit_week.sql
-- Allows project_admin or super_admin to unlock a committed week, clearing
-- the PPC baseline so the week can be re-committed after changes.
-- Historical daily_ppc records are preserved — they reflect what was true
-- at the time of calculation.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function uncommit_week(p_project_id uuid, p_week_number integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  task_count integer;
begin
  if not (
    is_super_admin()
    or has_project_role(p_project_id, 'project_admin')
  ) then
    raise exception 'Only project admins can unlock a committed week';
  end if;

  -- Clear committed fields on all tasks that were committed in this week
  update phase_tasks
  set
    committed       = false,
    committed_week  = null,
    committed_at    = null,
    committed_start = null
  where project_id    = p_project_id
    and phase         = 'wwp'
    and committed     = true
    and committed_week = p_week_number;

  get diagnostics task_count = row_count;

  -- Remove the commit record so the week shows as uncommitted in the UI
  delete from wwp_commits
  where project_id  = p_project_id
    and week_number = p_week_number;

  return json_build_object(
    'week_number',       p_week_number,
    'tasks_uncommitted', task_count
  );
end;
$$;

-- Grant execute to authenticated users (RLS inside the function handles auth)
grant execute on function uncommit_week(uuid, integer) to authenticated;
