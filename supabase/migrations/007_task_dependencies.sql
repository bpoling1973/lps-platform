-- ─────────────────────────────────────────────────────────────────────────────
-- 007_task_dependencies.sql
-- Task predecessor/lag dependency tracking for the WWP board.
-- predecessor_id: the task that must be (partially) complete before this one starts
-- lag_days: how many days of the predecessor must be complete (0 = finish-to-start)
-- ─────────────────────────────────────────────────────────────────────────────

alter table phase_tasks
  add column if not exists predecessor_id uuid references phase_tasks(id) on delete set null,
  add column if not exists lag_days       integer not null default 0;

create index if not exists idx_phase_tasks_predecessor on phase_tasks(predecessor_id);
