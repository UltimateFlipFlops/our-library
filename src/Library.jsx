import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { todayStr, fmtDate, borrowerLabel } from './helpers'
import './Library.css'

const COLUMNS =
  'id,title,author,cover_url,categories,rating_avg,rating_count,published_year'

const STATUSES = [
  ['unread', 'Not read yet'],
  ['reading', 'Reading'],
  ['read', 'Read'],
]

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

const fetchAllBooks = () =>
  fetchPaged(() =>
    supabase.from('books').select(COLUMNS).order('title').order('id')
  )

const fetchMyBooks = (userId) =>
  fetchPaged(() =>
    supabase
      .from('user_books')
      .select('book_id,status,my_rating')
      .eq('user_id', userId)
      .order('book_id')
  )

async function fetchLists(userId) {
  const { data, error } = await supabase
    .from('lists')
    .select('id,name')
    .eq('user_id', userId)
    .order('created_at')
  if (error) throw error
  return data
}

const fetchListItems = () =>
  fetchPaged(() =>
    supabase
      .from('list_items')
      .select('list_id,book_id')
      .order('list_id')
      .order('book_id')
  )

const CHECKOUT_COLUMNS = 'id,book_id,borrower_id,borrower_name,checked_out_at,due_date'

const fetchActiveCheckouts = () =>
  fetchPaged(() =>
    supabase
      .from('checkouts')
      .select(CHECKOUT_COLUMNS)
      .is('returned_at', null)
      .order('id')
  )

async function fetchProfiles() {
  const { data, error } = await supabase.from('profiles').select('id,display_name')
  if (error) throw error
  return data
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

function MyLists({ book, lists, listItems, onToggle, onCreate }) {
  const [name, setName] = useState('')
  return (
    <div className="my-shelf">
      <div className="shelf-label">My lists</div>
      {lists.length > 0 && (
        <div className="chips">
          {lists.map((l) => {
            const inList = listItems.get(l.id)?.has(book.id)
            return (
              <button
                key={l.id}
                className={`chip chip-button ${inList ? 'chip-on' : ''}`}
                onClick={() => onToggle(l.id, book.id, !inList)}
              >
                {inList ? '✓ ' : '+ '}
                {l.name}
              </button>
            )
          })}
        </div>
      )}
      <form
        className="new-list"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onCreate(name, book.id)
          setName('')
        }}
      >
        <input
          placeholder={lists.length ? 'New list name' : 'Make your first list, e.g. To Be Read'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={!name.trim()}>
          Create and add
        </button>
      </form>
    </div>
  )
}

function Availability({ book, checkout, userId, isAdmin, profiles, onCheckOut, onReturn }) {
  const [due, setDue] = useState('')
  const [who, setWho] = useState(userId)
  const [guest, setGuest] = useState('')

  if (checkout) {
    const overdue = checkout.due_date && checkout.due_date < todayStr()
    return (
      <div className="my-shelf">
        <div className="shelf-label">Availability</div>
        <p style={{ margin: '0 0 8px' }}>
          Checked out to <strong>{borrowerLabel(checkout, profiles, userId)}</strong> on{' '}
          {fmtDate(checkout.checked_out_at)}
          {checkout.due_date && (
            <span style={{ color: overdue ? 'tomato' : 'inherit' }}>
              {' '}
              · due {fmtDate(checkout.due_date)}
              {overdue ? ' (overdue)' : ''}
            </span>
          )}
        </p>
        {(checkout.borrower_id === userId || isAdmin) && (
          <button onClick={() => onReturn(checkout)}>Return book</button>
        )}
      </div>
    )
  }

  const members = [...profiles.entries()]
    .filter(([id]) => id !== userId)
    .sort((a, b) => a[1].localeCompare(b[1]))
  const canSubmit = who !== 'guest' || guest.trim()

  return (
    <div className="my-shelf">
      <div className="shelf-label">Availability</div>
      <p style={{ margin: '0 0 8px' }}>✓ Available</p>
      <div className="checkout-form">
        {isAdmin && (
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value={userId}>Check out to me</option>
            {members.map(([id, name]) => (
              <option key={id} value={id}>
                Check out to {name}
              </option>
            ))}
            <option value="guest">Check out to someone without an account…</option>
          </select>
        )}
        {isAdmin && who === 'guest' && (
          <input
            placeholder="Their name"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
          />
        )}
        <label className="muted" style={{ fontSize: 13 }}>
          Due back (optional){' '}
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button
          disabled={!canSubmit}
          onClick={() =>
            onCheckOut(book.id, {
              dueDate: due,
              borrowerId: who === 'guest' ? null : isAdmin ? who : userId,
              borrowerName: who === 'guest' ? guest.trim() : null,
            })
          }
        >
          Check out
        </button>
      </div>
    </div>
  )
}

