const $ = (id) => document.getElementById(id)
const css = document.documentElement.style
const BIN = api.platform === 'darwin' ? 'the trash' : 'the recycle bin'

const PRESETS = [
  ['weebware', '#fe9aec', '#ff428e'],
  ['periwinkle', '#b7b7ff', '#9587ff'],
  ['pink', '#ffb3c6', '#ffd6e0'],
  ['blue', '#7eb8f7', '#b3d4fb'],
  ['green', '#7ef7ae', '#b3fbce'],
  ['purple', '#c17ef7', '#dbb3fb'],
  ['amber', '#f7c97e', '#fbe0b3'],
  ['cyan', '#7ef3f7', '#b3f9fb'],
  ['red', '#f77e7e', '#fbb3b3'],
]
const RATE_MIN = 0.75, RATE_MID = 1, RATE_MAX = 1.5
const SORTS = { title: ['a-z', 'z-a'], artist: ['a-z', 'z-a'], added: ['old', 'new'] }
const TABS = ['home', 'download', 'settings']
const WAVE_BUCKETS = 240

const s = {
  accent: '#fe9aec', gradient_colors: ['#ff428e'], bg_color: '#000000', auto_contrast: false, text_color: '#b8b8b8',
  divider_lighter: false, divider_intensity: 0.5, volume: 0.8, rate: 1, last_tab: 'home', last_track_path: null,
  last_playlist: null, custom_presets: [], waveform_enabled: false, bass_boost: 0, reverb_mix: 0, glow_radius: 0.53,
  gradient_speed: 1, gradient_enabled: true, visualizer_enabled: false, vis_opacity: 0.5, vis_thickness_pct: 0.3,
  vis_height_pct: 0.6, vis_bar_count_pct: 0.3, vis_fade_enabled: false, vis_height_limit_pct: 1,
  vis_gradient_sync: false, discord_enabled: false, sort_key: 'title', sort_dir: 1, shuffle: false, repeat: false,
  dl_target: null, tidy_names: true,
}
const save = () => api.saveSettings(s)

const lib = { tracks: [], byPath: new Map(), lists: [], dir: '', bytes: 0 }
const view = { list: null, shown: [], selected: new Set(), anchor: null }
const play = { queue: [], i: -1, order: [], pos: 0, path: null }
let stats = { tracks_played: 0, listening_seconds: 0 }
let covers = {}
let tab = 'home'

