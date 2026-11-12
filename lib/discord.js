// rich presence straight over discord's local ipc pipe
import net from 'node:net'
import path from 'node:path'

const CLIENT_ID = '1524762094132531332'

let sock = null
let ready = false
let enabled = false
let retry = null
let activity = null

function pipe(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'
  return path.join(base, `discord-ipc-${i}`)
}

function frame(op, data) {
  const body = Buffer.from(JSON.stringify(data))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

function later() {
  if (!enabled || retry) return
  retry = setTimeout(() => { retry = null; connect() }, 15000)
}

function push() {
  if (!ready) return
  const nonce = `${Date.now()}${Math.random()}`
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }))
}

function connect(i = 0) {
  if (!enabled || sock) return
  if (i > 9) return later()
  const s = net.createConnection(pipe(i))
  let buf = Buffer.alloc(0)
  s.once('error', () => { if (sock !== s) connect(i + 1) })
  s.once('connect', () => {
    sock = s
    s.write(frame(0, { v: 1, client_id: CLIENT_ID }))
  })
  s.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
      const op = buf.readInt32LE(0)
      const len = buf.readInt32LE(4)
      let msg = {}
      try { msg = JSON.parse(buf.subarray(8, 8 + len)) } catch {}
      buf = buf.subarray(8 + len)
      if (op === 1 && msg.evt === 'READY') { ready = true; push() }
      else if (op === 3) s.write(frame(4, msg))
      else if (op === 2) s.destroy()
    }
  })
  s.on('close', () => {
    if (sock !== s) return
    sock = null
    ready = false
    later()
  })
}

export function setEnabled(on) {
  enabled = !!on
  if (enabled) return connect()
  clearTimeout(retry)
  retry = null
  const s = sock
  if (ready) { activity = null; push() }
  sock = null
  ready = false
  s?.end()
}

export function setActivity(next) {
  activity = next || null
  push()
}
