import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole, useProject } from '@/hooks/useProject'
import { DEFAULT_TRADES, ZONE_COLOUR_PALETTE, RNC_CATEGORIES, ROLES } from '@/lib/constants'
import { useAuth } from '@/features/auth/AuthContext'

// UK bank holidays (England & Wales) — extend as needed
const UK_BANK_HOLIDAYS = {
  2024: [
    { date: '2024-01-01', name: "New Year's Day" },
    { date: '2024-03-29', name: 'Good Friday' },
    { date: '2024-04-01', name: 'Easter Monday' },
    { date: '2024-05-06', name: 'Early May Bank Holiday' },
    { date: '2024-05-27', name: 'Spring Bank Holiday' },
    { date: '2024-08-26', name: 'Summer Bank Holiday' },
    { date: '2024-12-25', name: 'Christmas Day' },
    { date: '2024-12-26', name: 'Boxing Day' },
  ],
  2025: [
    { date: '2025-01-01', name: "New Year's Day" },
    { date: '2025-04-18', name: 'Good Friday' },
    { date: '2025-04-21', name: 'Easter Monday' },
    { date: '2025-05-05', name: 'Early May Bank Holiday' },
    { date: '2025-05-26', name: 'Spring Bank Holiday' },
    { date: '2025-08-25', name: 'Summer Bank Holiday' },
    { date: '2025-12-25', name: 'Christmas Day' },
    { date: '2025-12-26', name: 'Boxing Day' },
  ],
  2026: [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-06', name: 'Easter Monday' },
    { date: '2026-05-04', name: 'Early May Bank Holiday' },
    { date: '2026-05-25', name: 'Spring Bank Holiday' },
    { date: '2026-08-31', name: 'Summer Bank Holiday' },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-28', name: 'Boxing Day (substitute)' },
  ],
  2027: [
    { date: '2027-01-01', name: "New Year's Day" },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-03-29', name: 'Easter Monday' },
    { date: '2027-05-03', name: 'Early May Bank Holiday' },
    { date: '2027-05-31', name: 'Spring Bank Holiday' },
    { date: '2027-08-30', name: 'Summer Bank Holiday' },
    { date: '2027-12-27', name: 'Christmas Day (substitute)' },
    { date: '2027-12-28', name: 'Boxing Day (substitute)' },
  ],
}

const RNC_CAT_COLOURS = [
  '#dc2626', '#d97706', '#2563eb', '#7c3aed', '#059669',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6b7280',
]

function formatHolidayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function SortableTradeCard({ trade, isAdmin, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: trade.name })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        {isAdmin && (
          <span
            {...attributes} {...listeners}
            className="cursor-grab text-gray-300 hover:text-gray-500 select-none text-base leading-none touch-none"
            title="Drag to reorder"
          >⠿</span>
        )}
        <span className="text-sm font-semibold text-gray-800">{trade.name}</span>
      </div>
      {isAdmin && (
        <button
          onClick={() => onRemove(trade.name)}
          className="text-gray-400 hover:text-amber-600 text-lg leading-none transition-colors"
          title="Remove trade"
        >×</button>
      )}
    </div>
  )
}

