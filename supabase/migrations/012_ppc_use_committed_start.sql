-- ─────────────────────────────────────────────────────────────────────────────
-- 012_ppc_use_committed_start.sql
-- Fixes daily PPC to use committed_start (the baseline position at commit time)
-- rather than planned_start (the current, possibly moved position).
--
-- Before this fix: dragging a committed task to a different day excluded it
-- from the PPC denominator — it never appeared in planned_count.
-- After this fix: the committed_start position drives which day segment is
-- evaluated, so moved tasks correctly appear as "planned but not completed".
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Skip weekends
  if extract(isodow from p_date) in (6, 7) then return; end if;

  p_week_num := extract(week from p_date)::integer;

  with task_seg as (
    select
      pt.day_statuses,
      pt.duration_days,
      -- Use committed_start (baseline position) to compute the working-day
      -- segment index for p_date.  coalesce handles legacy rows with no
      -- committed_start (falls back to planned_start for safety).
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
      -- Task must have been in the committed plan by this date
      and (pt.committed_at is null or pt.committed_at::date <= p_date)
      -- Baseline start must be on or before p_date
      and coalesce(pt.committed_start, pt.planned_start) <= p_date
  )
  select
    count(*)::integer,
    count(*) filter (
      where seg_idx >= 0
        and seg_idx < duration_days
        and (day_statuses->>(seg_idx)) = 'complete'
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
