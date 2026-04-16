-- ============================================================
-- 002 — WWP Board Enhancements
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Add gang_id, duration_days, zone, and milestone_id to phase_tasks
alter table phase_tasks
  add column if not exists gang_id      text,
  add column if not exists duration_days integer not null default 1,
  add column if not exists zone          text,
  add column if not exists milestone_id  uuid references milestones(id) on delete set null;

-- Index for milestone linkage (float calculation queries)
create index if not exists idx_phase_tasks_milestone on phase_tasks(milestone_id);
