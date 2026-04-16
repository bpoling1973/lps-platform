-- Add per-day status array to phase_tasks.
-- Each element maps to one day of the task's duration_days.
-- Values: 'not_started' | 'in_progress' | 'complete'
-- Overall task status is derived from this array by the application.

alter table phase_tasks
  add column if not exists day_statuses jsonb;
