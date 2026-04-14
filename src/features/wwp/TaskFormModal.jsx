import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TASK_STATUS } from '@/lib/constants'

export default function TaskFormModal({ projectId, weekNumber, existing, onClose }) {
  const queryClient = useQueryClient()

  const [form, setForm] = useState({
    title: existing?.title || '',
    trade: existing?.trade || '',
    planned_start: existing?.planned_start || '',
    planned_end: existing?.planned_end || '',
    status: existing?.status || 'not_started',
    owner_email: '',
    owner_name: '',
  })
  const [error, setError] = useState(null)

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

  const [selectedOwnerMemberId, setSelectedOwnerMemberId] = useState(existing?.owner_id || '')

  const save = useMutation({
    mutationFn: async (data) => {
      const payload = {
        project_id: projectId,
        phase: 'wwp',
        week_number: weekNumber,
        title: data.title,
        trade: data.trade || null,
        planned_start: data.planned_start || null,
        planned_end: data.planned_end || null,
        status: data.status,
        owner_id: selectedOwnerMemberId || null,
      }

      if (existing) {
        const { error } = await supabase.from('phase_tasks').update(payload).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data: task, error } = await supabase.from('phase_tasks').insert(payload).select().single()
        if (error) throw error

        // Trigger assignment notification
        if (selectedOwnerMemberId) {
          await supabase.functions.invoke('send-task-assignment', {
            body: { taskId: task.id, projectId },
          }).catch(() => {}) // Non-fatal
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks', projectId, weekNumber] })
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
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks', projectId, weekNumber] })
      onClose()
    },
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    save.mutate(form)
  }

  function memberLabel(m) {
    return m.profiles?.full_name || m.profiles?.email || m.invited_email || m.id
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {existing ? 'Edit Task' : 'Add Task to WWP'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Task description *</label>
            <input
              type="text" required value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Fix first floor slab penetrations"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trade / Company</label>
            <input
              type="text" value={form.trade}
              onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. M&E, Concrete, Steelwork"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <select
              value={selectedOwnerMemberId}
              onChange={e => setSelectedOwnerMemberId(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Unassigned —</option>
              {members?.map(m => (
                <option key={m.id} value={m.id}>{memberLabel(m)} ({m.role?.replace(/_/g, ' ')})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planned start</label>
              <input
                type="date" value={form.planned_start}
                onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planned finish</label>
              <input
                type="date" value={form.planned_end}
                onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

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

          {error && <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{error}</p>}

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
