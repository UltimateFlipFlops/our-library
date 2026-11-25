import { useRef, useState } from 'react'
import { supabase } from './supabaseClient'

const DELAY = 500 // pause between Open Library requests, to be polite
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) =>
    (s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const JUNK_SUBJECT =
  /accessible|protected daisy|in library|large type|reading level|^nyt:|^series:|lending library|overdrive/i

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((r) => r.map((s) => s.trim())).filter((r) => r[0])
}

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch (err) {
      if (i === tries - 1) throw err
    }
    await sleep(2000 * (i + 1))
  }
  throw new Error('Open Library is not responding')
}

function cleanDescription(d) {
  if (!d) return null
  let text = typeof d === 'string' ? d : d.value
  if (!text) return null
  text = text.split(/\r?\n-{5,}/)[0]
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
  return text.slice(0, 2000) || null
}

async function lookupBook(rawTitle, author) {
  const searchTitle = rawTitle.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  const base =
    'https://openlibrary.org/search.json?limit=10&fields=key,title,author_name,first_publish_year,cover_i,subject,ratings_average,ratings_count'
  const url = (a) =>
    `${base}&title=${encodeURIComponent(searchTitle)}` +
    (a ? `&author=${encodeURIComponent(a)}` : '')

  let data = await fetchJson(url(author))
  await sleep(DELAY)
  if (!data.docs?.length && author) {
    data = await fetchJson(url(''))
    await sleep(DELAY)
  }
  const docs = data.docs || []
  const target = norm(searchTitle)
  const pick = (list) => list.find((d) => d.cover_i) || list[0]
  const exact = docs.filter((d) => norm(d.title) === target)
  const loose = docs.filter(
    (d) => norm(d.title).includes(target) || target.includes(norm(d.title))
  )
  const doc = exact.length ? pick(exact) : loose.length ? pick(loose) : null
  if (!doc) return { doc: null }

  let summary = null
  try {
    const work = await fetchJson(`https://openlibrary.org${doc.key}.json`)
    summary = cleanDescription(work.description)
  } catch {
    // no summary available, that's okay
  }
  await sleep(DELAY)
  return { doc, summary, weak: !exact.length }
}

async function importRow(title, author) {
  const { doc, summary, weak } = await lookupBook(title, author)

  if (!doc) {
    const { data: existing } = await supabase
      .from('books')
      .select('id')
      .eq('title', title)
      .is('ol_work_key', null)
      .limit(1)
    if (existing?.length) return { status: 'duplicate', note: 'already in library' }
    const { error } = await supabase
      .from('books')
      .insert({ title, author: author || null })
    if (error) throw error
    return { status: 'notfound', note: 'not found on Open Library, saved title only' }
  }

  const row = {
    ol_work_key: doc.key,
    title: doc.title,
    author: doc.author_name?.[0] || author || null,
    cover_url: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : null,
    summary,
    categories: (doc.subject || [])
      .filter((s) => s.length <= 30 && !JUNK_SUBJECT.test(s))
      .slice(0, 8),
    published_year: doc.first_publish_year || null,
    rating_avg: doc.ratings_average ? Number(doc.ratings_average.toFixed(2)) : null,
    rating_count: doc.ratings_count || null,
  }
  const { data, error } = await supabase
    .from('books')
    .upsert(row, { onConflict: 'ol_work_key', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  if (!data?.length) return { status: 'duplicate', note: 'already in library' }
  return weak
    ? { status: 'weak', note: `matched "${doc.title}", please double-check` }
    : { status: 'ok', note: `added "${doc.title}"` }
}

const COLORS = {
  ok: '#4caf50',
  weak: '#ffb300',
  notfound: '#ffb300',
  duplicate: '#9e9e9e',
  error: '#ef5350',
  info: '#90caf9',
}

export default function Import() {
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [log, setLog] = useState([])
  const stopRef = useRef(false)

  const addLog = (status, msg) => setLog((l) => [{ status, msg }, ...l])

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (file) setText(await file.text())
  }

  async function start() {
    const rows = parseCsv(text)
    if (rows[0] && rows[0][0].toLowerCase() === 'title') rows.shift()
    if (!rows.length) return
    stopRef.current = false
    setRunning(true)
    setLog([])
    setProgress({ done: 0, total: rows.length })

    for (let i = 0; i < rows.length; i++) {
      if (stopRef.current) {
        addLog('info', 'Stopped. Run the rest later; books already added are skipped.')
        break
      }
      const [title, author = ''] = rows[i]
      try {
        const r = await importRow(title, author)
        addLog(r.status, `${title}: ${r.note}`)
      } catch (err) {
        addLog('error', `${title}: ${err.message || err}`)
      }
      setProgress({ done: i + 1, total: rows.length })
    }
    setRunning(false)
  }

  return (
    <div>
      <h2>Import books</h2>
      <p>
        Paste a list with one book per line as <code>title,author</code> (or upload
        a .csv file). Covers, summaries, and categories are filled in from Open
        Library.
      </p>
      <input type="file" accept=".csv,.txt" onChange={onFile} disabled={running} />
      <textarea
        rows={10}
        style={{ width: '100%', marginTop: 8 }}
        placeholder={'title,author\nThe Hobbit,J.R.R. Tolkien'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={running}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button onClick={start} disabled={running || !text.trim()}>
          Start import
        </button>
        <button onClick={() => (stopRef.current = true)} disabled={!running}>
          Stop
        </button>
        {progress.total > 0 && (
          <span>
            {progress.done} / {progress.total}
          </span>
        )}
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 12, textAlign: 'left' }}>
        {log.map((l, i) => (
          <div key={i} style={{ color: COLORS[l.status], fontSize: 14, padding: '2px 0' }}>
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  )
}