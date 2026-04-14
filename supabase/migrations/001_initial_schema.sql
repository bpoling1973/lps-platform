-- OpSolv LPS Platform — Initial Schema
-- Run this in the Supabase SQL editor or via: supabase db push

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
create type rag_status_enum as enum ('navy', 'amber', 'grey');
create type lps_phase_enum as enum ('master', 'phase', 'lookahead', 'wwp');
create type task_status_enum as enum ('not_started', 'in_progress', 'complete', 'incomplete');
create type constraint_status_enum as enum ('open', 'resolved');
create type user_role_enum as enum ('project_admin', 'planner', 'trade_supervisor', 'viewer', 'constraint_owner');
create type notification_channel_enum as enum ('email', 'push', 'teams');
create type report_type_enum as enum ('weekly_ppc', 'constraint_log', 'milestone_rag', 'lookahead_readiness', 'trade_performance', 'full_export');
create type plan_tier_enum as enum ('trial', 'starter', 'professional', 'enterprise');
create type billing_status_enum as enum ('active', 'suspended', 'cancelled', 'trial');

create type rnc_category_enum as enum (
  'prerequisites_incomplete',
  'design_incomplete',
  'materials_unavailable',
  'equipment_unavailable',
  'labour_unavailable',
  'subcontractor_not_ready',
  'weather',
  'client_decision',
  'changed_scope',
  'other'
);

-- ============================================================
-- TABLES
-- ============================================================

-- Tenants (paying customers — main contractors, consultancies)
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan_tier   plan_tier_enum not null default 'trial',
  billing_status billing_status_enum not null default 'trial',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- User profiles (created automatically via trigger on auth.users insert)
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  tenant_id      uuid references tenants(id) on delete set null,
  full_name      text,
  email          text not null,
  is_super_admin boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Projects (belong to a tenant)
create table projects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  start_date  date,
  end_date    date,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Project members (users and invited non-users per project)
create table project_members (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  user_id        uuid references profiles(id) on delete set null,
  role           user_role_enum not null,
  invited_email  text,
  token          uuid unique default gen_random_uuid(),  -- for constraint owners / non-registered access
  joined_at      timestamptz,
  created_at     timestamptz not null default now(),
  constraint project_members_user_or_email check (user_id is not null or invited_email is not null)
);

-- Milestones (Master Programme)
create table milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  name           text not null,
  planned_date   date not null,
  forecast_date  date,
  rag_status     rag_status_enum not null default 'grey',
  owner_id       uuid references project_members(id) on delete set null,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Phase tasks (covers all LPS phases: master, phase, lookahead, wwp)
