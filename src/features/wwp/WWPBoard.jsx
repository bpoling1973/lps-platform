import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, DragOverlay, pointerWithin,
  PointerSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole, useProject } from '@/hooks/useProject'
import { TASK_STATUS, DEFAULT_TRADES, RNC_CATEGORIES } from '@/lib/constants'

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const LABEL_WIDTH = 150
const RAG_COLOURS = { navy: '#1e3a5f', amber: '#d97706', grey: '#4b5563' }
const CARD_HEIGHT = 96
const SEGMENT_STRIP = 40   // bottom strip height reserved for day-status marks
const CARD_GAP = 4
const NUM_WEEKS = 4
const NUM_DAYS = NUM_WEEKS * 7   // 28
const MIN_COL_WIDTH = 75         // px — minimum per day column; grid scrolls when viewport is narrower
const TRADE_HEADER_HEIGHT = 36   // trade section header row
const ADD_GANG_FOOTER_HEIGHT = 40 // "Add gang" footer row (canEdit only — used in position maths)

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getWeekNumber(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

function getWeekDays(weekOffset = 0) {
  const now = new Date()
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1 + weekOffset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: NUM_DAYS }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function getDayIndex(dateStr, weekDays) {
  if (!dateStr) return -1
  const d = new Date(dateStr + 'T00:00:00')
  return weekDays.findIndex(wd => wd.toDateString() === d.toDateString())
}

function isNonWorkingISO(iso, bankHolidays) {
  const dow = new Date(iso + 'T00:00:00').getDay()
  return dow === 0 || dow === 6 || (bankHolidays ? bankHolidays.has(iso) : false)
}

function workingDaysBetween(fromISO, toISO, bankHolidays) {
  // Returns positive if toISO is later than fromISO, negative if earlier
  if (fromISO === toISO) return 0
  const to = new Date(toISO + 'T00:00:00')
  const from = new Date(fromISO + 'T00:00:00')
  const step = to > from ? 1 : -1
  let count = 0
  const cur = new Date(from)
  while (cur.toISOString().slice(0, 10) !== toISO) {
    cur.setDate(cur.getDate() + step)
    const iso = cur.toISOString().slice(0, 10)
    if (!isNonWorkingISO(iso, bankHolidays)) count += step
  }
  return count
}

// Returns a Date object for the last working day of a task given its start ISO string and working-day duration.
function workingDayEnd(startISO, durationDays, bankHolidays) {
  const d = new Date(startISO + 'T00:00:00')
  let remaining = (durationDays || 1) - 1
  while (remaining > 0) {
    d.setDate(d.getDate() + 1)
    const iso = d.toISOString().slice(0, 10)
    if (!isNonWorkingISO(iso, bankHolidays)) remaining--
  }
  return d
}

// Returns { cols, used } for a task starting at startDayIdx with workingDays working-day duration.
//   cols = calendar columns for the FIRST contiguous working span — stops at the first bank
//          holiday (or Friday or task end). Bank holidays terminate the card just like SAT/SUN.
//          Post-BH working days in the same week are handled as intra-week fragments (see below).
//   used = total working (non-holiday) days consumed across the entire week (spans past bank
//          holidays). Used for the inter-week overflow calculation only.
function weekLayout(startDayIdx, workingDays, bankHolidayDayIndices) {
  const fridayIdx = Math.floor(startDayIdx / 7) * 7 + 4
  // cols: stop at the first bank holiday so the card never visually covers a non-working day.
  let cols = 0
  for (let i = startDayIdx; i <= fridayIdx && cols < workingDays; i++) {
    if (bankHolidayDayIndices?.has(i)) break
    cols++
  }
  if (cols === 0) cols = 1  // fallback if task is anchored to a bank holiday
  // used: count all working days Mon–Fri, skipping bank holidays, for overflow maths.
  let used = 0
  for (let i = startDayIdx; i <= fridayIdx && used < workingDays; i++) {
    if (i % 7 < 5 && !(bankHolidayDayIndices?.has(i))) used++
  }
  return { cols, used }
}

function dateToISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveStatus(dayStatuses) {
  if (!dayStatuses?.length) return 'not_started'
  if (dayStatuses.every(s => s === 'complete')) return 'complete'
  if (dayStatuses.some(s => s === 'in_progress' || s === 'complete')) return 'in_progress'
  return 'not_started'
}

function getContrastColor(hex) {
  if (!hex || hex.length < 7) return 'rgba(0,0,0,0.85)'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55
    ? 'rgba(0,0,0,0.85)'
    : 'rgba(255,255,255,0.95)'
}

function getContrastLineColor(hex) {
  if (!hex || hex.length < 7) return 'rgba(0,0,0,0.3)'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55
    ? 'rgba(0,0,0,0.3)'
    : 'rgba(255,255,255,0.45)'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MilestoneMarker({ milestone, isForecast }) {
  const colour = RAG_COLOURS[milestone.rag_status] || RAG_COLOURS.grey
  const date = isForecast ? milestone.forecast_date : milestone.planned_date
  const label = `${milestone.name}${isForecast ? ' (forecast)' : ''} — ${new Date(date + 'T00:00:00').toLocaleDateString('en-GB')}`
  return (
    <div title={label} className="inline-flex items-center justify-center cursor-default mt-0.5">
      <div
        style={{
          width: 16, height: 16,
          backgroundColor: isForecast ? 'transparent' : colour,
          border: isForecast ? `2px dashed ${colour}` : 'none',
          borderRadius: 2,
          transform: 'rotate(45deg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {!isForecast && (
          <span className="text-white font-bold" style={{ fontSize: '0.5rem', transform: 'rotate(-45deg)' }}>M</span>
        )}
      </div>
    </div>
  )
}

function ZoneLegend({ zones, activeZones, onToggleZone }) {
  if (!zones?.length) return null
  const hasFilter = activeZones.length > 0
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Zones:</span>
      {zones.map(z => {
        const isActive = activeZones.includes(z.name)
        return (
          <button
            key={z.name}
            onClick={() => onToggleZone(z.name)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full border transition-all"
            style={{
              borderColor: isActive ? z.colour : '#e5e7eb',
              backgroundColor: isActive ? z.colour + '18' : 'white',
              opacity: hasFilter && !isActive ? 0.4 : 1,
            }}
          >
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: z.colour }} />
            <span className="text-xs text-gray-700">{z.name}</span>
          </button>
        )
      })}
      {hasFilter && (
        <button onClick={() => onToggleZone(null)} className="text-xs text-gray-400 hover:text-gray-600 underline px-1">
          Clear
        </button>
      )}
    </div>
  )
}

function DroppableCell({ id, isRecovery, isNewWeek }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className="flex-1 h-full border-r border-gray-100 transition-colors"
      style={{
        backgroundColor: isOver ? 'rgba(59,130,246,0.45)' : isRecovery ? '#fffbeb80' : undefined,
        outline: isOver ? '3px solid #1d4ed8' : undefined,
        outlineOffset: '-3px',
        borderLeft: isNewWeek ? '2px solid #d1d5db' : undefined,
      }}
    />
  )
}

