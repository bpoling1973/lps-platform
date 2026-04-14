import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole } from '@/hooks/useProject'
import { RNC_CATEGORIES } from '@/lib/constants'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'

function getCurrentWeekNumber() {
  const d = new Date()
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

function getWeekEnding() {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? 0 : 7 - day + 7) // next Sunday
  const sunday = new Date(now.setDate(diff))
  return sunday.toISOString().split('T')[0]
}

function RNCForm({ task, ppcRecordId, onClose }) {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(null)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('rnc_entries').insert({
        phase_task_id: task.id,
        ppc_record_id: ppcRecordId,
        category,
        notes: notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ppc'] })
      onClose()
    },
    onError: err => setError(err.message),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Log Reason for Non-Completion</h3>
        <p className="text-sm text-gray-500 mb-4 truncate">{task.title}</p>
        <div className="space-y-3 mb-4">
          {RNC_CATEGORIES.map(cat => (
            <label key={cat.value}
              className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all min-h-[52px]"
              style={{
                borderColor: category === cat.value ? '#1e3a5f' : '#e5e7eb',
                backgroundColor: category === cat.value ? '#dbeafe' : 'white',
              }}>
              <input type="radio" name="rnc" value={cat.value}
                checked={category === cat.value}
                onChange={() => setCategory(cat.value)}
                className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-800">{cat.label}</span>
            </label>
          ))}
        </div>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Additional notes (optional)"
          rows={2}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4"
        />
        {error && <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => save.mutate()} disabled={!category || save.isPending}
            className="flex-1 py-3 rounded-lg text-white font-semibold disabled:opacity-60 min-h-[48px]"
            style={{ backgroundColor: '#1e3a5f' }}>
            {save.isPending ? 'Saving…' : 'Log RNC'}
          </button>
          <button onClick={onClose}
            className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium min-h-[48px]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PPCPage() {
  const { projectId } = useParams()
  const { data: role } = useMyProjectRole(projectId)
  const queryClient = useQueryClient()
  const canGeneratePPC = ['project_admin', 'planner'].includes(role)

  const [rncTask, setRncTask] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(null)

  const currentWeek = getCurrentWeekNumber()

  // Fetch PPC history
  const { data: ppcHistory = [] } = useQuery({
    queryKey: ['ppc', 'history', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ppc_records')
        .select('*, rnc_entries(*)')
        .eq('project_id', projectId)
        .order('week_ending', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  })

  // Fetch tasks for current week
  const { data: wwpTasks = [] } = useQuery({
    queryKey: ['wwp-tasks', projectId, currentWeek],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
        .eq('week_number', currentWeek)
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  const currentRecord = ppcHistory.find(r => {
    const weekEnding = getWeekEnding()
    return r.week_ending === weekEnding
  })

  const generatePPC = useMutation({
    mutationFn: async () => {
      const planned = wwpTasks.length
      const complete = wwpTasks.filter(t => t.status === 'complete').length
      const weekEnding = getWeekEnding()

      const { data: record, error } = await supabase
        .from('ppc_records')
        .upsert({
          project_id: projectId,
          week_ending: weekEnding,
          planned_count: planned,
          complete_count: complete,
        }, { onConflict: 'project_id,week_ending' })
        .select()
        .single()

      if (error) throw error

      // Trigger PPC report email
      await supabase.functions.invoke('send-ppc-report', {
        body: { ppcRecordId: record.id, projectId },
      }).catch(() => {})

      // Trigger RNC prompts for incomplete tasks
      const incompleteTasks = wwpTasks.filter(t => t.status === 'incomplete')
      for (const task of incompleteTasks) {
        await supabase.functions.invoke('send-rnc-prompt', {
          body: { taskId: task.id, ppcRecordId: record.id, projectId },
        }).catch(() => {})
      }

      return record
    },
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: ['ppc'] })
      setSelectedRecord(record)
    },
  })

  // Chart data
  const chartData = [...ppcHistory].reverse().slice(-12).map(r => ({
    week: new Date(r.week_ending).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    ppc: Number(r.ppc_percent),
  }))

  // RNC pareto for selected/latest record
  const activeRecord = selectedRecord || ppcHistory[0]
  const rncCounts = activeRecord?.rnc_entries?.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1
    return acc
  }, {}) || {}
  const rncChartData = Object.entries(rncCounts)
    .map(([cat, count]) => ({
      category: RNC_CATEGORIES.find(c => c.value === cat)?.label || cat,
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const incompleteTasks = wwpTasks.filter(t => t.status === 'incomplete')
  const plannedCount = wwpTasks.length
  const completeCount = wwpTasks.filter(t => t.status === 'complete').length
  const livePPC = plannedCount > 0 ? Math.round((completeCount / plannedCount) * 100) : null

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">PPC Tracking & RNC Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">Percent Plan Complete · Week {currentWeek}</p>
        </div>
        {canGeneratePPC && (
          <button
            onClick={() => generatePPC.mutate()} disabled={generatePPC.isPending}
            className="px-4 py-2.5 rounded-lg text-white font-medium text-sm min-h-[48px] disabled:opacity-60"
            style={{ backgroundColor: '#1e3a5f' }}>
            {generatePPC.isPending ? 'Calculating…' : 'Calculate PPC'}
          </button>
        )}
      </div>

      {/* Live PPC snapshot */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">Committed</p>
          <p className="text-3xl font-bold" style={{ color: '#2563eb' }}>{plannedCount}</p>
          <p className="text-xs text-gray-400 mt-1">tasks this week</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">Complete</p>
          <p className="text-3xl font-bold" style={{ color: '#1e3a5f' }}>{completeCount}</p>
          <p className="text-xs text-gray-400 mt-1">tasks done</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center"
          style={{
            borderColor: livePPC === null ? '#e5e7eb' :
              livePPC >= 80 ? '#1e3a5f' : livePPC >= 60 ? '#d97706' : '#4b5563',
          }}>
          <p className="text-sm font-medium text-gray-500 mb-1">Live PPC</p>
          <p className="text-3xl font-bold" style={{
            color: livePPC === null ? '#9ca3af' :
              livePPC >= 80 ? '#1e3a5f' : livePPC >= 60 ? '#d97706' : '#4b5563',
          }}>
            {livePPC !== null ? `${livePPC}%` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">current week</p>
        </div>
      </div>

      {/* Incomplete tasks needing RNC */}
      {incompleteTasks.length > 0 && (
        <div className="bg-white rounded-xl border-2 p-5" style={{ borderColor: '#d97706' }}>
          <h2 className="font-semibold text-gray-900 mb-3" style={{ color: '#d97706' }}>
            ⚠ Incomplete tasks requiring RNC ({incompleteTasks.length})
          </h2>
          <div className="space-y-2">
            {incompleteTasks.map(task => {
              const hasRNC = activeRecord?.rnc_entries?.some(e => e.phase_task_id === task.id)
              return (
                <div key={task.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{task.title}</p>
                    {task.trade && <p className="text-xs text-gray-500">{task.trade}</p>}
                  </div>
                  {hasRNC ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">RNC logged</span>
                  ) : (
                    <button
                      onClick={() => {
                        if (!activeRecord) {
                          alert('Please calculate PPC first to create a PPC record.')
                          return
                        }
                        setRncTask({ task, ppcRecordId: activeRecord.id })
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg text-white font-medium min-h-[36px]"
                      style={{ backgroundColor: '#d97706' }}>
                      Log RNC
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* PPC trend chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Cumulative PPC Trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, 'PPC']} />
              <Line type="monotone" dataKey="ppc" stroke="#2563eb" strokeWidth={2} dot={{ fill: '#2563eb', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* RNC Pareto */}
      {rncChartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            RNC Pareto — {activeRecord ? new Date(activeRecord.week_ending).toLocaleDateString('en-GB') : 'Latest'}
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rncChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={160} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* PPC history table */}
      {ppcHistory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">PPC History</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Week ending</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Planned</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Complete</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">PPC %</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">RNC entries</th>
              </tr>
            </thead>
            <tbody>
              {ppcHistory.map(r => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedRecord(r)}>
                  <td className="px-4 py-3 text-gray-800">
                    {new Date(r.week_ending).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{r.planned_count}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{r.complete_count}</td>
                  <td className="px-4 py-3 text-right font-bold"
                    style={{
                      color: r.ppc_percent >= 80 ? '#1e3a5f' :
                        r.ppc_percent >= 60 ? '#d97706' : '#4b5563'
                    }}>
                    {r.ppc_percent}%
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{r.rnc_entries?.length || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rncTask && (
        <RNCForm
          task={rncTask.task}
          ppcRecordId={rncTask.ppcRecordId}
          onClose={() => setRncTask(null)}
        />
      )}
    </div>
  )
}
