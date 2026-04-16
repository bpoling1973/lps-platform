-- ─────────────────────────────────────────────────────────────────────────────
-- 021_assigned_trades.sql
-- Adds assigned_trades to project_members so trade supervisors can be scoped
-- to specific trades. Admins and planners ignore this field.
-- ─────────────────────────────────────────────────────────────────────────────

alter table project_members
  add column if not exists assigned_trades text[];