function ManageLists({ lists, listItems, onRename, onDelete, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 style={{ margin: 0 }}>Manage my lists</h2>
        {lists.length === 0 && (
          <p className="muted">
            You don't have any lists yet. Open a book and create one from its popup.
          </p>
        )}
        {lists.map((l) => (
          <div key={l.id} className="list-row">
            <span className="grow">
              {l.name}{' '}
              <span className="muted">({listItems.get(l.id)?.size || 0} books)</span>
            </span>
            <button
              onClick={() => {
                const name = window.prompt('Rename list', l.name)
                if (name && name.trim()) onRename(l.id, name)
              }}
            >
              Rename
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the list "${l.name}"? The books themselves are not deleted.`
                  )
                )
                  onDelete(l.id)
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function BookDetails({
  book,
  mine,
  onSave,
  lists,
  listItems,
  onToggleList,
  onCreateList,
  checkout,
  profiles,
  userId,
  isAdmin,
  onCheckOut,
  onReturn,
  onPickCategory,
  onClose,
}) {
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
          <Availability
            book={book}
            checkout={checkout}
            userId={userId}
            isAdmin={isAdmin}
            profiles={profiles}
            onCheckOut={onCheckOut}
            onReturn={onReturn}
          />
          <MyShelf mine={mine} onChange={(changes) => onSave(book.id, changes)} />
          <MyLists
            book={book}
            lists={lists}
            listItems={listItems}
            onToggle={onToggleList}
            onCreate={onCreateList}
          />
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

export default function Library({ userId, isAdmin }) {
  const [books, setBooks] = useState([])
  const [myBooks, setMyBooks] = useState(new Map())
  const [lists, setLists] = useState([])
  const [listItems, setListItems] = useState(new Map())
  const [checkouts, setCheckouts] = useState(new Map())
  const [profiles, setProfiles] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ratingMin, setRatingMin] = useState('')
  const [listFilter, setListFilter] = useState('')
  const [availFilter, setAvailFilter] = useState('all')
  const [sort, setSort] = useState('title')
  const [selected, setSelected] = useState(null)
  const [showManage, setShowManage] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchAllBooks(),
      fetchMyBooks(userId),
      fetchLists(userId),
      fetchListItems(),
      fetchActiveCheckouts(),
      fetchProfiles(),
    ])
      .then(([b, mine, ls, items, outs, profs]) => {
        setBooks(b)
        setMyBooks(new Map(mine.map((r) => [r.book_id, r])))
        setLists(ls)
        const map = new Map(ls.map((l) => [l.id, new Set()]))
        for (const it of items) map.get(it.list_id)?.add(it.book_id)
        setListItems(map)
        setCheckouts(new Map(outs.map((c) => [c.book_id, c])))
        setProfiles(new Map(profs.map((p) => [p.id, p.display_name])))
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

  async function toggleInList(listId, bookId, add) {
    setNotice('')
    const apply = (adding) =>
      setListItems((m) => {
        const copy = new Map(m)
        const set = new Set(copy.get(listId) || [])
        if (adding) set.add(bookId)
        else set.delete(bookId)
        copy.set(listId, set)
        return copy
      })
    apply(add)
    const { error } = add
      ? await supabase.from('list_items').insert({ list_id: listId, book_id: bookId })
      : await supabase
          .from('list_items')
          .delete()
          .eq('list_id', listId)
          .eq('book_id', bookId)
    // 23505 means it was already in the list, which is fine
    if (error && error.code !== '23505') {
      apply(!add)
      setNotice(`Couldn't update that list: ${error.message}`)
    }
  }

  async function createList(name, firstBookId) {
    const clean = name.trim()
    if (!clean) return
    setNotice('')
    const { data, error } = await supabase
      .from('lists')
      .insert({ user_id: userId, name: clean })
      .select('id,name')
      .single()
    if (error) {
      setNotice(`Couldn't create the list: ${error.message}`)
      return
    }
    setLists((l) => [...l, data])
    setListItems((m) => new Map(m).set(data.id, new Set()))
    if (firstBookId) await toggleInList(data.id, firstBookId, true)
  }

  async function renameList(id, name) {
    const clean = name.trim()
    if (!clean) return
    setNotice('')
    const { error } = await supabase.from('lists').update({ name: clean }).eq('id', id)
    if (error) setNotice(`Couldn't rename the list: ${error.message}`)
    else setLists((l) => l.map((x) => (x.id === id ? { ...x, name: clean } : x)))
  }

  async function deleteList(id) {
    setNotice('')
    const { error } = await supabase.from('lists').delete().eq('id', id)
    if (error) {
      setNotice(`Couldn't delete the list: ${error.message}`)
      return
    }
    setLists((l) => l.filter((x) => x.id !== id))
    setListItems((m) => {
      const copy = new Map(m)
      copy.delete(id)
      return copy
    })
    if (listFilter === id) setListFilter('')
  }

  async function checkOut(bookId, { dueDate, borrowerId, borrowerName }) {
    setNotice('')
    const { data, error } = await supabase
      .from('checkouts')
      .insert({
        book_id: bookId,
        borrower_id: borrowerId || null,
        borrower_name: borrowerName || null,
        due_date: dueDate || null,
      })
      .select(CHECKOUT_COLUMNS)
      .single()
    if (error) {
      setNotice(
        error.code === '23505'
          ? 'Someone just checked that book out. Refresh to see who has it.'
          : `Couldn't check that book out: ${error.message}`
      )
      return
    }
    setCheckouts((m) => new Map(m).set(bookId, data))
  }

  async function returnBook(checkout) {
    setNotice('')
    const { data, error } = await supabase
      .from('checkouts')
      .update({ returned_at: new Date().toISOString() })
      .eq('id', checkout.id)
      .select('id')
    if (error || !data?.length) {
      setNotice(`Couldn't return that book${error ? ': ' + error.message : ''}`)
      return
    }
    setCheckouts((m) => {
      const copy = new Map(m)
      copy.delete(checkout.book_id)
      return copy
    })
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
    const inList = listFilter ? listItems.get(listFilter) : null
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
      if (listFilter && !inList?.has(b.id)) return false
      if (availFilter !== 'all') {
        const c = checkouts.get(b.id)
        if (availFilter === 'available' && c) return false
        if (availFilter === 'out' && !c) return false
        if (availFilter === 'mine' && c?.borrower_id !== userId) return false
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
  }, [
    books,
    myBooks,
    listItems,
    checkouts,
    userId,
    query,
    category,
    statusFilter,
    ratingMin,
    listFilter,
    availFilter,
    sort,
  ])

  const hasFilters =
    query ||
    category ||
    statusFilter !== 'all' ||
    ratingMin ||
    listFilter ||
    availFilter !== 'all'

  function clearFilters() {
    setQuery('')
    setCategory('')
    setStatusFilter('all')
    setRatingMin('')
    setListFilter('')
    setAvailFilter('all')
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
        <select value={availFilter} onChange={(e) => setAvailFilter(e.target.value)}>
          <option value="all">Any availability</option>
          <option value="available">Available</option>
          <option value="out">Checked out</option>
          <option value="mine">Checked out to me</option>
        </select>
        <select value={listFilter} onChange={(e) => setListFilter(e.target.value)}>
          <option value="">Any list</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({listItems.get(l.id)?.size || 0})
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
        <button className="clear-filters" onClick={() => setShowManage(true)}>
          Manage lists
        </button>
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
          const out = checkouts.get(b.id)
          return (
            <button key={b.id} className="book-card" onClick={() => setSelected(b)}>
              <div className="cover-wrap">
                <Cover book={b} />
                {status === 'read' && <span className="badge badge-read">✓ Read</span>}
                {status === 'reading' && (
                  <span className="badge badge-reading">Reading</span>
                )}
                {out && (
                  <span className="badge badge-out">
                    {out.borrower_id === userId ? 'With me' : 'Checked out'}
                  </span>
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
          lists={lists}
          listItems={listItems}
          onToggleList={toggleInList}
          onCreateList={createList}
          checkout={checkouts.get(selected.id)}
          profiles={profiles}
          userId={userId}
          isAdmin={isAdmin}
          onCheckOut={checkOut}
          onReturn={returnBook}
          onPickCategory={(c) => {
            setCategory(c)
            setSelected(null)
          }}
          onClose={() => setSelected(null)}
        />
      )}
      {showManage && (
        <ManageLists
          lists={lists}
          listItems={listItems}
          onRename={renameList}
          onDelete={deleteList}
          onClose={() => setShowManage(false)}
        />
      )}
    </div>
  )
}