const audio = new Audio()
audio.preservesPitch = false
audio.preload = 'auto'

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const current = () => lib.byPath.get(play.path)
const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
const fmtSize = (bytes) => (bytes >= 1024e6 ? `${(bytes / 1024e6).toFixed(1)}gb` : `${Math.floor(bytes / 1e6)}mb`)
const fmtLong = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${Math.floor(sec % 60)}s` : `${Math.floor(sec)}s`
}
function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lighten = (hex, amt = 50) => '#' + hexToRgb(hex).map((v) => Math.min(255, v + amt).toString(16).padStart(2, '0')).join('')
const lerpColor = (a, b, t) => {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b)
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`
}
function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l * 100]
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [hue * 60, sat * 100, l * 100]
}
function hslToHex(h, sat, l) {
  sat /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = sat * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(255 * x).toString(16).padStart(2, '0')).join('')
}
function autoPalette(bg) {
  const [h, sat, l] = hexToHsl(bg)
  const dark = l < 50
  const surf = dark ? 5 : -5
  return {
    '--text': hslToHex(h, Math.min(sat, 10), dark ? 72 : 25),
    '--muted': hslToHex(h, Math.min(sat, 8), dark ? 49 : 46),
    '--dim': hslToHex(h, Math.min(sat, 6), dark ? 34 : 60),
    '--surf2': hslToHex(h, sat * 0.3, clamp(l + surf, 0, 100)),
    '--track-bg': hslToHex(h, sat * 0.3, clamp(l + surf * 1.6, 0, 100)),
  }
}
const isHex = (h) => /^#[0-9a-fA-F]{6}$/.test(h)
const hexFrom = (v) => (v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`)

const theme = { accent: s.accent, dim: '#575757', bg: s.bg_color }

function applyBorder() {
  const [h, sat, l] = hexToHsl(s.bg_color)
  css.setProperty('--border', hslToHex(h, sat * 0.3, clamp(l + s.divider_intensity * 25 * (s.divider_lighter ? 1 : -1), 0, 100)))
}

function applyColors() {
  css.setProperty('--accent', s.accent)
  css.setProperty('--bg', s.bg_color)
  if (s.auto_contrast) {
    const p = autoPalette(s.bg_color)
    for (const k in p) css.setProperty(k, p[k])
    s.text_color = p['--text']
  } else {
    css.setProperty('--text', s.text_color)
  }
  applyBorder()
  for (const [picker, hex, key] of [['accent-picker', 'hex-input', 'accent'], ['bg-picker', 'bg-hex-input', 'bg_color'], ['text-picker', 'text-hex-input', 'text_color']]) {
    $(picker).value = s[key]
    $(hex).value = s[key]
  }
  theme.accent = s.accent
  theme.bg = s.bg_color
  theme.dim = getComputedStyle(document.documentElement).getPropertyValue('--dim').trim() || '#575757'
  buildGlow()
  renderPresets()
  drawProgress(progress())
  idleVisualizer()
}

const outer = document.querySelector('.window-outer')
const hairline = document.querySelector('.hairline')
const GLOW_FPS = 15
let glowTimer = 0
let glowEpoch = performance.now()
let hairlineW = 0
new ResizeObserver(([e]) => { hairlineW = e.contentRect.width }).observe(hairline)
const glowSeconds = () => (10 - s.gradient_speed * 9) * 1.2
const glowColors = () => [s.accent, ...s.gradient_colors]

function buildGlow() {
  css.setProperty('--glow-radius', `${(s.glow_radius * 52).toFixed(1)}px`)
  clearInterval(glowTimer)
  glowTimer = 0
  if (!s.gradient_enabled) {
    outer.style.boxShadow = ''
    hairline.style.backgroundImage = ''
    return
  }
  const colors = glowColors()
  const stops = [...colors, ...colors.slice(0, -1).reverse()]
  hairline.style.backgroundImage = `linear-gradient(90deg, ${stops.join(', ')})`
  hairline.style.backgroundSize = `${stops.length * 100}% 100%`
  glowEpoch = performance.now()
  const frame = () => {
    if (document.hidden) return
    const now = performance.now() - glowEpoch
    const d = glowSeconds() * 1000
    const pulse = Math.sin(((now % d) / d) * Math.PI)
    outer.style.boxShadow = `0 0 calc(var(--glow-radius) * ${(1 + 0.3 * pulse).toFixed(3)}) ${(2 + 2 * pulse).toFixed(1)}px ${glowColorNow()}`
    const shimmer = (10 - s.gradient_speed * 9) * 1000
    hairline.style.backgroundPositionX = `${(-((now % shimmer) / shimmer) * stops.length * hairlineW).toFixed(1)}px`
  }
  frame()
  glowTimer = setInterval(frame, 1000 / GLOW_FPS)
}

function renderGradientList() {
  $('gradient-colors-list').replaceChildren(...s.gradient_colors.map((hex, i) => {
    const row = el('div', 'color-field-row')
    const picker = Object.assign(el('input', 'color-swatch'), { type: 'color', value: hex })
    const text = Object.assign(el('input', 'hex-input'), { value: hex })
    const set = (h) => { s.gradient_colors[i] = h; buildGlow(); idleVisualizer(); save() }
    picker.addEventListener('input', () => { text.value = picker.value; set(picker.value) })
    text.addEventListener('change', () => {
      const h = hexFrom(text.value)
      if (!isHex(h)) return (text.value = picker.value)
      picker.value = h
      set(h)
    })
    row.append(picker, text)
    return row
  }))
}

const allPresets = () => [...PRESETS, ...s.custom_presets.map((p) => [p.name, p.base, p.light])]
function renderPresets() {
  const sel = $('preset-select')
  const presets = allPresets()
  const match = presets.find(([, base]) => base === s.accent)
  sel.replaceChildren(...(match ? [] : [el('option', '', 'custom')]), ...presets.map(([name]) => Object.assign(el('option', '', name), { value: name })))
  sel.value = match ? match[0] : 'custom'
}
$('preset-select').addEventListener('change', () => {
  const p = allPresets().find(([name]) => name === $('preset-select').value)
  if (!p) return
  s.accent = p[1]
  s.gradient_colors = [p[2]]
  renderGradientList()
  applyColors()
  save()
})
$('preset-add').addEventListener('click', async () => {
  const name = (await promptModal('preset name:'))?.trim()
  if (!name) return
  if (allPresets().some(([n]) => n === name)) return notify(`"${name}" already exists`, { type: 'error' })
  s.custom_presets.push({ name, base: s.accent, light: s.gradient_colors[0] || lighten(s.accent) })
  renderPresets()
  save()
})
$('preset-remove').addEventListener('click', async () => {
  const name = $('preset-select').value
  if (PRESETS.some(([n]) => n === name)) return notify("built-in presets can't be removed", { type: 'error' })
  if (!s.custom_presets.some((p) => p.name === name) || !(await confirmModal(`remove "${name}"?`))) return
  s.custom_presets = s.custom_presets.filter((p) => p.name !== name)
  renderPresets()
  save()
})

function colorInput(pickerId, hexId, key, after = () => {}) {
  const set = (h) => { s[key] = h; after(); applyColors(); save() }
  $(pickerId).addEventListener('input', () => set($(pickerId).value))
  $(hexId).addEventListener('change', () => {
    const h = hexFrom($(hexId).value)
    if (isHex(h)) set(h)
    else $(hexId).value = s[key]
  })
}
colorInput('accent-picker', 'hex-input', 'accent')
colorInput('bg-picker', 'bg-hex-input', 'bg_color')
colorInput('text-picker', 'text-hex-input', 'text_color')
$('gradient-color-add').addEventListener('click', () => {
  s.gradient_colors.push(lighten(s.gradient_colors.at(-1) || s.accent, 20))
  renderGradientList()
  applyColors()
  save()
})
$('gradient-color-remove').addEventListener('click', () => {
  if (s.gradient_colors.length <= 1) return
  s.gradient_colors.pop()
  renderGradientList()
  applyColors()
  save()
})

const toggles = {}
function toggle(id, key, label, after = () => {}, text = (on) => `[${label}: ${on ? 'on' : 'off'}]`) {
  const paint = () => {
    $(id).textContent = text(s[key])
    $(id).classList.toggle('toggled', !!s[key])
  }
  toggles[id] = paint
  $(id).addEventListener('click', () => {
    s[key] = !s[key]
    paint()
    after()
    save()
  })
}

let drag = null
window.addEventListener('mousemove', (e) => drag?.(e))
window.addEventListener('mouseup', (e) => {
  if (!drag) return
  drag(e, true)
  drag = null
})
const fills = {}
function bar(name, get, set, done = save) {
  const track = $(`${name}-bar`), fill = $(`${name}-fill`)
  const paint = () => { fill.style.width = `${clamp(get()) * 100}%` }
  fills[name] = paint
  track.addEventListener('mousedown', (e) => {
    const at = (ev) => {
      const r = track.getBoundingClientRect()
      return clamp((ev.clientX - r.left) / r.width)
    }
    set(at(e))
    paint()
    drag = (ev, end) => {
      set(at(ev))
      paint()
      if (end) done()
    }
  })
}

const rateToFrac = (r) => (r <= RATE_MID ? 0.5 * (r - RATE_MIN) / (RATE_MID - RATE_MIN) : 0.5 + 0.5 * (r - RATE_MID) / (RATE_MAX - RATE_MID))
const fracToRate = (f) => (f <= 0.5 ? RATE_MIN + (f / 0.5) * (RATE_MID - RATE_MIN) : RATE_MID + ((f - 0.5) / 0.5) * (RATE_MAX - RATE_MID))
function setRate(r, persist = true) {
  s.rate = clamp(Math.round(r * 100) / 100, RATE_MIN, RATE_MAX)
  audio.defaultPlaybackRate = audio.playbackRate = s.rate
  fills.rate?.()
  position()
  if (persist) { save(); presence() }
}

bar('vol', () => s.volume, (p) => { s.volume = p; applyVolume() })
bar('rate', () => rateToFrac(s.rate), (p) => setRate(fracToRate(p), false), () => { save(); presence() })
bar('bass', () => s.bass_boost, (p) => { s.bass_boost = p; route() })
bar('reverb', () => s.reverb_mix, (p) => { s.reverb_mix = p; route() })
bar('glow', () => s.glow_radius, (p) => { s.glow_radius = p; css.setProperty('--glow-radius', `${(p * 52).toFixed(1)}px`) })
function glowColorNow() {
  const colors = glowColors()
  if (colors.length < 2) return colors[0]
  const cycle = glowSeconds() * 2000
  const t = ((performance.now() - glowEpoch) % cycle) / cycle
  const u = t < 0.5 ? t * 2 : 2 - t * 2
  const p = u * u * (3 - 2 * u) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(p))
  return lerpColor(colors[i], colors[i + 1], p - i)
}
bar('gradient-speed', () => s.gradient_speed, (p) => { s.gradient_speed = p }, () => { buildGlow(); save() })
bar('divider-intensity', () => s.divider_intensity, (p) => { s.divider_intensity = p; applyBorder() })
bar('vis-opacity', () => s.vis_opacity, (p) => { s.vis_opacity = p; idleVisualizer() })
bar('vis-thickness', () => s.vis_thickness_pct, (p) => { s.vis_thickness_pct = p; idleVisualizer() })
bar('vis-height', () => s.vis_height_pct, (p) => { s.vis_height_pct = p; idleVisualizer() })
bar('vis-height-limit', () => s.vis_height_limit_pct, (p) => { s.vis_height_limit_pct = p; idleVisualizer() })
bar('vis-count', () => s.vis_bar_count_pct, (p) => { s.vis_bar_count_pct = p; idleVisualizer() })
$('rate-minus').addEventListener('click', () => setRate(s.rate - 0.1))
$('rate-plus').addEventListener('click', () => setRate(s.rate + 0.1))
$('rate-bar').addEventListener('dblclick', () => setRate(1))

toggle('auto-contrast-toggle', 'auto_contrast', 'auto contrast', () => {
  $('text-color-row').classList.toggle('hidden', s.auto_contrast)
  applyColors()
})
toggle('divider-shade-toggle', 'divider_lighter', 'divider', applyColors, (on) => `[divider: ${on ? 'lighter' : 'darker'}]`)
toggle('waveform-toggle', 'waveform_enabled', 'waveform', () => {
  if (s.waveform_enabled && current()) loadWave(current())
  drawProgress(progress())
})
toggle('gradient-toggle', 'gradient_enabled', 'gradient', buildGlow)
toggle('visualizer-toggle', 'visualizer_enabled', 'visualizer', () => {
  $('sidebar-visualizer').classList.toggle('hidden', !s.visualizer_enabled)
  route()
  visualizer()
})
toggle('vis-fade-toggle', 'vis_fade_enabled', 'fade', idleVisualizer)
toggle('vis-gradient-sync-toggle', 'vis_gradient_sync', 'gradient sync', idleVisualizer)
toggle('discord-toggle', 'discord_enabled', 'discord rpc', () => {
  api.setDiscord(s.discord_enabled)
  presence()
})
toggle('tidy-toggle', 'tidy_names', 'tidy file names', () => {
  save()
  if (s.tidy_names) refresh()
})
toggle('btn-shuffle', 'shuffle', 'shuffle', () => { if (s.shuffle) shuffle(play.i) }, () => '[shuffle]')
toggle('btn-repeat', 'repeat', 'repeat', () => {}, () => '[repeat]')

function showTab(name, animate = true) {
  tab = name
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name))
  const at = TABS.indexOf(name)
  TABS.forEach((n, i) => {
    const v = $(`view-${n}`)
    if (!animate) v.style.transition = 'none'
    v.style.transform = `translateX(${(i - at) * 100}%)`
    v.style.opacity = i === at ? '1' : '0'
    v.style.pointerEvents = i === at ? 'auto' : 'none'
    if (!animate) {
      void v.offsetWidth
      v.style.transition = ''
    }
  })
  if (name === 'settings') showStats()
  if (s.last_tab !== name) { s.last_tab = name; save() }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)))
$('btn-min').addEventListener('click', () => api.minimize())
$('btn-max').addEventListener('click', () => api.maximize())
$('btn-close').addEventListener('click', () => api.close())

function modal({ title, input = null, list = null, confirm = false }) {
  return new Promise((resolve) => {
    $('modal-title').textContent = title
    const box = $('modal-input'), rows = $('modal-list')
    box.classList.toggle('hidden', input === null)
    rows.classList.toggle('hidden', !list)
    $('modal-actions-default').classList.toggle('hidden', confirm)
    $('modal-actions-confirm').classList.toggle('hidden', !confirm)
    let picked = list?.[0]
    if (list) {
      rows.replaceChildren(...list.map((name) => {
        const row = el('div', 'modal-list-row' + (name === picked ? ' selected' : ''), name)
        row.addEventListener('click', () => {
          picked = name
          rows.querySelectorAll('.modal-list-row').forEach((r) => r.classList.toggle('selected', r === row))
        })
        row.addEventListener('dblclick', () => done(picked))
        return row
      }))
    }
    $('modal-overlay').classList.remove('hidden')
    if (input !== null) {
      box.value = input
      box.focus()
      box.select()
    }
    const ok = () => done(confirm ? true : input !== null ? box.value : picked)
    const no = () => done(confirm ? false : null)
    const key = (e) => {
      if (e.key === 'Enter') ok()
      if (e.key === 'Escape') no()
    }
    const ends = [['modal-ok', ok], ['modal-yes', ok], ['modal-cancel', no], ['modal-no', no]]
    for (const [id, fn] of ends) $(id).addEventListener('click', fn)
    document.addEventListener('keydown', key)
    function done(result) {
      $('modal-overlay').classList.add('hidden')
      for (const [id, fn] of ends) $(id).removeEventListener('click', fn)
      document.removeEventListener('keydown', key)
      resolve(result)
    }
  })
}
const promptModal = (title, value = '') => modal({ title, input: value })
const pickModal = (title, list) => modal({ title, list })
const confirmModal = (title) => modal({ title, confirm: true })

const toasts = { queue: [], live: new Map(), n: 0 }
function notify(message, { type = 'info', duration = type === 'error' ? 6000 : 4000 } = {}) {
  toasts.queue.push({ id: ++toasts.n, message, type, duration })
  drainToasts()
}
function drainToasts() {
  while (toasts.live.size < 3 && toasts.queue.length) {
    const { id, message, type, duration } = toasts.queue.shift()
    const box = el('div', `toast toast-${type}`)
    const close = el('span', 'toast-close', '[x]')
    close.addEventListener('click', () => dismiss(id))
    const ns = 'http://www.w3.org/2000/svg', r = 8, around = 2 * Math.PI * r
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('class', 'toast-ring')
    svg.setAttribute('viewBox', '0 0 20 20')
    const ring = (cls) => {
      const c = document.createElementNS(ns, 'circle')
      for (const [k, v] of [['class', cls], ['cx', 10], ['cy', 10], ['r', r]]) c.setAttribute(k, v)
      svg.append(c)
      return c
    }
    ring('toast-ring-bg')
    const fg = ring('toast-ring-fg')
    fg.setAttribute('stroke-dasharray', around)
    box.append(close, el('div', 'toast-message', message), svg)
    $('toast-container').append(box)
    void box.offsetWidth
    box.classList.add('show')
    fg.style.transitionDuration = `${duration}ms`
    requestAnimationFrame(() => { fg.style.strokeDashoffset = around })
    toasts.live.set(id, { box, timer: setTimeout(() => dismiss(id), duration) })
  }
}
function dismiss(id) {
  const t = toasts.live.get(id)
  if (!t) return
  clearTimeout(t.timer)
  toasts.live.delete(id)
  t.box.classList.remove('show')
  setTimeout(() => { t.box.remove(); drainToasts() }, 250)
}

function select(e, key, ordered, sel) {
  if (e.shiftKey && sel.anchor !== null && ordered.includes(sel.anchor)) {
    const [a, b] = [ordered.indexOf(sel.anchor), ordered.indexOf(key)].sort((x, y) => x - y)
    sel.selected = new Set(ordered.slice(a, b + 1))
  } else if (e.ctrlKey || e.metaKey) {
    if (sel.selected.has(key)) sel.selected.delete(key)
    else sel.selected.add(key)
    sel.anchor = key
  } else {
    sel.selected = new Set([key])
    sel.anchor = key
  }
}

let scanning = null
let rescan = false
async function refresh() {
  if (scanning) {
    rescan = true
    return scanning
  }
  scanning = (async () => {
    const r = await api.scan()
    for (const t of r.tracks) {
      t.text = t.sub ? `${t.title} - ${t.sub}` : t.title
      t.find = `${t.text} ${t.playlist || ''}`.toLowerCase()
      t.tkey = t.title.toLowerCase()
      t.akey = (t.artist || t.title).toLowerCase()
    }
    Object.assign(lib, { tracks: r.tracks, byPath: new Map(r.tracks.map((t) => [t.path, t])), lists: r.lists, dir: r.dir, bytes: r.totalBytes })
    if (view.list && !lib.lists.includes(view.list)) closeList()
    if (s.dl_target && !lib.lists.includes(s.dl_target)) s.dl_target = null
    $('count-lbl').textContent = `${plural(lib.tracks.length, 'track')} , ${fmtSize(lib.bytes)}`
    $('music-dir-path').textContent = lib.dir
    renderSidebar()
    renderTargets()
    filter()
  })()
  await scanning
  scanning = null
  if (rescan) {
    rescan = false
    await refresh()
  }
}
let changeTimer = null
api.onLibraryChanged(() => {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(refresh, 300)
})

function renderSidebar() {
  const counts = {}
  for (const t of lib.tracks) if (t.playlist) counts[t.playlist] = (counts[t.playlist] || 0) + 1
  const rows = [[null, 'library', lib.tracks.length], ...lib.lists.map((n) => [n, n, counts[n] || 0])]
  $('playlist-list').replaceChildren(...rows.map(([name, label, count]) => {
    const row = el('div', 'playlist-row' + (name === null ? ' library' : '') + (name === view.list ? ' selected' : ''))
    row.dataset.list = name ?? ''
    row.append(el('span', 'pl-name', label), el('span', 'pl-count', count))
    return row
  }))
}

const listOf = (row) => (row.dataset.list === '' ? null : row.dataset.list)
const sidebar = $('playlist-list')
sidebar.addEventListener('click', (e) => {
  const row = e.target.closest('.playlist-row')
  if (row) openList(listOf(row))
})
sidebar.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.playlist-row')
  if (!row) return
  openList(listOf(row))
  if (view.shown.length) startFrom(view.shown, s.shuffle ? Math.floor(Math.random() * view.shown.length) : 0)
})
sidebar.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.playlist-row')
  e.preventDefault()
  if (row && listOf(row)) renameList(listOf(row))
})
let dragged = null
sidebar.addEventListener('dragover', (e) => {
  const row = e.target.closest('.playlist-row')
  if (!row || !dragged) return
  e.preventDefault()
  sidebar.querySelectorAll('.drop').forEach((r) => r !== row && r.classList.remove('drop'))
  row.classList.add('drop')
})
sidebar.addEventListener('dragleave', (e) => e.target.closest('.playlist-row')?.classList.remove('drop'))
sidebar.addEventListener('drop', async (e) => {
  const row = e.target.closest('.playlist-row')
  sidebar.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'))
  if (!row || !dragged) return
  e.preventDefault()
  await moveTracks(listOf(row), dragged)
})

function openList(name, persist = true) {
  view.list = name
  view.selected.clear()
  view.anchor = null
  $('view-title').textContent = name ?? 'library'
  $('pl-banner').classList.toggle('hidden', !name)
  $('pl-banner-text').textContent = name ? `\u25b6 playlist: ${name}` : ''
  $('remove-from-playlist').classList.toggle('hidden', !name)
  renderSidebar()
  filter()
  showTab('home')
  if (persist) { s.last_playlist = name; save() }
}
const closeList = () => openList(null)
$('pl-exit').addEventListener('click', closeList)

function sorted(list) {
  const by = s.sort_key === 'added' ? (a, b) => a.added - b.added
    : s.sort_key === 'artist' ? (a, b) => cmp(a.akey, b.akey)
    : (a, b) => cmp(a.tkey, b.tkey)
  return list.slice().sort((a, b) => by(a, b) * s.sort_dir || cmp(a.path, b.path))
}

function filter() {
  const q = $('search-home').value.trim().toLowerCase()
  let list = view.list ? lib.tracks.filter((t) => t.playlist === view.list) : lib.tracks
  if (q) list = list.filter((t) => t.find.includes(q))
  view.shown = sorted(list).map((t) => t.path)
  for (const p of view.selected) if (!view.shown.includes(p)) view.selected.delete(p)
  $('sort-key').textContent = `[${s.sort_key}]`
  $('sort-dir').textContent = `[${SORTS[s.sort_key][s.sort_dir === 1 ? 0 : 1]}]`
  renderList()
}
let searchTimer = null
$('search-home').addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(filter, 120)
})
$('sort-key').addEventListener('click', () => {
  const keys = Object.keys(SORTS)
  s.sort_key = keys[(keys.indexOf(s.sort_key) + 1) % keys.length]
  filter()
  save()
})
$('sort-dir').addEventListener('click', () => {
  s.sort_dir = -s.sort_dir
  filter()
  save()
})

function renderList() {
  const frag = document.createDocumentFragment()
  view.shown.forEach((p, i) => {
    const t = lib.byPath.get(p)
    const row = el('div', 'track-row', t.text)
    row.dataset.i = i
    row.draggable = true
    if (!view.list && t.playlist) row.append(el('span', 'row-pl', t.playlist))
    frag.append(row)
  })
  $('track-list').replaceChildren(frag)
  paintRows()
}
function paintRows() {
  for (const row of $('track-list').children) {
    const p = view.shown[row.dataset.i]
    row.classList.toggle('playing', p === play.path)
    row.classList.toggle('multi-selected', view.selected.has(p))
  }
}

const tracks = $('track-list')
const rowPath = (e) => {
  const row = e.target.closest('.track-row')
  return row ? view.shown[row.dataset.i] : null
}
tracks.addEventListener('click', (e) => {
  const p = rowPath(e)
  if (!p) return
  select(e, p, view.shown, view)
  paintRows()
})
tracks.addEventListener('dblclick', (e) => {
  const p = rowPath(e)
  if (p) startFrom(view.shown, view.shown.indexOf(p))
})
tracks.addEventListener('contextmenu', async (e) => {
  e.preventDefault()
  const t = lib.byPath.get(rowPath(e))
  if (!t) return
  const title = await promptModal('title (empty puts the original back):', t.title)
  if (title === null) return
  await api.setTitle(t.path, title)
  await refresh()
})
tracks.addEventListener('dragstart', (e) => {
  const p = rowPath(e)
  dragged = view.selected.has(p) ? [...view.selected] : [p]
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', plural(dragged.length, 'track'))
})
tracks.addEventListener('dragend', () => { dragged = null })

$('refresh').addEventListener('click', refresh)
$('open-folder').addEventListener('click', () => api.openFolder())
$('choose-music-folder').addEventListener('click', async () => {
  if (!(await api.chooseFolder())) return
  closeList()
  await refresh()
  notify('music folder updated', { type: 'success' })
})

async function moveTracks(list, paths) {
  const moves = await api.moveTo(list, paths)
  view.selected.clear()
  for (const { from, to } of moves) {
    play.queue = play.queue.map((p) => (p === from ? to : p))
    if (play.path === from) play.path = to
    if (covers[from]) { covers[to] = covers[from]; delete covers[from] }
  }
  await refresh()
  const where = list ? `"${list}"` : 'the library'
  notify(moves.length ? `moved ${plural(moves.length, 'track')} to ${where}` : 'nothing moved', { type: moves.length ? 'success' : 'error' })
}

async function newList() {
  const name = (await promptModal('new playlist name:'))?.trim()
  if (!name) return null
  const r = await api.createList(name)
  if (r.error) {
    notify(r.error === 'exists' ? `"${name}" already exists` : "that name can't be a folder", { type: 'error' })
    return null
  }
  await refresh()
  return r.name
}
async function renameList(from) {
  const to = (await promptModal(`rename "${from}" to:`, from))?.trim()
  if (!to || to === from) return
  const r = await api.renameList(from, to)
  if (r.error) return notify(r.error === 'exists' ? `"${to}" already exists` : "couldn't rename that folder", { type: 'error' })
  const moved = (p) => (p.startsWith(`${lib.dir}${sep()}${from}${sep()}`) ? `${lib.dir}${sep()}${r.name}${p.slice(lib.dir.length + from.length + 1)}` : p)
  play.queue = play.queue.map(moved)
  if (play.path) play.path = moved(play.path)
  if (view.list === from) view.list = r.name
  if (s.dl_target === from) s.dl_target = r.name
  await refresh()
  openList(view.list)
}
const sep = () => (lib.dir.includes('\\') ? '\\' : '/')

$('pl-add').addEventListener('click', newList)
$('pl-del').addEventListener('click', async () => {
  const name = view.list
  if (!name) return notify('open a playlist first, then [-] removes it', { type: 'error' })
  const n = lib.tracks.filter((t) => t.playlist === name).length
  if (!(await confirmModal(`delete playlist "${name}"?\n\nits ${plural(n, 'track')} go back to the library, only the empty folder goes to ${BIN}.`))) return
  const r = await api.deleteList(name)
  if (r.error) return notify("couldn't delete that playlist", { type: 'error' })
  closeList()
  await refresh()
  notify(`deleted "${name}"`, { type: 'success' })
})
$('add-to-playlist').addEventListener('click', async () => {
  let paths = [...view.selected]
  if (!paths.length && play.path) paths = [play.path]
  if (!paths.length) return notify('select a track first', { type: 'error' })
  const name = lib.lists.length ? await pickModal('move to playlist:', lib.lists) : await newList()
  if (name) await moveTracks(name, paths)
})
$('remove-from-playlist').addEventListener('click', async () => {
  const paths = [...view.selected]
  if (!paths.length) return notify('select a track first', { type: 'error' })
  if (await confirmModal(`take ${plural(paths.length, 'track')} out of "${view.list}"?\n\nthey go back to the main music folder.`)) await moveTracks(null, paths)
})
$('delete-tracks').addEventListener('click', async () => {
  const paths = [...view.selected]
  if (!paths.length) return notify('select a track first', { type: 'error' })
  if (!(await confirmModal(`delete ${plural(paths.length, 'track')}? they go to ${BIN}.`))) return
  const done = await api.trash(paths)
  view.selected.clear()
  if (done.length) notify(`deleted ${plural(done.length, 'track')}`, { type: 'success' })
  if (done.length < paths.length) notify(`couldn't delete ${plural(paths.length - done.length, 'track')}`, { type: 'error' })
  await refresh()
})

