import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function LoginPage() {
  const { signInWithEmail, signInWithMagicLink } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('magic') // 'magic' | 'password'
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (mode === 'magic') {
      const { error } = await signInWithMagicLink(email)
      if (error) setError(error.message)
      else setMessage('Check your email — a sign-in link has been sent.')
    } else {
      const { error } = await signInWithEmail(email, password)
      if (error) setError(error.message)
      else navigate(from, { replace: true })
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-3"
            style={{ backgroundColor: '#1e3a5f' }}>
            <span className="text-white font-bold text-xl">LPS</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">OpSolv LPS Platform</h1>
          <p className="text-sm text-gray-500 mt-1">Last Planner System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          {mode === 'password' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {message && (
            <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-lg text-white font-semibold text-base transition-opacity disabled:opacity-60 min-h-[48px]"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            {loading ? 'Please wait…' : mode === 'magic' ? 'Send sign-in link' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => { setMode(m => m === 'magic' ? 'password' : 'magic'); setError(null); setMessage(null) }}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            {mode === 'magic' ? 'Sign in with password instead' : 'Send me a magic link instead'}
          </button>
        </div>

        <p className="mt-6 text-xs text-center text-gray-400">
          OpSolv LPS Platform — powered by{' '}
          <a href="https://opsolv.co.uk" className="underline" target="_blank" rel="noreferrer">
            OpSolv
          </a>
        </p>
      </div>
    </div>
  )
}
