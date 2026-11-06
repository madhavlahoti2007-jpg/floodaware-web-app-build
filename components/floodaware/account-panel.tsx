'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { Check, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'

export type FloodAwareProfile = {
  id: string
  display_name: string
  preferred_language: 'en' | 'hi'
  notification_opt_in: boolean
  role: 'member' | 'moderator' | 'admin'
}

type AccountPanelProps = {
  user: User | null
  profile: FloodAwareProfile | null
  profileError: string | null
  supabase: SupabaseClient | null
  onProfileSaved: () => void
}

export function AccountPanel({ user, profile, profileError, supabase, onProfileSaved }: AccountPanelProps) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [language, setLanguage] = useState<'en' | 'hi'>('en')
  const [notificationOptIn, setNotificationOptIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setDisplayName(profile?.display_name ?? String(user?.user_metadata?.display_name ?? ''))
    setLanguage(profile?.preferred_language ?? 'en')
    setNotificationOptIn(profile?.notification_opt_in ?? false)
  }, [profile, user])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) {
      setError('Supabase is not configured for this project.')
      return
    }
    setPending(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'sign-up') {
        const emailRedirectTo = process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || `${window.location.origin}/auth/callback`
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo, data: { display_name: displayName.trim() } },
        })
        if (authError) throw authError
        setMessage(data.session ? 'Your account is ready.' : 'Check your email to confirm your account, then sign in.')
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (authError) throw authError
        setMessage('Signed in successfully.')
      }
      setPassword('')
      onProfileSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication could not be completed.')
    } finally {
      setPending(false)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user) return
    setPending(true)
    setError('')
    setMessage('')
    try {
      const { error: saveError } = await supabase.from('profiles').update({
        display_name: displayName.trim(),
        preferred_language: language,
        notification_opt_in: notificationOptIn,
      }).eq('id', user.id)
      if (saveError) throw saveError
      setMessage('Profile preferences saved.')
      onProfileSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile preferences could not be saved.')
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    setPending(true)
    setError('')
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
    else setMessage('You are signed out.')
    setPending(false)
  }

  if (!supabase) {
    return <div className="panel-notice panel-notice--warning" role="status">Supabase authentication is unavailable because the project connection is not configured.</div>
  }

  if (user) {
    return (
      <div className="account-panel">
        <div className="account-identity">
          <span className="account-avatar"><UserRound size={22} aria-hidden="true" /></span>
          <div><span className="panel-kicker">Signed in</span><strong>{user.email}</strong></div>
          {profile && <span className="account-role"><ShieldCheck size={14} aria-hidden="true" /> {profile.role}</span>}
        </div>
        {profileError && <p className="panel-notice panel-notice--warning" role="status">Your account session is active, but profile storage is unavailable until the Supabase schema is applied.</p>}
        <form className="workspace-form" onSubmit={saveProfile}>
          <label className="workspace-label" htmlFor="profile-name">Display name</label>
          <input id="profile-name" className="workspace-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} />
          <label className="workspace-label" htmlFor="profile-language">Language</label>
          <select id="profile-language" className="workspace-input" value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'hi')}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
          <label className="workspace-check-row">
            <input type="checkbox" checked={notificationOptIn} onChange={(event) => setNotificationOptIn(event.target.checked)} />
            <span>Opt in to nearby flood notifications</span>
          </label>
          <div className="workspace-actions">
            <button className="workspace-button workspace-button--primary" type="submit" disabled={pending}>
              <Check size={16} aria-hidden="true" /> {pending ? 'Saving…' : 'Save profile'}
            </button>
            <button className="workspace-button" type="button" onClick={() => void signOut()} disabled={pending}>
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          </div>
        </form>
        {error && <p className="workspace-message workspace-message--error" role="alert">{error}</p>}
        {message && <p className="workspace-message" role="status">{message}</p>}
      </div>
    )
  }

  return (
    <div className="account-panel">
      <div className="account-heading"><span className="account-avatar"><UserRound size={22} aria-hidden="true" /></span><div><span className="panel-kicker">Community account</span><strong>Sign in to save and verify</strong></div></div>
      <div className="account-mode-switch" role="group" aria-label="Account action">
        <button type="button" className={mode === 'sign-in' ? 'is-active' : ''} aria-pressed={mode === 'sign-in'} onClick={() => { setMode('sign-in'); setError(''); setMessage('') }}>Sign in</button>
        <button type="button" className={mode === 'sign-up' ? 'is-active' : ''} aria-pressed={mode === 'sign-up'} onClick={() => { setMode('sign-up'); setError(''); setMessage('') }}>Create account</button>
      </div>
      <form className="workspace-form" onSubmit={handleAuth}>
        {mode === 'sign-up' && <><label className="workspace-label" htmlFor="signup-name">Display name</label><input id="signup-name" className="workspace-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} autoComplete="name" /></>}
        <label className="workspace-label" htmlFor="account-email">Email</label>
        <input id="account-email" className="workspace-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        <label className="workspace-label" htmlFor="account-password">Password</label>
        <input id="account-password" className="workspace-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} required />
        <button className="workspace-button workspace-button--primary workspace-button--wide" type="submit" disabled={pending}>
          <LogIn size={16} aria-hidden="true" /> {pending ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="panel-disclaimer">Use email and password. Confirm your email before signing in if verification is enabled for this Supabase project.</p>
      {error && <p className="workspace-message workspace-message--error" role="alert">{error}</p>}
      {message && <p className="workspace-message" role="status">{message}</p>}
    </div>
  )
}
