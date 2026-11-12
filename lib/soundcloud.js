import { parseBuffer } from 'music-metadata'
import { flatten, fragmented, encrypted } from './mp4.js'
import { tidy } from './tidy.js'

const API = 'https://api-v2.soundcloud.com'
const DRM = 'drm protected on soundcloud, only its own player can play it'
const ID_TTL = 30 * 60 * 1000
const MAX_LIKES = 500

let clientId = null
let clientIdAt = 0

// the public client id soundcloud.com uses itself
async function scrapeClientId() {
  const home = await fetch('https://soundcloud.com').then((r) => r.text())
  const scripts = [...home.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^\s"]+\.js)"/g)].map((m) => m[1])
  for (const src of scripts.reverse()) {
    const id = (await fetch(src).then((r) => r.text())).match(/client_id:"([^"]+)"/)
    if (id) return id[1]
  }
  throw new Error('soundcloud changed its site, no client id found')
}

async function id(refresh = false) {
  if (refresh || !clientId || Date.now() - clientIdAt > ID_TTL) {
    clientId = await scrapeClientId()
    clientIdAt = Date.now()
  }
  return clientId
}

async function get(url, params = {}, retry = true) {
  const qs = new URLSearchParams({ ...params, client_id: await id() })
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}${qs}`)
  if ((res.status === 401 || res.status === 403) && retry) {
    await id(true)
    return get(url, params, false)
  }
  if (!res.ok) throw new Error(`soundcloud said ${res.status}`)
  return res.json()
}

function preview(t) {
  const streams = t.media?.transcodings || []
  return t.policy === 'SNIP' || t.policy === 'BLOCK' || (streams.length > 0 && streams.every((s) => s.snipped))
}

// encrypted hls is drm, only soundcloud's own player can play those
const CLEAR = ['progressive', 'hls']
const playable = (t) => (t.media?.transcodings || []).filter((s) => !s.snipped && CLEAR.includes(s.format?.protocol))
const drm = (t) => (t.media?.transcodings || []).length > 0 && !preview(t) && !playable(t).length

const art = (t) => (t.artwork_url || t.user?.avatar_url || '').replace('-large.', '-t500x500.') || null

function simplify(t) {
  const lock = preview(t) ? 'go+' : drm(t) ? 'drm' : null
  return {
    id: t.id,
    title: t.title || '',
    uploader: t.user?.username || 'unknown',
    artist: t.publisher_metadata?.artist || '',
    duration: Math.round((t.full_duration || t.duration || 0) / 1000),
    artworkUrl: art(t),
    preview: !!lock,
    lock,
  }
}

export async function search(q, limit = 20) {
  const data = await get(`${API}/search/tracks`, { q, limit: String(limit), offset: '0', linked_partitioning: '1', app_locale: 'en' })
  return (data.collection || []).map(simplify)
}

async function hydrate(stubs) {
  const missing = stubs.filter((t) => !t.media).map((t) => t.id)
  const full = new Map()
  for (let i = 0; i < missing.length; i += 50) {
    for (const t of await get(`${API}/tracks`, { ids: missing.slice(i, i + 50).join(',') })) full.set(t.id, t)
  }
  return stubs.map((t) => full.get(t.id) || t)
}

async function likes(userId, progress) {
  const tracks = []
  let next = `${API}/users/${userId}/track_likes?limit=50&linked_partitioning=1`
  while (next && tracks.length < MAX_LIKES) {
    const data = await get(next)
    for (const item of data.collection || []) if (item.track) tracks.push(item.track)
    progress?.(tracks.length)
    next = data.next_href || null
  }
  return { tracks: tracks.slice(0, MAX_LIKES), truncated: !!next }
}

export async function resolve(url, progress) {
  let found
  try {
    found = await get(`${API}/resolve`, { url })
  } catch {
    throw new Error('not a soundcloud track, playlist or profile url')
  }
  if (found.kind === 'track') return { kind: 'track', label: found.title, tracks: [simplify(found)], truncated: false }
  if (found.kind === 'playlist') return { kind: 'playlist', label: found.title, tracks: (await hydrate(found.tracks || [])).map(simplify), truncated: false }
  if (found.kind === 'user') {
    const { tracks, truncated } = await likes(found.id, progress)
    return { kind: 'user', label: found.username, tracks: tracks.map(simplify), truncated }
  }
  throw new Error(`can't download a soundcloud ${found.kind || 'thing'} like that`)
}

async function bytes(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

async function hls(m3u8) {
  const text = await (await fetch(m3u8)).text()
  if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) throw new Error(DRM)
  const abs = (u) => new URL(u, m3u8).toString()
  const map = text.match(/#EXT-X-MAP:URI="([^"]+)"/)
  const parts = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(abs)
  if (!parts.length) throw new Error('empty stream')
  const out = map ? [await bytes(abs(map[1]))] : []
  for (const p of parts) out.push(await bytes(p))
  return Buffer.concat(out)
}

function streams(meta) {
  const ok = playable(meta)
  const mp3 = ok.filter((s) => s.format?.mime_type?.startsWith('audio/mpeg'))
  const aac = ok.filter((s) => s.format?.mime_type?.startsWith('audio/mp4'))
  return [...mp3.filter((s) => s.format.protocol === 'progressive'), ...mp3.filter((s) => s.format.protocol === 'hls'), ...aac]
}

const dashes = (s) => String(s).replace(/[\u2010-\u2015\u2212]/g, '-').trim()

export function fileName(item) {
  const artist = dashes(item.artist || item.uploader || '')
  const title = dashes(item.title)
  const name = / - /.test(title) || !artist || title.toLowerCase().startsWith(artist.toLowerCase()) ? title : `${artist} - ${title}`
  return tidy(name).slice(0, 180).replace(/[. ]+$/, '') || String(item.id)
}

export async function download(trackId) {
  const meta = await get(`${API}/tracks/${trackId}`)
  if (preview(meta)) throw new Error('go+ only, soundcloud would only hand over a 30 second preview')
  if (drm(meta)) throw new Error(DRM)
  const full = (meta.full_duration || meta.duration || 0) / 1000
  let last
  for (const s of streams(meta)) {
    try {
      const params = meta.track_authorization ? { track_authorization: meta.track_authorization } : {}
      const { url } = await get(s.url, params)
      let data = s.format.protocol === 'progressive' ? await bytes(url) : await hls(url)
      const ext = s.format.mime_type.startsWith('audio/mp4') ? '.m4a' : '.mp3'
      if (ext === '.m4a' && fragmented(data)) data = flatten(data)
      if (ext === '.m4a' && encrypted(data)) throw new Error(DRM)
      const { format } = await parseBuffer(data, { mimeType: s.format.mime_type }, { duration: true, skipCovers: true })
      if (full > 40 && format.duration && format.duration < 35) throw new Error('soundcloud only sent the 30 second go+ preview')
      return { data, ext, title: meta.title }
    } catch (err) {
      last = err
      if (/go\+/.test(err.message)) throw err
    }
  }
  throw new Error(last ? last.message : 'no downloadable stream, it\'s probably go+ or blocked here')
}
