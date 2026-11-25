import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import './Library.css'

const COLUMNS =
  'id,title,author,cover_url,categories,rating_avg,rating_count,published_year'

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

function BookDetails({ book, onClose }) {
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
          {book.categories?.length > 0 && (
            <div className="chips">
              {book.categories.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
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

export default function Library() {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('title')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetchAllBooks()
      .then(setBooks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = books.filter(
      (b) =>
        !q ||
        `${b.title} ${b.author || ''} ${(b.categories || []).join(' ')}`
          .toLowerCase()
          .includes(q)
    )
    const sorters = {
      title: (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)),
      author: (a, b) =>
        lastName(a.author).localeCompare(lastName(b.author)) ||
        sortTitle(a.title).localeCompare(sortTitle(b.title)),
      rating: (a, b) => (b.rating_avg || 0) - (a.rating_avg || 0),
    }
    return [...list].sort(sorters[sort])
  }, [books, query, sort])

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
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="title">Sort: Title</option>
          <option value="author">Sort: Author</option>
          <option value="rating">Sort: Rating</option>
        </select>
      </div>
      <p className="muted" style={{ textAlign: 'center' }}>
        Showing {shown.length} of {books.length} books
      </p>
      <div className="book-grid">
        {shown.map((b) => (
          <button key={b.id} className="book-card" onClick={() => setSelected(b)}>
            <Cover book={b} />
            <div className="book-title">{b.title}</div>
            <div className="book-author muted">{b.author}</div>
          </button>
        ))}
      </div>
      {selected && <BookDetails book={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}