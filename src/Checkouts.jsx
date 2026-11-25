import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { todayStr, fmtDate, borrowerLabel } from './helpers'
import './Library.css'

export default function Checkouts({ userId, isAdmin }) {
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState(new Map())
  const [history, setHistory] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    let query = supabase
      .from('checkouts')
      .select(
        'id,book_id,borrower_id,borrower_name,checked_out_at,due_date,returned_at,books(title,author,cover_url)'
      )
    query = history
      ? query
          .not('returned_at', 'is', null)
          .order('returned_at', { ascending: false })
          .limit(200)
      : query.is('returned_at', null).order('checked_out_at', { ascending: false })

    Promise.all([query, supabase.from('profiles').select('id,display_name')]).then(
      ([res, prof]) => {
        if (cancelled) return
        if (res.error) setError(res.error.message)
        else setRows(res.data)
        if (prof.data) setProfiles(new Map(prof.data.map((p) => [p.id, p.display_name])))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [history])

  async function returnBook(row) {
    setNotice('')
    const { data, error } = await supabase
      .from('checkouts')
      .update({ returned_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('id')
    if (error || !data?.length) {
      setNotice(`Couldn't return that book${error ? ': ' + error.message : ''}`)
      return
    }
    setRows((r) => r.filter((x) => x.id !== row.id))
  }

  const shown = rows.filter((r) => !mineOnly || r.borrower_id === userId)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'left' }}>
      <h2 style={{ textAlign: 'center' }}>{history ? 'Past checkouts' : 'Checked-out books'}</h2>
      <div className="library-toolbar">
        <button className="clear-filters" onClick={() => setHistory((h) => !h)}>
          {history ? 'Show current checkouts' : 'Show past checkouts'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Only my books
        </label>
      </div>
      {notice && <p style={{ color: 'tomato', textAlign: 'center' }}>{notice}</p>}
      {error && <p style={{ color: 'tomato', textAlign: 'center' }}>{error}</p>}
      {loading ? (
        <p style={{ textAlign: 'center' }}>Loading...</p>
      ) : shown.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center' }}>
          {history ? 'No past checkouts yet.' : 'Nothing is checked out right now.'}
        </p>
      ) : (
        shown.map((r) => {
          const overdue = !history && r.due_date && r.due_date < todayStr()
          return (
            <div key={r.id} className="checkout-row">
              {r.books?.cover_url ? (
                <img className="checkout-thumb" src={r.books.cover_url} alt="" />
              ) : (
                <div className="checkout-thumb" />
              )}
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{r.books?.title || 'Unknown book'}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {r.books?.author}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  With {borrowerLabel(r, profiles, userId)} since {fmtDate(r.checked_out_at)}
                  {history && r.returned_at && <> · returned {fmtDate(r.returned_at)}</>}
                  {!history && r.due_date && (
                    <span style={{ color: overdue ? 'tomato' : 'inherit' }}>
                      {' '}
                      · due {fmtDate(r.due_date)}
                      {overdue ? ' (overdue)' : ''}
                    </span>
                  )}
                </div>
              </div>
              {!history && (r.borrower_id === userId || isAdmin) && (
                <button className="clear-filters" onClick={() => returnBook(r)}>
                  Return
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}