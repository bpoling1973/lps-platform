import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole } from '@/hooks/useProject'
import { RAG_STATUS } from '@/lib/constants'

function RagBadge({ status }) {
  const rag = RAG_STATUS[status] || RAG_STATUS.grey
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: rag.bg, color: rag.colour }}>
      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: rag.colour }} />
      {rag.label}
    </span>
  )
}

function MilestoneForm({ projectId, onClose, existing }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: existing?.name || '',
    planned_date: existing?.planned_date || '',
    forecast_date: existing?.forecast_date || '',
    rag_status: existing?.rag_status || 'grey',
  })
  const [error, setError] = useState(null)

  const save = useMutation({
    mutationFn: async (data) => {
      if (existing) {
        const { error } = await supabase.from('milestones').update(data).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('milestones').insert({ ...data, project_id: projectId })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', projectId] })
      onClose()
    },
    onError: (err) => setError(err.message),
  })

  function handleSubmit(e) {
    e.preventDefault()
    save.mutate(form)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {existing ? 'Edit Milestone' : 'New Milestone'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Milestone name</label>
            <input
              type="text" required value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Superstructure complete"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Planned date</label>
              <input
                type="date" required value={form.planned_date}
                onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Forecast date</label>
              <input
                type="date" value={form.forecast_date}
                onChange={e => setForm(f => ({ ...f, forecast_date: e.target.value }))}
                className="w-full px-3 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">RAG Status</label>
            <div className="flex gap-2">
              {Object.entries(RAG_STATUS).map(([key, val]) => (
                <button
                  key={key} type="button"
                  onClick={() => setForm(f => ({ ...f, rag_status: key }))}
                  className="flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all min-h-[48px]"
                  style={{
                    borderColor: form.rag_status === key ? val.colour : '#e5e7eb',
                    backgroundColor: form.rag_status === key ? val.bg : 'white',
                    color: form.rag_status === key ? val.colour : '#6b7280',
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
              {save.isPending ? 'Saving…' : 'Save Milestone'}
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

export default function MilestonesPage() {
  const { projectId } = useParams()
  const { data: membership } = useMyProjectRole(projectId)
  const role = membership?.role
  const queryClient = useQueryClient()
  const canEdit = role === 'project_admin'

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: milestones, isLoading } = useQuery({
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
    refetchInterval: 30000,
  })

  const deleteMilestone = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('milestones').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['milestones', projectId] }),
  })

  // RAG summary counts
  const ragCounts = milestones?.reduce((acc, m) => {
    acc[m.rag_status] = (acc[m.rag_status] || 0) + 1
    return acc
  }, {}) || {}

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">Master Programme</h1>
          <p className="text-sm text-gray-500 mt-0.5">Project milestones and RAG status</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="px-4 py-2.5 rounded-lg text-white font-medium text-sm min-h-[48px]"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            + Add Milestone
          </button>
        )}
      </div>

      {/* RAG summary */}
      {milestones?.length > 0 && (
        <div className="flex gap-3 mb-6">
          {Object.entries(RAG_STATUS).map(([key, val]) => (
            <div key={key} className="flex-1 rounded-xl px-4 py-3 text-center"
              style={{ backgroundColor: val.bg }}>
              <p className="text-2xl font-bold" style={{ color: val.colour }}>
                {ragCounts[key] || 0}
              </p>
              <p className="text-xs font-medium mt-0.5" style={{ color: val.colour }}>
                {val.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : milestones?.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">No milestones yet</p>
          {canEdit && <p className="text-sm">Add the first milestone to get started.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {milestones?.map(m => {
            const isOverdue = m.planned_date < new Date().toISOString().split('T')[0] && m.rag_status !== 'navy'
            return (
              <div key={m.id}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate 2xl:text-lg">{m.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                    <span>Planned: {new Date(m.planned_date).toLocaleDateString('en-GB')}</span>
                    {m.forecast_date && m.forecast_date !== m.planned_date && (
                      <span className={isOverdue ? 'text-amber-600 font-medium' : ''}>
                        Forecast: {new Date(m.forecast_date).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </div>
                </div>
                <RagBadge status={m.rag_status} />
                {canEdit && (
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={() => { setEditing(m); setShowForm(true) }}
                      className="p-2 text-gray-400 hover:text-gray-700 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete this milestone?')) deleteMilestone.mutate(m.id) }}
                      className="p-2 text-gray-400 hover:text-amber-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <MilestoneForm
          projectId={projectId}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
