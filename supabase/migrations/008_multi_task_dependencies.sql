-- ─────────────────────────────────────────────────────────────────────────────
-- 008_multi_task_dependencies.sql
-- Replace the single-predecessor columns on phase_tasks with a proper
-- junction table that supports multiple predecessors per task.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Junction table ────────────────────────────────────────────────────────

create table if not exists task_dependencies (
  id             uuid        primary key default gen_random_uuid(),
  project_id     uuid        not null references projects(id) on delete cascade,
  task_id        uuid        not null references phase_tasks(id) on delete cascade,
  predecessor_id uuid        not null references phase_tasks(id) on delete cascade,
  lag_days       integer     not null default 0,
  created_at     timestamptz not null default now(),
  unique (task_id, predecessor_id)
);

create index if not exists idx_task_deps_project    on task_dependencies(project_id);
create index if not exists idx_task_deps_task        on task_dependencies(task_id);
create index if not exists idx_task_deps_predecessor on task_dependencies(predecessor_id);

alter table task_dependencies enable row level security;

create policy "task_deps_select" on task_dependencies
  for select using (is_super_admin() or is_project_member(project_id));

create policy "task_deps_insert" on task_dependencies
  for insert with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

create policy "task_deps_update" on task_dependencies
  for update using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );

create policy "task_deps_delete" on task_dependencies
  for delete using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
  );


-- ── 2. Migrate existing single-predecessor data ───────────────────────────────
-- Safe to run even if migration 007 was never applied (DO block checks first).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'phase_tasks' and column_name = 'predecessor_id'
  ) then
    insert into task_dependencies (project_id, task_id, predecessor_id, lag_days)
    select project_id, id, predecessor_id, coalesce(lag_days, 0)
    from phase_tasks
    where predecessor_id is not null
    on conflict (task_id, predecessor_id) do nothing;

    alter table phase_tasks drop column if exists predecessor_id;
    alter table phase_tasks drop column if exists lag_days;
  end if;
end;
$$;
