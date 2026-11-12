import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { shell } from 'electron'
import { parseFile } from 'music-metadata'
import * as store from './store.js'
import { tidyName } from './tidy.js'

const AUDIO = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus'])

let root = null
let cache = null
let watcher = null

export const dir = () => root

export function open(folder, onChange) {
  root = path.resolve(folder)
  fs.mkdirSync(root, { recursive: true })
  watcher?.close()
  let t = null
  try {
    watcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(t)
      t = setTimeout(onChange, 700)
    })
    watcher.on('error', () => {})
  } catch {}
}

export function inside(p, base = root) {
  const rel = path.relative(base, path.resolve(String(p)))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const pretty = (name) => name
  .replace(/[\u2010-\u2015\u2043\u2212]/g, '-')
  .replace(/_+/g, ' ')
  .replace(/\s+-\s*|\s*-\s+/g, ' - ')
  .replace(/\s{2,}/g, ' ')
  .replace(/^[\s\-.]+|[\s\-.]+$/g, '')

async function pool(items, n, fn) {
  let i = 0
  const lane = async () => { while (i < items.length) await fn(items[i++]) }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane))
}

async function walk(folder, out = []) {
  for (const e of await fsp.readdir(folder, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const full = path.join(folder, e.name)
    if (e.isDirectory()) await walk(full, out)
    else if (e.isFile() && AUDIO.has(path.extname(e.name).toLowerCase())) out.push(full)
  }
  return out
}

async function tags(file) {
  try {
    const { common, format } = await parseFile(file, { duration: false, skipCovers: true })
    return { title: common.title || null, artist: common.artist || null, album: common.album || null, duration: format.duration || 0 }
  } catch {
    return { title: null, artist: null, album: null, duration: 0 }
  }
}

function track(file, c, titles) {
  const parts = path.relative(root, file).split(path.sep)
  return {
    path: file,
    url: pathToFileURL(file).href,
    playlist: parts.length > 1 ? parts[0] : null,
    title: titles[file] || c.title?.replace(/\s+/g, ' ').trim() || pretty(path.basename(file, path.extname(file))),
    artist: c.artist || '',
    sub: [c.artist, c.album].filter(Boolean).join(' / '),
    duration: c.duration || 0,
    added: c.added || 0,
    size: c.size,
    wave: c.wave || null,
  }
}

async function tidyAll(files) {
  if (store.load('settings', {}).tidy_names === false) return files
  const moves = []
  const out = []
  for (const from of files) {
    const to = path.join(path.dirname(from), tidyName(path.basename(from)))
    if (to === from || (fs.existsSync(to) && to.toLowerCase() !== from.toLowerCase())) { out.push(from); continue }
    try {
      await fsp.rename(from, to)
      moves.push({ from, to })
      out.push(to)
    } catch {
      out.push(from)
    }
  }
  if (moves.length) {
    rekey(moves)
    const at = Date.now()
    store.save('renames', [...store.load('renames', []), ...moves.map((m) => ({ ...m, at }))].slice(-1000))
  }
  return out
}

export async function scan(titles) {
  cache ??= store.load('library', { tracks: {} })
  const files = (await tidyAll(await walk(root))).sort()
  const known = {}
  const fresh = []
  let totalBytes = 0
  await pool(files, 32, async (file) => {
    const st = await fsp.stat(file)
    totalBytes += st.size
    const hit = cache.tracks[file]
    if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) known[file] = hit
    else fresh.push([file, st])
  })
  await pool(fresh, 6, async ([file, st]) => {
    known[file] = { size: st.size, mtime: st.mtimeMs, added: Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs), ...await tags(file) }
  })
  if (fresh.length || Object.keys(cache.tracks).length !== files.length) {
    cache.tracks = known
    store.save('library', cache)
  }
  const lists = (await fsp.readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
  return { dir: root, totalBytes, lists, tracks: files.map((f) => track(f, known[f], titles)) }
}

function note(file, key, value) {
  const c = cache?.tracks[file]
  if (!c || c[key] === value) return
  c[key] = value
  store.save('library', cache)
}
export const setDuration = (file, seconds) => note(file, 'duration', seconds)
export const setWave = (file, peaks) => note(file, 'wave', peaks)

function rekey(moves) {
  if (!moves.length) return
  for (const name of ['covers', 'titles']) {
    const map = store.load(name, {})
    let hit = false
    for (const { from, to } of moves) {
      if (from in map) { map[to] = map[from]; delete map[from]; hit = true }
    }
    if (hit) store.save(name, map)
  }
  if (cache) {
    for (const { from, to } of moves) {
      if (cache.tracks[from]) { cache.tracks[to] = cache.tracks[from]; delete cache.tracks[from] }
    }
    store.save('library', cache)
  }
}

function free(folder, base) {
  const ext = path.extname(base)
  const stem = path.basename(base, ext)
  let dest = path.join(folder, base)
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(folder, `${stem} (${i})${ext}`)
  return dest
}

export async function move(paths, dest) {
  await fsp.mkdir(dest, { recursive: true })
  const moves = []
  for (const from of paths) {
    if (!inside(from) || path.dirname(from) === dest) continue
    const to = free(dest, path.basename(from))
    try {
      await fsp.rename(from, to)
    } catch {
      try {
        await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL)
        await fsp.unlink(from)
      } catch {
        continue
      }
    }
    moves.push({ from, to })
  }
  rekey(moves)
  return moves
}

export async function trash(paths) {
  const done = []
  for (const p of paths) {
    if (!inside(p)) continue
    try {
      await shell.trashItem(p)
      done.push(p)
    } catch {}
  }
  return done
}

const clean = (name) => String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim()
const list = (name) => {
  const d = path.join(root, clean(name))
  return path.dirname(d) === root && clean(name) ? d : null
}

export async function createList(name) {
  const d = list(name)
  if (!d) return { error: 'invalid' }
  if (fs.existsSync(d)) return { error: 'exists' }
  await fsp.mkdir(d)
  return { name: path.basename(d) }
}

export async function renameList(from, to) {
  const a = list(from), b = list(to)
  if (!a || !b) return { error: 'invalid' }
  if (!fs.existsSync(a)) return { error: 'missing' }
  if (fs.existsSync(b) && a.toLowerCase() !== b.toLowerCase()) return { error: 'exists' }
  const files = await walk(a)
  await fsp.rename(a, b)
  rekey(files.map((f) => ({ from: f, to: path.join(b, path.relative(a, f)) })))
  return { name: path.basename(b) }
}

export async function dissolveList(name) {
  const d = list(name)
  if (!d || !fs.existsSync(d)) return { error: 'missing' }
  const files = await walk(d)
  const moves = await move(files, root)
  if (moves.length === files.length) await shell.trashItem(d).catch(() => {})
  return { moved: moves.length }
}
