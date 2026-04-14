import { useState } from 'react'
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { useProject } from '@/hooks/useProject'

const NAV_ITEMS = [
  { path: 'dashboard', label: 'Dashboard', icon: '▦' },
  { path: 'milestones', label: 'Milestones', icon: '◆' },
  { path: 'wwp', label: 'Weekly Plan', icon: '☰' },
  { path: 'lookahead', label: 'Lookahead', icon: '⏱' },
  { path: 'ppc', label: 'PPC & RNC', icon: '↗' },
  { path: 'reports', label: 'Reports', icon: '⬇' },
]

export default function AppShell({ children }) {
  const { projectId } = useParams()
  const { user, profile, signOut, isSuperAdmin } = useAuth()
  const { data: project } = useProject(projectId)
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const currentPath = location.pathname.split('/').pop()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="h-14 flex items-center px-4 shadow-sm z-20"
        style={{ backgroundColor: '#1e3a5f' }}>
        <Link to="/" className="flex items-center gap-2 mr-6">
          <div className="w-7 h-7 rounded bg-white/20 flex items-center justify-center">
            <span className="text-white font-bold text-xs">LPS</span>
          </div>
          <span className="text-white font-semibold text-sm hidden sm:inline">OpSolv LPS</span>
        </Link>

        {project && (
          <span className="text-white/80 text-sm truncate flex-1 hidden md:block">
            {project.tenants?.name} &rsaquo; {project.name}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {isSuperAdmin && (
            <Link to="/admin" className="text-white/70 text-xs hover:text-white px-2 py-1 rounded">
              Admin
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="text-white/70 text-xs hover:text-white min-h-[36px] px-2"
          >
            Sign out
          </button>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: '#d97706' }}>
            {(profile?.full_name || user?.email || '?')[0].toUpperCase()}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav (visible when in a project) */}
        {projectId && (
          <nav className="w-48 bg-white border-r border-gray-200 flex-shrink-0 hidden md:flex flex-col py-4">
            {NAV_ITEMS.map(item => {
              const active = currentPath === item.path
              return (
                <Link
                  key={item.path}
                  to={`/project/${projectId}/${item.path}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors min-h-[48px]"
                  style={{
                    color: active ? '#1e3a5f' : '#4b5563',
                    backgroundColor: active ? '#dbeafe' : 'transparent',
                    borderRight: active ? '3px solid #1e3a5f' : '3px solid transparent',
                  }}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto p-4 md:p-6 2xl:text-lg">
          {children}
        </main>
      </div>

      {/* Bottom nav for mobile (when in a project) */}
      {projectId && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-20">
          {NAV_ITEMS.slice(0, 5).map(item => {
            const active = currentPath === item.path
            return (
              <Link
                key={item.path}
                to={`/project/${projectId}/${item.path}`}
                className="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] text-xs font-medium"
                style={{ color: active ? '#1e3a5f' : '#9ca3af' }}
              >
                <span className="text-lg leading-tight">{item.icon}</span>
                <span className="mt-0.5">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  )
}