create table phase_tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  phase         lps_phase_enum not null,
  title         text not null,
  trade         text,
  owner_id      uuid references project_members(id) on delete set null,
  planned_start date,
  planned_end   date,
  status        task_status_enum not null default 'not_started',
  week_number   integer,  -- ISO week number for WWP phase
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Constraints (logged against phase tasks)
create table constraints (
  id               uuid primary key default gen_random_uuid(),
  phase_task_id    uuid not null references phase_tasks(id) on delete cascade,
  description      text not null,
  owner_email      text,
  owner_name       text,
  due_date         date,
  status           constraint_status_enum not null default 'open',
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- PPC records (one per project per week)
create table ppc_records (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  week_ending    date not null,
  planned_count  integer not null default 0,
  complete_count integer not null default 0,
  ppc_percent    numeric(5,2) generated always as (
    case when planned_count > 0
    then round((complete_count::numeric / planned_count::numeric) * 100, 2)
    else 0
    end
  ) stored,
  created_at     timestamptz not null default now(),
  unique(project_id, week_ending)
);

-- RNC entries (one per incomplete task per PPC record)
create table rnc_entries (
  id             uuid primary key default gen_random_uuid(),
  phase_task_id  uuid not null references phase_tasks(id) on delete cascade,
  ppc_record_id  uuid not null references ppc_records(id) on delete cascade,
  category       rnc_category_enum not null,
  notes          text,
  created_at     timestamptz not null default now()
);

-- Notification log
create table notification_log (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references projects(id) on delete cascade,
  recipient_email  text not null,
  channel          notification_channel_enum not null,
  event_type       text not null,
  sent_at          timestamptz not null default now(),
  status           text not null default 'sent'  -- sent, failed, pending
);

-- Report schedules (per project)
create table report_schedule (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  report_type  report_type_enum not null,
  frequency    text not null default 'weekly',  -- weekly, monthly, on_demand
  recipients   text[] not null default '{}',
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_projects_tenant_id on projects(tenant_id);
create index idx_project_members_project_id on project_members(project_id);
create index idx_project_members_user_id on project_members(user_id);
create index idx_project_members_token on project_members(token);
create index idx_milestones_project_id on milestones(project_id);
create index idx_phase_tasks_project_id on phase_tasks(project_id);
create index idx_phase_tasks_phase on phase_tasks(phase);
create index idx_phase_tasks_week on phase_tasks(week_number);
create index idx_constraints_task_id on constraints(phase_task_id);
create index idx_ppc_records_project_id on ppc_records(project_id);
create index idx_rnc_entries_ppc_record on rnc_entries(ppc_record_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on auth.users insert
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );

  -- Link invited project_members rows to this user
  update project_members
  set user_id = new.id, joined_at = now()
  where invited_email = new.email and user_id is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Update updated_at timestamps
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_tenants_updated_at before update on tenants
  for each row execute procedure update_updated_at();
create trigger trg_profiles_updated_at before update on profiles
  for each row execute procedure update_updated_at();
create trigger trg_projects_updated_at before update on projects
  for each row execute procedure update_updated_at();
create trigger trg_milestones_updated_at before update on milestones
  for each row execute procedure update_updated_at();
create trigger trg_phase_tasks_updated_at before update on phase_tasks
  for each row execute procedure update_updated_at();
create trigger trg_constraints_updated_at before update on constraints
  for each row execute procedure update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table tenants enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table milestones enable row level security;
alter table phase_tasks enable row level security;
alter table constraints enable row level security;
alter table ppc_records enable row level security;
alter table rnc_entries enable row level security;
alter table notification_log enable row level security;
alter table report_schedule enable row level security;

-- Helper: get the current user's tenant_id
create or replace function get_my_tenant_id()
returns uuid language sql stable security definer as $$
  select tenant_id from profiles where id = auth.uid()
$$;

-- Helper: check if current user is a member of a project (any role)
create or replace function is_project_member(p_project_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from project_members
    where project_id = p_project_id
    and user_id = auth.uid()
  )
$$;

-- Helper: check if current user has a specific role in a project
create or replace function has_project_role(p_project_id uuid, p_role user_role_enum)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from project_members
    where project_id = p_project_id
    and user_id = auth.uid()
    and role = p_role
  )
$$;

-- Helper: check if current user is OpSolv super admin
create or replace function is_super_admin()
returns boolean language sql stable security definer as $$
  select coalesce(
    (select is_super_admin from profiles where id = auth.uid()),
    false
  )
$$;

-- TENANTS: Super admins see all; users see their own tenant
create policy "tenants_select" on tenants for select
  using (is_super_admin() or id = get_my_tenant_id());

create policy "tenants_insert" on tenants for insert
  with check (is_super_admin());

create policy "tenants_update" on tenants for update
  using (is_super_admin());

-- PROFILES: Users see their own profile; super admins see all
create policy "profiles_select" on profiles for select
  using (id = auth.uid() or is_super_admin());

create policy "profiles_update" on profiles for update
  using (id = auth.uid());

-- PROJECTS: Members of the project can select; admins can insert/update
create policy "projects_select" on projects for select
  using (
    is_super_admin()
    or (tenant_id = get_my_tenant_id() and is_project_member(id))
  );

create policy "projects_insert" on projects for insert
  with check (
    is_super_admin()
    or tenant_id = get_my_tenant_id()
  );

create policy "projects_update" on projects for update
  using (
    is_super_admin()
    or (tenant_id = get_my_tenant_id() and has_project_role(id, 'project_admin'))
  );

-- PROJECT MEMBERS: Members can see their project's member list
create policy "project_members_select" on project_members for select
  using (
    is_super_admin()
    or is_project_member(project_id)
    or user_id = auth.uid()
  );

create policy "project_members_insert" on project_members for insert
  with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
  );

