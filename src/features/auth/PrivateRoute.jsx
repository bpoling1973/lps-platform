import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function PrivateRoute({ children, requireSuperAdmin = false }) {
  const { user, loading, isSuperAdmin } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}