function shuffle(first) {
  const rest = [...play.queue.keys()].filter((k) => k !== first)
  for (let k = rest.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [rest[k], rest[j]] = [rest[j], rest[k]]
  }
  play.order = first >= 0 ? [first, ...rest] : rest
  play.pos = 0
}

function startFrom(paths, i) {
  play.queue = paths.slice()
  shuffle(i)
  load(i)
}

let failures = 0
function load(i, autoplay = true) {
  const t = lib.byPath.get(play.queue[i])
  if (!t) return
  play.i = i
  play.path = t.path
  if (s.shuffle) play.pos = Math.max(0, play.order.indexOf(i))
  audio.src = t.url
  audio.defaultPlaybackRate = audio.playbackRate = s.rate
  paintLocal(t)
  paintRows()
  s.last_track_path = t.path
  save()
  if (autoplay) {
    audio.play().catch(() => {})
    stats.tracks_played++
  }
}

function paintLocal(t) {
  wave.peaks = null
  if (!t) {
    $('np-title').textContent = 'no track loaded'
    $('np-sub').textContent = 'drop files into Music › weebware'
    $('time-cur').textContent = $('time-tot').textContent = '0:00'
    return drawProgress(0)
  }
  $('np-title').textContent = t.title
  $('np-sub').textContent = t.sub || t.playlist || 'library'
  $('time-tot').textContent = fmt(Number.isFinite(audio.duration) ? audio.duration : t.duration)
  showTime()
  if (s.waveform_enabled) loadWave(t)
  metadata({ title: t.title, artist: t.artist || t.playlist || 'weebwa.re', album: t.playlist || 'library', cover: covers[t.path] })
}

