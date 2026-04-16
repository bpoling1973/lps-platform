-- ─────────────────────────────────────────────────────────────────────────────
-- demo_project.sql
-- Creates a realistic demo project: "Elmwood Court — Residential Development"
-- ⚠️  BEFORE RUNNING: replace YOUR_EMAIL_HERE below with your login email.
-- Uses current_date so tasks always land near the live 4-week view.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_email         text    := 'bpoling@opsolv.co.uk';
  v_tenant_id     uuid;
  v_user_id       uuid;
  v_project_id    uuid;
  v_member_id     uuid;

  -- Trades / gangs (stored in project settings)
  v_settings      jsonb;

  -- Week anchors (Monday of each ISO week relative to today)
  w_cur  date; -- Monday of current week
  w_p1   date; -- Monday of previous week (w_cur - 7)
  w_n1   date; -- Monday of next week (w_cur + 7)
  w_n2   date; -- w_cur + 14
  w_n3   date; -- w_cur + 21

  -- Week numbers
  wn_cur  integer;
  wn_p1   integer;
  wn_n1   integer;
  wn_n2   integer;
  wn_n3   integer;

  -- Task ids we'll reference for dependencies
  t_gw_a1  uuid; t_gw_a2  uuid; t_gw_b1  uuid;
  t_ss_a1  uuid; t_ss_a2  uuid;
  t_cf_a1  uuid; t_cf_a2  uuid; t_cf_b1  uuid;
  t_bk_a1  uuid; t_bk_a2  uuid;
  t_me_a1  uuid; t_me_a2  uuid;
  t_el_a1  uuid; t_el_a2  uuid;

  -- Milestone ids (for float badge demo on lookahead)
  m_id_1  uuid; m_id_2  uuid; m_id_3  uuid; m_id_4  uuid;

  -- Lookahead task ids (need refs for constraints inserts)
  t_la_me1  uuid;  -- W+3 Mechanical (has constraint)
  t_la_ss4  uuid;  -- W+4 Steelwork  (has constraint)
  t_la_bk4  uuid;  -- W+4 Brickwork  (float lost demo)

  -- Extra week anchors for lookahead (W+4..W+6)
  w_n4  date; w_n5  date; w_n6  date;
  wn_n4 integer; wn_n5 integer; wn_n6 integer;

