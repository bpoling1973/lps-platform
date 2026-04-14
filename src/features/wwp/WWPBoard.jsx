import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '@/lib/supabase'
import { useMyProjectRole } from '@/hooks/useProject'
import { TASK_STATUS } from '@/lib/constants'
import TaskFormModal from './TaskFormModal'

// Get current ISO week number
function getWeekNumber(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// Get Mon–Fri dates for the current week
function getWeekDays(weekOffset = 0) {
  const now = new Date()
  const day = now.getDay() // 0=Sun
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const monday = new Date(now.setDate(diff + weekOffset * 7))
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function StatusBadge({ status }) {
  const s = TASK_STATUS[status] || TASK_STATUS.not_started
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.colour + '20', color: s.colour }}>
      {s.label}
    </span>
  )
}

function TaskCard({ task, canEdit, onEdit, onStatusChange, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const NEXT_STATUS = {
    not_started: 'in_progress',
    in_progress: 'complete',
    complete: 'incomplete',
    incomplete: 'not_started',
  }

  return (
    <div ref={setNodeRef} style={style}
      className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm select-none touch-manipulation
        2xl:p-4 hover:border-blue-300 transition-colors">
      {/* Drag handle area */}
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing mb-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 text-sm leading-snug 2xl:text-base flex-1 min-w-0">
            {task.title}
          </p>
          <span className="text-gray-300 text-base flex-shrink-0">⠿</span>
        </div>
      </div>

      {task.trade && (
        <p className="text-xs text-gray-500 mb-2 2xl:text-sm">{task.trade}</p>
      )}

      {(task.planned_start || task.planned_end) && (
        <p className="text-xs text-gray-400 mb-2 2xl:text-sm">
          {task.planned_start && new Date(task.planned_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          {task.planned_start && task.planned_end && ' – '}
          {task.planned_end && new Date(task.planned_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2">
        <StatusBadge status={task.status} />
        <div className="flex gap-1">
          {canEdit && (
            <>
              <button
                onClick={() => onStatusChange(task.id, NEXT_STATUS[task.status])}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 min-h-[36px] min-w-[36px] 2xl:min-h-[44px]"
                title="Advance status"
              >
                →
              </button>
              <button
                onClick={() => onEdit(task)}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 min-h-[36px] min-w-[36px] 2xl:min-h-[44px]"
              >
                ✎
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TradeSwimLane({ trade, tasks, canEdit, onEdit, onStatusChange, activeId }) {
  const taskIds = tasks.map(t => t.id)

  return (
    <div className="flex-shrink-0 w-52 2xl:w-64">
      <div className="rounded-lg px-2 py-1.5 mb-2 text-sm font-semibold text-white truncate"
        style={{ backgroundColor: '#1e3a5f' }}>
        {trade || 'Unassigned'}
        <span className="ml-2 text-xs font-normal opacity-70">({tasks.length})</span>
      </div>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 min-h-[120px]">
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              canEdit={canEdit}
              onEdit={onEdit}
              onStatusChange={onStatusChange}
              isDragging={activeId === task.id}
            />
          ))}
          {tasks.length === 0 && (
            <div className="h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center">
              <span className="text-xs text-gray-300">Drop here</span>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

export default function WWPBoard() {
  const { projectId } = useParams()
  const { data: role } = useMyProjectRole(projectId)
  const queryClient = useQueryClient()
  const canEdit = ['project_admin', 'planner', 'trade_supervisor'].includes(role)

  const [weekOffset, setWeekOffset] = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [activeTask, setActiveTask] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState(null)

  const weekNumber = getWeekNumber(new Date()) + weekOffset
  const weekDays = getWeekDays(weekOffset)
  const weekLabel = `Week ${weekNumber} · ${formatDate(weekDays[0])} – ${formatDate(weekDays[4])}`

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['wwp-tasks', projectId, weekNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phase_tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('phase', 'wwp')
        .eq('week_number', weekNumber)
        .order('position', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: 15000,
  })

  // Realtime subscription for live updates
  useEffect(() => {
    const channel = supabase
      .channel(`wwp-${projectId}-${weekNumber}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'phase_tasks',
        filter: `project_id=eq.${projectId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['wwp-tasks', projectId, weekNumber] })
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [projectId, weekNumber, queryClient])

  const updateTask = useMutation({
    mutationFn: async ({ id, ...updates }) => {
      const { error } = await supabase.from('phase_tasks').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wwp-tasks', projectId, weekNumber] }),
  })

  const reorderTasks = useMutation({
    mutationFn: async (orderedIds) => {
      const updates = orderedIds.map((id, index) => ({
        id,
        position: index,
        updated_at: new Date().toISOString(),
      }))
      // Upsert positions
      for (const u of updates) {
        await supabase.from('phase_tasks').update({ position: u.position }).eq('id', u.id)
      }
    },
  })

  // Group by trade
  const trades = [...new Set(tasks.map(t => t.trade || ''))].sort()
  const tasksByTrade = trades.reduce((acc, trade) => {
    acc[trade] = tasks.filter(t => (t.trade || '') === trade)
    return acc
  }, {})

  function handleDragStart({ active }) {
    setActiveId(active.id)
    setActiveTask(tasks.find(t => t.id === active.id))
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    setActiveTask(null)
    if (!over || active.id === over.id) return

    // Find task positions and reorder
    const oldIndex = tasks.findIndex(t => t.id === active.id)
    const newIndex = tasks.findIndex(t => t.id === over.id)
    const reordered = arrayMove(tasks, oldIndex, newIndex)

    // Optimistic update
    queryClient.setQueryData(['wwp-tasks', projectId, weekNumber], reordered)
    reorderTasks.mutate(reordered.map(t => t.id))
  }

  function handleStatusChange(taskId, newStatus) {
    updateTask.mutate({ id: taskId, status: newStatus })
    // If marking incomplete, notify user to log RNC
    if (newStatus === 'incomplete') {
      // RNC logging handled in PPC page
    }
  }

  const statusCounts = {
    not_started: tasks.filter(t => t.status === 'not_started').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    complete: tasks.filter(t => t.status === 'complete').length,
    incomplete: tasks.filter(t => t.status === 'incomplete').length,
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 2xl:text-2xl">Weekly Work Plan</h1>
          <p className="text-sm text-gray-500 mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 min-h-[48px] min-w-[48px] text-lg"
          >
            ‹
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 min-h-[48px] text-sm font-medium"
          >
            This week
          </button>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 min-h-[48px] min-w-[48px] text-lg"
          >
            ›
          </button>
          {canEdit && (
            <button
              onClick={() => { setEditingTask(null); setShowForm(true) }}
              className="px-4 py-2.5 rounded-lg text-white font-medium text-sm min-h-[48px] ml-2"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              + Add Task
            </button>
          )}
        </div>
      </div>

      {/* Status summary bar */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {Object.entries(TASK_STATUS).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border"
            style={{ borderColor: val.colour + '40', backgroundColor: val.colour + '10', color: val.colour }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: val.colour }} />
            {val.label}: {statusCounts[key]}
          </div>
        ))}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 text-gray-600">
          Total: {tasks.length}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Scrollable board */}
          <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
            {trades.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-lg mb-2">No tasks planned for this week</p>
                  {canEdit && <p className="text-sm">Use "+ Add Task" to commit work to this week.</p>}
                </div>
              </div>
            ) : (
              trades.map(trade => (
                <TradeSwimLane
                  key={trade}
                  trade={trade}
                  tasks={tasksByTrade[trade]}
                  canEdit={canEdit}
                  onEdit={(task) => { setEditingTask(task); setShowForm(true) }}
                  onStatusChange={handleStatusChange}
                  activeId={activeId}
                />
              ))
            )}
          </div>

          <DragOverlay>
            {activeTask && (
              <div className="bg-white rounded-xl border border-blue-400 shadow-xl p-3 w-52 2xl:w-64 opacity-90">
                <p className="font-semibold text-sm">{activeTask.title}</p>
                {activeTask.trade && <p className="text-xs text-gray-500 mt-1">{activeTask.trade}</p>}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {showForm && (
        <TaskFormModal
          projectId={projectId}
          weekNumber={weekNumber}
          existing={editingTask}
          onClose={() => { setShowForm(false); setEditingTask(null) }}
        />
      )}
    </div>
  )
}