function next() {
  const n = play.queue.length
  if (!n) return
  if (!s.shuffle) return load((play.i + 1) % n)
  if (++play.pos >= play.order.length) {
    const last = play.i
    shuffle(-1)
    if (play.order[0] === last && n > 1) play.order.push(play.order.shift())
  }
  load(play.order[play.pos])
}
function prev() {
  const n = play.queue.length
  if (!n) return
  if (audio.currentTime > 3) {
    audio.currentTime = 0
    return
  }
  if (s.shuffle && play.pos > 0) return load(play.order[--play.pos])
  load((play.i - 1 + n) % n)
}
function togglePlay() {
  if (!play.path) {
    if (view.shown.length) startFrom(view.shown, s.shuffle ? Math.floor(Math.random() * view.shown.length) : 0)
    return
  }
  if (audio.paused) audio.play().catch(() => {})
  else audio.pause()
}

$('btn-play').addEventListener('click', togglePlay)
$('btn-next').addEventListener('click', next)
$('btn-prev').addEventListener('click', prev)

function setPlaying() {
  const on = !audio.paused
  $('btn-play').textContent = on ? '[pause]' : '[play]'
  if (navigator.mediaSession) navigator.mediaSession.playbackState = on ? 'playing' : 'paused'
  visualizer()
  presence()
  if (!on) {
    tick = 0
    saveStats()
  }
}
audio.addEventListener('play', setPlaying)
audio.addEventListener('pause', setPlaying)
audio.addEventListener('playing', () => { failures = 0 })
audio.addEventListener('ended', () => {
  if (!s.repeat) return next()
  audio.currentTime = 0
  audio.play().catch(() => {})
})
audio.addEventListener('seeked', () => { showTime(); position(); presence() })
audio.addEventListener('loadedmetadata', () => {
  const t = current()
  if (!t || !Number.isFinite(audio.duration)) return
  if (Math.abs(t.duration - audio.duration) > 0.5) {
    t.duration = audio.duration
    api.setDuration(t.path, audio.duration)
  }
  $('time-tot').textContent = fmt(audio.duration)
  position()
  presence()
})
audio.addEventListener('error', () => {
  const t = current()
  if (!t || !audio.src) return
  notify(`can't play ${t.title.slice(0, 40)}`, { type: 'error' })
  if (++failures < 5) setTimeout(next, 800)
})