begin
  -- ── Resolve user + tenant from email (SQL Editor runs as service role) ───────
  if v_email = 'YOUR_EMAIL_HERE' then
    raise exception 'Replace YOUR_EMAIL_HERE with your login email before running';
  end if;

  select id into v_user_id from profiles where email = v_email limit 1;
  if v_user_id is null then
    raise exception 'No profile found for email: %', v_email;
  end if;

  select tenant_id into v_tenant_id from profiles where id = v_user_id;
  if v_tenant_id is null then
    raise exception 'Profile for % has no tenant_id — assign one first in the Admin panel', v_email;
  end if;

  -- ── Week date anchors ────────────────────────────────────────────────────────
  w_cur := date_trunc('week', current_date)::date;
  w_p1  := w_cur - 7;
  w_n1  := w_cur + 7;
  w_n2  := w_cur + 14;
  w_n3  := w_cur + 21;

  wn_cur := extract(week from w_cur)::integer;
  wn_p1  := extract(week from w_p1)::integer;
  wn_n1  := extract(week from w_n1)::integer;
  wn_n2  := extract(week from w_n2)::integer;
  wn_n3  := extract(week from w_n3)::integer;

  w_n4  := w_cur + 28; w_n5  := w_cur + 35; w_n6  := w_cur + 42;
  wn_n4 := extract(week from w_n4)::integer;
  wn_n5 := extract(week from w_n5)::integer;
  wn_n6 := extract(week from w_n6)::integer;

  -- ── Project settings (trades + gangs + zones) ────────────────────────────────
  v_settings := jsonb_build_object(
    'trades', jsonb_build_array(
      jsonb_build_object('name', 'Groundworks & Drainage',  'gangs', jsonb_build_array('Gang A', 'Gang B')),
      jsonb_build_object('name', 'Structural Steelwork',    'gangs', jsonb_build_array('Gang A')),
      jsonb_build_object('name', 'Concrete Frame',          'gangs', jsonb_build_array('Gang A', 'Gang B')),
      jsonb_build_object('name', 'Brickwork & Blockwork',   'gangs', jsonb_build_array('Gang A', 'Gang B')),
      jsonb_build_object('name', 'Mechanical & Plumbing',   'gangs', jsonb_build_array('Gang A')),
      jsonb_build_object('name', 'Electrical',              'gangs', jsonb_build_array('Gang A'))
    ),
    'zones', jsonb_build_array(
      jsonb_build_object('name', 'Block A', 'color', '#2563eb'),
      jsonb_build_object('name', 'Block B', 'color', '#d97706'),
      jsonb_build_object('name', 'Block C', 'color', '#059669'),
      jsonb_build_object('name', 'Common Areas', 'color', '#7c3aed')
    ),
    'ppc_calc_time', '18:00',
    'wwp_commit_timezone', 'Europe/London'
  );

  -- ── Create project ────────────────────────────────────────────────────────────
  insert into projects (tenant_id, name, start_date, end_date, settings)
  values (
    v_tenant_id,
    'Elmwood Court — Residential Development',
    w_p1,
    w_n3 + 180,
    v_settings
  )
  returning id into v_project_id;

  -- ── Add current user as project_admin ────────────────────────────────────────
  insert into project_members (project_id, user_id, role, joined_at)
  values (v_project_id, v_user_id, 'project_admin', now())
  returning id into v_member_id;

  -- ── Milestones (captured separately so we can link lookahead tasks) ─────────
  insert into milestones (project_id, name, planned_date, forecast_date, rag_status, position)
  values (v_project_id, 'Substructure Complete', w_cur + 4, w_cur + 6, 'amber', 1)
  returning id into m_id_1;

  insert into milestones (project_id, name, planned_date, forecast_date, rag_status, position)
  values (v_project_id, 'Superstructure Topping Out', w_n2 + 4, w_n2 + 4, 'grey', 2)
  returning id into m_id_2;

  insert into milestones (project_id, name, planned_date, forecast_date, rag_status, position)
  values (v_project_id, 'Envelope Closed', w_n3 + 11, w_n3 + 11, 'grey', 3)
  returning id into m_id_3;

  insert into milestones (project_id, name, planned_date, forecast_date, rag_status, position)
  values (v_project_id, 'Practical Completion', w_n3 + 60, w_n3 + 60, 'grey', 4)
  returning id into m_id_4;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- WWP TASKS
  -- Colour key: Block A = #2563eb, Block B = #d97706, Block C = #059669
  -- ═══════════════════════════════════════════════════════════════════════════

  -- ── PREVIOUS WEEK (w_p1) — some tasks incomplete to trigger rescheduling ──

  -- Groundworks Gang A — 3d task, only day 1 complete (triggers rescheduling flag)
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, committed, committed_week, committed_at, committed_start, week_number)
  values
    (v_project_id, 'wwp', 'Drainage Run — Axis 1–4', 'Groundworks & Drainage', 'Gang A',
     w_p1, 3, 'Block A',
     'in_progress', '["complete","not_started","not_started"]'::jsonb,
     true, wn_p1, now() - interval '7 days', w_p1, wn_p1)
  returning id into t_gw_a1;

  -- Groundworks Gang A — 2d task, fully complete
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, committed, committed_week, committed_at, committed_start, week_number)
  values
    (v_project_id, 'wwp', 'Manhole Install — MH1 & MH2', 'Groundworks & Drainage', 'Gang A',
     w_p1 + 3, 2, 'Block A',
     'complete', '["complete","complete"]'::jsonb,
     true, wn_p1, now() - interval '7 days', w_p1 + 3, wn_p1)
  returning id into t_gw_a2;

  -- Groundworks Gang B — complete
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, committed, committed_week, committed_at, committed_start, week_number)
  values
    (v_project_id, 'wwp', 'Pile Cap Excavation — Grid A', 'Groundworks & Drainage', 'Gang B',
     w_p1 + 1, 3, 'Block B',
     'complete', '["complete","complete","complete"]'::jsonb,
     true, wn_p1, now() - interval '7 days', w_p1 + 1, wn_p1)
  returning id into t_gw_b1;

  -- ── CURRENT WEEK (w_cur) ─────────────────────────────────────────────────────

  -- Groundworks Gang B — in progress
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, committed, committed_week, committed_at, committed_start, week_number)
  values
    (v_project_id, 'wwp', 'Blinding Concrete — Grid A', 'Groundworks & Drainage', 'Gang B',
     w_cur, 2, 'Block B',
     'in_progress', '["complete","not_started"]'::jsonb,
     true, wn_cur, now() - interval '1 day', w_cur, wn_cur);

  -- Structural Steelwork Gang A — slipped 2 days (ghost card demo)
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, committed, committed_week, committed_at, committed_start, week_number)
  values
    (v_project_id, 'wwp', 'Steel Frame — Level 01 West', 'Structural Steelwork', 'Gang A',
     w_cur + 2, 3, 'Block A',
     'not_started', '["not_started","not_started","not_started"]'::jsonb,
     true, wn_cur, now() - interval '1 day',
     w_cur,          -- committed_start = Monday (slipped 2 working days to Wednesday)
     wn_cur)
  returning id into t_ss_a1;

  -- Concrete Frame Gang A
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Formwork Set — Slab Level 1', 'Concrete Frame', 'Gang A',
     w_cur + 1, 2, 'Block B', 'not_started', '["not_started","not_started"]'::jsonb, wn_cur)
  returning id into t_cf_a1;

  -- Concrete Frame Gang B
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Rebar Fix — Slab Level 1', 'Concrete Frame', 'Gang B',
     w_cur + 3, 2, 'Block B', 'not_started', '["not_started","not_started"]'::jsonb, wn_cur)
  returning id into t_cf_b1;

  -- ── NEXT WEEK (w_n1) ─────────────────────────────────────────────────────────

  -- Structural Steelwork Gang A — continues
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Steel Frame — Level 01 East', 'Structural Steelwork', 'Gang A',
     w_n1, 3, 'Block A', 'not_started', '["not_started","not_started","not_started"]'::jsonb, wn_n1)
  returning id into t_ss_a2;

  -- Concrete Frame Gang A — pour
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Concrete Pour — Slab Level 1', 'Concrete Frame', 'Gang A',
     w_n1, 1, 'Block B', 'not_started', '["not_started"]'::jsonb, wn_n1)
  returning id into t_cf_a2;

  -- Brickwork Gang A — Block A
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Facing Brick — Level 01 North Elevation', 'Brickwork & Blockwork', 'Gang A',
     w_n1 + 1, 4, 'Block A', 'not_started',
     '["not_started","not_started","not_started","not_started"]'::jsonb, wn_n1)
  returning id into t_bk_a1;

  -- Brickwork Gang B — Block B (resource conflict: same gang same day as above — different gang so not a conflict, this is fine)
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Blockwork Inner Leaf — Level 01', 'Brickwork & Blockwork', 'Gang B',
     w_n1 + 2, 3, 'Block B', 'not_started',
     '["not_started","not_started","not_started"]'::jsonb, wn_n1)
  returning id into t_bk_a2;

  -- Mechanical Gang A — 5d spanning into week after (spill/continuation demo)
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'First Fix Pipework — Block A Ground Floor', 'Mechanical & Plumbing', 'Gang A',
     w_n1 + 3, 5, 'Block A', 'not_started',
     '["not_started","not_started","not_started","not_started","not_started"]'::jsonb, wn_n1)
  returning id into t_me_a1;

  -- ── WEEK +2 (w_n2) ───────────────────────────────────────────────────────────

  -- Groundworks — Block C drainage
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Drainage Run — Block C', 'Groundworks & Drainage', 'Gang A',
     w_n2, 3, 'Block C', 'not_started',
     '["not_started","not_started","not_started"]'::jsonb, wn_n2);

  -- Brickwork Gang A — Level 02
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'Facing Brick — Level 02 North Elevation', 'Brickwork & Blockwork', 'Gang A',
     w_n2, 5, 'Block A', 'not_started',
     '["not_started","not_started","not_started","not_started","not_started"]'::jsonb, wn_n2);

  -- Mechanical Gang A — second fix starts
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'First Fix Pipework — Block B Ground Floor', 'Mechanical & Plumbing', 'Gang A',
     w_n2 + 1, 4, 'Block B', 'not_started',
     '["not_started","not_started","not_started","not_started"]'::jsonb, wn_n2)
  returning id into t_me_a2;

  -- Electrical Gang A
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'First Fix Containment — Block A', 'Electrical', 'Gang A',
     w_n2 + 2, 3, 'Block A', 'not_started',
     '["not_started","not_started","not_started"]'::jsonb, wn_n2)
  returning id into t_el_a1;

  -- ── WEEK +3 (w_n3) ───────────────────────────────────────────────────────────

  -- Mechanical resource conflict demo: two tasks same gang same week overlapping
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'First Fix Pipework — Block C', 'Mechanical & Plumbing', 'Gang A',
     w_n3, 3, 'Block C', 'not_started',
     '["not_started","not_started","not_started"]'::jsonb, wn_n3),
    -- Overlaps with above (resource conflict)
    (v_project_id, 'wwp', 'Pressurisation & Testing — Block A', 'Mechanical & Plumbing', 'Gang A',
     w_n3 + 1, 2, 'Block A', 'not_started',
     '["not_started","not_started"]'::jsonb, wn_n3);

  -- Electrical Gang A — Block B
  insert into phase_tasks
    (project_id, phase, title, trade, gang_id, planned_start, duration_days, zone,
     status, day_statuses, week_number)
  values
    (v_project_id, 'wwp', 'First Fix Containment — Block B', 'Electrical', 'Gang A',
     w_n3, 4, 'Block B', 'not_started',
     '["not_started","not_started","not_started","not_started"]'::jsonb, wn_n3)
  returning id into t_el_a2;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- LOOKAHEAD TASKS (phase = 'lookahead', weeks +1 → +6)
  -- Demonstrates: milestone banners, float badges, constraints
  -- ═══════════════════════════════════════════════════════════════════════════

  -- ── W+1 (wn_n1) ─────────────────────────────────────────────────────────────
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Steel Frame — Level 02', 'Structural Steelwork',
     w_n1, 5, 'Block A', wn_n1, 'not_started'),
    (v_project_id, 'lookahead', 'Formwork & Rebar — Slab Level 2', 'Concrete Frame',
     w_n1 + 2, 3, 'Block B', wn_n1, 'not_started');

  -- ── W+2 (wn_n2) ─────────────────────────────────────────────────────────────
  -- Brickwork linked to Superstructure milestone: ends w_n2+2, milestone w_n2+4 → 2d float (amber badge)
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status, milestone_id)
  values
    (v_project_id, 'lookahead', 'Facing Brick — Level 02 South Elevation', 'Brickwork & Blockwork',
     w_n2, 3, 'Block A', wn_n2, 'not_started', m_id_2);

  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Concrete Pour — Slab Level 2', 'Concrete Frame',
     w_n2 + 3, 1, 'Block B', wn_n2, 'not_started');

  -- ── W+3 (wn_n3) ─────────────────────────────────────────────────────────────
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Facing Brick — Level 02 Block B North', 'Brickwork & Blockwork',
     w_n3, 5, 'Block B', wn_n3, 'not_started');

  -- Mechanical W+3 — has an open constraint (ready-mix delivery)
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Second Fix Pipework — Block A', 'Mechanical & Plumbing',
     w_n3 + 1, 4, 'Block A', wn_n3, 'not_started')
  returning id into t_la_me1;

  -- ── W+4 (wn_n4) ─────────────────────────────────────────────────────────────
  -- Steelwork linked to Envelope Closed: ends w_n4+3, milestone w_n3+11 → 1d float (amber badge)
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status, milestone_id)
  values
    (v_project_id, 'lookahead', 'Roof Structure — Timber Frame Block A', 'Structural Steelwork',
     w_n4, 4, 'Block A', wn_n4, 'not_started', m_id_3)
  returning id into t_la_ss4;

  -- Brickwork linked to Envelope Closed: ends w_n4+4, milestone w_n3+11 → 0d = Float lost (red badge)
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status, milestone_id)
  values
    (v_project_id, 'lookahead', 'External Render — Block A', 'Brickwork & Blockwork',
     w_n4, 5, 'Block A', wn_n4, 'not_started', m_id_3)
  returning id into t_la_bk4;

  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Second Fix Containment — Block A', 'Electrical',
     w_n4 + 1, 4, 'Block A', wn_n4, 'not_started');

  -- ── W+5 (wn_n5) ─────────────────────────────────────────────────────────────
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Roof Covering — Block A', 'Structural Steelwork',
     w_n5, 3, 'Block A', wn_n5, 'not_started'),
    (v_project_id, 'lookahead', 'Second Fix Pipework — Block B', 'Mechanical & Plumbing',
     w_n5 + 1, 4, 'Block B', wn_n5, 'not_started'),
    (v_project_id, 'lookahead', 'Drainage Completion — Block C', 'Groundworks & Drainage',
     w_n5, 2, 'Block C', wn_n5, 'not_started');

  -- ── W+6 (wn_n6) ─────────────────────────────────────────────────────────────
  insert into phase_tasks (project_id, phase, title, trade, planned_start, duration_days, zone, week_number, status)
  values
    (v_project_id, 'lookahead', 'Second Fix Electrics — Block B', 'Electrical',
     w_n6, 5, 'Block B', wn_n6, 'not_started'),
    (v_project_id, 'lookahead', 'Roof Covering — Block B', 'Structural Steelwork',
     w_n6 + 1, 3, 'Block B', wn_n6, 'not_started');

  -- ── CONSTRAINTS ─────────────────────────────────────────────────────────────
  -- Open constraint on W+3 Mechanical (ready-mix delivery not confirmed)
  insert into constraints (phase_task_id, description, owner_name, owner_email, due_date, status)
  values
    (t_la_me1,
     'Ready-mix concrete delivery lead time — supplier confirmation outstanding',
     'Site Manager', 'site.manager@elmwoodcourt.co.uk',
     w_n3 - 7, 'open');

  -- Open constraint on W+4 Steelwork (timber frame delivery TBC)
  insert into constraints (phase_task_id, description, owner_name, owner_email, due_date, status)
  values
    (t_la_ss4,
     'Timber roof structure — fabrication drawings not yet approved by SE',
     'Structural Engineer', 'se@elmwoodcourt.co.uk',
     w_n4 - 5, 'open');

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TASK DEPENDENCIES
  -- ═══════════════════════════════════════════════════════════════════════════

  insert into task_dependencies (project_id, task_id, predecessor_id, lag_days)
  values
    -- Concrete Frame pour depends on rebar fix
    (v_project_id, t_cf_a2,  t_cf_b1,  0),
    -- Rebar fix depends on formwork
    (v_project_id, t_cf_b1,  t_cf_a1,  0),
    -- Steelwork East depends on West being done
    (v_project_id, t_ss_a2,  t_ss_a1,  0),
    -- Brickwork Level 01 depends on Steel Level 01 East
    (v_project_id, t_bk_a1,  t_ss_a2,  0),
    -- Electrical Block A depends on Mechanical Block A first fix (2-day lag)
    (v_project_id, t_el_a1,  t_me_a2,  2),
    -- Electrical Block B depends on Electrical Block A
    (v_project_id, t_el_a2,  t_el_a1,  0);

  raise notice 'Demo project created: % (id: %)', 'Elmwood Court — Residential Development', v_project_id;
end;
$$;
