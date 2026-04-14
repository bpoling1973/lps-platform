// Colour palette — colourblind-safe, never red/green as primary status indicators
export const COLOURS = {
  navy: '#1e3a5f',
  amber: '#d97706',
  darkGrey: '#4b5563',
  blue: '#2563eb',
  purple: '#7c3aed',
  orange: '#ea580c',
  white: '#ffffff',
}

// RAG status definitions (Navy = on track, Amber = at risk, Grey = not started)
export const RAG_STATUS = {
  navy: { label: 'On Track', colour: COLOURS.navy, bg: '#dbeafe' },
  amber: { label: 'At Risk', colour: COLOURS.amber, bg: '#fef3c7' },
  grey: { label: 'Not Started', colour: COLOURS.darkGrey, bg: '#f3f4f6' },
}

// Task status
export const TASK_STATUS = {
  not_started: { label: 'Not Started', colour: COLOURS.darkGrey },
  in_progress: { label: 'In Progress', colour: COLOURS.blue },
  complete: { label: 'Complete', colour: COLOURS.navy },
  incomplete: { label: 'Incomplete', colour: COLOURS.amber },
}

// LPS planning phases
export const PHASES = {
  master: 'Master Programme',
  phase: 'Phase / Pull Planning',
  lookahead: 'Lookahead (6-week)',
  wwp: 'Weekly Work Plan',
}

// User roles (per project)
export const ROLES = {
  project_admin: { label: 'Project Admin', description: 'Full access — configure, manage users, reports' },
  planner: { label: 'Planner / Last Planner', description: 'Create and edit plans, log constraints, mark tasks' },
  trade_supervisor: { label: 'Trade Supervisor', description: 'View and update own tasks, mobile-optimised' },
  viewer: { label: 'Viewer / Guest', description: 'Read-only access to dashboard and reports' },
  constraint_owner: { label: 'Constraint Owner', description: 'Email-only access via tokenised link' },
}

// Standard LCI Reasons for Non-Completion (RNC) categories
export const RNC_CATEGORIES = [
  { value: 'prerequisites_incomplete', label: 'Prerequisites not complete' },
  { value: 'design_incomplete', label: 'Design not complete' },
  { value: 'materials_unavailable', label: 'Materials not available' },
  { value: 'equipment_unavailable', label: 'Equipment not available' },
  { value: 'labour_unavailable', label: 'Labour not available' },
  { value: 'subcontractor_not_ready', label: 'Subcontractor not ready' },
  { value: 'weather', label: 'Weather' },
  { value: 'client_decision', label: 'Client decision' },
  { value: 'changed_scope', label: 'Changed scope' },
  { value: 'other', label: 'Other' },
]

// Notification channels
export const NOTIFICATION_CHANNELS = {
  email: 'email',
  push: 'push',
  teams: 'teams',
}

// Report types
export const REPORT_TYPES = {
  weekly_ppc: 'Weekly PPC Report',
  constraint_log: 'Constraint Log',
  milestone_rag: 'Milestone RAG Dashboard',
  lookahead_readiness: 'Lookahead Readiness Report',
  trade_performance: 'Trade Performance Summary',
  full_export: 'Full Data Export',
}

// OpSolv admin email domain
export const OPSOLV_DOMAIN = 'opsolv.co.uk'
