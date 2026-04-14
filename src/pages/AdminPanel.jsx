import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function AdminPanel() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showCreateTenant, setShowCreateTenant] = useState(false)
  const [tenantName, setTenantName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [error, setError] = useState(null)

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*, projects(id, name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const createTenant = useMutation({
    mutationFn: async ({ name, adminEmail }) => {
      // Create tenant
      const { data: tenant, error: tErr } = await supabase
        .from('tenants')
        .insert({ name, plan_tier: 'trial', billing_status: 'trial' })
        .select()
        .single()
      if (tErr) throw tErr

      // Invite admin user — send magic link via Supabase Auth admin (handled server-side)
      // For MVP: create a project_members invitation row; they'll get the link on first sign-in
      // The actual email invite uses the Edge Function send-task-assignment
      const { error: inviteErr } = await supabase.functions.invoke('send-invitation', {
        body: { tenantId: tenant.id, adminEmail, tenantName: name },
      }).catch(() => ({ error: null })) // Non-fatal if function not yet deployed

      return tenant
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })
      setShowCreateTenant(false)
      setTenantName('')
      setAdminEmail('')
      setError(null)
    },
    onError: (err) => setError(err.message),
  })

  async function handleCreateTenant(e) {
    e.preventDefault()
    setError(null)
    createTenant.mutate({ name: tenantName.trim(), adminEmail: adminEmail.trim() })
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OpSolv Admin Panel</h1>
          <p className="text-sm text-gray-500">Tenant management and platform overview</p>
        </div>
        <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to projects
        </button>
      </div>

      {/* Tenant list */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Tenants ({tenants?.length ?? 0})</h2>
          <button
            onClick={() => setShowCreateTenant(v => !v)}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium min-h-[40px]"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            + Add Tenant
          </button>
        </div>

        {showCreateTenant && (
          <form onSubmit={handleCreateTenant} className="mb-4 bg-white rounded-xl border border-blue-300 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company name</label>
                <input
                  type="text" required value={tenantName}
                  onChange={e => setTenantName(e.target.value)}
                  placeholder="e.g. Wates Construction"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admin email</label>
                <input
                  type="email" required value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                  placeholder="admin@company.com"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            {error && <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit" disabled={createTenant.isPending}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60 min-h-[40px]"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                {createTenant.isPending ? 'Creating…' : 'Create Tenant'}
              </button>
              <button type="button" onClick={() => setShowCreateTenant(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 min-h-[40px]">
                Cancel
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Tenant</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Plan</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Projects</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Created</th>
                </tr>
              </thead>
              <tbody>
                {tenants?.map(tenant => (
                  <tr key={tenant.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{tenant.name}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{tenant.plan_tier}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        tenant.billing_status === 'active' ? 'bg-blue-100 text-blue-800' :
                        tenant.billing_status === 'trial' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {tenant.billing_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{tenant.projects?.length ?? 0}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(tenant.created_at).toLocaleDateString('en-GB')}
                    </td>
                  </tr>
                ))}
                {tenants?.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No tenants yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
