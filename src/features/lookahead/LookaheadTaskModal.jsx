import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TASK_STATUS, DEFAULT_TRADES } from '@/lib/constants'

export default function LookaheadTaskModal({ projectId, weekNumber, existing, prefillWeek, project, onClose }) {
  const queryClient = useQueryClient()

  const projectSettings = project?.settings || {}
  const trades = projectSettings.trades?.length ? projectSettings.trades : DEFAULT_TRADES

  const existingTradeInList = existing?.trade && trades.includes(existing.trade)
  const [customTrade, setCustomTrade] = useState(!existingTradeInList && existing?.trade ? existing.trade : '')
  const [showCustomTrade, setShowCustomTrade] = useState(!existingTradeInList && !!existing?.trade)

  const [form, setForm] = useState({
    title: existing?.title || '',
    trade: existing?.trade || '',
    gang_id: existing?.gang_id || '',
    planned_start: existing?.planned_start || '',
    duration_days: existing?.duration_days || 1,
    milestone_id: existing?.milestone_id || '',
    status: existing?.status || 'not_started',
    week_number: existing?.week_number || weekNumber || '',
  })

  const [error, setError] = useState(null)

  // Fetch milestones for linkage dropdown
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('milestones')
        .select('*')
        .eq('project_id', projectId)
        .order('planned_date', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  const effectiveTrade = showCustomTrade ? customTrade : form.trade

  // Float calculation
  const linkedMilestone = milestones.find(m => m.id === form.milestone_id)
  let floatDays = null
  if (linkedMilestone && form.planned_start && form.duration_days) {
    const startDate = new Date(form.planned_start + 'T00:00:00')
    const finishDate = new Date(startDate)
    finishDate.setDate(startDate.getDate() + Number(form.duration_days) - 1)
    const milestoneDate = new Date(linkedMilestone.planned_date + 'T00:00:00')
    floatDays = Math.round((milestoneDate - finishDate) / (1000 * 60 * 60 * 24))
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        project_id: projectId,
        phase: 'lookahead',
        week_number: Number(form.week_number) || weekNumber,
        title: form.title.trim(),
        trade: effectiveTrade || null,
        gang_id: form.gang_id.trim() || null,
        planned_start: form.planned_start || null,
        duration_days: Number(form.duration_days) || 1,
        milestone_id: form.milestone_id || null,
        status: form.status,
      }

      if (existing) {
        const { error } = await supabase.from('phase_tasks').update(payload).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('phase_tasks').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookahead', projectId] })
      onClose()
    },
    onError: (err) => setError(err.message),
  })

  const deleteFn = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('phase_tasks').delete().eq('id', existing.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookahead', projectId] })
      onClose()
    },
    onError: (err) => setError(err.message),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    save.mutate()
  }

  function FloatBadge() {
    if (floatDays === null) return null
    if (floatDays > 5) return (
      <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
        ✓ {floatDays} days float to milestone
      </div>
    )
    if (floatDays > 0) return (
      <div className="px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-xs font-medium text-amber-800">
        ⚠ Only {floatDays} day{floatDays !== 1 ? 's' : ''} float remaining to milestone
      </div>
    )
    return (
      <div className="px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-xs font-medium text-red-700">
        🚨 Float lost — this task overruns the milestone by {Math.abs(floatDays)} day{Math.abs(floatDays) !== 1 ? 's' : ''}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {existing ? 'Edit Lookahead Task' : 'Add Lookahead Task'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Task description *</label>
            <input
              type="text" required value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Install structural steelwork — Level 3"
            />
          </div>

          {/* Trade */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trade</label>
            {!showCustomTrade ? (
              <select
                value={form.trade}
                onChange={e => {
                  if (e.target.value === '__other__') {
                    setShowCustomTrade(true)
                    setForm(f => ({ ...f, trade: '' }))
                  } else {
                    setForm(f => ({ ...f, trade: e.target.value }))
                  }
                }}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select trade —</option>
                {trades.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value="__other__">Other (type below)…</option>
              </select>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text" value={customTrade} autoFocus
                  onChange={e => setCustomTrade(e.target.value)}
                  placeholder="Enter trade name"
                  className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="button"
                  onClick={() => { setShowCustomTrade(false); setCustomTrade('') }}
                  className="px-3 py-3 rounded-lg border border-gray-300 text-gray-500 text-sm hover:bg-gray-50">
                  ← List
                </button>
              </div>
            )}
          </div>

          {/* Gang ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gang ID</label>
            <input
              type="text" value={form.gang_id}
              onChange={e => setForm(f => ({ ...f, gang_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Gang A, Gang 1"
            />
          </div>

          {/* Planned start */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Planned start date</label>
            <input
              type="date" value={form.planned_start}
              onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))}
              className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (days)</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, duration_days: Math.max(1, Number(f.duration_days) - 1) }))}
                className="w-10 h-10 rounded-lg border border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
              >−</button>
              <input
                type="number" min="1" value={form.duration_days}
                onChange={e => setForm(f => ({ ...f, duration_days: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="w-16 text-center px-2 py-2 rounded-lg border border-gray-300 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, duration_days: Number(f.duration_days) + 1 }))}
                className="w-10 h-10 rounded-lg border border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
              >+</button>
              <span className="text-sm text-gray-500">day{form.duration_days !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Milestone link */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Linked milestone</label>
            <select
              value={form.milestone_id}
              onChange={e => setForm(f => ({ ...f, milestone_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— No milestone link —</option>
              {milestones.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({new Date(m.planned_date + 'T00:00:00').toLocaleDateString('en-GB')})
                </option>
              ))}
            </select>
          </div>

          {/* Float indicator */}
          <FloatBadge />

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TASK_STATUS).map(([key, val]) => (
                <button
                  key={key} type="button"
                  onClick={() => setForm(f => ({ ...f, status: key }))}
                  className="py-2.5 rounded-lg border-2 text-xs font-medium transition-all min-h-[48px]"
                  style={{
                    borderColor: form.status === key ? val.colour : '#e5e7eb',
                    backgroundColor: form.status === key ? val.colour + '15' : 'white',
                    color: form.status === key ? val.colour : '#6b7280',
                  }}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit" disabled={save.isPending}
              className="flex-1 py-3 rounded-lg text-white font-semibold disabled:opacity-60 min-h-[48px]"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              {save.isPending ? 'Saving…' : existing ? 'Update Task' : 'Add Task'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium min-h-[48px]">
              Cancel
            </button>
          </div>

          {existing && (
            <button
              type="button"
              onClick={() => { if (confirm('Delete this task?')) deleteFn.mutate() }}
              disabled={deleteFn.isPending}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 min-h-[48px]"
            >
              Delete task
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
