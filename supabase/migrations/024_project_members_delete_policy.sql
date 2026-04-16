-- ─────────────────────────────────────────────────────────────────────────────
-- 024_project_members_delete_policy.sql
-- Adds a DELETE policy on project_members so that project admins (and super
-- admins) can remove members from a project.
-- ─────────────────────────────────────────────────────────────────────────────

create policy "project_members_delete" on project_members for delete
  using (
    is_super_admin()
    or has_project_role(project_id, 'project_admin')
  );
