-- ─────────────────────────────────────────────────────────────────────────────
-- 026_trade_supervisor_rls.sql
-- 1. Helper function: can the current user edit tasks in a given trade?
-- 2. Updated phase_tasks INSERT/UPDATE/DELETE policies for trade supervisors.
-- 3. Fix add_gang_to_trade to initialise trades from DEFAULT when settings empty.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper function ───────────────────────────────────────────────────────

create or replace function can_edit_trade(p_project_id uuid, p_trade text)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and role = 'trade_supervisor'
      and p_trade = any(assigned_trades)
  )
$$;


-- ── 2. Phase tasks policies ──────────────────────────────────────────────────

-- INSERT: trade supervisors can create tasks in their assigned trades
drop policy if exists "phase_tasks_insert" on phase_tasks;
create policy "phase_tasks_insert" on phase_tasks for insert
  with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
    or can_edit_trade(project_id, trade)
  );

-- UPDATE: trade supervisors can update tasks in their assigned trades
drop policy if exists "phase_tasks_update" on phase_tasks;
create policy "phase_tasks_update" on phase_tasks for update
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
    or can_edit_trade(project_id, trade)
  );

-- DELETE: trade supervisors can delete tasks in their assigned trades
drop policy if exists "phase_tasks_delete" on phase_tasks;
create policy "phase_tasks_delete" on phase_tasks for delete
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
    or can_edit_trade(project_id, trade)
  );


-- ── 3. Fix add_gang_to_trade for uninitialised settings ──────────────────────
-- When a project has no trades saved in settings yet (uses DEFAULT_TRADES),
-- the RPC needs to initialise the trades array first.

create or replace function add_gang_to_trade(
  p_project_id uuid,
  p_trade_name text,
  p_gang_name  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings   jsonb;
  v_trades     jsonb;
  v_new_trades jsonb;
  v_found      boolean := false;
begin
  if not (
    is_super_admin()
    or has_project_role(p_project_id, 'project_admin')
    or has_project_role(p_project_id, 'planner')
    or (
      has_project_role(p_project_id, 'trade_supervisor')
      and exists (
        select 1 from project_members
        where project_id = p_project_id
          and user_id = auth.uid()
          and p_trade_name = any(assigned_trades)
      )
    )
  ) then
    raise exception 'Insufficient permissions';
  end if;

  select settings into v_settings from projects where id = p_project_id;
  v_trades := coalesce(v_settings->'trades', '[]'::jsonb);

  -- If trades array is empty (project using defaults), initialise with the requested trade
  if jsonb_array_length(v_trades) = 0 then
    v_new_trades := jsonb_build_array(
      jsonb_build_object('name', p_trade_name, 'gangs', jsonb_build_array(p_gang_name))
    );
  else
    -- Check if trade exists in the array
    select jsonb_agg(
      case
        when t->>'name' = p_trade_name then
          jsonb_set(t, '{gangs}',
            case
              when exists (
                select 1 from jsonb_array_elements_text(coalesce(t->'gangs', '[]'::jsonb)) g
                where g = p_gang_name
              )
              then coalesce(t->'gangs', '[]'::jsonb)
              else coalesce(t->'gangs', '[]'::jsonb) || to_jsonb(p_gang_name)
            end
          )
        else t
      end
    )
    into v_new_trades
    from jsonb_array_elements(v_trades) t;

    -- Check if we found the trade
    select exists (
      select 1 from jsonb_array_elements(v_trades) t where t->>'name' = p_trade_name
    ) into v_found;

    -- Trade not in settings yet — append it
    if not v_found then
      v_new_trades := coalesce(v_new_trades, '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('name', p_trade_name, 'gangs', jsonb_build_array(p_gang_name)));
    end if;
  end if;

  update projects
  set settings = jsonb_set(coalesce(v_settings, '{}'::jsonb), '{trades}', v_new_trades)
  where id = p_project_id;
end;
$$;