const progress = () => (audio.duration ? audio.currentTime / audio.duration : 0)
let scrubbing = false
let tick = 0
let shownSecond = -1
const showTime = () => {
  shownSecond = Math.floor(audio.currentTime)
  drawProgress(progress())
  $('time-cur').textContent = fmt(audio.currentTime)
}
audio.addEventListener('timeupdate', () => {
  if (!audio.paused) {
    const now = performance.now()
    if (tick && now - tick < 2000) stats.listening_seconds += (now - tick) / 1000
    tick = now
  }
  if (!scrubbing && audio.duration && Math.floor(audio.currentTime) !== shownSecond) showTime()
})

const progressBar = $('progress-bar')
function scrubAt(e) {
  const r = progressBar.getBoundingClientRect()
  const pct = clamp((e.clientX - r.left) / r.width)
  drawProgress(pct)
  $('time-cur').textContent = fmt(pct * (audio.duration || 0))
  return pct
}
progressBar.addEventListener('mousedown', (e) => {
  scrubbing = true
  scrubAt(e)
  drag = (ev, end) => {
    const pct = scrubAt(ev)
    if (!end) return
    scrubbing = false
    if (audio.duration) audio.currentTime = pct * audio.duration
  }
})

const wave = { peaks: null, w: 0, h: 0 }
const packWave = (peaks) => btoa(String.fromCharCode(...peaks.map((p) => Math.round(p * 255))))
const unpackWave = (b64) => Array.from(atob(b64), (c) => c.charCodeAt(0) / 255)

