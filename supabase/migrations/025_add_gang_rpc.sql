-- ─────────────────────────────────────────────────────────────────────────────
-- 025_add_gang_rpc.sql
-- RPC function that lets trade supervisors add a gang to their assigned trade
-- without needing UPDATE permission on the projects table.
-- ─────────────────────────────────────────────────────────────────────────────

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
begin
  -- Permission check: project_admin, planner, or trade_supervisor assigned to this trade
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

  -- Update the gangs array for the matching trade
  select jsonb_agg(
    case
      when t->>'name' = p_trade_name
        and not exists (
          select 1 from jsonb_array_elements_text(coalesce(t->'gangs', '[]'::jsonb)) g
          where g = p_gang_name
        )
      then jsonb_set(t, '{gangs}', coalesce(t->'gangs', '[]'::jsonb) || to_jsonb(p_gang_name))
      else t
    end
  )
  into v_new_trades
  from jsonb_array_elements(v_trades) t;

  update projects
  set settings = jsonb_set(coalesce(v_settings, '{}'::jsonb), '{trades}', coalesce(v_new_trades, v_trades))
  where id = p_project_id;
end;
$$;

grant execute on function add_gang_to_trade(uuid, text, text) to authenticated;
