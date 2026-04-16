import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { downloadPPCReport } from './PPCReportPDF'
import { useProject } from '@/hooks/useProject'

export default function ReportsPage() {
  const { projectId } = useParams()
  const { data: project } = useProject(projectId)
  const [generating, setGenerating] = useState(null)

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
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['all-wwp-tasks', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  async function handleDownloadPPC(record) {
    setGenerating(record.id)
    const weekTasks = tasks.filter(t => {
      // Match tasks to the week of this record
      return true // Include all WWP tasks for now; filter by week_number in production
    })
    try {
      await downloadPPCReport({
        projectName: project?.name || 'Project',
        weekEnding: record.week_ending,
        ppcRecord: record,
        tasks: weekTasks,
        ppcHistory,
      })
    } finally {
      setGenerating(null)
    }
  }

  async function exportCSV() {
    const rows = [
      ['Week Ending', 'Planned', 'Complete', 'PPC %'],
      ...ppcHistory.map(r => [r.week_ending, r.planned_count, r.complete_count, r.ppc_percent]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `PPC-Data-${project?.name || 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Generate and download project reports</p>
        </div>
        {ppcHistory.length > 0 && (
          <button
            onClick={exportCSV}
            className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm min-h-[48px] hover:bg-gray-50"
          >
            Export CSV
          </button>
        )}
      </div>

      {ppcHistory.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-400 text-lg mb-2">No PPC records yet</p>
          <p className="text-sm text-gray-400">Generate PPC data from the PPC & RNC page first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Weekly PPC Reports</h2>
          {ppcHistory.map(record => (
            <div key={record.id}
              className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="font-semibold text-gray-900">
                  Weekly PPC Report — {new Date(record.week_ending).toLocaleDateString('en-GB', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                  })}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  PPC: {Math.round(record.ppc_percent)}% · {record.planned_count} planned · {record.complete_count} complete
                  {record.rnc_entries?.length > 0 && ` · ${record.rnc_entries.length} RNC entries`}
                </p>
              </div>
              <button
                onClick={() => handleDownloadPPC(record)}
                disabled={generating === record.id}
                className="px-4 py-2.5 rounded-lg text-white font-medium text-sm min-h-[48px] disabled:opacity-60 flex-shrink-0"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                {generating === record.id ? 'Generating…' : 'Download PDF'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
