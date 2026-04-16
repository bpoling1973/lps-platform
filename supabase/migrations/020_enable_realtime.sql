-- ─────────────────────────────────────────────────────────────────────────────
-- 020_enable_realtime.sql
-- Adds the tables that need collaborative real-time sync to the
-- supabase_realtime publication so that postgres_changes subscriptions work.
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table phase_tasks;
alter publication supabase_realtime add table wwp_commits;
alter publication supabase_realtime add table milestones;
alter publication supabase_realtime add table task_dependencies;
alter publication supabase_realtime add table daily_ppc;