create policy "project_members_update" on project_members for update
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or user_id = auth.uid()
  );

-- MILESTONES: Project members can read; project_admin can write
create policy "milestones_select" on milestones for select
  using (is_super_admin() or is_project_member(project_id));

create policy "milestones_insert" on milestones for insert
  with check (is_super_admin() or has_project_role(project_id, 'project_admin'));

create policy "milestones_update" on milestones for update
  using (is_super_admin() or has_project_role(project_id, 'project_admin'));

create policy "milestones_delete" on milestones for delete
  using (is_super_admin() or has_project_role(project_id, 'project_admin'));

-- PHASE TASKS: Members read; planners and admins write
create policy "phase_tasks_select" on phase_tasks for select
  using (is_super_admin() or is_project_member(project_id));

create policy "phase_tasks_insert" on phase_tasks for insert
  with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

create policy "phase_tasks_update" on phase_tasks for update
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
    or (
      has_project_role(project_id, 'trade_supervisor')
      and owner_id in (
        select id from project_members where user_id = auth.uid()
      )
    )
  );

create policy "phase_tasks_delete" on phase_tasks for delete
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

-- CONSTRAINTS: Project members read; planners/admins write
create policy "constraints_select" on constraints for select
  using (
    is_super_admin()
    or is_project_member(
      (select project_id from phase_tasks where id = phase_task_id)
    )
  );

create policy "constraints_insert" on constraints for insert
  with check (
    is_super_admin()
    or is_project_member(
      (select project_id from phase_tasks where id = phase_task_id)
    )
  );

create policy "constraints_update" on constraints for update
  using (
    is_super_admin()
    or is_project_member(
      (select project_id from phase_tasks where id = phase_task_id)
    )
  );

-- PPC RECORDS: Project members read; admins write
create policy "ppc_records_select" on ppc_records for select
  using (is_super_admin() or is_project_member(project_id));

create policy "ppc_records_insert" on ppc_records for insert
  with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

-- RNC ENTRIES: Project members read; members can log RNC
create policy "rnc_entries_select" on rnc_entries for select
  using (
    is_super_admin()
    or is_project_member(
      (select project_id from ppc_records where id = ppc_record_id)
    )
  );

create policy "rnc_entries_insert" on rnc_entries for insert
  with check (
    is_super_admin()
    or is_project_member(
      (select project_id from ppc_records where id = ppc_record_id)
    )
  );

-- NOTIFICATION LOG: Project members read; service role writes
create policy "notification_log_select" on notification_log for select
  using (is_super_admin() or is_project_member(project_id));

-- REPORT SCHEDULE: Project members read; admins write
create policy "report_schedule_select" on report_schedule for select
  using (is_super_admin() or is_project_member(project_id));

create policy "report_schedule_insert" on report_schedule for insert
  with check (is_super_admin() or has_project_role(project_id, 'project_admin'));

create policy "report_schedule_update" on report_schedule for update
  using (is_super_admin() or has_project_role(project_id, 'project_admin'));

-- ============================================================
-- REALTIME (enable for live collaboration)
-- ============================================================
-- Run these in the Supabase dashboard: Database -> Replication
-- Or uncomment and run here (requires supabase_realtime publication):
-- alter publication supabase_realtime add table phase_tasks;
-- alter publication supabase_realtime add table milestones;
-- alter publication supabase_realtime add table constraints;
-- alter publication supabase_realtime add table ppc_records;
