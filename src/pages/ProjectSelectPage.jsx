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

  const createProject = useMutation({
    mutationFn: async (name) => {
      if (!profile?.tenant_id) throw new Error('No tenant associated with your account. Contact OpSolv admin.')

      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({ tenant_id: profile.tenant_id, name })
        .select()
        .single()

      if (pErr) throw pErr

      // Add creator as project_admin
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

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {projects?.map(project => (
              <button
                key={project.id}
                onClick={() => navigate(`/project/${project.id}/dashboard`)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-6 py-4 hover:border-blue-400 hover:shadow-sm transition-all min-h-[72px] flex items-center"
              >
                <div>
                  <p className="font-semibold text-gray-900">{project.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {project.tenants?.name} ·{' '}
                    {project.project_members?.[0]?.role?.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className="ml-auto text-gray-400 text-xl">›</span>
              </button>
            ))}

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
                {error && <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{error}</p>}
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
    </div>
  )
}
