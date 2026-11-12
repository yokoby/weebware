import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const pending = new Map()
let timer = null

const file = (name) => path.join(app.getPath('userData'), `${name}.json`)

export function load(name, fallback) {
  if (pending.has(name)) return pending.get(name)
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8').trimStart())
  } catch {
    return fallback
  }
}

export function save(name, data) {
  pending.set(name, data)
  timer ??= setTimeout(flush, 500)
}

export function flush() {
  clearTimeout(timer)
  timer = null
  for (const [name, data] of pending) {
    try {
      fs.mkdirSync(path.dirname(file(name)), { recursive: true })
      const tmp = `${file(name)}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data, null, name === 'library' ? 0 : 2))
      fs.renameSync(tmp, file(name))
    } catch {}
  }
  pending.clear()
}
