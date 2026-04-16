-- ─────────────────────────────────────────────────────────────────────────────
-- 028_fix_add_gang_defaults.sql
-- Fixes add_gang_to_trade to accept default trades list. When project settings
-- have no trades saved yet, the full default list is initialised — not just
-- the one trade being modified.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists add_gang_to_trade(uuid, text, text);

create or replace function add_gang_to_trade(
  p_project_id     uuid,
  p_trade_name     text,
  p_gang_name      text,
  p_default_trades jsonb default null
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

  -- If trades array is empty, initialise from the provided defaults
  if jsonb_array_length(v_trades) = 0 and p_default_trades is not null then
    v_trades := p_default_trades;
  end if;

  -- Update the matching trade's gangs array
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

  -- If trade wasn't found, append it
  select exists (
    select 1 from jsonb_array_elements(v_trades) t where t->>'name' = p_trade_name
  ) into v_found;

  if not v_found then
    v_new_trades := coalesce(v_new_trades, '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object('name', p_trade_name, 'gangs', jsonb_build_array(p_gang_name)));
  end if;

  update projects
  set settings = jsonb_set(coalesce(v_settings, '{}'::jsonb), '{trades}', v_new_trades)
  where id = p_project_id;
end;
$$;

grant execute on function add_gang_to_trade(uuid, text, text, jsonb) to authenticated;
