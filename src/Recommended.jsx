import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { Cover } from './Library'
import './Library.css'

const RATING_WEIGHT = { 1: -2, 2: -1, 3: 0, 4: 1, 5: 2 }
const MAX_PER_AUTHOR = 3
const PAGE = 24

async function fetchPaged(buildQuery) {
  const pageSize = 1000
  let all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data)
    if (data.length < pageSize) break
  }
  return all
}

const fetchBooks = () =>
  fetchPaged(() =>
    supabase
      .from('books')
      .select('id,title,author,cover_url,categories,rating_avg,rating_count')
      .order('id')
  )

const fetchMine = (userId) =>
  fetchPaged(() =>
    supabase
      .from('user_books')
      .select('book_id,status,my_rating')
      .eq('user_id', userId)
      .order('book_id')
  )

const fetchOut = () =>
  fetchPaged(() =>
    supabase.from('checkouts').select('id,book_id').is('returned_at', null).order('id')
  )

function buildRecommendations(books, mine) {
  const N = books.length || 1
  const df = new Map()
  for (const b of books)
    for (const c of new Set(b.categories || [])) df.set(c, (df.get(c) || 0) + 1)
  const idf = (c) => Math.max(0, Math.log(N / (1 + (df.get(c) || 0))))

  // Learn the reader's taste from books they've read, reading, or rated
  const catAffinity = new Map()
  const authorAffinity = new Map()
  let positive = 0
  for (const b of books) {
    const m = mine.get(b.id)
    if (!m) continue
    const w = m.my_rating ? RATING_WEIGHT[m.my_rating] : m.status === 'unread' ? 0 : 0.5
    if (!w) continue
    if (w > 0) positive++
    const cats = b.categories || []
    for (const c of cats)
      catAffinity.set(c, (catAffinity.get(c) || 0) + w / Math.sqrt(cats.length))
    if (b.author) authorAffinity.set(b.author, (authorAffinity.get(b.author) || 0) + w)
  }

  // Only books they haven't read yet
  const candidates = books.filter((b) => {
    const m = mine.get(b.id)
    return !m || (m.status === 'unread' && !m.my_rating)
  })

  // Don't let one author fill the whole list
  const capByAuthor = (list) => {
    const counts = new Map()
    return list.filter(({ book }) => {
      const key = book.author || book.id
      const n = counts.get(key) || 0
      counts.set(key, n + 1)
      return n < MAX_PER_AUTHOR
    })
  }

  if (positive > 0) {
    const scored = candidates.map((b) => {
      const cats = b.categories || []
      const contributions = cats.map((c) => [c, (catAffinity.get(c) || 0) * idf(c)])
      const catScore =
        contributions.reduce((sum, [, v]) => sum + v, 0) / Math.sqrt(Math.max(cats.length, 1))
      const authorScore = authorAffinity.get(b.author) || 0
      const quality =
        b.rating_avg && b.rating_count >= 5 ? (Number(b.rating_avg) - 3.5) * 0.6 : 0
      const score = catScore + authorScore * 1.5 + quality

      let reason = ''
      if (authorScore > 0) {
        reason = `More from ${b.author}, an author you've enjoyed`
      } else {
        const top = contributions
          .filter(([, v]) => v > 0)
          .sort((a, z) => z[1] - a[1])
          .slice(0, 2)
          .map(([c]) => c)
        if (top.length) reason = `Because you enjoy ${top.join(' and ')}`
        else if (quality > 0) reason = 'Highly rated by readers'
      }
      return { book: b, score, reason }
    })
    return {
      mode: 'taste',
      items: capByAuthor(scored.filter((s) => s.score > 0).sort((a, z) => z.score - a.score)),
    }
  }

  // No ratings yet: fall back to top-rated unread books
  const popular = candidates
    .filter((b) => b.rating_avg)
    .map((b) => ({
      book: b,
      score: Number(b.rating_avg) * Math.log(1 + (b.rating_count || 0)),
      reason: `Rated ★ ${Number(b.rating_avg).toFixed(1)} on Open Library`,
    }))
    .sort((a, z) => z.score - a.score)
  return { mode: 'popular', items: capByAuthor(popular) }
}

export default function Recommended({ userId, onOpen }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  useEffect(() => {
    Promise.all([fetchBooks(), fetchMine(userId), fetchOut()])
      .then(([books, mine, out]) =>
        setData({
          books,
          mine: new Map(mine.map((r) => [r.book_id, r])),
          out: new Set(out.map((c) => c.book_id)),
        })
      )
      .catch((e) => setError(e.message))
  }, [userId])

  const result = useMemo(
    () => (data ? buildRecommendations(data.books, data.mine) : null),
    [data]
  )

  if (error) return <p style={{ color: 'tomato' }}>{error}</p>
  if (!data) return <p>Finding books you might like...</p>

  const items = result.items.filter(({ book }) => !onlyAvailable || !data.out.has(book.id))
  const visible = items.slice(0, limit)

  return (
    <div>
      <h2 style={{ textAlign: 'center', marginBottom: 4 }}>
        {result.mode === 'taste' ? 'Picked for you' : 'Top-rated books you haven’t read'}
      </h2>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
        {result.mode === 'taste'
          ? 'Based on the books you’ve rated and marked as read. The more you rate, the better these get.'
          : 'Rate some books you’ve read (4 or 5 stars for favorites, 1 or 2 for ones you didn’t enjoy) and this tab will tailor itself to you.'}
      </p>
      <div className="library-toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => {
              setOnlyAvailable(e.target.checked)
              setLimit(PAGE)
            }}
          />
          Only show available books
        </label>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center' }}>
          Nothing to suggest yet. Rate a few more books, or add more books to the library.
        </p>
      ) : (
        <div className="book-grid">
          {visible.map(({ book, reason }) => (
            <button key={book.id} className="book-card" onClick={() => onOpen(book.id)}>
              <div className="cover-wrap">
                <Cover book={book} />
                {data.out.has(book.id) && <span className="badge badge-out">Checked out</span>}
              </div>
              <div className="book-title">{book.title}</div>
              <div className="book-author muted">{book.author}</div>
              {reason && <div className="rec-reason">{reason}</div>}
            </button>
          ))}
        </div>
      )}
      {items.length > limit && (
        <p style={{ textAlign: 'center' }}>
          <button className="clear-filters" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </button>
        </p>
      )}
    </div>
  )
}