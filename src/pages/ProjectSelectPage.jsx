import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { useProjects } from '@/hooks/useProject'

export default function ProjectSelectPage() {
  const { user, profile, isSuperAdmin } = useAuth()
  const { data: projects, isLoading } = useProjects()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)   // project object to delete
  const [confirmClone, setConfirmClone] = useState(null)     // template project to clone from
  const [cloneNewName, setCloneNewName] = useState('')

  const createProject = useMutation({
    mutationFn: async (name) => {
      // Use profile's tenant, or fall back to the tenant of any existing project
      let tenantId = profile?.tenant_id
      if (!tenantId && projects?.length) {
        tenantId = projects[0].tenant_id
      }
      if (!tenantId) throw new Error('No tenant associated with your account. Contact OpSolv admin.')

      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({ tenant_id: tenantId, name })
        .select()
        .single()

      if (pErr) throw pErr

      const { error: mErr } = await supabase
        .from('project_members')
        .insert({ project_id: project.id, user_id: user.id, role: 'project_admin', joined_at: new Date().toISOString() })

      if (mErr) throw mErr
      return project
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/project/${project.id}/dashboard`)
    },
    onError: (err) => setError(err.message),
  })

  const deleteProject = useMutation({
    mutationFn: async (projectId) => {
      const { error } = await supabase.from('projects').delete().eq('id', projectId)
      if (error) throw error
    },
    onSuccess: () => {
      setConfirmDelete(null)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => {
      setConfirmDelete(null)
      setError(`Failed to delete project: ${err.message}`)
    },
  })

  const toggleTemplate = useMutation({
    mutationFn: async ({ projectId, value }) => {
      const { error } = await supabase.from('projects')
        .update({ is_demo_template: value })
        .eq('id', projectId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err) => setError(`Failed to update template: ${err.message}`),
  })

  const cloneProject = useMutation({
    mutationFn: async ({ sourceId, name }) => {
      const { data, error } = await supabase.rpc('clone_project_as_demo', {
        p_source_project_id: sourceId,
        p_new_name: name,
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setConfirmClone(null)
      setCloneNewName('')
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/project/${data.project_id}/dashboard`)
    },
    onError: (err) => {
      setConfirmClone(null)
      setError(`Failed to create demo: ${err.message}\n\nMake sure migration 014 has been run.`)
    },
  })

  async function handleCreate(e) {
    e.preventDefault()
    if (!newProjectName.trim()) return
    setError(null)
    createProject.mutate(newProjectName.trim())
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Your Projects</h1>
            <p className="text-sm text-gray-500 mt-1">
              {profile?.tenants?.name && `${profile.tenants.name} · `}
              {user?.email}
            </p>
          </div>
          {isSuperAdmin && (
            <a href="/admin" className="text-sm text-blue-600 underline">OpSolv Admin</a>
          )}
        </div>

        {error && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">{error}</p>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {projects?.map(project => {
              const isAdmin = isSuperAdmin || project.project_members?.[0]?.role === 'project_admin'
              const isTemplate = !!project.is_demo_template
              return (
                <div
                  key={project.id}
                  className="group w-full bg-white rounded-xl border hover:shadow-sm transition-all flex items-center min-h-[72px]"
                  style={{ borderColor: isTemplate ? '#d97706' : undefined }}
                >
                  <button
                    onClick={() => navigate(`/project/${project.id}/dashboard`)}
                    className="flex-1 text-left px-6 py-4 flex items-center min-w-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{project.name}</p>
                        {isTemplate && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                            Demo template
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {project.tenants?.name} ·{' '}
                        {project.project_members?.[0]?.role?.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <span className="ml-auto pl-4 text-gray-400 text-xl flex-shrink-0">›</span>
                  </button>

                  {/* Create demo button — visible on template projects for admins */}
                  {isTemplate && isAdmin && (
                    <button
                      onClick={() => { setConfirmClone(project); setCloneNewName(`${project.name} — Demo`) }}
                      className="flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold mr-2 transition-colors"
                      style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
                      title="Create a fresh demo from this template"
                    >
                      Create demo →
                    </button>
                  )}

                  {/* Template toggle — super admin only */}
                  {isSuperAdmin && (
                    <button
                      onClick={() => toggleTemplate.mutate({ projectId: project.id, value: !isTemplate })}
                      className="flex-shrink-0 px-3 py-4 transition-colors opacity-0 group-hover:opacity-100 text-xs font-medium"
                      style={{ color: isTemplate ? '#d97706' : '#9ca3af' }}
                      title={isTemplate ? 'Remove demo template flag' : 'Mark as demo template'}
                    >
                      {isTemplate ? '★' : '☆'}
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      onClick={() => setConfirmDelete(project)}
                      className="flex-shrink-0 px-4 py-4 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete project"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}

            {projects?.length === 0 && !showCreate && (
              <div className="text-center py-12 text-gray-400">
                <p>No projects yet.</p>
              </div>
            )}

            {showCreate ? (
              <form onSubmit={handleCreate} className="bg-white rounded-xl border border-blue-300 px-6 py-4 space-y-3">
                <input
                  type="text"
                  required
                  autoFocus
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  placeholder="Project name (e.g. King's Cross Phase 2)"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createProject.isPending}
                    className="flex-1 py-3 rounded-lg text-white font-semibold min-h-[48px] disabled:opacity-60"
                    style={{ backgroundColor: '#1e3a5f' }}
                  >
                    {createProject.isPending ? 'Creating…' : 'Create Project'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium min-h-[48px]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors font-medium min-h-[48px]"
              >
                + New Project
              </button>
            )}
          </div>
        )}
      </div>

      {/* Clone / create demo modal */}
      {confirmClone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">📋</span>
              <div>
                <h3 className="text-base font-bold text-gray-900">Create demo from template</h3>
                <p className="text-sm text-gray-600 mt-1">
                  A fresh copy of <strong>{confirmClone.name}</strong> will be created with all dates
                  re-anchored to the current week, so the board looks live.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Demo project name</label>
              <input
                type="text"
                autoFocus
                value={cloneNewName}
                onChange={e => setCloneNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && cloneNewName.trim()) cloneProject.mutate({ sourceId: confirmClone.id, name: cloneNewName.trim() }) }}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Elmwood Court — Acme Construction Demo"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setConfirmClone(null); setCloneNewName('') }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => cloneProject.mutate({ sourceId: confirmClone.id, name: cloneNewName.trim() })}
                disabled={!cloneNewName.trim() || cloneProject.isPending}
                className="px-4 py-2 rounded-lg text-sm text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#d97706' }}>
                {cloneProject.isPending ? 'Creating…' : 'Create demo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">🗑️</span>
              <div>
                <h3 className="text-base font-bold text-gray-900">Delete "{confirmDelete.name}"?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This will permanently delete the project and all of its tasks, milestones, and PPC data. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteProject.mutate(confirmDelete.id)}
                disabled={deleteProject.isPending}
                className="px-4 py-2 rounded-lg text-sm text-white font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-60"
              >
                {deleteProject.isPending ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
