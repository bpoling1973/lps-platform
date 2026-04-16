import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DEFAULT_TRADES } from '@/lib/constants'

function deriveStatus(dayStatuses) {
  if (!dayStatuses?.length) return 'not_started'
  if (dayStatuses.every(s => s === 'complete')) return 'complete'
  if (dayStatuses.some(s => s === 'in_progress' || s === 'complete')) return 'in_progress'
  return 'not_started'
}

function getISOWeekNumber(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const utcD = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  utcD.setUTCDate(utcD.getUTCDate() + 4 - (utcD.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(utcD.getUTCFullYear(), 0, 1))
  return Math.ceil((((utcD - yearStart) / 86400000) + 1) / 7)
}

export default function TaskFormModal({ projectId, weekNumber, weekDays, existing, prefill, project, onClose }) {
  const queryClient = useQueryClient()

  const projectSettings = project?.settings || {}
  const trades = projectSettings.trades?.length ? projectSettings.trades : DEFAULT_TRADES
  const zones = projectSettings.zones || []

  const existingTradeInList = existing?.trade && trades.includes(existing.trade)
  const [customTrade, setCustomTrade] = useState(!existingTradeInList && existing?.trade ? existing.trade : '')
  const [showCustomTrade, setShowCustomTrade] = useState(!existingTradeInList && !!existing?.trade)

  const [form, setForm] = useState({
    title: existing?.title || '',
    trade: existing?.trade || prefill?.trade || '',
    gang_id: existing?.gang_id || prefill?.gang_id || '',
    planned_start: existing?.planned_start || prefill?.planned_start || '',
    duration_days: existing?.duration_days || 1,
    zone: existing?.zone || '',
  })

  const [error, setError] = useState(null)
  const [selectedOwnerMemberId, setSelectedOwnerMemberId] = useState(existing?.owner_id || '')

  // Fetch project members for owner assignment
  const { data: members } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('id, role, invited_email, profiles(id, full_name, email)')
        .eq('project_id', projectId)
      if (error) throw error
      return data
    },
  })

  const effectiveTrade = showCustomTrade ? customTrade : form.trade
  const durationOver3 = Number(form.duration_days) > 3

  const save = useMutation({
    mutationFn: async () => {
      const newDuration = Number(form.duration_days) || 1

      // Preserve existing day_statuses when editing, adjusted to new duration
      const existingStatuses = existing?.day_statuses || []
      const day_statuses = Array.from({ length: newDuration }, (_, i) =>
        existingStatuses[i] || 'not_started'
      )

      const payload = {
        project_id: projectId,
        phase: 'wwp',
        week_number: getISOWeekNumber(form.planned_start) ?? weekNumber,
        title: form.title.trim(),
        trade: effectiveTrade || null,
        gang_id: form.gang_id.trim() || null,
        planned_start: form.planned_start || null,
        duration_days: newDuration,
        zone: form.zone || null,
        status: deriveStatus(day_statuses),
        day_statuses,
        owner_id: selectedOwnerMemberId || null,
        planned_end: null,
      }

      if (existing) {
        const { error } = await supabase.from('phase_tasks').update(payload).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data: task, error } = await supabase.from('phase_tasks').insert(payload).select().single()
        if (error) throw error
        if (selectedOwnerMemberId) {
          await supabase.functions.invoke('send-task-assignment', {
            body: { taskId: task.id, projectId },
          }).catch(() => {})
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
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
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
      onClose()
    },
    onError: (err) => setError(err.message),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    if (durationOver3) return // blocked by warning UI
    save.mutate()
  }

  function memberLabel(m) {
    return m.profiles?.full_name || m.profiles?.email || m.invited_email || m.id
  }

  // Day of week quick-pick based on weekDays (supports 14-day / 2-week view)
  const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const dayOptions = weekDays?.map((d, i) => ({
    value: (() => {
      const y = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const da = String(d.getDate()).padStart(2, '0')
      return `${y}-${mo}-${da}`
    })(),
    label: DAY_NAMES[i % 7] + ' ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    isRecovery: i % 7 >= 5,
    weekStart: i === 0 || i === 7,
    weekNum: i < 7 ? 1 : 2,
  })) || []
  const week1Days = dayOptions.slice(0, 7)
  const week2Days = dayOptions.slice(7, 14)
  const week3Days = dayOptions.slice(14, 21)
  const week4Days = dayOptions.slice(21, 28)

  const selectedZone = zones.find(z => z.name === form.zone)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {existing ? 'Edit Task' : 'Add Task to WWP'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Task description *</label>
            <input
              type="text" required value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Fix first floor slab penetrations"
            />
          </div>

          {/* Trade dropdown */}
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
                <button
                  type="button"
                  onClick={() => { setShowCustomTrade(false); setCustomTrade('') }}
                  className="px-3 py-3 rounded-lg border border-gray-300 text-gray-500 text-sm hover:bg-gray-50"
                >
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
              placeholder="e.g. Gang A, Gang 1, North Team"
            />
          </div>

          {/* Zone */}
          {zones.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Construction zone</label>
              <div className="flex gap-2 items-center">
                {selectedZone && (
                  <div className="w-5 h-5 rounded flex-shrink-0 border border-gray-200"
                    style={{ backgroundColor: selectedZone.colour }} />
                )}
                <select
                  value={form.zone}
                  onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— No zone —</option>
                  {zones.map(z => (
                    <option key={z.name} value={z.name}>{z.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Start date — quick day picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
            {dayOptions.length > 0 ? (
              <div className="space-y-1.5">
                {[week1Days, week2Days, week3Days, week4Days].filter(w => w.length > 0).map((weekDaySet, wi) => (
                  <div key={wi}>
                    <p className="text-xs text-gray-400 font-medium mb-1">Week {wi + 1}</p>
                    <div className="grid grid-cols-7 gap-1">
                      {weekDaySet.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, planned_start: opt.value }))}
                          className="py-1.5 rounded-lg border-2 text-center transition-all"
                          style={{
                            borderColor: form.planned_start === opt.value ? '#1e3a5f' : '#e5e7eb',
                            backgroundColor: form.planned_start === opt.value
                              ? '#1e3a5f15'
                              : opt.isRecovery ? '#fef3c7' : 'white',
                            color: form.planned_start === opt.value ? '#1e3a5f' : opt.isRecovery ? '#d97706' : '#374151',
                          }}
                        >
                          <div className="text-xs font-bold leading-tight">{opt.label.split(' ')[0]}</div>
                          <div style={{ fontSize: '0.6rem' }} className="text-gray-500 leading-tight">{opt.label.split(' ').slice(1).join(' ')}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <input
                type="date" value={form.planned_start}
                onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
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
            {durationOver3 && (
              <div className="mt-2 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50">
                <p className="text-sm font-medium text-amber-800">⚠ Tasks should be 3 days or less</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Please break this task into smaller chunks of 3 days or less to maintain short-cycle planning.
                </p>
              </div>
            )}
          </div>

          {/* Owner */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <select
              value={selectedOwnerMemberId}
              onChange={e => setSelectedOwnerMemberId(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Unassigned —</option>
              {members?.map(m => (
                <option key={m.id} value={m.id}>
                  {memberLabel(m)} ({m.role?.replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={save.isPending || durationOver3}
              className="flex-1 py-3 rounded-lg text-white font-semibold disabled:opacity-60 min-h-[48px]"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              {save.isPending ? 'Saving…' : existing ? 'Update Task' : 'Add Task'}
            </button>
            <button
              type="button" onClick={onClose}
              className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium min-h-[48px]"
            >
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