async function loadWave(t) {
  let peaks = t.wave ? unpackWave(t.wave) : null
  if (!peaks) {
    try {
      const data = await (await fetch(t.url)).arrayBuffer()
      const pcm = (await new OfflineAudioContext(1, 1, 8000).decodeAudioData(data)).getChannelData(0)
      const block = Math.max(1, Math.floor(pcm.length / WAVE_BUCKETS))
      peaks = []
      for (let i = 0; i < WAVE_BUCKETS; i++) {
        let sum = 0
        for (let j = i * block, end = j + block; j < end && j < pcm.length; j++) sum += Math.abs(pcm[j])
        peaks.push(sum / block)
      }
      const max = Math.max(0.0001, ...peaks)
      peaks = peaks.map((p) => p / max)
      t.wave = packWave(peaks)
      api.setWave(t.path, t.wave)
    } catch {
      return
    }
  }
  if (play.path !== t.path) return
  wave.peaks = peaks
  drawProgress(progress())
}

const waveCanvas = $('progress-waveform')
new ResizeObserver(([e]) => {
  wave.w = e.contentRect.width
  wave.h = e.contentRect.height
  if (wave.peaks) drawProgress(progress())
}).observe(waveCanvas)

function drawProgress(pct) {
  pct = clamp(pct || 0)
  const on = s.waveform_enabled && wave.peaks
  progressBar.classList.toggle('waveform-mode', !!on)
  if (!on) {
    $('progress-fill').style.width = `${pct * 100}%`
    return
  }
  const dpr = devicePixelRatio || 1
  const w = Math.max(1, Math.round(wave.w * dpr)), h = Math.max(1, Math.round(wave.h * dpr))
  if (waveCanvas.width !== w) waveCanvas.width = w
  if (waveCanvas.height !== h) waveCanvas.height = h
  const ctx = waveCanvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, wave.w, wave.h)
  const barW = wave.w / wave.peaks.length
  const played = pct * wave.w
  wave.peaks.forEach((p, i) => {
    const x = i * barW, barH = Math.max(1, p * wave.h)
    ctx.fillStyle = x <= played ? theme.accent : theme.dim
    ctx.fillRect(x, (wave.h - barH) / 2, Math.max(1, barW - 1), barH)
  })
}

let ctx = null
let nodes = null
let shape = ''
const effectsWanted = () => s.bass_boost > 0 || s.reverb_mix > 0 || s.visualizer_enabled

function applyVolume() {
  s.volume = clamp(s.volume)
  if (nodes) nodes.vol.gain.value = s.volume
  audio.volume = nodes ? 1 : s.volume
}

function impulse(c, seconds = 2.5, decay = 3) {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

function route() {
  fills.bass?.()
  fills.reverb?.()
  if (!ctx && !effectsWanted()) return
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' })
    nodes = { src: ctx.createMediaElementSource(audio), bass: ctx.createBiquadFilter(), dry: ctx.createGain(), wet: ctx.createGain(), verb: null, an: ctx.createAnalyser(), vol: ctx.createGain() }
    nodes.bass.type = 'lowshelf'
    nodes.bass.frequency.value = 150
    nodes.an.fftSize = 1024
    applyVolume()
  }
  const { src, bass, dry, wet, an, vol } = nodes
  bass.gain.value = s.bass_boost * 15
  dry.gain.value = 1 - s.reverb_mix
  wet.gain.value = s.reverb_mix
  const want = `${s.bass_boost > 0}${s.reverb_mix > 0}${s.visualizer_enabled}`
  if (want === shape) return
  shape = want
  for (const n of [src, bass, dry, wet, an, vol, nodes.verb]) n?.disconnect()
  const out = vol
  vol.connect(s.visualizer_enabled ? an : ctx.destination)
  if (s.visualizer_enabled) an.connect(ctx.destination)
  let head = src
  if (s.bass_boost > 0) {
    src.connect(bass)
    head = bass
  }
  if (s.reverb_mix > 0) {
    nodes.verb ??= Object.assign(ctx.createConvolver(), { buffer: impulse(ctx) })
    head.connect(dry)
    dry.connect(out)
    head.connect(nodes.verb)
    nodes.verb.connect(wet)
    wet.connect(out)
  } else {
    head.connect(out)
  }
  ctx.resume?.()
}

