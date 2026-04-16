import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setProfile(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    // Link any pending project invitations for this user's email
    try { await supabase.rpc('link_my_invitations') } catch {}

    const { data, error } = await supabase
      .from('profiles')
      .select('*, tenants(*)')
      .eq('id', userId)
      .single()
    if (error) console.error('loadProfile failed:', error)
    setProfile(data)
  }

  async function signInWithEmail(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function signInWithMagicLink(email) {
    return supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  async function signUp(email, password, fullName) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
  }

  async function signOut() {
    return supabase.auth.signOut()
  }

  const loading = session === undefined
  const user = session?.user ?? null
  const isSuperAdmin = profile?.is_super_admin ?? false

  return (
    <AuthContext.Provider value={{
      session, user, profile, loading, isSuperAdmin,
      signInWithEmail, signInWithMagicLink, signUp, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