export default function ProjectSettingsPage() {
  const { projectId } = useParams()
  const { data: membership } = useMyProjectRole(projectId)
  const role = membership?.role
  const { data: project } = useProject(projectId)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('trades')

  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  const TIMEZONES = [
    { value: 'Europe/London',       label: 'London (GMT/BST)' },
    { value: 'Europe/Dublin',       label: 'Dublin (GMT/IST)' },
    { value: 'Europe/Paris',        label: 'Paris (CET/CEST)' },
    { value: 'Europe/Berlin',       label: 'Berlin (CET/CEST)' },
    { value: 'Europe/Amsterdam',    label: 'Amsterdam (CET/CEST)' },
    { value: 'Europe/Madrid',       label: 'Madrid (CET/CEST)' },
    { value: 'Europe/Rome',         label: 'Rome (CET/CEST)' },
    { value: 'America/New_York',    label: 'New York (ET)' },
    { value: 'America/Chicago',     label: 'Chicago (CT)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
    { value: 'Asia/Dubai',          label: 'Dubai (GST)' },
    { value: 'Asia/Singapore',      label: 'Singapore (SGT)' },
    { value: 'Australia/Sydney',    label: 'Sydney (AEST/AEDT)' },
    { value: 'UTC',                 label: 'UTC' },
  ]
  const [saved, setSaved] = useState(false)

  const isAdmin = role === 'project_admin'

  const tradeSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleTradeDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = currentTrades.findIndex(t => t.name === active.id)
    const newIdx = currentTrades.findIndex(t => t.name === over.id)
    setTrades(arrayMove(currentTrades, oldIdx, newIdx))
  }

  const projectSettings = project?.settings || {}
  const [trades, setTrades] = useState(null) // null = not yet initialised from project
  const [zones, setZones] = useState(null)

  // Initialise local state from project settings once loaded
  // Normalise trades: support both old string[] and new { name, gangs[] }[] formats
  function normalizeTrades(raw) {
    if (!raw?.length) return []
    return raw.map(t => typeof t === 'string' ? { name: t, gangs: [] } : t)
  }
  const currentTrades = trades ?? normalizeTrades(
    projectSettings.trades?.length ? projectSettings.trades : DEFAULT_TRADES
  )
  const currentZones = zones ?? (projectSettings.zones || [])

  const [commitSettings, setCommitSettings] = useState(null)
  const currentCommit = commitSettings ?? {
    wwp_commit_day:      projectSettings.wwp_commit_day      || 'friday',
    wwp_commit_time:     projectSettings.wwp_commit_time     || '17:00',
    wwp_commit_timezone: projectSettings.wwp_commit_timezone || 'Europe/London',
    ppc_calc_time:       projectSettings.ppc_calc_time       || '18:00',
  }

  // RNC categories
  const DEFAULT_RNC = RNC_CATEGORIES.map((c, i) => ({ ...c, colour: RNC_CAT_COLOURS[i % RNC_CAT_COLOURS.length] }))
  const [rncCategories, setRncCategories] = useState(null)
  const currentRncCategories = rncCategories ?? (projectSettings.rnc_categories?.length ? projectSettings.rnc_categories : DEFAULT_RNC)
  const [newRncLabel, setNewRncLabel] = useState('')
  const [newRncColour, setNewRncColour] = useState('#6b7280')

  function addRncCategory() {
    const label = newRncLabel.trim()
    if (!label) return
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    if (currentRncCategories.some(c => c.value === value)) return
    setRncCategories([...currentRncCategories, { value, label, colour: newRncColour }])
    setNewRncLabel('')
  }

  function removeRncCategory(value) {
    setRncCategories(currentRncCategories.filter(c => c.value !== value))
  }

  function updateRncColour(value, colour) {
    setRncCategories(currentRncCategories.map(c => c.value === value ? { ...c, colour } : c))
  }

  // Bank holidays
  const [bankHolidays, setBankHolidays] = useState(null)
  const currentBankHolidays = bankHolidays ?? (projectSettings.bank_holidays || [])
  const bankHolidaySet = new Set(currentBankHolidays)
  const [bankYear, setBankYear] = useState(new Date().getFullYear())
  const [customHolidayDate, setCustomHolidayDate] = useState('')

  function toggleHoliday(iso) {
    if (bankHolidaySet.has(iso)) {
      setBankHolidays(currentBankHolidays.filter(d => d !== iso))
    } else {
      setBankHolidays([...currentBankHolidays, iso].sort())
    }
  }

  function addAllForYear(year) {
    const preset = UK_BANK_HOLIDAYS[year] || []
    const toAdd = preset.map(h => h.date).filter(d => !bankHolidaySet.has(d))
    if (toAdd.length) setBankHolidays([...currentBankHolidays, ...toAdd].sort())
  }

  function addCustomHoliday() {
    if (!customHolidayDate || bankHolidaySet.has(customHolidayDate)) return
    setBankHolidays([...currentBankHolidays, customHolidayDate].sort())
    setCustomHolidayDate('')
  }

  const [newTrade, setNewTrade] = useState('')
  const [newZoneName, setNewZoneName] = useState('')
  const [newZoneColour, setNewZoneColour] = useState(ZONE_COLOUR_PALETTE[0])
  const [customColour, setCustomColour] = useState('')

  const saveSettings = useMutation({
    mutationFn: async ({ updatedTrades, updatedZones, updatedCommit, updatedBankHolidays, updatedRncCategories }) => {
      const { error } = await supabase
        .from('projects')
        .update({
          settings: {
            ...projectSettings,
            trades: updatedTrades,
            zones: updatedZones,
            bank_holidays: updatedBankHolidays,
            rnc_categories: updatedRncCategories,
            ...updatedCommit,
          },
        })
        .eq('id', projectId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  function handleSave() {
    saveSettings.mutate({
      updatedTrades: currentTrades,
      updatedZones: currentZones,
      updatedCommit: currentCommit,
      updatedBankHolidays: currentBankHolidays,
      updatedRncCategories: currentRncCategories,
    })
  }

  function addTrade() {
    const name = newTrade.trim()
    if (!name || currentTrades.some(t => t.name === name)) return
    setTrades([...currentTrades, { name, gangs: [] }])
    setNewTrade('')
  }

  function removeTrade(tradeName) {
    setTrades(currentTrades.filter(t => t.name !== tradeName))
  }

  function resetTrades() {
    setTrades(DEFAULT_TRADES.map(t => typeof t === 'string' ? { name: t, gangs: [] } : t))
  }

  function addZone() {
    const name = newZoneName.trim()
    const colour = customColour.trim() || newZoneColour
    if (!name) return
    if (currentZones.find(z => z.name === name)) return
    setZones([...currentZones, { name, colour }])
    setNewZoneName('')
    setCustomColour('')
    setNewZoneColour(ZONE_COLOUR_PALETTE[currentZones.length % ZONE_COLOUR_PALETTE.length])
  }

  function removeZone(name) {
    setZones(currentZones.filter(z => z.name !== name))
  }

  function updateZoneColour(name, colour) {
    setZones(currentZones.map(z => z.name === name ? { ...z, colour } : z))
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <p className="text-gray-500">Only Project Admins can access project settings.</p>
      </div>
    )
  }

  const TABS = [
    { id: 'trades',   label: 'Trades' },
    { id: 'zones',    label: 'Construction Zones' },
    { id: 'commit',   label: 'Commit Schedule' },
    { id: 'holidays', label: 'Bank Holidays' },
    { id: 'rnc',      label: 'RNC Categories' },
    { id: 'members',  label: 'Members' },
  ]

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Project Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">{project?.name}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saveSettings.isPending}
          className="px-5 py-2.5 rounded-lg text-white font-medium text-sm min-h-[44px] disabled:opacity-60 transition-all"
          style={{ backgroundColor: saved ? '#059669' : '#1e3a5f' }}
        >
          {saveSettings.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-5 py-3 text-sm font-medium border-b-2 transition-colors"
            style={{
              borderColor: activeTab === tab.id ? '#1e3a5f' : 'transparent',
              color: activeTab === tab.id ? '#1e3a5f' : '#6b7280',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Trades tab ── */}
      {activeTab === 'trades' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Define the trades and their gangs for this project. Each gang becomes a swimlane on the WWP board — without a gang, a trade has no row.
          </p>

          {/* Add trade */}
          <div className="flex gap-2 mb-5">
            <input
              type="text" value={newTrade}
              onChange={e => setNewTrade(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTrade())}
              placeholder="Add a trade…"
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addTrade}
              className="px-4 py-2.5 rounded-lg text-white text-sm font-medium min-h-[44px]"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              Add
            </button>
            <button
              onClick={resetTrades}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm min-h-[44px] hover:bg-gray-50"
              title="Reset to default trade list"
            >
              Reset defaults
            </button>
          </div>

          {/* Trade cards with gang management — drag ⠿ handle to reorder */}
          <DndContext sensors={tradeSensors} collisionDetection={closestCenter} onDragEnd={handleTradeDragEnd}>
            <SortableContext items={currentTrades.map(t => t.name)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {currentTrades.map(trade => (
                  <SortableTradeCard
                    key={trade.name}
                    trade={trade}
                    isAdmin={isAdmin}
                    onRemove={removeTrade}
                  />
                ))}
                {currentTrades.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">No trades configured. Add one above or reset to defaults.</p>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* ── Zones tab ── */}
      {activeTab === 'zones' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Define construction zones for this project. Assign zones to tasks to visually identify clashes on the Weekly Work Plan board.
          </p>

          {/* Add zone */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text" value={newZoneName}
                onChange={e => setNewZoneName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addZone())}
                placeholder="Zone name (e.g. North Wing, Zone A)"
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Colour</p>
              <div className="flex items-center gap-2 flex-wrap">
                {ZONE_COLOUR_PALETTE.map(colour => (
                  <button
                    key={colour}
                    type="button"
                    onClick={() => { setNewZoneColour(colour); setCustomColour('') }}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: colour,
                      borderColor: (customColour || newZoneColour) === colour ? '#1e3a5f' : 'transparent',
                      outline: (customColour || newZoneColour) === colour ? `2px solid ${colour}` : 'none',
                      outlineOffset: 2,
                    }}
                    title={colour}
                  />
                ))}
                <div className="flex items-center gap-1.5 ml-2">
                  <input
                    type="color"
                    value={customColour || newZoneColour}
                    onChange={e => setCustomColour(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                    title="Custom colour"
                  />
                  <span className="text-xs text-gray-500">Custom</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(customColour || newZoneColour) && newZoneName && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
                  style={{
                    borderLeft: `4px solid ${customColour || newZoneColour}`,
                    backgroundColor: `${customColour || newZoneColour}12`,
                  }}>
                  <span className="text-sm font-medium text-gray-800">{newZoneName}</span>
                </div>
              )}
              <button
                onClick={addZone}
                className="px-4 py-2.5 rounded-lg text-white text-sm font-medium min-h-[44px]"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                Add zone
              </button>
            </div>
          </div>

          {/* Zone list */}
          <div className="space-y-2">
            {currentZones.map((zone, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white">
                {/* Colour picker per zone */}
                <input
                  type="color"
                  value={zone.colour}
                  onChange={e => updateZoneColour(zone.name, e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-gray-200 flex-shrink-0"
                  title="Change colour"
                />
                <div className="w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ backgroundColor: zone.colour }} />
                <span className="flex-1 text-sm text-gray-800 font-medium">{zone.name}</span>
                <span className="text-xs text-gray-400 font-mono">{zone.colour}</span>
                <button
                  onClick={() => removeZone(zone.name)}
                  className="text-gray-400 hover:text-amber-600 text-lg leading-none transition-colors"
                  title="Remove zone"
                >×</button>
              </div>
            ))}
            {currentZones.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No zones configured. Add one above to enable zone colouring on the WWP board.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Commit Schedule tab ── */}
      {activeTab === 'commit' && (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            Each week, tasks in the upcoming week are automatically committed at the time below.
            The committed plan becomes the fixed baseline for PPC calculations — tasks added after
            the commit do not count toward that week's PPC.
          </p>

          {/* Commit day */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Commit day</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(day => {
                const val = day.toLowerCase()
                const active = currentCommit.wwp_commit_day === val
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setCommitSettings(s => ({ ...currentCommit, ...s, wwp_commit_day: val }))}
                    className="px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all min-h-[44px]"
                    style={{
                      borderColor: active ? '#1e3a5f' : '#e5e7eb',
                      backgroundColor: active ? '#1e3a5f12' : 'white',
                      color: active ? '#1e3a5f' : '#6b7280',
                    }}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Commit time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Commit time</label>
            <input
              type="time"
              value={currentCommit.wwp_commit_time}
              onChange={e => setCommitSettings(s => ({ ...currentCommit, ...s, wwp_commit_time: e.target.value }))}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">24-hour format. Tasks are committed at this time in the timezone below.</p>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
            <select
              value={currentCommit.wwp_commit_timezone}
              onChange={e => setCommitSettings(s => ({ ...currentCommit, ...s, wwp_commit_timezone: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>

          {/* PPC calculation time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily PPC calculation time</label>
            <input
              type="time"
              value={currentCommit.ppc_calc_time}
              onChange={e => setCommitSettings(s => ({ ...currentCommit, ...s, ppc_calc_time: e.target.value }))}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              PPC is calculated automatically at this time each working day. Admins can also trigger a manual recalculation from the board at any time.
            </p>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 space-y-1">
            <p className="text-sm text-blue-800">
              <span className="font-semibold">Commit: </span>
              Every <span className="font-semibold capitalize">{currentCommit.wwp_commit_day}</span> at{' '}
              <span className="font-semibold">{currentCommit.wwp_commit_time}</span>{' '}
              ({TIMEZONES.find(t => t.value === currentCommit.wwp_commit_timezone)?.label || currentCommit.wwp_commit_timezone})
            </p>
            <p className="text-sm text-blue-800">
              <span className="font-semibold">Daily PPC: </span>
              Calculated at <span className="font-semibold">{currentCommit.ppc_calc_time}</span> each working day
            </p>
          </div>
        </div>
      )}

      {/* ── RNC Categories tab ── */}
      {activeTab === 'rnc' && (
        <div className="space-y-5">
          <p className="text-sm text-gray-600">
            Reasons for Non-Completion (RNC) are recorded when a committed task is not finished as planned.
            Customise the categories below — they appear in the Daily Review panel and PPC analysis.
          </p>

          {/* Add category */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Add a category</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRncLabel}
                onChange={e => setNewRncLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRncCategory())}
                placeholder="e.g. Design not complete"
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="color"
                value={newRncColour}
                onChange={e => setNewRncColour(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border border-gray-300"
                title="Category colour"
              />
              <button
                onClick={addRncCategory}
                disabled={!newRncLabel.trim()}
                className="px-4 py-2.5 rounded-lg text-white text-sm font-medium min-h-[44px] disabled:opacity-40"
                style={{ backgroundColor: '#1e3a5f' }}
              >Add</button>
            </div>
          </div>

          {/* Category list */}
          <div className="space-y-2">
            {currentRncCategories.map(cat => (
              <div key={cat.value} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white">
                <input
                  type="color"
                  value={cat.colour || '#6b7280'}
                  onChange={e => updateRncColour(cat.value, e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-gray-200 flex-shrink-0"
                  title="Change colour"
                />
                <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: cat.colour || '#6b7280' }} />
                <span className="flex-1 text-sm text-gray-800 font-medium">{cat.label}</span>
                <span className="text-xs text-gray-400 font-mono">{cat.value}</span>
                <button
                  onClick={() => removeRncCategory(cat.value)}
                  className="text-gray-400 hover:text-red-500 text-lg leading-none transition-colors"
                  title="Remove category"
                >×</button>
              </div>
            ))}
            {currentRncCategories.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No categories. Add one above.</p>
            )}
          </div>

          <button
            onClick={() => setRncCategories(DEFAULT_RNC)}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            Reset to standard LCI categories
          </button>
        </div>
      )}

      {/* ── Bank Holidays tab ── */}
      {activeTab === 'holidays' && (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            Mark specific dates as non-working days. Bank holidays are highlighted on the Weekly Work Plan board
            (like weekends) and excluded from working-day calculations.
          </p>

          {/* UK presets */}
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-900">UK Bank Holiday presets</p>
              {/* Year selector */}
              <div className="flex gap-1">
                {Object.keys(UK_BANK_HOLIDAYS).map(y => (
                  <button
                    key={y}
                    onClick={() => setBankYear(Number(y))}
                    className="px-3 py-1 rounded-lg text-xs font-medium border transition-all"
                    style={{
                      borderColor: bankYear === Number(y) ? '#d97706' : '#e5e7eb',
                      backgroundColor: bankYear === Number(y) ? '#d97706' : 'white',
                      color: bankYear === Number(y) ? 'white' : '#6b7280',
                    }}
                  >{y}</button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {(UK_BANK_HOLIDAYS[bankYear] || []).map(({ date, name }) => {
                const active = bankHolidaySet.has(date)
                return (
                  <div
                    key={date}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-all"
                    style={{
                      borderColor: active ? '#d97706' : '#e5e7eb',
                      backgroundColor: active ? '#fef3c7' : 'white',
                    }}
                    onClick={() => toggleHoliday(date)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all"
                        style={{
                          borderColor: active ? '#d97706' : '#d1d5db',
                          backgroundColor: active ? '#d97706' : 'white',
                        }}
                      >
                        {active && <span className="text-white text-xs leading-none font-bold">✓</span>}
                      </span>
                      <span className="text-sm text-gray-800 font-medium">{name}</span>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">{formatHolidayDate(date)}</span>
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => addAllForYear(bankYear)}
              className="text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
            >
              + Add all {bankYear} bank holidays
            </button>
          </div>

          {/* Custom date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Add a custom date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={customHolidayDate}
                onChange={e => setCustomHolidayDate(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomHoliday()}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={addCustomHoliday}
                disabled={!customHolidayDate || bankHolidaySet.has(customHolidayDate)}
                className="px-4 py-2.5 rounded-lg text-white text-sm font-medium min-h-[44px] disabled:opacity-40"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Configured holidays list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">
                Configured non-working days
                {currentBankHolidays.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">({currentBankHolidays.length})</span>
                )}
              </p>
              {currentBankHolidays.length > 0 && (
                <button
                  onClick={() => setBankHolidays([])}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {currentBankHolidays.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6 rounded-lg border border-dashed border-gray-200">
                No bank holidays configured. Use the presets above or add a custom date.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {currentBankHolidays.map(iso => {
                  // Try to find a preset name for this date
                  const presetName = Object.values(UK_BANK_HOLIDAYS)
                    .flat()
                    .find(h => h.date === iso)?.name
                  return (
                    <div key={iso} className="flex items-center justify-between px-3 py-2 rounded-lg border border-amber-200 bg-amber-50">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{presetName || 'Custom date'}</span>
                        <span className="ml-2 text-xs text-gray-500">{formatHolidayDate(iso)}</span>
                      </div>
                      <button
                        onClick={() => toggleHoliday(iso)}
                        className="text-gray-400 hover:text-red-500 text-lg leading-none transition-colors ml-3 flex-shrink-0"
                        title="Remove"
                      >×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Members tab ── */}
      {activeTab === 'members' && (
        <MembersPanel projectId={projectId} project={project} currentTrades={currentTrades} />
      )}
    </div>
  )
}

function MembersPanel({ projectId, project, currentTrades }) {
  const queryClient = useQueryClient()
  const { isSuperAdmin } = useAuth()
  const members = project?.project_members || []

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('trade_supervisor')
  const [inviteTrades, setInviteTrades] = useState([])

  const inviteMember = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase()
      if (!email) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      const { error } = await supabase.from('project_members').insert({
        project_id: projectId,
        user_id: profile?.id || null,
        invited_email: email,
        role: inviteRole,
        assigned_trades: inviteRole === 'trade_supervisor' ? inviteTrades : null,
        joined_at: profile ? new Date().toISOString() : null,
      })
      if (error) throw error

      // If user already exists, ensure their profile is linked to this project's tenant
      if (profile?.id) {
        const { data: proj } = await supabase
          .from('projects')
          .select('tenant_id')
          .eq('id', projectId)
          .single()
        if (proj?.tenant_id) {
          await supabase
            .from('profiles')
            .update({ tenant_id: proj.tenant_id })
            .eq('id', profile.id)
            .is('tenant_id', null)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      setInviteEmail('')
      setInviteTrades([])
    },
    onError: (err) => {
      alert(`Failed to add member: ${err.message}`)
    },
  })

  const updateMember = useMutation({
    mutationFn: async ({ memberId, updates }) => {
      const { error } = await supabase
        .from('project_members')
        .update(updates)
        .eq('id', memberId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['my-role', projectId] })
    },
  })

  const removeMember = useMutation({
    mutationFn: async (memberId) => {
      const { error } = await supabase
        .from('project_members')
        .delete()
        .eq('id', memberId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (err) => alert(`Failed to remove member: ${err.message}`),
  })

  const tradeNames = currentTrades.map(t => t.name)

  function toggleInviteTrade(tradeName) {
    setInviteTrades(prev =>
      prev.includes(tradeName) ? prev.filter(t => t !== tradeName) : [...prev, tradeName]
    )
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Manage who has access to this project and assign trades to supervisors.
      </p>

      {/* Invite form */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-200">
        <p className="text-xs font-semibold text-gray-700 mb-3">Add member</p>
        <div className="flex gap-2 mb-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="Email address"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <select
            value={inviteRole}
            onChange={e => { setInviteRole(e.target.value); if (e.target.value !== 'trade_supervisor') setInviteTrades([]) }}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {Object.entries(ROLES).filter(([k]) => k !== 'constraint_owner').map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => inviteMember.mutate()}
            disabled={!inviteEmail.trim() || inviteMember.isPending}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 min-h-[44px]"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            {inviteMember.isPending ? '…' : 'Add'}
          </button>
        </div>

        {inviteRole === 'trade_supervisor' && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Assign trades (supervisor can only edit tasks in these trades):</p>
            <div className="flex flex-wrap gap-1.5">
              {tradeNames.map(t => (
                <button
                  key={t}
                  onClick={() => toggleInviteTrade(t)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                  style={inviteTrades.includes(t)
                    ? { backgroundColor: '#1e3a5f', borderColor: '#1e3a5f', color: 'white' }
                    : { backgroundColor: 'white', borderColor: '#d1d5db', color: '#6b7280' }
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {members.map(m => {
          const profile = m.profiles
          const displayName = profile?.full_name || m.invited_email || '(unknown)'
          const displayEmail = profile?.email || m.invited_email || ''
          const isTradeSuper = m.role === 'trade_supervisor'
          const memberTrades = m.assigned_trades || []

          return (
            <div key={m.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: m.role === 'project_admin' ? '#1e3a5f' : m.role === 'planner' ? '#2563eb' : '#d97706' }}
                >
                  {displayName[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                    {!m.joined_at && (
                      <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 font-medium shrink-0">Pending</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{displayEmail}</p>
                </div>
                <select
                  value={m.role}
                  onChange={e => updateMember.mutate({
                    memberId: m.id,
                    updates: {
                      role: e.target.value,
                      assigned_trades: e.target.value === 'trade_supervisor' ? memberTrades : null,
                    },
                  })}
                  className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600"
                >
                  {Object.entries(ROLES).filter(([k]) => k !== 'constraint_owner').map(([value, { label }]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {!m.joined_at && (
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/login?email=${encodeURIComponent(displayEmail)}`
                      navigator.clipboard.writeText(url)
                      alert('Invite link copied — share it with the user so they can sign in via magic link.')
                    }}
                    className="text-gray-400 hover:text-blue-600 text-xs transition-colors whitespace-nowrap"
                    title="Copy invite link to clipboard"
                  >
                    Copy link
                  </button>
                )}
                <button
                  onClick={() => { if (confirm(`Remove ${displayName} from this project?`)) removeMember.mutate(m.id) }}
                  className="text-gray-300 hover:text-red-500 text-lg leading-none transition-colors"
                  title="Remove member"
                >×</button>
              </div>

              {isTradeSuper && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1.5">Assigned trades:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tradeNames.map(t => (
                      <button
                        key={t}
                        onClick={() => {
                          const updated = memberTrades.includes(t)
                            ? memberTrades.filter(x => x !== t)
                            : [...memberTrades, t]
                          updateMember.mutate({ memberId: m.id, updates: { assigned_trades: updated } })
                        }}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                        style={memberTrades.includes(t)
                          ? { backgroundColor: '#1e3a5f', borderColor: '#1e3a5f', color: 'white' }
                          : { backgroundColor: 'white', borderColor: '#d1d5db', color: '#6b7280' }
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