const visCanvas = $('sidebar-visualizer')
const vis = { raf: 0, last: 0, data: null, groups: null, key: '', w: 0, h: 0 }
new ResizeObserver(([e]) => {
  vis.w = e.contentRect.width
  vis.h = e.contentRect.height
  idleVisualizer()
}).observe(visCanvas)

function logGroups(bins, count) {
  const key = `${bins}:${count}`
  if (vis.key === key) return vis.groups
  const top = Math.log2(bins)
  vis.groups = Array.from({ length: count }, (_, i) => {
    const a = Math.max(1, Math.floor(2 ** ((i / count) * top)))
    return [a, Math.min(Math.max(a + 1, Math.floor(2 ** (((i + 1) / count) * top))), bins)]
  })
  vis.key = key
  return vis.groups
}

function drawVisualizer(freq) {
  if (!vis.w || !vis.h) return
  const dpr = devicePixelRatio || 1
  const w = Math.round(vis.w * dpr), h = Math.round(vis.h * dpr)
  if (visCanvas.width !== w) visCanvas.width = w
  if (visCanvas.height !== h) visCanvas.height = h
  const c = visCanvas.getContext('2d')
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, vis.w, vis.h)
  const count = Math.round(8 + s.vis_bar_count_pct * 120)
  const groups = logGroups(freq.length, count)
  const barW = 1 + s.vis_thickness_pct * 9
  const spacing = vis.w / count
  const maxH = vis.h * s.vis_height_limit_pct * (0.1 + s.vis_height_pct * 0.9)
  c.fillStyle = s.vis_gradient_sync && s.gradient_enabled ? glowColorNow() : theme.accent
  c.globalAlpha = s.vis_opacity
  groups.forEach(([a, b], i) => {
    let peak = 0
    for (let j = a; j < b; j++) if (freq[j] > peak) peak = freq[j]
    const barH = Math.max(2, Math.min(maxH, Math.pow(peak / 255, 0.6) * maxH))
    c.fillRect(i * spacing + (spacing - barW) / 2, vis.h - barH, barW, barH)
  })
  c.globalAlpha = 1
  if (s.vis_fade_enabled) {
    const top = vis.h - maxH
    const fade = c.createLinearGradient(0, top, 0, top + maxH * 0.5)
    fade.addColorStop(0, theme.bg)
    fade.addColorStop(1, 'transparent')
    c.fillStyle = fade
    c.fillRect(0, top, vis.w, maxH * 0.5)
  }
}

function visualizer() {
  cancelAnimationFrame(vis.raf)
  vis.raf = 0
  if (!s.visualizer_enabled || audio.paused || document.hidden || !nodes) return idleVisualizer()
  vis.data ??= new Uint8Array(nodes.an.frequencyBinCount)
  const frame = (now) => {
    vis.raf = requestAnimationFrame(frame)
    if (now - vis.last < 33) return
    vis.last = now
    nodes.an.getByteFrequencyData(vis.data)
    drawVisualizer(vis.data)
  }
  vis.raf = requestAnimationFrame(frame)
}
function idleVisualizer() {
  if (s.visualizer_enabled && !vis.raf) drawVisualizer(vis.data || new Uint8Array(512))
}
document.addEventListener('visibilitychange', visualizer)

const ms = navigator.mediaSession
let logoArt = null
fetch('../assets/icon.png').then((r) => r.blob()).then((b) => { logoArt = URL.createObjectURL(b) }).catch(() => {})
const pause = () => audio.pause()
const seek = (e) => { audio.currentTime = e.seekTime }
for (const [action, fn] of [['play', togglePlay], ['pause', pause], ['previoustrack', prev], ['nexttrack', next], ['seekto', seek]]) {
  try { ms?.setActionHandler(action, fn) } catch {}
}
function metadata({ title, artist, album, cover }) {
  if (!ms) return
  ms.metadata = new MediaMetadata({
    title,
    artist,
    album,
    artwork: cover ? [{ src: cover, sizes: '500x500' }] : logoArt ? [{ src: logoArt, sizes: '256x256', type: 'image/png' }] : [],
  })
}
function position() {
  if (!ms || !Number.isFinite(audio.duration)) return
  try { ms.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }) } catch {}
}

// soundcloud sometimes deletes artwork, discord shows a dead link as a ?
const coverChecks = new Map()
function liveCover(url) {
  if (!url) return null
  if (!coverChecks.has(url)) {
    coverChecks.set(url, true)
    const img = new Image()
    img.onerror = () => { coverChecks.set(url, false); presence() }
    img.src = url
  }
  return coverChecks.get(url) ? url : null
}

function presence() {
  if (!s.discord_enabled) return
  const n = nowInfo()
  if (!n) return api.setActivity(null)
  let artist = n.artist, song = n.title
  const cut = song.indexOf(' - ')
  if (!artist && cut > 0) [artist, song] = [song.slice(0, cut), song.slice(cut + 3)]
  const line = (x) => (x.length < 2 ? `${x}  ` : x).slice(0, 128)
  const a = { type: 2, name: (artist || 'weebwa.re').slice(0, 128), details: line(song), state: line(artist ? `by ${artist}` : 'weebwa.re'), instance: false }
  a.assets = { large_image: liveCover(n.cover) || 'icon', large_text: line(song) }
  if (!n.paused && n.duration) {
    const start = Date.now() - (n.pos / n.rate) * 1000
    a.timestamps = { start: Math.round(start), end: Math.round(start + (n.duration / n.rate) * 1000) }
  } else {
    a.state = line(`${a.state} \u00b7 paused`)
  }
  api.setActivity(a)
}

function nowInfo() {
  const t = current()
  if (!t) return null
  return {
    title: t.title, artist: t.artist, cover: covers[t.path] || null, pos: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : t.duration, paused: audio.paused, rate: audio.playbackRate,
  }
}

const dl = { items: [], selected: new Set(), anchor: null, gen: 0, resolving: 0, queue: [], running: false }
const SC_URL = /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i
const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')

