import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole } from '@/hooks/useProject'

const WEEKS_AHEAD = 6

function getWeekLabel(offset) {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.setDate(diff + offset * 7))
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  return `W+${offset}: ${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${friday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

function getCurrentWeekNumber() {
  const d = new Date()
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

function ConstraintBadge({ count }) {
  if (!count) return null
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: '#d97706' }}>
      {count}
    </span>
  )
}

function ConstraintForm({ taskId, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ description: '', owner_name: '', owner_email: '', due_date: '' })
  const [error, setError] = useState(null)

  const save = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('constraints').insert({ ...data, phase_task_id: taskId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookahead'] })
      onClose()
    },
    onError: err => setError(err.message),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Log Constraint</h3>
        <form onSubmit={e => { e.preventDefault(); save.mutate(form) }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Constraint description *</label>
            <textarea
              required rows={2} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="e.g. Steel delivery not confirmed"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner name</label>
              <input type="text" value={form.owner_name}
                onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner email</label>
              <input type="email" value={form.owner_email}
                onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="owner@company.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due date</label>
            <input type="date" value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending}
              className="flex-1 py-3 rounded-lg text-white font-semibold disabled:opacity-60 min-h-[48px]"
              style={{ backgroundColor: '#1e3a5f' }}>
              {save.isPending ? 'Saving…' : 'Log Constraint'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium min-h-[48px]">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LookaheadPage() {
  const { projectId } = useParams()
  const { data: role } = useMyProjectRole(projectId)
  const queryClient = useQueryClient()
  const canEdit = ['project_admin', 'planner'].includes(role)

  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showConstraintForm, setShowConstraintForm] = useState(null) // taskId
  const [expandedTask, setExpandedTask] = useState(null)
  const [newTask, setNewTask] = useState({ title: '', trade: '', week_offset: 1 })

  const currentWeek = getCurrentWeekNumber()

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['lookahead', projectId],
    queryFn: async () => {
      const weekNumbers = Array.from({ length: WEEKS_AHEAD }, (_, i) => currentWeek + i + 1)
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('*, constraints(*)')
        .eq('project_id', projectId)
        .eq('phase', 'lookahead')
        .in('week_number', weekNumbers)
        .order('week_number', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  })

  const addTask = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('phase_tasks').insert({
        project_id: projectId,
        phase: 'lookahead',
        title: data.title,
        trade: data.trade || null,
        week_number: currentWeek + data.week_offset,
        status: 'not_started',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookahead', projectId] })
      setShowTaskForm(false)
      setNewTask({ title: '', trade: '', week_offset: 1 })
    },
  })

  const resolveConstraint = useMutation({
    mutationFn: async ({ id, note }) => {
      const { error } = await supabase.from('constraints')
        .update({ status: 'resolved', resolution_note: note })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lookahead', projectId] }),
  })

  // Group tasks by week
  const tasksByWeek = Array.from({ length: WEEKS_AHEAD }, (_, i) => {
    const weekNum = currentWeek + i + 1
    return {
      weekNum,
      label: getWeekLabel(i + 1),
      tasks: tasks.filter(t => t.week_number === weekNum),
    }
  })

  const totalOpen = tasks.reduce((acc, t) =>
    acc + (t.constraints?.filter(c => c.status === 'open').length || 0), 0)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">6-Week Lookahead</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalOpen > 0 ? (
              <span style={{ color: '#d97706' }}>⚠ {totalOpen} open constraint{totalOpen !== 1 ? 's' : ''}</span>
            ) : 'All constraints clear'}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowTaskForm(v => !v)}
            className="px-4 py-2.5 rounded-lg text-white font-medium text-sm min-h-[48px]"
            style={{ backgroundColor: '#1e3a5f' }}>
            + Add Task
          </button>
        )}
      </div>

      {showTaskForm && (
        <form onSubmit={e => { e.preventDefault(); addTask.mutate(newTask) }}
          className="bg-white rounded-xl border border-blue-300 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <input type="text" required value={newTask.title}
                onChange={e => setNewTask(f => ({ ...f, title: e.target.value }))}
                placeholder="Task description"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <input type="text" value={newTask.trade}
              onChange={e => setNewTask(f => ({ ...f, trade: e.target.value }))}
              placeholder="Trade"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Week:</label>
            <select value={newTask.week_offset}
              onChange={e => setNewTask(f => ({ ...f, week_offset: Number(e.target.value) }))}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {Array.from({ length: WEEKS_AHEAD }, (_, i) => (
                <option key={i + 1} value={i + 1}>{getWeekLabel(i + 1)}</option>
              ))}
            </select>
            <button type="submit" disabled={addTask.isPending}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium min-h-[40px]"
              style={{ backgroundColor: '#1e3a5f' }}>
              {addTask.isPending ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setShowTaskForm(false)}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 min-h-[40px]">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {tasksByWeek.map(({ weekNum, label, tasks: weekTasks }) => (
            <div key={weekNum} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between"
                style={{ backgroundColor: '#f8fafc' }}>
                <h2 className="font-semibold text-gray-800 text-sm 2xl:text-base">{label}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{weekTasks.length} task{weekTasks.length !== 1 ? 's' : ''}</span>
                  {weekTasks.some(t => t.constraints?.some(c => c.status === 'open')) && (
                    <ConstraintBadge count={weekTasks.reduce((a, t) =>
                      a + (t.constraints?.filter(c => c.status === 'open').length || 0), 0)} />
                  )}
                </div>
              </div>

              {weekTasks.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No tasks planned for this week</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {weekTasks.map(task => {
                    const openConstraints = task.constraints?.filter(c => c.status === 'open') || []
                    const resolvedConstraints = task.constraints?.filter(c => c.status === 'resolved') || []
                    const isExpanded = expandedTask === task.id

                    return (
                      <div key={task.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900 text-sm 2xl:text-base truncate">{task.title}</p>
                              {openConstraints.length > 0 && (
                                <ConstraintBadge count={openConstraints.length} />
                              )}
                            </div>
                            {task.trade && <p className="text-xs text-gray-500 mt-0.5">{task.trade}</p>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {task.constraints?.length > 0 && (
                              <button
                                onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                                className="text-xs text-blue-600 hover:text-blue-800 min-h-[36px] px-2">
                                {isExpanded ? 'Hide' : `Constraints (${task.constraints.length})`}
                              </button>
                            )}
                            {canEdit && (
                              <button
                                onClick={() => setShowConstraintForm(task.id)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 min-h-[36px]">
                                + Constraint
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && task.constraints?.length > 0 && (
                          <div className="mt-3 space-y-2 pl-2 border-l-2" style={{ borderColor: '#d97706' }}>
                            {task.constraints.map(c => (
                              <div key={c.id} className="text-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-gray-800">{c.description}</p>
                                    {c.owner_name && (
                                      <p className="text-xs text-gray-500 mt-0.5">
                                        Owner: {c.owner_name}
                                        {c.owner_email && ` (${c.owner_email})`}
                                        {c.due_date && ` · Due: ${new Date(c.due_date).toLocaleDateString('en-GB')}`}
                                      </p>
                                    )}
                                    {c.resolution_note && (
                                      <p className="text-xs text-gray-500 mt-0.5 italic">{c.resolution_note}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                      c.status === 'open'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-blue-100 text-blue-700'
                                    }`}>
                                      {c.status}
                                    </span>
                                    {canEdit && c.status === 'open' && (
                                      <button
                                        onClick={() => {
                                          const note = prompt('Resolution note (optional):') ?? ''
                                          resolveConstraint.mutate({ id: c.id, note })
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-800 min-h-[32px]">
                                        Resolve
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showConstraintForm && (
        <ConstraintForm
          taskId={showConstraintForm}
          onClose={() => setShowConstraintForm(null)}
        />
      )}
    </div>
  )
}
