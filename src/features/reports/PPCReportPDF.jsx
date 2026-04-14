import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'
import { RNC_CATEGORIES } from '@/lib/constants'

const NAVY = '#1e3a5f'
const AMBER = '#d97706'
const GREY = '#4b5563'
const BLUE = '#2563eb'
const LIGHT_GREY = '#f3f4f6'

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10, color: '#111827' },
  header: { marginBottom: 24 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  brandBox: { backgroundColor: NAVY, padding: '6 12', borderRadius: 4 },
  brandText: { color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 12 },
  reportTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 2 },
  reportSubtitle: { fontSize: 10, color: GREY },
  divider: { height: 2, backgroundColor: NAVY, marginBottom: 20 },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 8, paddingBottom: 4, borderBottom: `1 solid #e5e7eb` },

  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  kpiCard: { flex: 1, padding: 12, borderRadius: 6, alignItems: 'center' },
  kpiValue: { fontSize: 28, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  kpiLabel: { fontSize: 8, color: GREY },

  table: { width: '100%' },
  tableHeader: { flexDirection: 'row', backgroundColor: NAVY, padding: '6 8' },
  tableHeaderCell: { color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 9 },
  tableRow: { flexDirection: 'row', padding: '5 8', borderBottom: '1 solid #f3f4f6' },
  tableRowAlt: { flexDirection: 'row', padding: '5 8', borderBottom: '1 solid #f3f4f6', backgroundColor: LIGHT_GREY },
  tableCell: { fontSize: 9, color: '#374151' },

  bar: { height: 14, borderRadius: 2, marginBottom: 6 },
  barLabel: { fontSize: 8, color: GREY, marginBottom: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  barContainer: { flex: 1, backgroundColor: LIGHT_GREY, borderRadius: 2, height: 12 },
  barFill: { backgroundColor: BLUE, borderRadius: 2, height: 12 },
  barCount: { fontSize: 8, color: GREY, width: 20, textAlign: 'right' },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 8, color: '#9ca3af' },
})

function PPCBadge({ ppc }) {
  const colour = ppc >= 80 ? NAVY : ppc >= 60 ? AMBER : GREY
  const bg = ppc >= 80 ? '#dbeafe' : ppc >= 60 ? '#fef3c7' : '#f3f4f6'
  const label = ppc >= 80 ? 'On Track' : ppc >= 60 ? 'At Risk' : 'Below Target'
  return { colour, bg, label }
}

export function PPCReportDocument({ projectName, weekEnding, ppcRecord, tasks, ppcHistory }) {
  const ppc = Number(ppcRecord?.ppc_percent || 0)
  const { colour, bg, label } = PPCBadge({ ppc })

  // RNC counts
  const rncEntries = ppcRecord?.rnc_entries || []
  const rncCounts = rncEntries.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1
    return acc
  }, {})
  const rncSorted = Object.entries(rncCounts)
    .map(([cat, count]) => ({
      label: RNC_CATEGORIES.find(c => c.value === cat)?.label || cat,
      count,
    }))
    .sort((a, b) => b.count - a.count)
  const maxRNC = Math.max(...rncSorted.map(r => r.count), 1)

  // Incomplete tasks
  const incompleteTasks = tasks.filter(t => t.status === 'incomplete')
  const rncByTask = rncEntries.reduce((acc, e) => {
    acc[e.phase_task_id] = RNC_CATEGORIES.find(c => c.value === e.category)?.label || e.category
    return acc
  }, {})

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.reportTitle}>Weekly PPC Report</Text>
              <Text style={styles.reportSubtitle}>{projectName}</Text>
            </View>
            <View style={styles.brandBox}>
              <Text style={styles.brandText}>OpSolv LPS</Text>
            </View>
          </View>
          <Text style={{ fontSize: 9, color: GREY }}>
            Week ending {weekEnding ? new Date(weekEnding).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
            {' · '}Generated {new Date().toLocaleDateString('en-GB')}
          </Text>
          <View style={styles.divider} />
        </View>

        {/* KPI Row */}
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { backgroundColor: bg }]}>
            <Text style={[styles.kpiValue, { color: colour }]}>{ppc}%</Text>
            <Text style={styles.kpiLabel}>PPC This Week</Text>
            <Text style={{ fontSize: 8, color: colour, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>{label}</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: '#eff6ff' }]}>
            <Text style={[styles.kpiValue, { color: BLUE }]}>{ppcRecord?.planned_count || 0}</Text>
            <Text style={styles.kpiLabel}>Tasks Committed</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: '#f0fdf4' }]}>
            <Text style={[styles.kpiValue, { color: NAVY }]}>{ppcRecord?.complete_count || 0}</Text>
            <Text style={styles.kpiLabel}>Tasks Complete</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: '#fffbeb' }]}>
            <Text style={[styles.kpiValue, { color: AMBER }]}>{incompleteTasks.length}</Text>
            <Text style={styles.kpiLabel}>Incomplete</Text>
          </View>
        </View>

        {/* PPC Trend table */}
        {ppcHistory?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cumulative PPC Trend (last 8 weeks)</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Week ending</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Planned</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Complete</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>PPC %</Text>
              </View>
              {[...ppcHistory].reverse().slice(-8).map((r, i) => (
                <View key={r.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>
                    {new Date(r.week_ending).toLocaleDateString('en-GB')}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>{r.planned_count}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>{r.complete_count}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold',
                    color: Number(r.ppc_percent) >= 80 ? NAVY : Number(r.ppc_percent) >= 60 ? AMBER : GREY }]}>
                    {r.ppc_percent}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* RNC Breakdown */}
        {rncSorted.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RNC Breakdown — This Week ({rncEntries.length} entries)</Text>
            {rncSorted.map(({ label, count }) => (
              <View key={label} style={styles.barRow}>
                <Text style={{ fontSize: 8, color: GREY, width: 160 }}>{label}</Text>
                <View style={styles.barContainer}>
                  <View style={[styles.barFill, { width: `${(count / maxRNC) * 100}%` }]} />
                </View>
                <Text style={styles.barCount}>{count}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Incomplete tasks */}
        {incompleteTasks.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Incomplete Tasks ({incompleteTasks.length})</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Task</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Trade</Text>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>RNC</Text>
              </View>
              {incompleteTasks.map((t, i) => (
                <View key={t.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <Text style={[styles.tableCell, { flex: 3 }]}>{t.title}</Text>
                  <Text style={[styles.tableCell, { flex: 1, color: GREY }]}>{t.trade || '—'}</Text>
                  <Text style={[styles.tableCell, { flex: 2, color: AMBER }]}>
                    {rncByTask[t.id] || 'Pending'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>OpSolv LPS Platform · opsolv.co.uk</Text>
          <Text style={styles.footerText}>
            Generated {new Date().toLocaleDateString('en-GB')} · Confidential
          </Text>
        </View>
      </Page>
    </Document>
  )
}

// Helper to download PDF
export async function downloadPPCReport(props) {
  const blob = await pdf(<PPCReportDocument {...props} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `PPC-Report-${props.weekEnding || 'latest'}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