function renderTargets() {
  $('dl-target').replaceChildren(Object.assign(el('option', '', 'library'), { value: '' }), ...lib.lists.map((n) => Object.assign(el('option', '', n), { value: n })))
  $('dl-target').value = s.dl_target || ''
}
$('dl-target').addEventListener('change', () => {
  s.dl_target = $('dl-target').value || null
  save()
})

function renderDl() {
  $('dl-results').replaceChildren(...dl.items.map((r, i) => {
    const row = el('div', 'track-row' + (r.preview ? ' preview' : '') + (dl.selected.has(i) ? ' multi-selected' : ''),
      `${r.title.slice(0, 44)}  [${r.duration ? fmt(r.duration) : '?:??'}]${r.preview ? `  [${r.lock || 'go+'}]` : ''}`)
    row.dataset.i = i
    return row
  }))
}
$('dl-results').addEventListener('click', (e) => {
  const row = e.target.closest('.track-row')
  if (!row || dl.items[row.dataset.i].preview) return
  select(e, +row.dataset.i, dl.items.map((r, i) => (r.preview ? -1 : i)), dl)
  renderDl()
})

function dlStatus(prefix, list) {
  const go = list.filter((t) => t.preview && t.lock !== 'drm').length
  const drm = list.filter((t) => t.lock === 'drm').length
  return `${prefix} ${plural(list.length, 'track')}${go ? `, ${go} go+ (30s previews, skipped)` : ''}${drm ? `, ${drm} drm (soundcloud only, skipped)` : ''}`
}
async function dlSearch() {
  const q = $('search-dl').value.trim()
  if (!q) return
  const gen = ++dl.gen
  dl.items = []
  dl.selected = new Set()
  dl.anchor = null
  renderDl()
  const url = SC_URL.test(q)
  $('dl-status').textContent = url ? 'resolving url...' : 'searching...'
  dl.resolving = url ? gen : 0
  try {
    const r = url ? await api.resolve(q) : { kind: 'search', tracks: await api.search(q) }
    if (gen !== dl.gen) return
    dl.items = r.tracks
    renderDl()
    const what = r.kind === 'playlist' ? `playlist "${r.label}":` : r.kind === 'user' ? `${r.label}'s likes:` : r.kind === 'track' ? `"${r.label}":` : 'found'
    $('dl-status').textContent = dlStatus(what, r.tracks) + (r.truncated ? ' (stopped at 500)' : '')
  } catch (err) {
    if (gen === dl.gen) $('dl-status').textContent = `error: ${cleanError(err).slice(0, 80)}`
  }
}
$('dl-go').addEventListener('click', dlSearch)
$('search-dl').addEventListener('keydown', (e) => e.key === 'Enter' && dlSearch())
api.onResolveProgress((n) => {
  if (dl.resolving === dl.gen) $('dl-status').textContent = `fetching likes... ${n} so far`
})

async function runDownloads() {
  dl.running = true
  while (dl.queue.length) {
    const { item, list } = dl.queue.shift()
    const name = item.title.slice(0, 40)
    $('dl-status').textContent = `downloading: ${name}${dl.queue.length ? ` (${dl.queue.length} more queued)` : ''}`
    try {
      const r = await api.download(item, list)
      if (item.artworkUrl) covers[r.path] = item.artworkUrl
      notify(r.existed ? `already in your library: ${name}` : `downloaded: ${name}`, { type: 'success' })
    } catch (err) {
      notify(`failed: ${item.title.slice(0, 30)}, ${cleanError(err).slice(0, 70)}`, { type: 'error' })
    }
  }
  dl.running = false
  $('dl-status').textContent = 'done'
  await refresh()
}
$('dl-download').addEventListener('click', () => {
  const items = [...dl.selected].sort((a, b) => a - b).map((i) => dl.items[i]).filter((t) => t && !t.preview)
  if (!items.length) return notify('select at least one track first', { type: 'error' })
  dl.selected.clear()
  renderDl()
  dl.queue.push(...items.map((item) => ({ item, list: s.dl_target })))
  if (items.length > 1) notify(`queued ${plural(items.length, 'track')}`)
  if (!dl.running) runDownloads()
})

let savedStats = ''
function saveStats() {
  const now = JSON.stringify(stats)
  if (now === savedStats) return
  savedStats = now
  api.saveStats(stats)
}
setInterval(saveStats, 60000)
async function showStats() {
  $('stat-played').textContent = `tracks played: ${stats.tracks_played}`
  $('stat-listened').textContent = `listening time: ${fmtLong(stats.listening_seconds)}`
  try { $('stat-memory').textContent = `memory: ${await api.memory()} mb` } catch {}
}
setInterval(() => tab === 'settings' && showStats(), 4000)

window.addEventListener('beforeunload', () => api.saveFinal(s, stats))

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return
  if (!$('modal-overlay').classList.contains('hidden')) return
  if (e.code === 'Space') {
    e.preventDefault()
    togglePlay()
  } else if (e.code === 'ArrowRight') next()
  else if (e.code === 'ArrowLeft') prev()
  else if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey) && tab === 'home') {
    e.preventDefault()
    view.selected = new Set(view.shown)
    paintRows()
  }
})

async function init() {
  const [saved, savedStatsFile, savedCovers] = await Promise.all([api.get('settings'), api.get('stats'), api.get('covers')])
  Object.assign(s, saved)
  stats = { ...stats, ...savedStatsFile }
  savedStats = JSON.stringify(stats)
  covers = savedCovers || {}
  if (!Array.isArray(s.gradient_colors) || !s.gradient_colors.length) s.gradient_colors = ['#ff428e']
  if (!SORTS[s.sort_key]) s.sort_key = 'title'
  s.sort_dir = s.sort_dir === -1 ? -1 : 1
  s.rate = clamp(s.rate, RATE_MIN, RATE_MAX)
  applyVolume()
  audio.defaultPlaybackRate = audio.playbackRate = s.rate
  for (const paint of Object.values(toggles)) paint()
  for (const paint of Object.values(fills)) paint()
  $('text-color-row').classList.toggle('hidden', s.auto_contrast)
  $('sidebar-visualizer').classList.toggle('hidden', !s.visualizer_enabled)
  renderGradientList()
  applyColors()
  route()
  if (s.discord_enabled) api.setDiscord(true)
  const lastTab = TABS.includes(s.last_tab) ? s.last_tab : 'home'
  await refresh()
  if (s.last_playlist && lib.lists.includes(s.last_playlist)) openList(s.last_playlist, false)
  showTab(lastTab, false)
  const last = lib.byPath.get(s.last_track_path)
  if (last) {
    const at = view.shown.indexOf(last.path)
    play.queue = at >= 0 ? view.shown.slice() : [last.path]
    shuffle(Math.max(0, at))
    load(Math.max(0, at), false)
  }
}
init()
