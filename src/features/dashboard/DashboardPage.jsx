import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '@/lib/supabase'
import { RAG_STATUS, RNC_CATEGORIES } from '@/lib/constants'

function StatCard({ label, value, unit, colour, subtext }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <div className="flex items-end gap-1 mt-2">
        <span className="text-3xl font-bold 2xl:text-4xl" style={{ color: colour || '#1e3a5f' }}>
          {value ?? '—'}
        </span>
        {unit && <span className="text-base font-medium text-gray-400 mb-0.5">{unit}</span>}
      </div>
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  )
}

function getCurrentWeekNumber() {
  const d = new Date()
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

export default function DashboardPage() {
  const { projectId } = useParams()
  const currentWeek = getCurrentWeekNumber()

  // PPC history
  const { data: ppcHistory = [] } = useQuery({
    queryKey: ['ppc', 'history', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ppc_records')
        .select('*, rnc_entries(*)')
        .eq('project_id', projectId)
        .order('week_ending', { ascending: false })
        .limit(16)
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  })

  // Milestones
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('milestones')
        .select('rag_status')
        .eq('project_id', projectId)
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  })

  // Open constraints
  const { data: constraints = [] } = useQuery({
    queryKey: ['open-constraints', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('constraints')
        .select('id, created_at, status, phase_tasks!inner(project_id)')
        .eq('phase_tasks.project_id', projectId)
        .eq('status', 'open')
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  })

  // WWP tasks this week
  const { data: thisWeekTasks = [] } = useQuery({
    queryKey: ['wwp-tasks', projectId, currentWeek],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('status')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
        .eq('week_number', currentWeek)
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  })

  // Derived metrics
  const latestPPC = ppcHistory[0]
  const currentPPC = latestPPC ? Number(latestPPC.ppc_percent) : null
  const ppcColour = currentPPC === null ? '#9ca3af' :
    currentPPC >= 80 ? '#1e3a5f' :
    currentPPC >= 60 ? '#d97706' : '#4b5563'

  const ragCounts = milestones.reduce((acc, m) => {
    acc[m.rag_status] = (acc[m.rag_status] || 0) + 1
    return acc
  }, {})

  const thisWeekCommitted = thisWeekTasks.length
  const thisWeekComplete = thisWeekTasks.filter(t => t.status === 'complete').length

  // Constraint age distribution
  const now = Date.now()
  const constraintAges = constraints.map(c => {
    const days = Math.floor((now - new Date(c.created_at).getTime()) / 86400000)
    return days
  })
  const ageGroups = {
    '< 7 days': constraintAges.filter(d => d < 7).length,
    '7–14 days': constraintAges.filter(d => d >= 7 && d < 14).length,
    '14–28 days': constraintAges.filter(d => d >= 14 && d < 28).length,
    '> 28 days': constraintAges.filter(d => d >= 28).length,
  }
  const ageChartData = Object.entries(ageGroups)
    .map(([label, count]) => ({ label, count }))
    .filter(d => d.count > 0)

  // RNC Pareto (all records)
  const allRNC = ppcHistory.flatMap(r => r.rnc_entries || [])
  const rncCounts = allRNC.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1
    return acc
  }, {})
  const rncChartData = Object.entries(rncCounts)
    .map(([cat, count]) => ({
      label: RNC_CATEGORIES.find(c => c.value === cat)?.label || cat,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // PPC trend for chart
  const trendData = [...ppcHistory].reverse().map(r => ({
    week: new Date(r.week_ending).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    ppc: Number(r.ppc_percent),
  }))

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">Project Dashboard</h1>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Current Week PPC"
          value={currentPPC !== null ? `${currentPPC}` : null}
          unit="%"
          colour={ppcColour}
          subtext={latestPPC ? `Week ending ${new Date(latestPPC.week_ending).toLocaleDateString('en-GB')}` : 'No data yet'}
        />
        <StatCard
          label="Tasks This Week"
          value={`${thisWeekComplete} / ${thisWeekCommitted}`}
          colour="#2563eb"
          subtext="complete / committed"
        />
        <StatCard
          label="Open Constraints"
          value={constraints.length}
          colour={constraints.length > 0 ? '#d97706' : '#1e3a5f'}
          subtext={constraints.length > 0 ? 'Require resolution' : 'All clear'}
        />
        <StatCard
          label="Milestones"
          value={milestones.length}
          colour="#1e3a5f"
          subtext={`${ragCounts.amber || 0} at risk`}
        />
      </div>

      {/* Milestone RAG summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Milestone RAG Status</h2>
        {milestones.length === 0 ? (
          <p className="text-sm text-gray-400">No milestones yet. Add them in the Milestones section.</p>
        ) : (
          <div className="flex gap-4">
            {Object.entries(RAG_STATUS).map(([key, val]) => (
              <div key={key} className="flex-1 rounded-xl px-4 py-4 text-center"
                style={{ backgroundColor: val.bg }}>
                <p className="text-3xl font-bold" style={{ color: val.colour }}>
                  {ragCounts[key] || 0}
                </p>
                <p className="text-sm font-medium mt-1" style={{ color: val.colour }}>{val.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PPC Trend + tasks progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">PPC Trend</h2>
          {trendData.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No PPC records yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={v => [`${v}%`, 'PPC']} />
                <Line type="monotone" dataKey="ppc" stroke="#2563eb" strokeWidth={2}
                  dot={{ fill: '#2563eb', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">This Week — Tasks</h2>
          {thisWeekCommitted === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No tasks committed this week yet</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Complete</span>
                  <span className="font-medium" style={{ color: '#1e3a5f' }}>
                    {thisWeekComplete} / {thisWeekCommitted}
                  </span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${thisWeekCommitted > 0 ? (thisWeekComplete / thisWeekCommitted) * 100 : 0}%`,
                      backgroundColor: '#1e3a5f',
                    }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center mt-4">
                {[
                  ['not_started', '#4b5563'],
                  ['in_progress', '#2563eb'],
                  ['complete', '#1e3a5f'],
                  ['incomplete', '#d97706'],
                ].map(([status, colour]) => (
                  <div key={status} className="rounded-lg py-2" style={{ backgroundColor: colour + '10' }}>
                    <p className="text-lg font-bold" style={{ color: colour }}>
                      {thisWeekTasks.filter(t => t.status === status).length}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">{status.replace(/_/g, ' ')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RNC Pareto */}
      {rncChartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">RNC Pareto (all time)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rncChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={180} />
              <Tooltip />
              <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Open constraints age */}
      {constraints.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            Open Constraints — Age Distribution ({constraints.length})
          </h2>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={ageChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#ea580c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
