import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as store from './lib/store.js'
import * as library from './lib/library.js'
import * as soundcloud from './lib/soundcloud.js'
import * as discord from './lib/discord.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const mac = process.platform === 'darwin'

app.setPath('userData', path.join(app.getPath('appData'), 'weebware-electron'))

if (!app.requestSingleInstanceLock()) app.exit(0)

app.commandLine.appendSwitch('disable-features', 'MediaRouter,DialMediaRouteProvider,SpareRendererForSitePerProcess')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let win = null
let quitting = false

const defaultDir = () => path.join(app.getPath('music'), 'weebware')

function keyed(name) {
  const map = store.load(name, {})
  let fixed = false
  for (const k of Object.keys(map)) {
    if (path.isAbsolute(k)) continue
    map[path.join(library.dir(), k)] = map[k]
    delete map[k]
    fixed = true
  }
  if (fixed) store.save(name, map)
  return map
}

function settings() {
  const s = store.load('settings', {})
  if (s.last_track_path && !path.isAbsolute(s.last_track_path)) s.last_track_path = path.join(library.dir(), s.last_track_path)
  return s
}

const openLibrary = (dir) => library.open(dir, () => win?.webContents.send('library:changed'))

function listDir(name) {
  if (!name) return library.dir()
  const dest = path.join(library.dir(), String(name))
  if (path.dirname(dest) !== library.dir()) throw new Error('no such playlist')
  return dest
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    title: 'weebwa.re',
    icon: path.join(here, 'assets', mac ? 'icon.png' : 'icon.ico'),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      v8CacheOptions: 'bypassHeatCheck',
    },
  })
  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(here, 'renderer', 'index.html'))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('close', (e) => {
    if (mac && !quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => { win = null })
}

const on = (channel, fn) => ipcMain.on(channel, (_e, ...args) => fn(...args))
const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args))

on('win:minimize', () => win?.minimize())
on('win:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()))
on('win:close', () => win?.close())

handle('library:scan', () => library.scan(keyed('titles')))
on('library:open', () => shell.openPath(library.dir()))
handle('library:choose', async () => {
  const r = await dialog.showOpenDialog(win, { defaultPath: library.dir(), properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  openLibrary(r.filePaths[0])
  const s = store.load('settings', {})
  if (path.resolve(r.filePaths[0]) === path.resolve(defaultDir())) delete s.music_dir
  else s.music_dir = library.dir()
  store.save('settings', s)
  return library.dir()
})
handle('library:trash', (paths) => library.trash(Array.isArray(paths) ? paths : []))
on('library:duration', (p, seconds) => library.inside(p) && Number.isFinite(seconds) && library.setDuration(p, seconds))
on('library:wave', (p, peaks) => library.inside(p) && typeof peaks === 'string' && peaks.length < 2000 && library.setWave(p, peaks))
handle('library:title', (p, title) => {
  if (!library.inside(p)) return
  const titles = keyed('titles')
  const t = String(title || '').trim().slice(0, 200)
  if (t) titles[p] = t
  else delete titles[p]
  store.save('titles', titles)
})

handle('lists:create', (name) => library.createList(name))
handle('lists:rename', (from, to) => library.renameList(from, to))
handle('lists:delete', (name) => library.dissolveList(name))
handle('lists:move', (name, paths) => library.move(Array.isArray(paths) ? paths : [], listDir(name)))

const reads = { settings, stats: () => store.load('stats', {}), covers: () => keyed('covers') }
handle('store:get', (name) => reads[name]?.() ?? {})
const saveSettings = (data) => {
  const { music_dir } = store.load('settings', {})
  store.save('settings', music_dir ? { ...data, music_dir } : data)
}
on('store:settings', saveSettings)
on('store:stats', (data) => store.save('stats', data))
ipcMain.on('store:final', (e, s, stats) => {
  saveSettings(s)
  store.save('stats', stats)
  store.flush()
  e.returnValue = true
})

handle('app:memory', () => Math.round(app.getAppMetrics().reduce((n, m) => n + (m.memory?.workingSetSize || 0), 0) / 1024))

handle('dl:search', (q) => soundcloud.search(String(q)))
handle('dl:resolve', (url) => soundcloud.resolve(String(url), (n) => win?.webContents.send('dl:progress', n)))
handle('dl:track', async (item, list) => {
  if (!item || item.preview) throw new Error(item?.lock === 'drm' ? 'drm protected on soundcloud, only its own player can play it' : 'go+ only, soundcloud would only hand over a 30 second preview')
  const dest = listDir(list)
  const base = soundcloud.fileName(item)
  const folders = [library.dir(), ...fs.readdirSync(library.dir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(library.dir(), e.name))]
  for (const folder of folders) {
    for (const ext of ['.mp3', '.m4a']) {
      const p = path.join(folder, base + ext)
      if (fs.existsSync(p)) return { path: p, existed: true }
    }
  }
  const { data, ext } = await soundcloud.download(item.id)
  const file = path.join(dest, base + ext)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(file, data)
  if (item.artworkUrl) {
    const covers = keyed('covers')
    covers[file] = item.artworkUrl
    store.save('covers', covers)
  }
  return { path: file }
})

on('discord:enabled', (v) => discord.setEnabled(v))
on('discord:activity', (a) => discord.setActivity(a && typeof a === 'object' ? a : null))

app.on('second-instance', () => {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => {
  discord.setEnabled(false)
  store.flush()
})
app.on('window-all-closed', () => { if (!mac) app.quit() })
app.on('activate', () => (win ? win.show() : createWindow()))

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('weebware.musicplayer')
  Menu.setApplicationMenu(mac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  if (mac) app.dock?.setIcon(path.join(here, 'assets', 'icon.png'))
  const { music_dir } = store.load('settings', {})
  openLibrary(music_dir && fs.existsSync(music_dir) ? music_dir : defaultDir())
  createWindow()
})
