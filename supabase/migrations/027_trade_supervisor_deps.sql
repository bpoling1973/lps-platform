-- ─────────────────────────────────────────────────────────────────────────────
-- 027_trade_supervisor_deps.sql
-- Allow trade supervisors to create and remove dependencies (cross-trade).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "task_deps_insert" on task_dependencies;
create policy "task_deps_insert" on task_dependencies for insert
  with check (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
    or has_project_role(project_id, 'trade_supervisor')
  );

drop policy if exists "task_deps_delete" on task_dependencies;
create policy "task_deps_delete" on task_dependencies for delete
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
    or has_project_role(project_id, 'planner')
    or has_project_role(project_id, 'trade_supervisor')
  );
