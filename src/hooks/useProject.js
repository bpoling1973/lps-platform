import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthContext'

// Fetch all projects the current user is a member of
export function useProjects() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['projects', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          tenants(id, name),
          project_members!inner(id, role, user_id)
        `)
        .eq('project_members.user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}

// Fetch a single project with full membership list
export function useProject(projectId) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          tenants(id, name),
          project_members(id, role, user_id, invited_email, joined_at, assigned_trades, profiles(id, full_name, email))
        `)
        .eq('id', projectId)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!projectId && !!user,
  })
}

// Get current user's membership in a project (role + assigned_trades)
export function useMyProjectRole(projectId) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-role', projectId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('role, assigned_trades')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .single()

      if (error) return null
      return data
    },
    enabled: !!projectId && !!user,
  })
}
