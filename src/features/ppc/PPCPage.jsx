import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole, useProject } from '@/hooks/useProject'
import { RNC_CATEGORIES } from '@/lib/constants'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function fmtDateLong(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ppcColour(ppc) {
  if (ppc === null || ppc === undefined) return '#9ca3af'
  if (ppc >= 80) return '#059669'
  if (ppc >= 60) return '#d97706'
  return '#dc2626'
}

function isoToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoWeeksAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function downloadCSV(filename, rows, headers) {
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, colour }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold" style={{ color: colour || '#1e3a5f' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PPCPage() {
  const { projectId } = useParams()
  const { data: membership } = useMyProjectRole(projectId)
  const role = membership?.role
  const { data: project } = useProject(projectId)
  const isSuperAdmin = role === 'super_admin'

  const projectSettings = project?.settings || {}
  const rncCategories = projectSettings.rnc_categories?.length
    ? projectSettings.rnc_categories
    : RNC_CATEGORIES.map(c => ({ ...c, colour: '#6b7280' }))

  // Date range state — default: last 12 weeks
  const [fromDate, setFromDate] = useState(isoWeeksAgo(12))
  const [toDate, setToDate] = useState(isoToday())
  const [rollup, setRollup] = useState(false) // tenant-wide rollup

  // ── Queries ──────────────────────────────────────────────────────────────────

  // Daily PPC trend
  const { data: dailyPPC = [], isLoading: ppcLoading } = useQuery({
    queryKey: ['daily-ppc-range', projectId, fromDate, toDate, rollup],
    queryFn: async () => {
      let q = supabase
        .from('daily_ppc')
        .select('calc_date, planned_count, complete_count, ppc_percent, project_id')
        .gte('calc_date', fromDate)
        .lte('calc_date', toDate)
        .order('calc_date', { ascending: true })
      if (!rollup) q = q.eq('project_id', projectId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: !!projectId,
  })

  // RNC entries with task info
  const { data: rncEntries = [], isLoading: rncLoading } = useQuery({
    queryKey: ['rnc-entries-range', projectId, fromDate, toDate, rollup],
    queryFn: async () => {
      let q = supabase
        .from('rnc_entries')
        .select('id, entry_date, category, notes, phase_task_id, project_id, phase_tasks(trade, gang_id, title)')
        .gte('entry_date', fromDate)
        .lte('entry_date', toDate)
        .order('entry_date', { ascending: false })
      if (!rollup) q = q.eq('project_id', projectId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: !!projectId,
  })

  // ── Derived metrics ───────────────────────────────────────────────────────────

  const ppcTrendData = useMemo(() => {
    // If rollup: average PPC per day across all projects
    if (!rollup) {
      return dailyPPC.map(r => ({
        date: r.calc_date,
        label: fmtDate(r.calc_date),
        ppc: r.ppc_percent !== null ? Number(r.ppc_percent) : null,
        planned: r.planned_count,
        complete: r.complete_count,
      }))
    }
    // Group by date and average
    const byDate = {}
    dailyPPC.forEach(r => {
      if (!byDate[r.calc_date]) byDate[r.calc_date] = { planned: 0, complete: 0, count: 0 }
      byDate[r.calc_date].planned += r.planned_count
      byDate[r.calc_date].complete += r.complete_count
      byDate[r.calc_date].count++
    })
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        label: fmtDate(date),
        ppc: v.planned > 0 ? Math.round((v.complete / v.planned) * 100) : null,
        planned: v.planned,
        complete: v.complete,
      }))
  }, [dailyPPC, rollup])

  // Overall stats for the period
  const totalPlanned  = dailyPPC.reduce((s, r) => s + (r.planned_count  || 0), 0)
  const totalComplete = dailyPPC.reduce((s, r) => s + (r.complete_count || 0), 0)
  const avgPPC = totalPlanned > 0 ? Math.round((totalComplete / totalPlanned) * 100) : null
  const latestPPC = ppcTrendData.length ? Math.round(ppcTrendData[ppcTrendData.length - 1].ppc) : null

  // RNC by category (pareto)
  const rncByCategory = useMemo(() => {
    const counts = {}
    rncEntries.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1 })
    return Object.entries(counts)
      .map(([cat, count]) => {
        const catDef = rncCategories.find(c => c.value === cat)
        return { category: catDef?.label || cat, count, colour: catDef?.colour || '#6b7280' }
      })
      .sort((a, b) => b.count - a.count)
  }, [rncEntries, rncCategories])

  // RNC by trade
  const rncByTrade = useMemo(() => {
    const map = {}
    rncEntries.forEach(e => {
      const trade = e.phase_tasks?.trade || 'Unassigned'
      if (!map[trade]) map[trade] = { trade, count: 0, cats: {} }
      map[trade].count++
      map[trade].cats[e.category] = (map[trade].cats[e.category] || 0) + 1
    })
    return Object.values(map)
      .sort((a, b) => b.count - a.count)
      .map(t => ({
        ...t,
        topReason: Object.entries(t.cats).sort((a, b) => b[1] - a[1])[0]?.[0],
      }))
      .map(t => ({
        ...t,
        topReasonLabel: rncCategories.find(c => c.value === t.topReason)?.label || t.topReason || '—',
      }))
  }, [rncEntries, rncCategories])

  // RNC by gang
  const rncByGang = useMemo(() => {
    const map = {}
    rncEntries.forEach(e => {
      const gang = e.phase_tasks?.gang_id || 'Unassigned'
      const trade = e.phase_tasks?.trade || ''
      const key = gang
      if (!map[key]) map[key] = { gang, trade, count: 0, cats: {} }
      map[key].count++
      map[key].cats[e.category] = (map[key].cats[e.category] || 0) + 1
    })
    return Object.values(map)
      .sort((a, b) => b.count - a.count)
      .map(g => ({
        ...g,
        topReason: Object.entries(g.cats).sort((a, b) => b[1] - a[1])[0]?.[0],
      }))
      .map(g => ({
        ...g,
        topReasonLabel: rncCategories.find(c => c.value === g.topReason)?.label || g.topReason || '—',
      }))
  }, [rncEntries, rncCategories])

  // PPC trend weekly buckets (for sparse daily data, group to weekly)
  const weeklyTrend = useMemo(() => {
    const buckets = {}
    ppcTrendData.forEach(d => {
      if (d.ppc === null) return
      // ISO week key
      const dt = new Date(d.date + 'T00:00:00')
      const dayNum = dt.getUTCDay() || 7
      dt.setUTCDate(dt.getUTCDate() + 4 - dayNum)
      const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
      const wk = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7)
      const key = `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
      if (!buckets[key]) buckets[key] = { ppcs: [], label: key }
      buckets[key].ppcs.push(d.ppc)
    })
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        label: v.label,
        ppc: Math.round(v.ppcs.reduce((s, p) => s + p, 0) / v.ppcs.length),
      }))
  }, [ppcTrendData])

  const chartData = ppcTrendData.length > 60 ? weeklyTrend : ppcTrendData

  // ── CSV export ────────────────────────────────────────────────────────────────
  function exportRNC() {
    const rows = rncEntries.map(e => ({
      date: e.entry_date,
      project_id: e.project_id,
      task: e.phase_tasks?.title || e.phase_task_id,
      trade: e.phase_tasks?.trade || '',
      gang: e.phase_tasks?.gang_id || '',
      category: rncCategories.find(c => c.value === e.category)?.label || e.category,
      notes: e.notes || '',
    }))
    downloadCSV(`rnc-export-${fromDate}-to-${toDate}.csv`, rows,
      ['date', 'project_id', 'task', 'trade', 'gang', 'category', 'notes'])
  }

  function exportPPC() {
    const rows = ppcTrendData.map(d => ({
      date: d.date,
      planned: d.planned,
      complete: d.complete,
      ppc_percent: d.ppc,
    }))
    downloadCSV(`ppc-trend-${fromDate}-to-${toDate}.csv`, rows,
      ['date', 'planned', 'complete', 'ppc_percent'])
  }

  const loading = ppcLoading || rncLoading

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">PPC Tracking & RNC Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">Percent Plan Complete · Reason for Non-Completion</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuperAdmin && (
            <button
              onClick={() => setRollup(r => !r)}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
              style={rollup
                ? { borderColor: '#7c3aed', backgroundColor: '#7c3aed', color: 'white' }
                : { borderColor: '#e5e7eb', backgroundColor: 'white', color: '#6b7280' }
              }
            >
              {rollup ? '◉ All projects' : '○ All projects'}
            </button>
          )}
          <button onClick={exportPPC} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50">↓ PPC CSV</button>
          <button onClick={exportRNC} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50">↓ RNC CSV</button>
        </div>
      </div>

      {/* ── Date range ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border border-gray-200 px-4 py-3">
        <span className="text-sm font-medium text-gray-600">Period</span>
        <div className="flex items-center gap-2">
          <input type="date" value={fromDate} max={toDate}
            onChange={e => setFromDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={toDate} min={fromDate} max={isoToday()}
            onChange={e => setToDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-1 ml-auto flex-wrap">
          {[['4w', 4], ['8w', 8], ['12w', 12], ['26w', 26], ['52w', 52]].map(([label, weeks]) => (
            <button key={label}
              onClick={() => { setFromDate(isoWeeksAgo(weeks)); setToDate(isoToday()) }}
              className="px-2.5 py-1 rounded border text-xs font-medium transition-all"
              style={fromDate === isoWeeksAgo(weeks) && toDate === isoToday()
                ? { borderColor: '#1e3a5f', backgroundColor: '#1e3a5f', color: 'white' }
                : { borderColor: '#e5e7eb', color: '#6b7280' }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ── Summary stats ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Avg PPC" value={avgPPC !== null ? `${avgPPC}%` : '—'} sub="for period" colour={ppcColour(avgPPC)} />
        <StatCard label="Latest PPC" value={latestPPC !== null ? `${latestPPC}%` : '—'} sub="most recent day" colour={ppcColour(latestPPC)} />
        <StatCard label="RNC entries" value={rncEntries.length} sub="in period" colour="#7c3aed" />
        <StatCard label="Days tracked" value={dailyPPC.length} sub="with PPC data" colour="#2563eb" />
      </div>

      {/* ── PPC Trend chart ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">
            PPC Trend
            <span className="ml-2 text-xs font-normal text-gray-400">
              {chartData === weeklyTrend ? '(weekly avg)' : '(daily)'}
            </span>
          </h2>
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
        </div>
        {chartData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No PPC data for this period. Data is calculated automatically each working day.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={36} />
              <Tooltip
                formatter={(v, n) => [v !== null ? `${v}%` : '—', 'PPC']}
                labelFormatter={l => `Week: ${l}`}
              />
              <ReferenceLine y={80} stroke="#05966940" strokeDasharray="4 4" label={{ value: '80%', position: 'right', fontSize: 10, fill: '#059669' }} />
              <Line
                type="monotone" dataKey="ppc" stroke="#1e3a5f" strokeWidth={2.5}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  if (payload.ppc === null) return null
                  return <circle key={props.key} cx={cx} cy={cy} r={3} fill={ppcColour(payload.ppc)} stroke="white" strokeWidth={1.5} />
                }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── RNC Pareto ─────────────────────────────────────────────────────── */}
      {rncByCategory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">RNC by Category</h2>
          <ResponsiveContainer width="100%" height={Math.max(180, rncByCategory.length * 38)}>
            <BarChart data={rncByCategory} layout="vertical" margin={{ left: 4, right: 24, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={180} />
              <Tooltip formatter={v => [v, 'RNC entries']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {rncByCategory.map((entry, i) => (
                  <Cell key={i} fill={entry.colour || '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Per-trade breakdown ─────────────────────────────────────────────── */}
      {rncByTrade.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">RNC by Trade</h2>
            <span className="text-xs text-gray-400">{rncEntries.length} total entries</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Trade</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">RNC count</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Top reason</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">% of total</th>
              </tr>
            </thead>
            <tbody>
              {rncByTrade.map((row, i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{row.trade}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{row.count}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{row.topReasonLabel}</td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {rncEntries.length > 0 ? `${Math.round(row.count / rncEntries.length * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Per-gang breakdown ─────────────────────────────────────────────── */}
      {rncByGang.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">RNC by Gang</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-3 font-medium text-gray-600">Gang</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Trade</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">RNC count</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Top reason</th>
              </tr>
            </thead>
            <tbody>
              {rncByGang.map((row, i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{row.gang}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.trade}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{row.count}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{row.topReasonLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── RNC entry log ──────────────────────────────────────────────────── */}
      {rncEntries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">RNC Log</h2>
            <button onClick={exportRNC} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded border border-gray-200 hover:bg-gray-50">↓ Export CSV</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-5 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Task</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Trade / Gang</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rncEntries.slice(0, 100).map(e => {
                  const cat = rncCategories.find(c => c.value === e.category)
                  return (
                    <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-5 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(e.entry_date)}</td>
                      <td className="px-4 py-2.5 text-gray-800 font-medium max-w-[200px] truncate">{e.phase_tasks?.title || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                        {[e.phase_tasks?.trade, e.phase_tasks?.gang_id].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ backgroundColor: `${cat?.colour || '#6b7280'}18`, color: cat?.colour || '#6b7280' }}
                        >
                          {cat?.label || e.category}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs max-w-[200px] truncate">{e.notes || '—'}</td>
                    </tr>
                  )
                })}
                {rncEntries.length > 100 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-3 text-xs text-gray-400 text-center">
                      Showing 100 of {rncEntries.length} entries. Export CSV for full data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && dailyPPC.length === 0 && rncEntries.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 font-medium">No data for this period</p>
          <p className="text-xs text-gray-400 mt-1">Daily PPC is calculated automatically each working day. Use the Daily Review button on the WWP board to log RNC reasons.</p>
        </div>
      )}
    </div>
  )
}
