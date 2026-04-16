-- ─────────────────────────────────────────────────────────────────────────────
-- 029_segment_timestamps.sql
-- Adds day_statuses_at (timestamptz[]) to phase_tasks — one timestamp per
-- segment recording WHEN that segment was last set to its current status.
-- Updates _calc_daily_ppc to only count a segment as 'complete' if it was
-- marked complete on or before the calc date.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add column ────────────────────────────────────────────────────────────

alter table phase_tasks
  add column if not exists day_statuses_at timestamptz[];


-- ── 2. Update _calc_daily_ppc to respect timestamps ──────────────────────────

create or replace function _calc_daily_ppc(p_project_id uuid, p_date date, p_is_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_week_num    integer;
  planned_cnt   integer;
  complete_cnt  integer;
begin
  if extract(isodow from p_date) in (6, 7) then return; end if;

  p_week_num := extract(week from p_date)::integer;

  with task_seg as (
    select
      pt.day_statuses,
      pt.day_statuses_at,
      pt.duration_days,
      (
        select (count(*) - 1)::integer
        from generate_series(
          coalesce(pt.committed_start, pt.planned_start),
          p_date,
          '1 day'::interval
        ) gs(d)
        where extract(isodow from gs.d) not in (6, 7)
      ) as seg_idx
    from phase_tasks pt
    where pt.project_id    = p_project_id
      and pt.committed      = true
      and pt.committed_week = p_week_num
      and coalesce(pt.committed_start, pt.planned_start) <= p_date
      and (not p_is_auto or pt.committed_at is null or pt.committed_at::date <= p_date)
  )
  select
    count(*)::integer,
    count(*) filter (
      where seg_idx >= 0
        and seg_idx < duration_days
        and (day_statuses->>(seg_idx)) = 'complete'
        -- Only count if the segment was marked complete on or before p_date.
        -- If day_statuses_at is null (legacy data), assume it was timely.
        and (
          day_statuses_at is null
          or array_length(day_statuses_at, 1) <= seg_idx
          or day_statuses_at[seg_idx + 1] is null
          or (day_statuses_at[seg_idx + 1])::date <= p_date
        )
    )::integer
  into planned_cnt, complete_cnt
  from task_seg
  where seg_idx >= 0
    and seg_idx < duration_days;

  insert into daily_ppc
    (project_id, calc_date, planned_count, complete_count, calculated_at, is_auto)
  values
    (p_project_id, p_date, coalesce(planned_cnt, 0), coalesce(complete_cnt, 0), now(), p_is_auto)
  on conflict (project_id, calc_date)
  do update set
    planned_count  = excluded.planned_count,
    complete_count = excluded.complete_count,
    calculated_at  = excluded.calculated_at,
    is_auto        = excluded.is_auto;
end;
$$;
