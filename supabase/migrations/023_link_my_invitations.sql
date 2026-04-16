-- ─────────────────────────────────────────────────────────────────────────────
-- 023_link_my_invitations.sql
-- Provides a function the client calls after every login to link any pending
-- project_members invitations to the current user. This handles the case
-- where a user already existed when the admin invited them — the new-user
-- trigger wouldn't fire, leaving user_id = null on the invitation row.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function link_my_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_tenant_id uuid;
  linked_count integer;
begin
  select email into v_email from profiles where id = auth.uid();
  if v_email is null then return 0; end if;

  -- Link pending invitations
  update project_members
  set user_id = auth.uid(), joined_at = now()
  where invited_email = v_email
    and user_id is null;

  get diagnostics linked_count = row_count;

  -- If profile has no tenant_id yet, set it from the first linked project
  select tenant_id into v_tenant_id from profiles where id = auth.uid();
  if v_tenant_id is null then
    update profiles
    set tenant_id = (
      select p.tenant_id
      from project_members pm
      join projects p on p.id = pm.project_id
      where pm.user_id = auth.uid()
      limit 1
    )
    where id = auth.uid();
  end if;

  return linked_count;
end;
$$;

grant execute on function link_my_invitations() to authenticated;
