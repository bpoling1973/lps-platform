-- ─────────────────────────────────────────────────────────────────────────────
-- 022_new_user_tenant_id.sql
-- Updates handle_new_user() so that when a new user signs up and has pending
-- project_members invitations, their profile.tenant_id is automatically set
-- from the project's tenant — linking them to the correct tenant on first login.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_tenant_id uuid;
begin
  -- Auto-set tenant_id from the first project this user was invited to
  select p.tenant_id into v_tenant_id
  from project_members pm
  join projects p on p.id = pm.project_id
  where pm.invited_email = new.email
    and pm.user_id is null
  limit 1;

  insert into profiles (id, email, full_name, tenant_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    v_tenant_id
  );

  -- Link invited project_members rows to this user
  update project_members
  set user_id = new.id, joined_at = now()
  where invited_email = new.email and user_id is null;

  return new;
end;
$$;
