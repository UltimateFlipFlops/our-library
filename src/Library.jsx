import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import './Library.css'

const COLUMNS =
  'id,title,author,cover_url,categories,rating_avg,rating_count,published_year'

const STATUSES = [
  ['unread', 'Not read yet'],
  ['reading', 'Reading'],
  ['read', 'Read'],
]

async function fetchAllBooks() {
  const pageSize = 1000
  let all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('books')
      .select(COLUMNS)
      .order('title')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data)
    if (data.length < pageSize) break
  }
  return all
}

async function fetchMyBooks(userId) {
  const pageSize = 1000
  let all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('user_books')
      .select('book_id,status,my_rating')
      .eq('user_id', userId)
      .order('book_id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data)
    if (data.length < pageSize) break
  }
  return all
}

const sortTitle = (t) => (t || '').toLowerCase().replace(/^(the|a|an)\s+/, '')
const lastName = (a) => (a || '').trim().split(/\s+/).pop().toLowerCase()

function hueFor(text) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function Cover({ book, className = '' }) {
  const [failed, setFailed] = useState(false)
  if (book.cover_url && !failed) {
    return (
      <img
        className={`book-cover ${className}`}
        src={book.cover_url}
        alt={`Cover of ${book.title}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div
      className={`book-cover book-cover-fallback ${className}`}
      style={{ background: `hsl(${hueFor(book.title)}, 35%, 30%)` }}
    >
      {book.title}
    </div>
  )
}

function Rating({ book }) {
  if (!book.rating_avg) return <span className="muted">No ratings yet</span>
  return (
    <span>
      ★ {Number(book.rating_avg).toFixed(1)}
      <span className="muted">
        {' '}
        ({book.rating_count} ratings on Open Library)
      </span>
    </span>
  )
}

function MyShelf({ mine, onChange }) {
  const status = mine?.status || 'unread'
  const rating = mine?.my_rating || 0
  return (
    <div className="my-shelf">
      <div className="shelf-label">My reading status</div>
      <div className="segmented">
        {STATUSES.map(([value, label]) => (
          <button
            key={value}
            className={status === value ? 'active' : ''}
            onClick={() => onChange({ status: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="shelf-label" style={{ marginTop: 12 }}>
        My rating
      </div>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={n <= rating ? 'star on' : 'star'}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={() => onChange({ my_rating: rating === n ? null : n })}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  )
}

function BookDetails({ book, mine, onSave, onPickCategory, onClose }) {
  const [extra, setExtra] = useState(null)

  useEffect(() => {
    supabase
      .from('books')
      .select('summary,awards')
      .eq('id', book.id)
      .single()
      .then(({ data }) => setExtra(data || {}))
  }, [book.id])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <Cover book={book} className="modal-cover" />
        <div className="modal-body">
          <h2>{book.title}</h2>
          <p className="muted">
            {book.author || 'Unknown author'}
            {book.published_year ? ` · first published ${book.published_year}` : ''}
          </p>
          <p>
            <Rating book={book} />
          </p>
          <MyShelf mine={mine} onChange={(changes) => onSave(book.id, changes)} />
          {book.categories?.length > 0 && (
            <div className="chips">
              {book.categories.map((c) => (
                <button
                  key={c}
                  className="chip chip-button"
                  title={`Show all "${c}" books`}
                  onClick={() => onPickCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <h3>Awards</h3>
          <p>{extra?.awards || <span className="muted">None recorded yet</span>}</p>
          <h3>Summary</h3>
          <p>
            {extra === null ? (
              <span className="muted">Loading...</span>
            ) : (
              extra.summary || <span className="muted">No summary available</span>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function Library({ userId }) {
  const [books, setBooks] = useState([])
  const [myBooks, setMyBooks] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ratingMin, setRatingMin] = useState('')
  const [sort, setSort] = useState('title')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    Promise.all([fetchAllBooks(), fetchMyBooks(userId)])
      .then(([b, mine]) => {
        setBooks(b)
        setMyBooks(new Map(mine.map((r) => [r.book_id, r])))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [userId])

  async function saveMine(bookId, changes) {
    const prev = myBooks.get(bookId)
    const next = {
      book_id: bookId,
      status: prev?.status || 'unread',
      my_rating: prev?.my_rating ?? null,
      ...changes,
    }
    // Giving a rating to a book you haven't marked yet means you've read it
    if (changes.my_rating && next.status === 'unread') next.status = 'read'

    setNotice('')
    setMyBooks((m) => new Map(m).set(bookId, next))
    const { error } = await supabase.from('user_books').upsert(
      {
        user_id: userId,
        book_id: bookId,
        status: next.status,
        my_rating: next.my_rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,book_id' }
    )
    if (error) {
      setMyBooks((m) => {
        const copy = new Map(m)
        if (prev) copy.set(bookId, prev)
        else copy.delete(bookId)
        return copy
      })
      setNotice(`Couldn't save that change: ${error.message}`)
    }
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map()
    for (const b of books)
      for (const c of b.categories || []) counts.set(c, (counts.get(c) || 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 60)
  }, [books])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const minRating = Number(ratingMin) || 0
    const list = books.filter((b) => {
      if (
        q &&
        !`${b.title} ${b.author || ''} ${(b.categories || []).join(' ')}`
          .toLowerCase()
          .includes(q)
      )
        return false
      if (category && !(b.categories || []).includes(category)) return false
      if (minRating && !(Number(b.rating_avg) >= minRating)) return false
      if (statusFilter !== 'all') {
        const s = myBooks.get(b.id)?.status || 'unread'
        if (s !== statusFilter) return false
      }
      return true
    })
    const sorters = {
      title: (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)),
      author: (a, b) =>
        lastName(a.author).localeCompare(lastName(b.author)) ||
        sortTitle(a.title).localeCompare(sortTitle(b.title)),
      rating: (a, b) => (Number(b.rating_avg) || 0) - (Number(a.rating_avg) || 0),
      popularity: (a, b) => (b.rating_count || 0) - (a.rating_count || 0),
    }
    return [...list].sort(sorters[sort])
  }, [books, myBooks, query, category, statusFilter, ratingMin, sort])

  const hasFilters = query || category || statusFilter !== 'all' || ratingMin

  function clearFilters() {
    setQuery('')
    setCategory('')
    setStatusFilter('all')
    setRatingMin('')
  }

  if (loading) return <p>Loading your library...</p>
  if (error) return <p style={{ color: 'tomato' }}>{error}</p>

  return (
    <div>
      <div className="library-toolbar">
        <input
          type="search"
          placeholder="Search title, author, or category"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {category && !categoryCounts.some(([c]) => c === category) && (
            <option value={category}>{category}</option>
          )}
          {categoryCounts.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Any reading status</option>
          {STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={ratingMin} onChange={(e) => setRatingMin(e.target.value)}>
          <option value="">Any rating</option>
          <option value="3">3.0+ stars</option>
          <option value="3.5">3.5+ stars</option>
          <option value="4">4.0+ stars</option>
          <option value="4.5">4.5+ stars</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="title">Sort: Title</option>
          <option value="author">Sort: Author</option>
          <option value="rating">Sort: Rating</option>
          <option value="popularity">Sort: Popularity</option>
        </select>
        {hasFilters && (
          <button className="clear-filters" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>
      <p className="muted" style={{ textAlign: 'center' }}>
        Showing {shown.length} of {books.length} books
      </p>
      {notice && <p style={{ color: 'tomato', textAlign: 'center' }}>{notice}</p>}
      <div className="book-grid">
        {shown.map((b) => {
          const status = myBooks.get(b.id)?.status
          return (
            <button key={b.id} className="book-card" onClick={() => setSelected(b)}>
              <div className="cover-wrap">
                <Cover book={b} />
                {status === 'read' && <span className="badge badge-read">✓ Read</span>}
                {status === 'reading' && (
                  <span className="badge badge-reading">Reading</span>
                )}
              </div>
              <div className="book-title">{b.title}</div>
              <div className="book-author muted">{b.author}</div>
            </button>
          )
        })}
      </div>
      {selected && (
        <BookDetails
          book={selected}
          mine={myBooks.get(selected.id)}
          onSave={saveMine}
          onPickCategory={(c) => {
            setCategory(c)
            setSelected(null)
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}