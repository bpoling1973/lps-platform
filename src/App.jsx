import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthContext'
import PrivateRoute from '@/features/auth/PrivateRoute'
import LoginPage from '@/features/auth/LoginPage'
import AuthCallback from '@/features/auth/AuthCallback'
import ProjectSelectPage from '@/pages/ProjectSelectPage'
import AdminPanel from '@/pages/AdminPanel'
import AppShell from '@/components/AppShell'
import DashboardPage from '@/features/dashboard/DashboardPage'
import MilestonesPage from '@/features/milestones/MilestonesPage'
import WWPBoard from '@/features/wwp/WWPBoard'
import LookaheadPage from '@/features/lookahead/LookaheadPage'
import PPCPage from '@/features/ppc/PPCPage'
import ReportsPage from '@/features/reports/ReportsPage'
import ProjectSettingsPage from '@/features/settings/ProjectSettingsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
})

function ProjectLayout({ children }) {
  return (
    <PrivateRoute>
      <AppShell>{children}</AppShell>
    </PrivateRoute>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            <Route path="/" element={
              <PrivateRoute>
                <AppShell><ProjectSelectPage /></AppShell>
              </PrivateRoute>
            } />

            <Route path="/admin" element={
              <PrivateRoute requireSuperAdmin>
                <AppShell><AdminPanel /></AppShell>
              </PrivateRoute>
            } />

            <Route path="/project/:projectId/dashboard" element={<ProjectLayout><DashboardPage /></ProjectLayout>} />
            <Route path="/project/:projectId/milestones" element={<ProjectLayout><MilestonesPage /></ProjectLayout>} />
            <Route path="/project/:projectId/wwp" element={<ProjectLayout><WWPBoard /></ProjectLayout>} />
            <Route path="/project/:projectId/lookahead" element={<ProjectLayout><LookaheadPage /></ProjectLayout>} />
            <Route path="/project/:projectId/ppc" element={<ProjectLayout><PPCPage /></ProjectLayout>} />
            <Route path="/project/:projectId/reports" element={<ProjectLayout><ReportsPage /></ProjectLayout>} />
            <Route path="/project/:projectId/settings" element={<ProjectLayout><ProjectSettingsPage /></ProjectLayout>} />
            <Route path="/project/:projectId" element={<Navigate to="dashboard" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
