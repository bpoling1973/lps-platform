-- ─────────────────────────────────────────────────────────────────────────────
-- 011_projects_delete_policy.sql
-- Adds the missing DELETE RLS policy on the projects table.
-- Without this, project_admin delete attempts succeed silently with 0 rows
-- affected because RLS blocks them without raising an error.
-- ─────────────────────────────────────────────────────────────────────────────

create policy "projects_delete" on projects for delete
  using (
    is_super_admin()
    or (tenant_id = get_my_tenant_id() and has_project_role(id, 'project_admin'))
  );
