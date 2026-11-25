import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [bookCount, setBookCount] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s)
    )
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('books')
      .select('*', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (error) setMessage(error.message)
        else setBookCount(count)
      })
  }, [session])

  async function signIn(e) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setMessage(error ? error.message : '')
  }

  if (!session) {
    return (
      <div style={{ maxWidth: 360, margin: '4rem auto', padding: '0 1rem' }}>
        <h1>Our Library</h1>
        <form onSubmit={signIn} style={{ display: 'grid', gap: 8 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Sign in</button>
        </form>
        {message && <p style={{ color: 'tomato' }}>{message}</p>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Our Library</h1>
      <p>Signed in as {session.user.email}</p>
      <p>Books in the library: {bookCount ?? '...'}</p>
      {message && <p style={{ color: 'tomato' }}>{message}</p>}
      <button onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}