function LinkConfigModal({ fromTask, toTask, onConfirm, onCancel }) {
  const [lagDays, setLagDays] = useState(0)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onPointerDown={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4"
        onPointerDown={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900 mb-1">Set dependency</h2>
        <p className="text-sm text-gray-500 mb-5">
          <span className="font-semibold" style={{ color: '#d97706' }}>{toTask.title}</span>
          {' '}depends on{' '}
          <span className="font-semibold text-gray-800">{fromTask.title}</span>
        </p>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Start after how many days of "{fromTask.title}" are complete?
        </label>
        <div className="flex items-center gap-3 mb-6">
          <input
            autoFocus
            type="number" min="0" max="28"
            value={lagDays}
            onChange={e => setLagDays(Math.max(0, Number(e.target.value)))}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(lagDays); if (e.key === 'Escape') onCancel() }}
            className="w-20 px-3 py-2 rounded-lg border border-gray-300 text-base text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <span className="text-sm text-gray-500">
            {lagDays === 0 ? 'All days must be complete (finish-to-start)' : `${lagDays} day${lagDays !== 1 ? 's' : ''} must be done`}
          </span>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 min-h-[44px]">
            Cancel
          </button>
          <button onClick={() => onConfirm(lagDays)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white min-h-[44px]"
            style={{ backgroundColor: '#d97706' }}>
            Link tasks
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onPointerDown={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4"
        onPointerDown={e => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white min-h-[44px]"
            style={{ backgroundColor: '#d97706' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function DraggableCard({ task, zones, canEdit, canLink, onUpdate, onDelete, onSegmentClick, visibleDays, style, hasOverflow, isContinuation, isConflict, isBlocked, allProjectTasks, taskDeps, onRemoveDependency, linkingFromId, onLinkAction, startDayIdx, bankHolidayDayIndices }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDuration, setEditDuration] = useState(1)
  const [editZone, setEditZone] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [flashLabel, setFlashLabel] = useState(null)
  const lastTapRef = useRef(0)

  useEffect(() => {
    if (!flashLabel) return
    const timer = setTimeout(() => setFlashLabel(null), 1200)
    return () => clearTimeout(timer)
  }, [flashLabel])

  const isLinkingSource = linkingFromId === task.id
  const isLinkTarget = !!linkingFromId && !isLinkingSource && !isContinuation

  const draggableId = isContinuation ? `${task.id}__cont` : task.id
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    disabled: !canEdit || isContinuation || isEditing || !!linkingFromId,
  })

  const displayZone = isEditing
    ? zones?.find(z => z.name === editZone)
    : zones?.find(z => z.name === task.zone)
  const bgColor = displayZone?.colour || '#FDE047'
  const textColor = getContrastColor(bgColor)
  const lineColor = getContrastLineColor(bgColor)

  const segmentCount = visibleDays || task.duration_days || 1
  const segmentOffset = task.continuationOffset || 0
  // Build per-column segment info, skipping bank-holiday columns.
  // Each entry is { isBankHoliday, wdi (working-day index within this card), status }.
  let _wdi = 0
  const segmentInfos = Array.from({ length: segmentCount }, (_, ci) => {
    const globalIdx = startDayIdx != null ? startDayIdx + ci : -1
    if (globalIdx >= 0 && bankHolidayDayIndices?.has(globalIdx)) {
      return { isBankHoliday: true, wdi: null, status: null }
    }
    const wdi = _wdi++
    return { isBankHoliday: false, wdi, status: task.day_statuses?.[segmentOffset + wdi] || 'not_started' }
  })

  function openEdit() {
    setEditTitle(task.title || '')
    setEditDuration(task.duration_days || 1)
    setEditZone(task.zone || null)
    setIsEditing(true)
  }

  function handleDoubleClick(e) {
    if (!canEdit || isContinuation) return
    e.stopPropagation()
    openEdit()
  }

  function handleTouchEnd(e) {
    const now = Date.now()
    if (now - lastTapRef.current < 350 && canEdit && !isContinuation) {
      e.stopPropagation()
      openEdit()
    }
    lastTapRef.current = now
  }

  function handleSave() {
    if (!editTitle.trim()) return
    const newDuration = Math.max(1, Math.min(3, editDuration))
    const existing = task.day_statuses || []
    const newDayStatuses = Array.from({ length: newDuration }, (_, i) =>
      existing[i] || 'not_started'
    )
    onUpdate(task.id, {
      title: editTitle.trim(),
      duration_days: newDuration,
      zone: editZone || null,
      day_statuses: newDayStatuses,
      status: deriveStatus(newDayStatuses),
    })
    setIsEditing(false)
  }

  // ── Editing view ──
  if (isEditing) {
    return (
      <div
        style={{
          ...style,
          height: 'auto',
          minHeight: CARD_HEIGHT + 44,
          minWidth: 240,
          zIndex: 50,
          backgroundColor: bgColor,
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        }}
        className="rounded-lg overflow-hidden"
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="p-2 flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setIsEditing(false)
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
            }}
            rows={2}
            className="w-full resize-none rounded px-1.5 py-1 text-xs font-bold focus:outline-none"
            style={{ backgroundColor: 'rgba(0,0,0,0.15)', color: textColor }}
          />
          <div className="flex items-center gap-2">
            <span style={{ fontSize: '0.65rem', color: textColor, opacity: 0.75 }}>Days</span>
            <input
              type="number" min="1" max="3"
              value={editDuration}
              onChange={e => setEditDuration(Number(e.target.value))}
              className="w-10 text-xs text-center rounded px-1 py-0.5 focus:outline-none"
              style={{ backgroundColor: 'rgba(0,0,0,0.15)', color: textColor }}
            />
          </div>
          {zones?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span style={{ fontSize: '0.65rem', color: textColor, opacity: 0.75 }}>Zone</span>
              {zones.map(z => (
                <button
                  key={z.name}
                  onClick={() => setEditZone(editZone === z.name ? null : z.name)}
                  className="w-4 h-4 rounded-sm flex-shrink-0 transition-all"
                  style={{
                    backgroundColor: z.colour,
                    outline: editZone === z.name ? `2px solid ${textColor}` : '2px solid transparent',
                    outlineOffset: '1px',
                  }}
                  title={z.name}
                />
              ))}
            </div>
          )}
          {/* Dependencies list */}
          {taskDeps?.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span style={{ fontSize: '0.65rem', color: textColor, opacity: 0.75 }}>Depends on</span>
              {taskDeps.map(dep => {
                const pred = (allProjectTasks || []).find(t => t.id === dep.predecessor_id)
                return (
                  <div key={dep.id} className="flex items-center gap-1">
                    <span
                      className="flex-1 rounded px-1 py-0.5 text-xs truncate"
                      style={{ backgroundColor: 'rgba(0,0,0,0.15)', color: textColor }}
                      title={pred?.title}
                    >
                      {pred?.title || dep.predecessor_id.slice(0, 8)}
                      {dep.lag_days > 0 && <span style={{ opacity: 0.7 }}> +{dep.lag_days}d</span>}
                    </span>
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => onRemoveDependency && onRemoveDependency(dep.id)}
                      className="text-xs rounded px-1 py-0.5 flex-shrink-0"
                      style={{ backgroundColor: 'rgba(0,0,0,0.2)', color: textColor }}
                      title="Remove this dependency"
                    >×</button>
                  </div>
                )
              })}
            </div>
          )}
          {canEdit && !isContinuation && (
            <span style={{ fontSize: '0.58rem', color: textColor, opacity: 0.55 }}>
              Use ⊕ (hover card) to add dependencies
            </span>
          )}

          <div className="flex gap-1 pt-0.5">
            <button
              onClick={handleSave}
              className="flex-1 text-xs py-1 rounded font-bold"
              style={{ backgroundColor: 'rgba(0,0,0,0.2)', color: textColor }}
            >✓ Save</button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 text-xs py-1 rounded"
              style={{ backgroundColor: 'rgba(0,0,0,0.1)', color: textColor }}
            >✕</button>
          </div>
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full text-xs py-1 rounded mt-0.5 font-medium"
            style={{ backgroundColor: 'rgba(0,0,0,0.25)', color: textColor, opacity: 0.8 }}
          >🗑 Delete task</button>
          {confirmDelete && (
            <ConfirmModal
              title="Delete task?"
              message={`"${task.title}" will be permanently removed.`}
              confirmLabel="Delete"
              onConfirm={() => { setConfirmDelete(false); setIsEditing(false); onDelete(task.id) }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
        </div>
      </div>
    )
  }

  // ── Normal view ──
  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      style={{
        ...style,
        opacity: isDragging ? 0 : 1,
        backgroundColor: bgColor,
        border: isLinkingSource
          ? '3px solid #d97706'
          : isConflict ? '3px solid #d97706'
          : isContinuation ? `2px dashed ${lineColor}`
          : 'none',
        boxShadow: isLinkingSource
          ? '0 0 0 4px #d97706, 0 0 20px 8px rgba(217,119,6,0.55), 2px 3px 8px rgba(0,0,0,0.28)'
          : isConflict ? '0 0 0 3px #d97706, 0 0 12px 4px rgba(217,119,6,0.55), 2px 3px 8px rgba(0,0,0,0.28)'
          : isContinuation ? 'none'
          : '2px 3px 8px rgba(0,0,0,0.28)',
      }}
      className="group rounded-lg select-none touch-manipulation overflow-hidden relative"
      onDoubleClick={handleDoubleClick}
      onTouchEnd={handleTouchEnd}
    >
      <div
        {...(isContinuation || !canEdit ? {} : { ...attributes, ...listeners })}
        className={`px-2 flex flex-col items-center justify-center overflow-hidden ${isContinuation || !canEdit ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ height: CARD_HEIGHT - SEGMENT_STRIP, touchAction: isContinuation || !canEdit ? undefined : 'none' }}
      >
        {isConflict && (
          <span
            className="absolute top-1 left-1 font-black leading-none"
            style={{ fontSize: '0.85rem', color: '#d97706', textShadow: '0 0 4px rgba(0,0,0,0.4)' }}
            title="Resource conflict — this gang has overlapping tasks on one or more days"
          >⚠</span>
        )}
        <p className="font-bold leading-tight line-clamp-2 text-xs text-center" style={{ color: textColor }} title={task.title}>
          {task.title}
        </p>
        {!isContinuation && task.committed && task.committed_start && task.committed_start !== task.planned_start && (() => {
          const slip = workingDaysBetween(task.committed_start, task.planned_start)
          const late = slip > 0
          return (
            <span
              style={{
                fontSize: '0.5rem', fontWeight: 700, color: 'white',
                backgroundColor: late ? '#dc2626' : '#059669',
                borderRadius: 3, padding: '1px 4px', marginTop: 3,
                flexShrink: 0,
              }}
              title={`${Math.abs(slip)} working day${Math.abs(slip) !== 1 ? 's' : ''} ${late ? 'later' : 'earlier'} than committed plan`}
            >
              {late ? `+${slip}d` : `${slip}d`}
            </span>
          )
        })()}
      </div>

      {hasOverflow && !isContinuation && (
        <span className="absolute top-1 right-1 text-xs" style={{ color: textColor, opacity: 0.55 }}>›</span>
      )}

      {/* ⊕ Link handle — visible for any editable role (cross-trade linking) */}
      {canLink && !isContinuation && !linkingFromId && !isEditing && (
        <button
          title="Click to start linking a dependency from this task"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onLinkAction && onLinkAction(task) }}
          className="absolute bottom-1 right-1 flex items-center justify-center rounded-full transition-opacity opacity-0 group-hover:opacity-100 hover:opacity-100"
          style={{
            width: 18, height: 18,
            backgroundColor: 'rgba(0,0,0,0.25)',
            color: textColor,
            fontSize: '0.65rem',
            lineHeight: 1,
            zIndex: 4,
          }}
        >⊕</button>
      )}

      {/* Target overlay — click to link TO this card */}
      {isLinkTarget && (
        <div
          className="absolute inset-0 rounded-lg flex items-center justify-center cursor-pointer"
          style={{ backgroundColor: 'rgba(217,119,6,0.18)', zIndex: 6, border: '2px dashed #d97706' }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onLinkAction && onLinkAction(task) }}
        >
          <span style={{ fontSize: '1.1rem', color: '#d97706' }}>⊕</span>
        </div>
      )}

      <div
        className="absolute bottom-0 left-0 right-0 flex"
        style={{ height: SEGMENT_STRIP, borderTop: `1px solid ${lineColor}` }}
      >
        {segmentInfos.map((seg, ci) => (
          <div
            key={ci}
            className="flex-1 relative flex items-center justify-center"
            style={{
              borderLeft: ci > 0 ? `1px solid ${lineColor}` : 'none',
              backgroundColor: seg.isBankHoliday ? 'rgba(0,0,0,0.12)' : undefined,
              cursor: seg.isBankHoliday ? 'default' : isBlocked ? 'not-allowed' : canEdit ? 'pointer' : 'default',
            }}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              if (seg.isBankHoliday || !canEdit || isBlocked) return
              const nextStatus = seg.status === 'not_started' ? 'in_progress'
                : seg.status === 'in_progress' ? 'complete' : 'not_started'
              const label = nextStatus === 'in_progress' ? 'Started'
                : nextStatus === 'complete' ? 'Complete' : 'Reset'
              setFlashLabel({ wdi: seg.wdi, label })
              onSegmentClick(task, seg.wdi)
            }}
          >
            {seg.isBankHoliday ? null : isBlocked ? (
              <span style={{ fontSize: '1rem', lineHeight: 1, opacity: 0.85 }} title="Waiting on predecessor task">🔒</span>
            ) : (
              <>
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" style={{ pointerEvents: 'none' }}>
                  {(seg.status === 'in_progress' || seg.status === 'complete') && (
                    <line x1="3" y1="100%" x2="100%" y2="3" stroke={lineColor} strokeWidth="2.5" strokeLinecap="round" />
                  )}
                  {seg.status === 'complete' && (
                    <line x1="3" y1="3" x2="100%" y2="100%" stroke={lineColor} strokeWidth="2.5" strokeLinecap="round" />
                  )}
                </svg>
                {flashLabel && flashLabel.wdi === seg.wdi && (
                  <span
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{
                      fontSize: '0.55rem',
                      fontWeight: 700,
                      color: textColor,
                      backgroundColor: bgColor + 'cc',
                      zIndex: 5,
                      animation: 'fadeOut 1.2s forwards',
                    }}
                  >
                    {flashLabel.label}
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function GhostCard({ zones, onSave, onCancel, style }) {
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(1)
  const [zone, setZone] = useState(null)
  const selectedZone = zones?.find(z => z.name === zone)
  const bg = selectedZone?.colour || '#FDE047'
  const tc = getContrastColor(bg)

  function handleSave() {
    if (!title.trim()) return
    onSave({ title: title.trim(), duration_days: Math.max(1, Math.min(3, duration)), zone: zone || null })
  }

  return (
    <div
      style={{ ...style, backgroundColor: bg, minWidth: 240, zIndex: 50, borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="p-2 flex flex-col gap-1.5">
        <textarea
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
          }}
          rows={2}
          placeholder="Task description…"
          className="w-full resize-none rounded px-1.5 py-1 text-xs font-bold focus:outline-none placeholder-black/30"
          style={{ backgroundColor: 'rgba(0,0,0,0.15)', color: tc }}
        />
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '0.65rem', color: tc, opacity: 0.75 }}>Days</span>
          <input
            type="number" min="1" max="3"
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            className="w-10 text-xs text-center rounded px-1 py-0.5 focus:outline-none"
            style={{ backgroundColor: 'rgba(0,0,0,0.15)', color: tc }}
          />
        </div>
        {zones?.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={{ fontSize: '0.65rem', color: tc, opacity: 0.75 }}>Zone</span>
            {zones.map(z => (
              <button key={z.name} onClick={() => setZone(zone === z.name ? null : z.name)}
                className="w-4 h-4 rounded-sm flex-shrink-0"
                style={{ backgroundColor: z.colour, outline: zone === z.name ? `2px solid ${tc}` : '2px solid transparent', outlineOffset: 1 }}
                title={z.name}
              />
            ))}
          </div>
        )}
        <div className="flex gap-1 pt-0.5">
          <button onClick={handleSave}
            className="flex-1 text-xs py-1 rounded font-bold"
            style={{ backgroundColor: 'rgba(0,0,0,0.2)', color: tc }}>✓ Save</button>
          <button onClick={onCancel}
            className="flex-1 text-xs py-1 rounded"
            style={{ backgroundColor: 'rgba(0,0,0,0.1)', color: tc }}>✕</button>
        </div>
      </div>
    </div>
  )
}

const EMPTY_ROW_HEIGHT = 44  // minimal height when gang has no tasks this period

// ─── Dependency arrows — DOM-measured ─────────────────────────────────────────
// Uses getBoundingClientRect() so arrow positions are always accurate regardless
// of trade header height, stacked cards, or collapsed swimlanes.

function DependencyArrows({ dependencies, gridAreaRef }) {
  const svgRef = useRef(null)
  const [arrows, setArrows] = useState([])

  function measure() {
    if (!svgRef.current || !gridAreaRef?.current || !dependencies.length) {
      setArrows([])
      return
    }
    const svgRect = svgRef.current.getBoundingClientRect()
    if (svgRect.width === 0) return
    const newArrows = []
    for (const dep of dependencies) {
      const fromEls = gridAreaRef.current.querySelectorAll(`[data-task-id="${dep.predecessor_id}"]`)
      const toEls   = gridAreaRef.current.querySelectorAll(`[data-task-id="${dep.task_id}"]`)
      if (!fromEls.length || !toEls.length) continue
      // Predecessor: rightmost right edge (accounts for continuation cards)
      let x1 = -Infinity, y1 = 0
      fromEls.forEach(el => {
        const r = el.getBoundingClientRect()
        if (r.right > x1) { x1 = r.right; y1 = (r.top + r.bottom) / 2 }
      })
      // Successor: leftmost left edge
      let x2 = Infinity, y2 = 0
      toEls.forEach(el => {
        const r = el.getBoundingClientRect()
        if (r.left < x2) { x2 = r.left; y2 = (r.top + r.bottom) / 2 }
      })
      newArrows.push({
        id: dep.id,
        x1: x1 - svgRect.left,
        y1: y1 - svgRect.top,
        x2: x2 - svgRect.left,
        y2: y2 - svgRect.top,
        lagDays: dep.lag_days,
      })
    }
    setArrows(newArrows)
  }

  useLayoutEffect(() => {
    // Defer measure one animation frame so the DOM settles after zone-filter
    // changes collapse/expand swimlanes before we read card positions.
    const raf = requestAnimationFrame(measure)
    if (!gridAreaRef?.current) return () => cancelAnimationFrame(raf)
    const ro = new ResizeObserver(measure)
    ro.observe(gridAreaRef.current)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencies, gridAreaRef])

  const ARROW_COLOR = '#d97706'

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 8, overflow: 'visible',
      }}
    >
      <defs>
        <marker id="dep-arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto">
          <path d="M0,0 L0,8 L8,4 Z" fill={ARROW_COLOR} />
        </marker>
      </defs>
      {arrows.map(({ id, x1, y1, x2, y2, lagDays }) => {
        const cp = Math.max(Math.abs(x2 - x1) * 0.4, 40)
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        return (
          <g key={id}>
            <path
              d={`M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`}
              fill="none"
              stroke={ARROW_COLOR}
              strokeWidth="2"
              strokeDasharray={lagDays > 0 ? '5,3' : undefined}
              markerEnd="url(#dep-arrow)"
            />
            {lagDays > 0 && (
              <text x={midX} y={midY - 6} textAnchor="middle"
                fontSize="10" fontWeight="bold" fill={ARROW_COLOR}>
                +{lagDays}d
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function GangRow({ trade, gang, tasks, weekDays, zones, canEdit, canLink, onUpdate, onDelete, onSegmentClick, onCreateTask, onRenameGang, onDeleteGang, activeId, allProjectTasks, taskMap, isTaskBlockedFn, depsByTaskId, onRemoveDependency, linkingFromId, onLinkAction, incompleteHistoricCount, bankHolidayDayIndices }) {
  const [creatingAtDay, setCreatingAtDay] = useState(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteGang, setConfirmDeleteGang] = useState(false)

  const tasksByDay = {}
  tasks.forEach(t => {
    const di = getDayIndex(t.planned_start, weekDays)
    if (di < 0) return
    if (!tasksByDay[di]) tasksByDay[di] = []
    tasksByDay[di].push(t)
  })

  // Conflict detection — expand each task to every day index it covers,
  // then flag any task that shares a day with at least one other task.
  const conflictingIds = new Set()
  const dayCoverage = {} // dayIdx → [taskId, ...]
  // Include continuation cards: they have the correct planned_start for their week
  // and duration_days capped to remaining working days — so the same day-coverage
  // logic applies unchanged.
  tasks.filter(t => t.planned_start).forEach(t => {
    const startIdx = getDayIndex(t.planned_start, weekDays)
    if (startIdx < 0) return
    const dayInWeek = startIdx % 7
    const isWeekendStart = dayInWeek >= 5
    const { cols: visibleDur } = isWeekendStart
      ? { cols: 7 - dayInWeek }
      : weekLayout(startIdx, t.duration_days || 1, bankHolidayDayIndices)
    for (let d = 0; d < visibleDur; d++) {
      const di = startIdx + d
      if (!dayCoverage[di]) dayCoverage[di] = []
      dayCoverage[di].push(t.id)
    }
  })
  Object.values(dayCoverage).forEach(ids => {
    if (ids.length > 1) ids.forEach(id => conflictingIds.add(id))
  })

  const hasVisibleGhosts = allProjectTasks.some(t => {
    if (!t.committed || !t.committed_start) return false
    const cGang  = t.committed_gang_id  ?? t.gang_id  ?? 'Unassigned Gang'
    const cTrade = t.committed_trade     ?? t.trade    ?? 'Unassigned'
    if (cGang !== gang || cTrade !== trade) return false
    if (getDayIndex(t.committed_start, weekDays) < 0) return false
    const movedDate  = t.committed_start !== t.planned_start
    const movedGang  = t.committed_gang_id != null && t.committed_gang_id !== t.gang_id
    const movedTrade = t.committed_trade  != null && t.committed_trade  !== t.trade
    return movedDate || movedGang || movedTrade
  })

  const isEmpty = tasks.length === 0
  const maxStack = isEmpty ? 0 : Math.max(...Object.values(tasksByDay).map(a => a.length), 1)
  const baseHeight = isEmpty ? EMPTY_ROW_HEIGHT : Math.max(CARD_HEIGHT + 8, maxStack * (CARD_HEIGHT + CARD_GAP) + 8)
  const rowHeight = hasVisibleGhosts ? Math.max(baseHeight, CARD_HEIGHT + 8) : baseHeight

  function handleRename() {
    const name = renameValue.trim()
    if (name && name !== gang) onRenameGang(trade, gang, name)
    setIsRenaming(false)
  }

  return (
    <div className="flex border-b border-gray-300">
      {/* Gang label — sticky left */}
      <div
        style={{
          width: LABEL_WIDTH, flexShrink: 0,
          position: 'sticky', left: 0, zIndex: 3,
          minHeight: rowHeight,
          backgroundColor: '#f9fafb',
        }}
        className="px-3 py-2 border-r border-gray-200 flex items-center justify-between gap-1"
      >
        {isRenaming ? (
          <div className="flex flex-col gap-1 w-full" onPointerDown={e => e.stopPropagation()}>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleRename() }
                if (e.key === 'Escape') setIsRenaming(false)
              }}
              className="w-full px-2 py-0.5 text-xs rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="flex gap-1">
              <button onClick={handleRename}
                className="flex-1 text-xs py-0.5 rounded font-bold text-white"
                style={{ backgroundColor: '#1e3a5f' }}>✓</button>
              <button onClick={() => setIsRenaming(false)}
                className="flex-1 text-xs py-0.5 rounded border border-gray-300 text-gray-500">✕</button>
              <button
                onClick={() => setConfirmDeleteGang(true)}
                className="flex-1 text-xs py-0.5 rounded border font-medium"
                style={{ borderColor: '#d97706', color: '#d97706' }}
                title="Delete gang"
              >🗑</button>
            </div>
          </div>
        ) : (
          <>
            <span
              className="text-xs text-gray-700 font-semibold truncate flex-1 cursor-default"
              title={canEdit ? 'Double-click to rename' : gang}
              onDoubleClick={() => { if (canEdit) { setRenameValue(gang); setIsRenaming(true) } }}
            >{gang}</span>
            {incompleteHistoricCount > 0 && (
              <span
                title={`${incompleteHistoricCount} incomplete task${incompleteHistoricCount !== 1 ? 's' : ''} from previous weeks — navigate back using ‹ to find and reschedule them`}
                className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
                style={{ backgroundColor: '#d97706', color: 'white', fontSize: '0.6rem', minWidth: 16, height: 16, padding: '0 4px' }}
              >
                {incompleteHistoricCount}
              </span>
            )}
          </>
        )}
      </div>

      {/* Cards area — full 28-column width */}
      <div className="flex-1 relative" style={{ minHeight: rowHeight }}>
        {/* Droppable backgrounds */}
        <div className="absolute inset-0 flex">
          {weekDays.map((_, i) => (
            <DroppableCell
              key={i}
              id={`${trade}||${gang}||${i}`}
              isRecovery={i % 7 >= 5 || !!bankHolidayDayIndices?.has(i)}
              isNewWeek={i === 7 || i === 14 || i === 21}
            />
          ))}
        </div>

        {/* Task cards */}
        {tasks.map(task => {
          const dayIdx = getDayIndex(task.planned_start, weekDays)
          if (dayIdx < 0) return null
          const dayInWeek = dayIdx % 7
          const isWeekendStart = dayInWeek >= 5
          const { cols: duration, used: workingDaysUsed } = isWeekendStart
            ? { cols: 7 - dayInWeek, used: 0 }
            : weekLayout(dayIdx, task.duration_days || 1, bankHolidayDayIndices)
          const stackIndex = tasksByDay[dayIdx]?.indexOf(task) ?? 0
          const leftPct = (dayIdx / NUM_DAYS) * 100
          const widthPct = (duration / NUM_DAYS) * 100

          return (
            <DraggableCard
              key={task.isContinuation ? `${task.id}__cont_${task.planned_start}` : task.id}
              task={task}
              zones={zones}
              canEdit={canEdit}
              canLink={canLink}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onSegmentClick={onSegmentClick}
              visibleDays={duration}
              hasOverflow={!isWeekendStart && (task.duration_days || 1) > workingDaysUsed}
              isContinuation={!!task.isContinuation}
              isConflict={conflictingIds.has(task.id)}
              isBlocked={!!isTaskBlockedFn && isTaskBlockedFn(task)}
              allProjectTasks={allProjectTasks}
              taskDeps={depsByTaskId ? (depsByTaskId[task.id] || []) : []}
              onRemoveDependency={onRemoveDependency}
              linkingFromId={linkingFromId}
              onLinkAction={onLinkAction}
              startDayIdx={dayIdx}
              bankHolidayDayIndices={bankHolidayDayIndices}
              style={{
                position: 'absolute',
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                top: 4 + stackIndex * (CARD_HEIGHT + CARD_GAP),
                height: CARD_HEIGHT,
                zIndex: 2,
              }}
            />
          )
        })}

        {/* Ghost cards — committed baseline position for tasks moved after commitment.
            Anchored to the ORIGINAL (committed) gang so that cross-swimlane moves
            leave the ghost in the right row. Uses allProjectTasks so that a task
            moved to a different gang still generates a ghost here. */}
        {allProjectTasks
          .filter(t => {
            if (!t.committed || !t.committed_start) return false
            // committed_gang_id / committed_trade are set by migration 019.
            // Fall back to current gang_id / trade for pre-migration rows.
            const cGang  = t.committed_gang_id  ?? t.gang_id  ?? 'Unassigned Gang'
            const cTrade = t.committed_trade     ?? t.trade    ?? 'Unassigned'
            if (cGang !== gang || cTrade !== trade) return false
            // Only show a ghost when something has actually moved.
            const movedDate  = t.committed_start !== t.planned_start
            const movedGang  = t.committed_gang_id != null && t.committed_gang_id !== t.gang_id
            const movedTrade = t.committed_trade  != null && t.committed_trade  !== t.trade
            return movedDate || movedGang || movedTrade
          })
          .map(t => {
            const ghostDayIdx = getDayIndex(t.committed_start, weekDays)
            if (ghostDayIdx < 0) return null
            const ghostDayInWeek = ghostDayIdx % 7
            const { cols: ghostDur } = ghostDayInWeek >= 5
              ? { cols: 7 - ghostDayInWeek }
              : weekLayout(ghostDayIdx, t.duration_days || 1, bankHolidayDayIndices)
            const ghostLeft = (ghostDayIdx / NUM_DAYS) * 100
            const ghostWidth = (ghostDur / NUM_DAYS) * 100
            const zoneColor = zones.find(z => z.name === t.zone)?.color || '#94a3b8'
            return (
              <div
                key={`ghost-${t.id}`}
                style={{
                  position: 'absolute',
                  left: `calc(${ghostLeft}% + 2px)`,
                  width: `calc(${ghostWidth}% - 4px)`,
                  top: 4,
                  height: CARD_HEIGHT,
                  border: `2px dashed ${zoneColor}`,
                  borderRadius: 8,
                  opacity: 0.4,
                  backgroundColor: zoneColor + '18',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
                title={`Committed position: ${t.committed_start}`}
              />
            )
          })
        }

        {/* Empty cell + buttons */}
        {canEdit && weekDays.map((d, i) => {
          if (tasksByDay[i]?.length || creatingAtDay === i) return null
          return (
            <button
              key={i}
              onClick={() => setCreatingAtDay(i)}
              className="absolute flex items-center justify-center text-gray-200 hover:text-blue-300 transition-colors"
              style={{ left: `${(i / NUM_DAYS) * 100}%`, width: `${100 / NUM_DAYS}%`, top: 0, bottom: 0, fontSize: '1.4rem', zIndex: 1 }}
              title={`Add task — ${DAY_NAMES[i % 7]}`}
            >+</button>
          )
        })}

        {/* Inline ghost card for new task creation */}
        {creatingAtDay !== null && (
          <GhostCard
            zones={zones}
            style={{ position: 'absolute', left: `calc(${(creatingAtDay / NUM_DAYS) * 100}% + 2px)`, top: 4 }}
            onSave={({ title, duration_days, zone }) => {
              onCreateTask({
                trade: trade === 'Unassigned' ? null : trade,
                gang_id: gang === 'Unassigned Gang' ? null : gang,
                planned_start: dateToISO(weekDays[creatingAtDay]),
                title,
                duration_days,
                zone,
              })
              setCreatingAtDay(null)
            }}
            onCancel={() => setCreatingAtDay(null)}
          />
        )}
      </div>
      {confirmDeleteGang && (
        <ConfirmModal
          title={`Delete "${gang}"?`}
          message={tasks.length > 0
            ? `This will permanently delete the gang and its ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`
            : 'This gang has no tasks and will be permanently removed.'}
          confirmLabel="Delete gang"
          onConfirm={() => { setConfirmDeleteGang(false); setIsRenaming(false); onDeleteGang(trade, gang) }}
          onCancel={() => setConfirmDeleteGang(false)}
        />
      )}
    </div>
  )
}

function TradeGroup({ trade, gangs, tasks, weekDays, zones, canEdit, canLink, onUpdate, onDelete, onSegmentClick, onCreateTask, onAddGang, onRenameGang, onDeleteGang, activeId, allProjectTasks, taskMap, isTaskBlockedFn, depsByTaskId, onRemoveDependency, linkingFromId, onLinkAction, forceExpand, incompleteHistoricByGang, bankHolidayDayIndices }) {
  const [isAddingGang, setIsAddingGang] = useState(false)
  const [newGangName, setNewGangName] = useState('')
  const tradeTaskCount = tasks.filter(t => (t.trade || 'Unassigned') === trade && !t.isContinuation).length
  const tradeHasHistoric = Object.keys(incompleteHistoricByGang || {}).some(k => k.startsWith(`${trade}|||`))
  const isEmpty = tradeTaskCount === 0 && !tradeHasHistoric
  // A trade with no gangs yet must stay expanded so the user can see "+ Add gang".
  // Also don't auto-collapse when exactly one gang exists — it was just created.
  const canCollapse = gangs.length > 0
  const [collapsed, setCollapsed] = useState(isEmpty && gangs.length > 1)

  // Expand when a dependency involves a task in this trade
  useEffect(() => {
    if (forceExpand) setCollapsed(false)
  }, [forceExpand])

  function handleAddGang() {
    const name = newGangName.trim()
    if (!name) return
    onAddGang(trade, name)
    setNewGangName('')
    setIsAddingGang(false)
  }

  return (
    <div className="border-b-2 border-gray-400">
      {/* Trade header — label sticky-left, rest scrolls */}
      <div
        className="flex items-center hover:bg-gray-50 cursor-pointer"
        style={{ backgroundColor: '#1e3a5f08' }}
        onClick={() => setCollapsed(v => !v)}
      >
        <div
          style={{
            width: LABEL_WIDTH, flexShrink: 0,
            position: 'sticky', left: 0, zIndex: 3,
            backgroundColor: '#f3f4f6',
          }}
          className="flex items-center gap-2 px-3 py-2"
        >
          <span className="text-sm font-bold" style={{ color: isEmpty ? '#9ca3af' : '#1e3a5f' }}>{trade}</span>
          {!isEmpty && (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: '#1e3a5f20', color: '#1e3a5f' }}>
              {tradeTaskCount}
            </span>
          )}
          <span className="text-xs" style={{ color: isEmpty ? '#d1d5db' : '#9ca3af' }}>
            {isEmpty ? '— no tasks' : collapsed ? '▶' : '▼'}
          </span>
        </div>
        <div className="flex-1 min-h-[36px]" />
      </div>

      {!collapsed && (
        <>
          {gangs.map(gang => (
            <GangRow
              key={gang}
              trade={trade}
              gang={gang}
              tasks={tasks.filter(t =>
                (t.trade || 'Unassigned') === trade &&
                (t.gang_id || 'Unassigned Gang') === gang
              )}
              weekDays={weekDays}
              zones={zones}
              canEdit={canEdit}
              canLink={canLink}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onSegmentClick={onSegmentClick}
              onCreateTask={onCreateTask}
              onRenameGang={onRenameGang}
              onDeleteGang={onDeleteGang}
              activeId={activeId}
              allProjectTasks={allProjectTasks}
              taskMap={taskMap}
              isTaskBlockedFn={isTaskBlockedFn}
              depsByTaskId={depsByTaskId}
              onRemoveDependency={onRemoveDependency}
              linkingFromId={linkingFromId}
              onLinkAction={onLinkAction}
              incompleteHistoricCount={incompleteHistoricByGang?.[`${trade}|||${gang}`] || 0}
              bankHolidayDayIndices={bankHolidayDayIndices}
            />
          ))}

          {/* Add gang row — always visible to admins/planners */}
          {canEdit && (
            <div className="flex border-b border-gray-300">
              <div
                style={{
                  width: LABEL_WIDTH, flexShrink: 0,
                  position: 'sticky', left: 0, zIndex: 3,
                  backgroundColor: '#f9fafb',
                }}
                className="px-3 py-2 border-r border-gray-200"
                onPointerDown={e => e.stopPropagation()}
              >
                {isAddingGang ? (
                  <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={newGangName}
                      onChange={e => setNewGangName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleAddGang() }
                        if (e.key === 'Escape') { setIsAddingGang(false); setNewGangName('') }
                      }}
                      placeholder="Gang name…"
                      className="w-full px-2 py-1 text-xs rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={handleAddGang}
                        className="flex-1 text-xs py-0.5 rounded font-bold text-white"
                        style={{ backgroundColor: '#1e3a5f' }}
                      >✓</button>
                      <button
                        onClick={() => { setIsAddingGang(false); setNewGangName('') }}
                        className="flex-1 text-xs py-0.5 rounded border border-gray-300 text-gray-500"
                      >✕</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={e => { e.stopPropagation(); setIsAddingGang(true) }}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors w-full"
                  >
                    <span className="text-base leading-none">+</span>
                    <span>Add gang</span>
                  </button>
                )}
              </div>
              <div className="flex-1" style={{ backgroundColor: '#f9fafb' }} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Daily Review Panel ────────────────────────────────────────────────────────
function DailyReviewPanel({ projectId, bankHolidaySet, rncCategories, onClose }) {
  const queryClient = useQueryClient()

  // Default review date: yesterday (skip weekends)
  const defaultDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const dow = d.getDay()
    if (dow === 0) d.setDate(d.getDate() - 2)
    if (dow === 6) d.setDate(d.getDate() - 1)
    return dateToISO(d)
  })()
  const [reviewDate, setReviewDate] = useState(defaultDate)

  // All committed WWP tasks for this project
  const { data: committedTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['rnc-committed-tasks', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('id, title, trade, gang_id, committed_start, duration_days, day_statuses, committed')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
        .eq('committed', true)
      if (error) throw error
      return data || []
    },
  })

  // Existing RNC entries for the review date
  const { data: existingRNC = [], refetch: refetchRNC } = useQuery({
    queryKey: ['rnc-entries-date', projectId, reviewDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rnc_entries')
        .select('id, phase_task_id, category, notes')
        .eq('project_id', projectId)
        .eq('entry_date', reviewDate)
      if (error) throw error
      return data || []
    },
    enabled: !!reviewDate,
  })

  const loggedTaskIds = new Set(existingRNC.map(e => e.phase_task_id))

  // Determine which tasks need review on the selected date
  const tasksNeedingReview = useMemo(() => {
    return committedTasks.filter(task => {
      if (!task.committed_start) return false
      const dayIdx = workingDaysBetween(task.committed_start, reviewDate, bankHolidaySet)
      if (dayIdx < 0 || dayIdx >= (task.duration_days || 1)) return false
      const statuses = task.day_statuses || []
      return statuses[dayIdx] !== 'complete'
    })
  }, [committedTasks, reviewDate, bankHolidaySet])

  const pending = tasksNeedingReview.filter(t => !loggedTaskIds.has(t.id))
  const logged  = tasksNeedingReview.filter(t => loggedTaskIds.has(t.id))

  // Per-task selection state { taskId: { category, notes } }
  const [selections, setSelections] = useState({})

  function setSelection(taskId, field, value) {
    setSelections(s => ({ ...s, [taskId]: { ...(s[taskId] || {}), [field]: value } }))
  }

  const saveRNC = useMutation({
    mutationFn: async (entries) => {
      const { error } = await supabase.from('rnc_entries').insert(
        entries.map(({ taskId, category, notes }) => ({
          project_id: projectId,
          phase_task_id: taskId,
          entry_date: reviewDate,
          category,
          notes: notes || null,
        }))
      )
      if (error) throw error
    },
    onSuccess: () => {
      setSelections({})
      refetchRNC()
      queryClient.invalidateQueries({ queryKey: ['rnc-entries-date', projectId] })
      queryClient.invalidateQueries({ queryKey: ['ppc'] })
    },
  })

  function handleSubmit() {
    const entries = pending
      .filter(t => selections[t.id]?.category)
      .map(t => ({ taskId: t.id, ...selections[t.id] }))
    if (entries.length) saveRNC.mutate(entries)
  }

  const readyCount = pending.filter(t => selections[t.id]?.category).length

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Daily Review</h2>
            <p className="text-xs text-gray-500 mt-0.5">Log reasons for incomplete task segments</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1">×</button>
        </div>

        {/* Date picker */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <label className="text-xs font-medium text-gray-600 block mb-1">Review date</label>
          <input
            type="date"
            value={reviewDate}
            onChange={e => setReviewDate(e.target.value)}
            max={defaultDate}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tasksLoading && (
            <p className="text-sm text-gray-400 text-center py-8">Loading tasks…</p>
          )}

          {!tasksLoading && tasksNeedingReview.length === 0 && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2">✓</div>
              <p className="text-sm font-semibold text-gray-700">All tasks complete</p>
              <p className="text-xs text-gray-400 mt-1">No incomplete committed segments on {reviewDate}</p>
            </div>
          )}

          {/* Pending — need RNC */}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                Needs RNC ({pending.length})
              </p>
              <div className="space-y-3">
                {pending.map(task => (
                  <div key={task.id} className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{task.title}</p>
                      {(task.trade || task.gang_id) && (
                        <p className="text-xs text-gray-500">{[task.trade, task.gang_id].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {rncCategories.map(cat => {
                        const sel = selections[task.id]?.category === cat.value
                        return (
                          <label
                            key={cat.value}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-all"
                            style={{
                              borderColor: sel ? (cat.colour || '#1e3a5f') : '#e5e7eb',
                              backgroundColor: sel ? `${cat.colour || '#1e3a5f'}18` : 'white',
                            }}
                          >
                            <input
                              type="radio"
                              name={`rnc-${task.id}`}
                              value={cat.value}
                              checked={sel}
                              onChange={() => setSelection(task.id, 'category', cat.value)}
                              className="w-3.5 h-3.5 flex-shrink-0"
                            />
                            <span className="text-xs font-medium text-gray-800">{cat.label}</span>
                          </label>
                        )
                      })}
                    </div>
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={selections[task.id]?.notes || ''}
                      onChange={e => setSelection(task.id, 'notes', e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Already logged */}
          {logged.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Already logged ({logged.length})
              </p>
              <div className="space-y-1.5">
                {logged.map(task => {
                  const entry = existingRNC.find(e => e.phase_task_id === task.id)
                  const cat = rncCategories.find(c => c.value === entry?.category)
                  return (
                    <div key={task.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                      <div>
                        <p className="text-xs font-medium text-gray-700">{task.title}</p>
                        {task.trade && <p className="text-xs text-gray-400">{task.trade}</p>}
                      </div>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                        style={{ backgroundColor: `${cat?.colour || '#6b7280'}20`, color: cat?.colour || '#6b7280' }}
                      >
                        {cat?.label || entry?.category}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {pending.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-200 flex-shrink-0">
            <button
              onClick={handleSubmit}
              disabled={readyCount === 0 || saveRNC.isPending}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40 transition-all min-h-[48px]"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              {saveRNC.isPending
                ? 'Saving…'
                : readyCount === 0
                  ? `Select a reason for ${pending.length} task${pending.length !== 1 ? 's' : ''}`
                  : `Log ${readyCount} RNC entr${readyCount !== 1 ? 'ies' : 'y'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main board ───────────────────────────────────────────────────────────────

export default function WWPBoard() {
  const { projectId } = useParams()
  const { data: membership } = useMyProjectRole(projectId)
  const role = membership?.role
  const assignedTrades = membership?.assigned_trades || []
  const { data: project } = useProject(projectId)
  const queryClient = useQueryClient()
  const canEdit = ['project_admin', 'planner', 'trade_supervisor'].includes(role)
  const canEditTrade = (tradeName) =>
    role === 'project_admin' || role === 'planner'
    || (role === 'trade_supervisor' && assignedTrades.includes(tradeName))
  const canUncommit = role === 'project_admin'
  const canRecalcPPC = role === 'project_admin'

  const [weekOffset, setWeekOffset] = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [activeTask, setActiveTask] = useState(null)
  const [activeZones, setActiveZones] = useState([])
  const scrollRef = useRef(null)
  const gridAreaRef = useRef(null)
  const [showDependencies, setShowDependencies] = useState(false)
  const [activeMetricFilter, setActiveMetricFilter] = useState(null) // null | 'rescheduling' | 'conflicts'
  const [weekendBlockMsg, setWeekendBlockMsg] = useState(false)
  const [showDailyReview, setShowDailyReview] = useState(false)
  const [pendingCommitWeek, setPendingCommitWeek] = useState(null)
  const [pendingUncommitWeek, setPendingUncommitWeek] = useState(null)
  const [showRecalcPanel, setShowRecalcPanel] = useState(false)
  const recalcPanelRef = useRef(null)
  const [linkingFrom, setLinkingFrom] = useState(null)   // full task object, or null
  const [pendingLink, setPendingLink] = useState(null)

  // Cancel linking mode on Escape
  useEffect(() => {
    if (!linkingFrom) return
    const handler = (e) => { if (e.key === 'Escape') setLinkingFrom(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [linkingFrom])

  // Reset horizontal scroll when the 4-week window shifts
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0
  }, [weekOffset])

  // Close PPC recalc panel on outside click
  useEffect(() => {
    if (!showRecalcPanel) return
    const handler = (e) => {
      if (recalcPanelRef.current && !recalcPanelRef.current.contains(e.target))
        setShowRecalcPanel(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [showRecalcPanel])


  // ── Real-time collaborative sync ──────────────────────────────────────────
  // Subscribe to DB changes for this project and invalidate the relevant
  // React Query caches so every connected device stays in sync automatically.
  useEffect(() => {
    if (!projectId) return
    const channel = supabase
      .channel(`wwp-board-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'phase_tasks',      filter: `project_id=eq.${projectId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi',      projectId] })
        queryClient.invalidateQueries({ queryKey: ['wwp-all-tasks',        projectId] })
        queryClient.invalidateQueries({ queryKey: ['rnc-committed-tasks',  projectId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wwp_commits',      filter: `project_id=eq.${projectId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['wwp-commits',          projectId] })
        queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi',      projectId] })
        queryClient.invalidateQueries({ queryKey: ['wwp-all-tasks',        projectId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones',       filter: `project_id=eq.${projectId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['milestones',           projectId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_dependencies',filter: `project_id=eq.${projectId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['task-dependencies',    projectId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ppc',        filter: `project_id=eq.${projectId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['daily-ppc',            projectId] })
        queryClient.invalidateQueries({ queryKey: ['daily-ppc-range',      projectId] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [projectId, queryClient])

  function handleToggleZone(zoneName) {
    if (zoneName === null) { setActiveZones([]); return }
    setActiveZones(prev => prev.includes(zoneName) ? prev.filter(z => z !== zoneName) : [...prev, zoneName])
  }

  const weekNumber = getWeekNumber() + weekOffset
  const weekDays = getWeekDays(weekOffset)   // 28 days

  const projectSettings = project?.settings || {}
  const zones = projectSettings.zones || []

  // Bank holidays — memoised Set of ISO date strings; also pre-computed as day indices for the current window
  const bankHolidayDates = projectSettings.bank_holidays || []
  const bankHolidaySet = useMemo(() => new Set(bankHolidayDates), [bankHolidayDates])
  const bankHolidayDayIndices = useMemo(() => new Set(
    weekDays.reduce((acc, d, i) => {
      if (bankHolidaySet.has(dateToISO(d))) acc.push(i)
      return acc
    }, [])
  ), [weekDays, bankHolidaySet])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  // ── Query — fetch by date range (immune to week_number mismatches) ──
  const viewStartISO = dateToISO(weekDays[0])
  const viewEndISO   = dateToISO(weekDays[NUM_DAYS - 1])
  const prevWeekMonday = new Date(weekDays[0])
  prevWeekMonday.setDate(prevWeekMonday.getDate() - 7)
  const prevWeekStartISO = dateToISO(prevWeekMonday)

  // One ISO Set per week for fast membership testing
  const weekISOSets = Array.from({ length: NUM_WEEKS }, (_, wi) =>
    new Set(weekDays.slice(wi * 7, (wi + 1) * 7).map(d => dateToISO(d)))
  )

  const { data: allQueryTasks = [], isLoading } = useQuery({
    queryKey: ['wwp-tasks-multi', projectId, viewStartISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
        .gte('planned_start', prevWeekStartISO)
        .lte('planned_start', viewEndISO)
        .order('position', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  })

  // Split by actual planned_start date — not stored week_number
  const weekTaskGroups = weekISOSets.map(isoSet =>
    allQueryTasks.filter(t => t.planned_start && isoSet.has(t.planned_start))
  )
  const prevWeekTasks = allQueryTasks.filter(t =>
    t.planned_start && !weekISOSets.some(s => s.has(t.planned_start))
  )

  // ── RNC review badge — tasks with incomplete committed segments yesterday ──
  const rncCategories = projectSettings.rnc_categories?.length
    ? projectSettings.rnc_categories
    : RNC_CATEGORIES.map(c => ({ ...c, colour: '#6b7280' }))


  // ── Daily PPC — "yesterday" = most recent working day ──
  const yesterdayISO = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const dow = d.getDay()
    if (dow === 0) d.setDate(d.getDate() - 2) // Sun → Fri
    if (dow === 6) d.setDate(d.getDate() - 1) // Sat → Fri
    return dateToISO(d)
  })()

  const { data: yesterdayPPC } = useQuery({
    queryKey: ['daily-ppc', projectId, yesterdayISO],
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_ppc')
        .select('ppc_percent, planned_count, complete_count, calculated_at')
        .eq('project_id', projectId)
        .eq('calc_date', yesterdayISO)
        .maybeSingle()
      return data
    },
    enabled: !!projectId,
  })

  // Range query — PPC for every date in the current 4-week view
  const { data: viewPPCRecords = [] } = useQuery({
    queryKey: ['daily-ppc-range', projectId, viewStartISO, viewEndISO],
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_ppc')
        .select('calc_date, ppc_percent, planned_count, complete_count')
        .eq('project_id', projectId)
        .gte('calc_date', viewStartISO)
        .lte('calc_date', viewEndISO)
      return data || []
    },
    enabled: !!projectId,
  })
  const ppcByDate = Object.fromEntries(viewPPCRecords.map(r => [r.calc_date, r]))

  const recalcPPC = useMutation({
    mutationFn: async (date) => {
      const { data, error } = await supabase.rpc('recalc_daily_ppc', {
        p_project_id: projectId,
        p_date: date,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-ppc', projectId] })
      queryClient.invalidateQueries({ queryKey: ['daily-ppc-range', projectId] })
    },
    onError: (err) => {
      alert(`Failed to recalculate PPC: ${err.message}`)
    },
  })

  function ppcColour(pct) {
    if (pct === null || pct === undefined) return '#6b7280'
    if (pct >= 80) return '#059669'
    if (pct >= 60) return '#d97706'
    return '#dc2626'
  }

  // ── Commits — which weeks are locked ──
  const viewWeekNumbers = Array.from({ length: NUM_WEEKS }, (_, i) => weekNumber + i)
  const { data: commits = [] } = useQuery({
    queryKey: ['wwp-commits', projectId, weekNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wwp_commits')
        .select('week_number, committed_at, is_auto')
        .eq('project_id', projectId)
        .in('week_number', viewWeekNumbers)
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
  const committedWeeks = new Set(commits.map(c => c.week_number))

  const commitWeek = useMutation({
    mutationFn: async (wkNum) => {
      const { data, error } = await supabase.rpc('commit_week_now', {
        p_project_id: projectId,
        p_week_number: wkNum,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wwp-commits', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-all-tasks', projectId] })
    },
    onError: (err) => {
      alert(`Failed to commit week: ${err.message}\n\nMake sure migrations 009 and 010 have been run in Supabase.`)
    },
  })

  const uncommitWeek = useMutation({
    mutationFn: async (wkNum) => {
      const { data, error } = await supabase.rpc('uncommit_week', {
        p_project_id: projectId,
        p_week_number: wkNum,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wwp-commits', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-all-tasks', projectId] })
    },
    onError: (err) => {
      alert(`Failed to unlock week: ${err.message}\n\nMake sure migration 013 has been run in Supabase.`)
    },
  })

  // ── Milestones ──
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('milestones').select('*')
        .eq('project_id', projectId)
        .order('planned_date', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  // ── All project WWP tasks — for name lookup & taskMap ──
  const { data: allProjectTasks = [] } = useQuery({
    queryKey: ['wwp-all-tasks', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
        .order('planned_start', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  // ── Task dependencies (junction table) ──
  const { data: dependencies = [] } = useQuery({
    queryKey: ['task-dependencies', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_dependencies')
        .select('id, task_id, predecessor_id, lag_days')
        .eq('project_id', projectId)
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  const depsByTaskId = useMemo(() => {
    const map = {}
    dependencies.forEach(d => {
      if (!map[d.task_id]) map[d.task_id] = []
      map[d.task_id].push(d)
    })
    return map
  }, [dependencies])

  const dependencyTaskIds = useMemo(() => {
    const ids = new Set()
    dependencies.forEach(d => { ids.add(d.task_id); ids.add(d.predecessor_id) })
    return ids
  }, [dependencies])

  // Count incomplete tasks from before the current 4-week view, keyed by "trade|||gang"
  const incompleteHistoricByGang = useMemo(() => {
    const map = {}
    allProjectTasks.forEach(t => {
      if (!t.planned_start || t.planned_start >= viewStartISO) return
      if (t.status === 'complete') return
      // For tasks that spill into the current view, only flag if the days that fell
      // before the view start are not all complete
      const viewStart = new Date(viewStartISO)
      const dur = t.duration_days || 1
      let daysBeforeView = 0
      const cursor = new Date(t.planned_start)
      let workingDaysCounted = 0
      while (workingDaysCounted < dur) {
        const dow = cursor.getDay()
        if (dow !== 0 && dow !== 6) {
          if (cursor < viewStart) daysBeforeView++
          workingDaysCounted++
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      // Task ends entirely before the view — falls through to be counted below
      // Task spills into the view — only flag if its pre-view days aren't all complete
      if (daysBeforeView < dur) {
        if (daysBeforeView === 0) return // task starts in current view, shouldn't be here
        const statuses = t.day_statuses || []
        const priorDaysComplete = Array.from({ length: daysBeforeView }, (_, i) => statuses[i] || 'not_started').every(s => s === 'complete')
        if (priorDaysComplete) return
      }
      const key = `${t.trade || 'Unassigned'}|||${t.gang_id || 'Unassigned Gang'}`
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [allProjectTasks, viewStartISO])

  // ── Realtime ──
  useEffect(() => {
    const channel = supabase
      .channel(`wwp-${projectId}-${viewStartISO}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'phase_tasks',
        filter: `project_id=eq.${projectId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
        queryClient.invalidateQueries({ queryKey: ['wwp-all-tasks', projectId] })
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'task_dependencies',
        filter: `project_id=eq.${projectId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['task-dependencies', projectId] })
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [projectId, viewStartISO, queryClient])

  const updateTask = useMutation({
    mutationFn: async ({ id, ...updates }) => {
      const { error } = await supabase.from('phase_tasks').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-all-tasks', projectId] })
    },
  })

  // ── Overflow continuations ──
  function getOverflowContinuation(sourceTasks, targetStartISO) {
    // Advance past bank holidays at the start of the target week so the
    // continuation card lands on the first actual working day — matching how
    // SAT/SUN appear as empty grid cells rather than being inside a card.
    let actualStartISO = targetStartISO
    while (isNonWorkingISO(actualStartISO, bankHolidaySet)) {
      const d = new Date(actualStartISO + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      actualStartISO = dateToISO(d)
    }

    return sourceTasks.flatMap(task => {
      if (!task.planned_start || !task.duration_days) return []
      const dayIdx = getDayIndex(task.planned_start, weekDays)

      let used
      if (dayIdx >= 0 && dayIdx % 7 < 5) {
        // Task starts within the visible grid — use weekLayout
        ({ used } = weekLayout(dayIdx, task.duration_days, bankHolidayDayIndices))
      } else if (dayIdx < 0) {
        // Task starts before the visible grid — count working days consumed
        // from planned_start up to (but not including) the target week start.
        used = 0
        const cur = new Date(task.planned_start + 'T00:00:00')
        const target = new Date(targetStartISO + 'T00:00:00')
        while (cur < target && used < task.duration_days) {
          if (!isNonWorkingISO(dateToISO(cur), bankHolidaySet)) used++
          cur.setDate(cur.getDate() + 1)
        }
      } else {
        return []
      }

      const remaining = task.duration_days - used
      if (remaining <= 0) return []
      return [{ ...task, planned_start: actualStartISO, duration_days: Math.min(remaining, 5), isContinuation: true, continuationOffset: used, fullDuration: task.duration_days }]
    })
  }

  // ── Intra-week bank-holiday fragments ──
  // When a bank holiday falls mid-week inside a task's span, weekLayout stops `cols` before it.
  // The working days after the bank holiday (still in the same week) need their own card fragments,
  // rendered as continuation cards — exactly like how SAT/SUN cause a split to next Monday.
  function getIntraWeekFragments(sourceTasks) {
    return sourceTasks.flatMap(task => {
      if (!task.planned_start || !task.duration_days) return []
      const dayIdx = getDayIndex(task.planned_start, weekDays)
      if (dayIdx < 0 || dayIdx % 7 >= 5) return []

      const fridayIdx = Math.floor(dayIdx / 7) * 7 + 4
      const totalDays = task.fullDuration || task.duration_days || 1
      let cumulativeOffset = task.continuationOffset || 0
      let remaining = totalDays - cumulativeOffset

      // Advance past the first contiguous working span (the primary card covers it).
      let currentIdx = dayIdx
      while (currentIdx <= fridayIdx && !bankHolidayDayIndices?.has(currentIdx) && remaining > 0) {
        currentIdx++
        remaining--
        cumulativeOffset++
      }
      // Skip the bank holiday(s) that terminated the first span.
      while (currentIdx <= fridayIdx && bankHolidayDayIndices?.has(currentIdx)) currentIdx++

      // Generate a fragment for each contiguous working span after a bank holiday.
      const fragments = []
      while (remaining > 0 && currentIdx <= fridayIdx) {
        let segUsed = 0
        for (let i = currentIdx; i <= fridayIdx && segUsed < remaining; i++) {
          if (bankHolidayDayIndices?.has(i)) break
          segUsed++
        }
        if (segUsed === 0) { currentIdx++; continue }  // another bank holiday, skip

        fragments.push({
          ...task,
          planned_start: dateToISO(weekDays[currentIdx]),
          duration_days: segUsed,
          isContinuation: true,
          continuationOffset: cumulativeOffset,
          fullDuration: totalDays,
        })

        cumulativeOffset += segUsed
        remaining -= segUsed
        currentIdx += segUsed
        // Skip any trailing bank holidays before the next fragment.
        while (currentIdx <= fridayIdx && bankHolidayDayIndices?.has(currentIdx)) currentIdx++
      }
      return fragments
    })
  }

  const weekStartISOs = Array.from({ length: NUM_WEEKS }, (_, wi) => dateToISO(weekDays[wi * 7]))

  const continuations = [
    getOverflowContinuation(prevWeekTasks, weekStartISOs[0]),
    ...weekTaskGroups.slice(0, -1).map((wt, wi) => getOverflowContinuation(wt, weekStartISOs[wi + 1])),
  ].flat()

  const primaryTasks = [...weekTaskGroups.flat(), ...continuations]
  const allTasks = [...primaryTasks, ...getIntraWeekFragments(primaryTasks)]

  const dailyReviewCount = useMemo(() => {
    const yesterday = (() => {
      const d = new Date(); d.setDate(d.getDate() - 1)
      const dow = d.getDay()
      if (dow === 0) d.setDate(d.getDate() - 2)
      if (dow === 6) d.setDate(d.getDate() - 1)
      return dateToISO(d)
    })()
    return allTasks.filter(t => {
      if (!t.committed || !t.committed_start || t.isContinuation) return false
      const dayIdx = workingDaysBetween(t.committed_start, yesterday, bankHolidaySet)
      if (dayIdx < 0 || dayIdx >= (t.duration_days || 1)) return false
      const statuses = t.day_statuses || []
      return statuses[dayIdx] !== 'complete'
    }).length
  }, [allTasks, bankHolidaySet])

  // ── Dependency helpers ──
  const taskMap = useMemo(() =>
    Object.fromEntries(allProjectTasks.map(t => [t.id, t])),
    [allProjectTasks]
  )

  function isTaskBlocked(task) {
    const deps = depsByTaskId[task.id] || []
    if (!deps.length) return false
    // Blocked if ANY predecessor hasn't met its completion requirement
    return deps.some(dep => {
      const pred = taskMap[dep.predecessor_id]
      if (!pred) return false
      const requiredDays = dep.lag_days > 0 ? dep.lag_days : (pred.duration_days || 1)
      const completedDays = (pred.day_statuses || []).filter(s => s === 'complete').length
      return completedDays < requiredDays
    })
  }

  // ── Trade / gang structure — settings-first ──
  // Configured trades from project settings drive the swimlane order.
  // Tasks that exist outside the configured structure still appear (appended).
  const rawTrades = projectSettings.trades?.length ? projectSettings.trades : DEFAULT_TRADES
  const configuredTrades = rawTrades.map(t =>
    typeof t === 'string' ? { name: t, gangs: [] } : t
  )
  const tradeList = []
  const gangsByTrade = {}
  configuredTrades.forEach(ct => {
    tradeList.push(ct.name)
    gangsByTrade[ct.name] = new Set(ct.gangs || [])
  })
  allTasks.filter(t => !t.isContinuation).forEach(t => {
    const trade = t.trade || 'Unassigned'
    const gang  = t.gang_id || 'Unassigned Gang'
    if (!tradeList.includes(trade)) tradeList.push(trade)
    if (!gangsByTrade[trade]) gangsByTrade[trade] = new Set()
    gangsByTrade[trade].add(gang)
  })
  // Also ensure gangs with historic incomplete tasks are present in the structure,
  // even if they have no tasks in the current 4-week view.
  Object.keys(incompleteHistoricByGang).forEach(key => {
    const [trade, gang] = key.split('|||')
    if (!tradeList.includes(trade)) tradeList.push(trade)
    if (!gangsByTrade[trade]) gangsByTrade[trade] = new Set()
    gangsByTrade[trade].add(gang)
  })

  // Sort: trades that have tasks in the current 4-week view appear first;
  // empty trades (no tasks this period) sink to the bottom. Relative order
  // within each group is preserved.
  const tradeHasActiveTasks = (tradeName) =>
    allTasks.some(t => !t.isContinuation && (t.trade || 'Unassigned') === tradeName) ||
    Object.keys(incompleteHistoricByGang).some(k => k.startsWith(`${tradeName}|||`))
  const sortedTradeList = [
    ...tradeList.filter(t => tradeHasActiveTasks(t)),
    ...tradeList.filter(t => !tradeHasActiveTasks(t)),
  ]

  // ── Drag handlers ──
  function handleDragStart({ active }) {
    const realId = String(active.id).replace('__cont', '')
    setActiveId(realId)
    setActiveTask(allTasks.find(t => t.id === realId && !t.isContinuation) || null)
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    setActiveTask(null)
    if (!over) return
    const parts = String(over.id).split('||')
    if (parts.length !== 3) return
    const [targetTrade, targetGang, dayIdxStr] = parts
    const dayIdx = parseInt(dayIdxStr, 10)
    const targetDay = weekDays[dayIdx]
    if (!targetDay || isNaN(dayIdx)) return

    // Block drops onto Saturday, Sunday, or a configured bank holiday
    if (dayIdx % 7 >= 5 || bankHolidayDayIndices.has(dayIdx)) {
      setWeekendBlockMsg(true)
      setTimeout(() => setWeekendBlockMsg(false), 6000)
      return
    }

    const realId = String(active.id).replace('__cont', '')
    const task = allTasks.find(t => t.id === realId && !t.isContinuation)
    if (!task) return
    const newStart   = dateToISO(targetDay)
    const newTrade   = targetTrade === 'Unassigned' ? null : targetTrade
    const newGang    = targetGang === 'Unassigned Gang' ? null : targetGang
    const newWeekNum = getWeekNumber(targetDay)
    if (task.planned_start !== newStart || task.trade !== newTrade || task.gang_id !== newGang) {
      updateTask.mutate({ id: task.id, planned_start: newStart, trade: newTrade, gang_id: newGang, week_number: newWeekNum })
    }
  }

  function handleSegmentClick(task, segIdx) {
    const fullDuration = task.fullDuration || task.duration_days || 1
    const offset = task.continuationOffset || 0
    const current = Array.from({ length: fullDuration }, (_, i) => task.day_statuses?.[i] || 'not_started')
    const adjustedIdx = offset + segIdx
    const currentStatus = current[adjustedIdx]

    let next
    if (currentStatus === 'not_started') {
      // Can only start a day once all previous days are complete
      const allPriorComplete = current.slice(0, adjustedIdx).every(s => s === 'complete')
      if (!allPriorComplete) return
      // Block first segment if task is waiting on a predecessor
      if (adjustedIdx === 0 && isTaskBlocked(task)) return
      next = 'in_progress'
    } else if (currentStatus === 'in_progress') {
      next = 'complete'
    } else {
      // Can only un-complete a day if no later days have been started
      const anyLaterStarted = current.slice(adjustedIdx + 1).some(s => s !== 'not_started')
      if (anyLaterStarted) return
      next = 'not_started'
    }

    const updated = [...current]
    updated[adjustedIdx] = next

    // Record when each segment status was last changed
    const currentTimestamps = Array.from({ length: fullDuration }, (_, i) => task.day_statuses_at?.[i] || null)
    const updatedTimestamps = [...currentTimestamps]
    updatedTimestamps[adjustedIdx] = new Date().toISOString()

    updateTask.mutate({ id: task.id, day_statuses: updated, day_statuses_at: updatedTimestamps, status: deriveStatus(updated) })
  }

  const deleteTask = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('phase_tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] }),
  })

  const saveDependency = useMutation({
    mutationFn: async ({ toTaskId, fromTaskId, lagDays }) => {
      const { error } = await supabase.from('task_dependencies')
        .upsert(
          { project_id: projectId, task_id: toTaskId, predecessor_id: fromTaskId, lag_days: lagDays },
          { onConflict: 'task_id,predecessor_id' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      setPendingLink(null)
      queryClient.invalidateQueries({ queryKey: ['task-dependencies', projectId] })
    },
    onError: (err) => {
      alert(`Failed to save dependency: ${err.message}\n\nMake sure migration 008_multi_task_dependencies.sql has been run in Supabase.`)
    },
  })

  const removeDependency = useMutation({
    mutationFn: async (depId) => {
      const { error } = await supabase.from('task_dependencies').delete().eq('id', depId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-dependencies', projectId] }),
  })

  function handleLinkAction(task) {
    if (task.isContinuation) return
    if (!linkingFrom) {
      // Start: store the full task object as the predecessor
      setLinkingFrom(task)
    } else if (linkingFrom.id === task.id) {
      // Cancel: clicked the same card again
      setLinkingFrom(null)
    } else {
      // Complete: open the lag-days modal
      setPendingLink({ fromTask: linkingFrom, toTask: task })
      setLinkingFrom(null)
    }
  }

  const renameGang = useMutation({
    mutationFn: async ({ tradeName, oldGang, newGang }) => {
      // 1. Rename in project settings
      const baseTrades = projectSettings.trades?.length ? projectSettings.trades : DEFAULT_TRADES
      const updatedTrades = baseTrades.map(t => {
        const tObj = typeof t === 'string' ? { name: t, gangs: [] } : t
        if (tObj.name !== tradeName) return tObj
        return { ...tObj, gangs: (tObj.gangs || []).map(g => g === oldGang ? newGang : g) }
      })
      const { error: settingsErr } = await supabase
        .from('projects')
        .update({ settings: { ...projectSettings, trades: updatedTrades } })
        .eq('id', projectId)
      if (settingsErr) throw settingsErr

      // 2. Rename on all tasks in this trade+gang
      const { error: taskErr } = await supabase
        .from('phase_tasks')
        .update({ gang_id: newGang })
        .eq('project_id', projectId)
        .eq('trade', tradeName)
        .eq('gang_id', oldGang)
      if (taskErr) throw taskErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
    },
  })

  const deleteGang = useMutation({
    mutationFn: async ({ tradeName, gangName }) => {
      // 1. Remove from project settings
      const baseTrades = projectSettings.trades?.length ? projectSettings.trades : DEFAULT_TRADES
      const updatedTrades = baseTrades.map(t => {
        const tObj = typeof t === 'string' ? { name: t, gangs: [] } : t
        if (tObj.name !== tradeName) return tObj
        return { ...tObj, gangs: (tObj.gangs || []).filter(g => g !== gangName) }
      })
      const { error: settingsErr } = await supabase
        .from('projects')
        .update({ settings: { ...projectSettings, trades: updatedTrades } })
        .eq('id', projectId)
      if (settingsErr) throw settingsErr

      // 2. Delete all tasks in this trade+gang
      const { error: taskErr } = await supabase
        .from('phase_tasks')
        .delete()
        .eq('project_id', projectId)
        .eq('trade', tradeName)
        .eq('gang_id', gangName)
      if (taskErr) throw taskErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] })
    },
  })

  const addGangToTrade = useMutation({
    mutationFn: async ({ tradeName, gangName }) => {
      const needsDefaults = !projectSettings.trades?.length
      const { error } = await supabase.rpc('add_gang_to_trade', {
        p_project_id: projectId,
        p_trade_name: tradeName,
        p_gang_name: gangName,
        p_default_trades: needsDefaults
          ? DEFAULT_TRADES.map(t => ({ name: t, gangs: [] }))
          : null,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (err) => alert(`Failed to add gang: ${err.message}`),
  })

  const createTask = useMutation({
    mutationFn: async ({ trade, gang_id, planned_start, title, duration_days, zone }) => {
      const d = new Date(planned_start + 'T00:00:00')
      const { error } = await supabase.from('phase_tasks').insert({
        project_id: projectId,
        phase: 'wwp',
        title,
        trade: trade || null,
        gang_id: gang_id || null,
        planned_start,
        duration_days,
        zone: zone || null,
        week_number: getWeekNumber(d),
        status: 'not_started',
        day_statuses: Array(duration_days).fill('not_started'),
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wwp-tasks-multi', projectId] }),
  })

  const totalIncompleteHistoric = Object.values(incompleteHistoricByGang).reduce((sum, n) => sum + n, 0)

  const { resourceConflictCount, conflictingTaskIds } = useMemo(() => {
    // Use the same day-coverage approach as GangRow so continuation cards are
    // included and results stay consistent with the per-card conflict indicator.
    const byGang = {}
    allTasks.filter(t => t.planned_start).forEach(t => {
      const key = `${t.trade || 'Unassigned'}|||${t.gang_id || 'Unassigned Gang'}`
      if (!byGang[key]) byGang[key] = []
      byGang[key].push(t)
    })
    const ids = new Set()
    const pairs = new Set()
    Object.values(byGang).forEach(tasks => {
      const dayCoverage = {}
      tasks.forEach(t => {
        const startIdx = getDayIndex(t.planned_start, weekDays)
        if (startIdx < 0) return
        const dayInWeek = startIdx % 7
        const isWeekendStart = dayInWeek >= 5
        const { cols: visibleDur } = isWeekendStart
          ? { cols: 7 - dayInWeek }
          : weekLayout(startIdx, t.duration_days || 1, bankHolidayDayIndices)
        for (let d = 0; d < visibleDur; d++) {
          const di = startIdx + d
          if (!dayCoverage[di]) dayCoverage[di] = []
          dayCoverage[di].push(t.id)
        }
      })
      Object.values(dayCoverage).forEach(taskIds => {
        if (taskIds.length < 2) return
        taskIds.forEach(id => ids.add(id))
        // Count unique conflicting pairs so 2 overlapping tasks = 1 conflict
        for (let i = 0; i < taskIds.length; i++) {
          for (let j = i + 1; j < taskIds.length; j++) {
            pairs.add([taskIds[i], taskIds[j]].sort().join('|'))
          }
        }
      })
    })
    return { resourceConflictCount: pairs.size, conflictingTaskIds: ids }
  }, [allTasks, weekDays])

  const { sequencingViolationCount, sequencingViolationIds } = useMemo(() => {
    let count = 0
    const ids = new Set()
    dependencies.forEach(dep => {
      const pred = taskMap[dep.predecessor_id]
      const task = taskMap[dep.task_id]
      if (!pred?.planned_start || !task?.planned_start) return
      const predWithLagEnd = workingDayEnd(
        pred.planned_start,
        (pred.duration_days || 1) + (dep.lag_days || 0),
        bankHolidaySet
      )
      if (new Date(task.planned_start + 'T00:00:00') <= predWithLagEnd) {
        count++
        ids.add(dep.task_id)
        ids.add(dep.predecessor_id)
      }
    })
    return { sequencingViolationCount: count, sequencingViolationIds: ids }
  }, [dependencies, taskMap, bankHolidaySet])

  const filteredTasks = (() => {
    let tasks = activeZones.length === 0 ? allTasks : allTasks.filter(t => activeZones.includes(t.zone))
    if (activeMetricFilter === 'conflicts') tasks = tasks.filter(t => conflictingTaskIds.has(t.id))
    if (activeMetricFilter === 'sequencing') tasks = tasks.filter(t => sequencingViolationIds.has(t.id))
    return tasks
  })()

  const filteredTaskIds = new Set(filteredTasks.map(t => t.id))
  const visibleDependencies = dependencies.filter(
    d => filteredTaskIds.has(d.task_id) && filteredTaskIds.has(d.predecessor_id)
  )

  const displayTradeList = activeMetricFilter === 'rescheduling'
    ? sortedTradeList.filter(t => Object.keys(incompleteHistoricByGang).some(k => k.startsWith(t + '|||')))
    : sortedTradeList

  const displayGangsByTrade = activeMetricFilter === 'rescheduling'
    ? Object.fromEntries(
        Object.entries(gangsByTrade).map(([trade, gangs]) => [
          trade,
          new Set([...gangs].filter(g => (incompleteHistoricByGang[`${trade}|||${g}`] || 0) > 0)),
        ])
      )
    : gangsByTrade

  const weekLabel = `Weeks ${weekNumber}–${weekNumber + NUM_WEEKS - 1} · ${weekDays[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${weekDays[NUM_DAYS - 1].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  return (
    <div className="flex flex-col h-full">

      {/* ── Weekend drop blocker toast ── */}
      {weekendBlockMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 px-5 py-4 rounded-xl shadow-xl border max-w-sm"
          style={{ backgroundColor: '#1e3a5f', borderColor: '#1e3a5f', color: 'white' }}>
          <span className="text-lg leading-none mt-0.5">🚫</span>
          <div>
            <p className="text-sm font-semibold">Non-working day</p>
            <p className="text-xs mt-1 opacity-80">This day is a weekend or bank holiday. To schedule work on this day, create a separate <span className="font-semibold">recovery task</span> using the + button on that day cell.</p>
          </div>
        </div>
      )}

      {/* ── Sticky page header ── */}
      <div className="bg-white border-b border-gray-200 shadow-sm pb-3 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3 px-1 pt-1">
          <div>
            <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">Weekly Work Plan</h1>
            <p className="text-sm text-gray-500 mt-0.5">{weekLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset(o => o - 1)}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 min-h-[48px] min-w-[48px] text-lg">‹</button>
            <button onClick={() => setWeekOffset(0)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 min-h-[48px] text-sm font-medium">This week</button>
            <button onClick={() => setWeekOffset(o => o + 1)}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 min-h-[48px] min-w-[48px] text-lg">›</button>
          </div>
        </div>

        <div className="flex gap-2 mb-3 flex-wrap mt-2 items-center">
          <button
            onClick={() => setActiveMetricFilter(f => f === 'rescheduling' ? null : 'rescheduling')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
            style={activeMetricFilter === 'rescheduling'
              ? { borderColor: '#d97706', backgroundColor: '#d97706', color: 'white' }
              : totalIncompleteHistoric > 0
                ? { borderColor: '#d9770660', backgroundColor: '#d9770610', color: '#d97706' }
                : { borderColor: '#d1d5db', backgroundColor: 'transparent', color: '#6b7280' }
            }
            title={activeMetricFilter === 'rescheduling' ? 'Clear filter' : 'Filter to gangs with incomplete tasks from previous weeks'}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeMetricFilter === 'rescheduling' ? 'white' : totalIncompleteHistoric > 0 ? '#d97706' : '#9ca3af' }} />
            Require rescheduling: {totalIncompleteHistoric}
          </button>
          <button
            onClick={() => setActiveMetricFilter(f => f === 'conflicts' ? null : 'conflicts')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
            style={activeMetricFilter === 'conflicts'
              ? { borderColor: '#dc2626', backgroundColor: '#dc2626', color: 'white' }
              : resourceConflictCount > 0
                ? { borderColor: '#dc262660', backgroundColor: '#dc262610', color: '#dc2626' }
                : { borderColor: '#d1d5db', backgroundColor: 'transparent', color: '#6b7280' }
            }
            title={activeMetricFilter === 'conflicts' ? 'Clear filter' : 'Filter to tasks with resource conflicts'}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeMetricFilter === 'conflicts' ? 'white' : resourceConflictCount > 0 ? '#dc2626' : '#9ca3af' }} />
            Resource conflicts: {resourceConflictCount}
          </button>

          <button
            onClick={() => setActiveMetricFilter(f => f === 'sequencing' ? null : 'sequencing')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
            style={activeMetricFilter === 'sequencing'
              ? { borderColor: '#7c3aed', backgroundColor: '#7c3aed', color: 'white' }
              : sequencingViolationCount > 0
                ? { borderColor: '#7c3aed60', backgroundColor: '#7c3aed10', color: '#7c3aed' }
                : { borderColor: '#d1d5db', backgroundColor: 'transparent', color: '#6b7280' }
            }
            title={activeMetricFilter === 'sequencing' ? 'Clear filter' : 'Filter to tasks with sequencing conflicts'}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeMetricFilter === 'sequencing' ? 'white' : sequencingViolationCount > 0 ? '#7c3aed' : '#9ca3af' }} />
            Sequencing conflicts: {sequencingViolationCount}
          </button>

          <button
            onClick={() => setShowDependencies(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
            style={showDependencies
              ? { borderColor: '#d97706', backgroundColor: '#d97706', color: 'white' }
              : dependencies.length > 0
                ? { borderColor: '#d9770660', backgroundColor: '#d9770610', color: '#d97706' }
                : { borderColor: '#d1d5db', backgroundColor: 'transparent', color: '#6b7280' }
            }
            title={showDependencies ? 'Hide dependency arrows' : dependencies.length === 0 ? 'No dependencies — hover a card and click ⊕ to link tasks' : 'Show dependency arrows'}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: showDependencies ? 'white' : dependencies.length > 0 ? '#d97706' : '#9ca3af' }} />
            Dependencies: {visibleDependencies.length}{visibleDependencies.length !== dependencies.length ? ` / ${dependencies.length}` : ''}
          </button>

          {/* Daily Review button */}
          <button
            onClick={() => setShowDailyReview(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all relative"
            style={dailyReviewCount > 0
              ? { borderColor: '#dc2626', backgroundColor: '#dc262610', color: '#dc2626' }
              : { borderColor: '#d1d5db', backgroundColor: 'transparent', color: '#6b7280' }
            }
            title="Open daily review to log RNC reasons for incomplete tasks"
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dailyReviewCount > 0 ? '#dc2626' : '#9ca3af' }} />
            Daily Review
            {dailyReviewCount > 0 && (
              <span className="ml-0.5 font-bold">{dailyReviewCount}</span>
            )}
          </button>

        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <ZoneLegend zones={zones} activeZones={activeZones} onToggleZone={handleToggleZone} />

          {canRecalcPPC && (
            <div className="relative ml-auto" ref={recalcPanelRef}>
              <button
                onClick={() => setShowRecalcPanel(p => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                ↻ Recalc PPC
              </button>

              {showRecalcPanel && (
                <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-xl shadow-xl border border-gray-200 w-72 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-700">Recalculate Daily PPC</p>
                    <p className="text-xs text-gray-400 mt-0.5">Only committed weeks · bank holidays skipped</p>
                  </div>

                  {viewWeekNumbers.map((wkNum, wi) => {
                    const isCommitted = committedWeeks.has(wkNum)
                    return (
                      <div key={wkNum} className="border-b border-gray-100 last:border-0">
                        <div className="px-4 py-2 flex items-center justify-between bg-gray-50">
                          <span className="text-xs font-semibold text-gray-600">Wk {wkNum}</span>
                          {!isCommitted && (
                            <span className="text-xs text-gray-400 italic">not committed</span>
                          )}
                        </div>
                        {isCommitted && (
                          <div>
                            {[0, 1, 2, 3, 4].map(d => {
                              const dayIdx = wi * 7 + d
                              const dayDate = weekDays[dayIdx]
                              const iso = dateToISO(dayDate)
                              if (bankHolidaySet.has(iso)) return null
                              const rec = ppcByDate[iso]
                              const isPending = recalcPPC.isPending && recalcPPC.variables === iso
                              const pct = rec?.ppc_percent
                              return (
                                <div key={iso} className="flex items-center gap-2 px-4 py-1.5 hover:bg-gray-50">
                                  <span className="text-xs text-gray-500 w-16 shrink-0">
                                    {DAY_NAMES[d]} {dayDate.getDate()} {dayDate.toLocaleDateString('en-GB', { month: 'short' })}
                                  </span>
                                  <span
                                    className="text-xs font-semibold w-8 shrink-0"
                                    style={{ color: rec ? ppcColour(pct) : '#9ca3af' }}
                                  >
                                    {rec ? (pct !== null ? `${Math.round(pct)}%` : '—') : '···'}
                                  </span>
                                  {rec && (
                                    <span className="text-xs text-gray-400 flex-1">
                                      {rec.complete_count}/{rec.planned_count}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => recalcPPC.mutate(iso)}
                                    disabled={recalcPPC.isPending}
                                    className="ml-auto text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors text-sm leading-none"
                                    title={`Recalculate PPC for ${iso}`}
                                  >
                                    {isPending ? '…' : '↻'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
        {/* Linking mode banner */}
        {linkingFrom && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium flex-shrink-0"
            style={{ backgroundColor: '#d97706', color: 'white' }}
          >
            <span>
              ⊕ Linking from: <strong>{linkingFrom.title}</strong> — click any other task to set it as the successor, or press Esc to cancel
            </span>
            <button
              onClick={() => setLinkingFrom(null)}
              className="px-3 py-1 rounded-full text-xs font-bold border border-white/60 hover:bg-white/20 transition-colors"
            >Cancel</button>
          </div>
        )}

        <DndContext
          sensors={linkingFrom ? [] : sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/*
            Single scroll container — handles BOTH axes.
            overflow-x scrolls the 4-week grid horizontally.
            overflow-y scrolls trade rows vertically.
            Sticky children (day header top-0, labels left-0) work within this container.
          */}
          <div ref={scrollRef} className="flex-1 overflow-auto">
            <div style={{ minWidth: LABEL_WIDTH + NUM_DAYS * MIN_COL_WIDTH }}>

              {/* ── Day header — sticky top, corner also sticky left ── */}
              <div className="flex sticky top-0 z-10 bg-white border-b-2 border-gray-200 shadow-sm">
                {/* Corner cell: sticky on BOTH axes */}
                <div
                  style={{ width: LABEL_WIDTH, flexShrink: 0, position: 'sticky', left: 0, zIndex: 20, backgroundColor: 'white' }}
                  className="px-3 py-2 border-r border-gray-200 flex items-end"
                >
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Trade / Gang</span>
                </div>

                <div className="flex-1 flex">
                  {weekDays.map((d, i) => {
                    const isRecovery  = i % 7 >= 5 || bankHolidayDayIndices.has(i)
                    const isNewWeek   = i === 7 || i === 14 || i === 21
                    const weekNum     = weekNumber + Math.floor(i / 7)
                    const dayMilestones = milestones.filter(m => getDayIndex(m.planned_date, weekDays) === i)
                    const forecastMilestones = milestones.filter(m =>
                      m.forecast_date && m.forecast_date !== m.planned_date &&
                      getDayIndex(m.forecast_date, weekDays) === i
                    )
                    return (
                      <div
                        key={i}
                        className="flex-1 px-0.5 py-1 text-center"
                        style={{
                          backgroundColor: isRecovery ? '#fffbeb' : undefined,
                          borderLeft: isNewWeek ? '2px solid #d1d5db' : '1px solid #f3f4f6',
                          borderRight: isNewWeek ? undefined : undefined,
                        }}
                      >
                        <div className="text-xs font-bold text-gray-700 mt-1">{DAY_NAMES[i % 7]}</div>
                        <div style={{ fontSize: '0.6rem' }} className="text-gray-400 mt-0.5">
                          {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </div>
                        {(() => {
                          const dayISO = dateToISO(d)
                          const dayPPC = ppcByDate[dayISO]
                          if (isRecovery) return null
                          if (dayPPC?.ppc_percent != null) return (
                            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: ppcColour(dayPPC.ppc_percent), lineHeight: 1 }} className="mt-1">
                              {Math.round(dayPPC.ppc_percent)}%
                            </div>
                          )
                          return <div style={{ fontSize: '0.95rem', color: '#e5e7eb', lineHeight: 1 }} className="mt-1">—</div>
                        })()}
                        {i % 7 === 0 && (
                          <div className="mt-0.5 flex items-center justify-center gap-0.5 flex-wrap">
                            <span className="font-bold" style={{ color: '#1e3a5f', fontSize: '0.55rem' }}>
                              Wk {weekNum}
                            </span>
                            {committedWeeks.has(weekNum) ? (
                              canUncommit ? (
                                <button
                                  onPointerDown={e => e.stopPropagation()}
                                  onClick={e => { e.stopPropagation(); setPendingUncommitWeek(weekNum) }}
                                  disabled={uncommitWeek.isPending}
                                  title={`Wk ${weekNum} committed — click to unlock`}
                                  className="rounded px-1 text-white transition-opacity hover:opacity-70"
                                  style={{ fontSize: '0.5rem', backgroundColor: '#059669', lineHeight: '1.4' }}
                                >
                                  {uncommitWeek.isPending && pendingUncommitWeek === weekNum ? '…' : '🔒 Unlock'}
                                </button>
                              ) : (
                                <span title="Week committed — PPC baseline locked" style={{ fontSize: '0.6rem' }}>🔒</span>
                              )
                            ) : (
                              <button
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => { e.stopPropagation(); if (canEdit) setPendingCommitWeek(weekNum) }}
                                disabled={!canEdit || commitWeek.isPending}
                                title={canEdit ? `Commit Wk ${weekNum} as PPC baseline` : 'You do not have permission to commit weeks'}
                                className="rounded px-1 text-white transition-opacity"
                                style={{ fontSize: '0.5rem', backgroundColor: '#1e3a5f', lineHeight: '1.4', opacity: canEdit ? 1 : 0.4 }}
                              >
                                {commitWeek.isPending && pendingCommitWeek === weekNum ? '…' : 'Commit'}
                              </button>
                            )}
                          </div>
                        )}
                        {(dayMilestones.length > 0 || forecastMilestones.length > 0) && (
                          <div className="flex justify-center gap-0.5 mt-0.5 flex-wrap">
                            {dayMilestones.map(m => <MilestoneMarker key={m.id} milestone={m} isForecast={false} />)}
                            {forecastMilestones.map(m => <MilestoneMarker key={`f-${m.id}`} milestone={m} isForecast={true} />)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Trade groups ── */}
              {sortedTradeList.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-gray-400">
                  <div className="text-center">
                    <p className="text-lg mb-2">No trades configured</p>
                    <p className="text-sm">Add trades in <strong>Settings → Trades</strong> to set up your swimlanes.</p>
                  </div>
                </div>
              ) : (
                <div ref={gridAreaRef} style={{ position: 'relative' }}>
                  {showDependencies && (
                    <DependencyArrows dependencies={visibleDependencies} gridAreaRef={gridAreaRef} />
                  )}
                  {displayTradeList.map(trade => (
                    <TradeGroup
                      key={trade}
                      trade={trade}
                      gangs={[...(displayGangsByTrade[trade] || [])].sort()}
                      tasks={filteredTasks}
                      weekDays={weekDays}
                      zones={zones}
                      canEdit={canEditTrade(trade)}
                      canLink={canEdit}
                      onUpdate={(id, updates) => updateTask.mutate({ id, ...updates })}
                      onDelete={id => deleteTask.mutate(id)}
                      onSegmentClick={handleSegmentClick}
                      onCreateTask={taskData => createTask.mutate(taskData)}
                      onAddGang={(tradeName, gangName) => addGangToTrade.mutate({ tradeName, gangName })}
                      onRenameGang={(tradeName, oldGang, newGang) => renameGang.mutate({ tradeName, oldGang, newGang })}
                      onDeleteGang={(tradeName, gangName) => deleteGang.mutate({ tradeName, gangName })}
                      activeId={activeId}
                      allProjectTasks={allProjectTasks}
                      taskMap={taskMap}
                      isTaskBlockedFn={isTaskBlocked}
                      depsByTaskId={depsByTaskId}
                      onRemoveDependency={id => removeDependency.mutate(id)}
                      linkingFromId={linkingFrom?.id || null}
                      onLinkAction={handleLinkAction}
                      forceExpand={showDependencies && allProjectTasks.some(t =>
                        (t.trade || 'Unassigned') === trade && dependencyTaskIds.has(t.id)
                      )}
                      incompleteHistoricByGang={incompleteHistoricByGang}
                      bankHolidayDayIndices={bankHolidayDayIndices}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask && (() => {
              const zone = activeTask.zone ? (project?.settings?.zones || []).find(z => z.name === activeTask.zone) : null
              const bg = zone ? zone.colour : '#FDE047'
              const tc = getContrastColor(bg)
              return (
                <div className="rounded-lg shadow-2xl p-2.5 opacity-95 rotate-1" style={{ width: 150, backgroundColor: bg }}>
                  <p className="font-bold text-xs leading-tight" style={{ color: tc }}>{activeTask.title}</p>
                </div>
              )
            })()}
          </DragOverlay>
        </DndContext>
        </>
      )}

      {/* Daily Review Panel */}
      {showDailyReview && (
        <DailyReviewPanel
          projectId={projectId}
          bankHolidaySet={bankHolidaySet}
          rncCategories={rncCategories}
          onClose={() => setShowDailyReview(false)}
        />
      )}

      {/* Commit confirmation modal */}
      {pendingCommitWeek !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">⚠️</span>
              <div>
                <h3 className="text-base font-bold text-gray-900">Commit Week {pendingCommitWeek}?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  We recommend rescheduling any incomplete tasks before committing, as this will lock the PPC baseline for this week.
                </p>
                {totalIncompleteHistoric > 0 && (
                  <p className="text-sm font-semibold mt-2" style={{ color: '#d97706' }}>
                    {totalIncompleteHistoric} task{totalIncompleteHistoric !== 1 ? 's' : ''} currently require rescheduling.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingCommitWeek(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Go back
              </button>
              <button
                onClick={() => { commitWeek.mutate(pendingCommitWeek); setPendingCommitWeek(null) }}
                className="px-4 py-2 rounded-lg text-sm text-white font-semibold"
                style={{ backgroundColor: '#1e3a5f' }}>
                Commit anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Uncommit confirmation modal */}
      {pendingUncommitWeek !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">🔓</span>
              <div>
                <h3 className="text-base font-bold text-gray-900">Unlock Week {pendingUncommitWeek}?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This will remove the committed baseline for this week. Tasks will no longer have a ghost card or slip indicator, and the PPC baseline for this week will be cleared.
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Historical PPC records already calculated are not affected. Re-commit the week when you are ready to set a new baseline.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingUncommitWeek(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => { uncommitWeek.mutate(pendingUncommitWeek); setPendingUncommitWeek(null) }}
                className="px-4 py-2 rounded-lg text-sm text-white font-semibold"
                style={{ backgroundColor: '#dc2626' }}>
                Unlock week
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link config modal — fires after user picks predecessor + target */}
      {pendingLink && (
        <LinkConfigModal
          fromTask={pendingLink.fromTask}
          toTask={pendingLink.toTask}
          onConfirm={(lagDays) => {
            saveDependency.mutate({
              toTaskId: pendingLink.toTask.id,
              fromTaskId: pendingLink.fromTask.id,
              lagDays,
            })
          }}
          onCancel={() => setPendingLink(null)}
        />
      )}

    </div>
  )
}
