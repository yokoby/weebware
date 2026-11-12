// soundcloud's aac is fragmented mp4. some players (javafx) stop after the first fragment, so flatten
// rewrites it as one plain m4a. same samples, nothing re-encoded
function* boxes(buf, start = 0, end = buf.length) {
  let p = start
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p)
    let head = 8
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8))
      head = 16
    } else if (size === 0) {
      size = end - p
    }
    if (size < head || p + size > end) return
    yield { type: buf.toString('latin1', p + 4, p + 8), start: p, body: p + head, end: p + size }
    p += size
  }
}

function find(buf, path, start = 0, end = buf.length) {
  let found = null
  for (const type of path) {
    found = null
    for (const b of boxes(buf, start, end)) if (b.type === type) { found = b; break }
    if (!found) return null
    start = found.body
    end = found.end
  }
  return found
}

function u32(values) {
  const b = Buffer.alloc(4 * values.length)
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4))
  return b
}
function box(type, ...parts) {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}
const full = (type, ...parts) => box(type, u32([0]), ...parts)
const copy = (buf, b) => Buffer.from(buf.subarray(b.start, b.end))

function setDuration(b, v0, v1, value) {
  if (b[8] === 1) b.writeBigUInt64BE(BigInt(Math.round(value)), v1)
  else b.writeUInt32BE(Math.round(value) >>> 0, v0)
}
const timescale = (b) => b.readUInt32BE(b[8] === 1 ? 28 : 20)

export const fragmented = (buf) => !!find(buf, ['moov', 'mvex'])

export function encrypted(buf) {
  const stsd = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'])
  return !!stsd && buf.toString('latin1', stsd.body + 12, stsd.body + 16) === 'enca'
}

export function flatten(buf) {
  const moov = find(buf, ['moov'])
  const trak = find(buf, ['trak'], moov.body, moov.end)
  const mdia = find(buf, ['mdia'], trak.body, trak.end)
  const minf = find(buf, ['minf'], mdia.body, mdia.end)
  const stbl = find(buf, ['stbl'], minf.body, minf.end)
  const trex = find(buf, ['mvex', 'trex'], moov.body, moov.end)
  const sizes = [], durations = [], data = []
  const top = [...boxes(buf)]

  top.forEach((moof, n) => {
    if (moof.type !== 'moof') return
    const mdat = top.slice(n + 1).find((b) => b.type === 'mdat')
    for (const traf of boxes(buf, moof.body, moof.end)) {
      if (traf.type !== 'traf') continue
      const tfhd = find(buf, ['tfhd'], traf.body, traf.end)
      const tf = buf.readUInt32BE(tfhd.body) & 0xffffff
      let p = tfhd.body + 8
      let base = moof.start
      let dur = trex ? buf.readUInt32BE(trex.body + 12) : 0
      let size = trex ? buf.readUInt32BE(trex.body + 16) : 0
      if (tf & 0x1) { base = Number(buf.readBigUInt64BE(p)); p += 8 }
      if (tf & 0x2) p += 4
      if (tf & 0x8) { dur = buf.readUInt32BE(p); p += 4 }
      if (tf & 0x10) { size = buf.readUInt32BE(p); p += 4 }
      let at = mdat ? mdat.body : moof.end
      for (const trun of boxes(buf, traf.body, traf.end)) {
        if (trun.type !== 'trun') continue
        const rf = buf.readUInt32BE(trun.body) & 0xffffff
        const count = buf.readUInt32BE(trun.body + 4)
        let q = trun.body + 8
        if (rf & 0x1) { at = base + buf.readInt32BE(q); q += 4 }
        if (rf & 0x4) q += 4
        for (let i = 0; i < count; i++) {
          let d = dur, z = size
          if (rf & 0x100) { d = buf.readUInt32BE(q); q += 4 }
          if (rf & 0x200) { z = buf.readUInt32BE(q); q += 4 }
          if (rf & 0x400) q += 4
          if (rf & 0x800) q += 4
          durations.push(d)
          sizes.push(z)
          data.push(buf.subarray(at, at + z))
          at += z
        }
      }
    }
  })
  if (!sizes.length) throw new Error('no audio in that stream')

  const total = durations.reduce((a, b) => a + b, 0)
  const mdhd = copy(buf, find(buf, ['mdhd'], mdia.body, mdia.end))
  const mvhd = copy(buf, find(buf, ['mvhd'], moov.body, moov.end))
  const tkhd = copy(buf, find(buf, ['tkhd'], trak.body, trak.end))
  const movieTotal = (total * timescale(mvhd)) / timescale(mdhd)
  setDuration(mdhd, 24, 32, total)
  setDuration(mvhd, 24, 32, movieTotal)
  setDuration(tkhd, 28, 36, movieTotal)

  const runs = []
  for (const d of durations) {
    const last = runs.at(-1)
    if (last && last[1] === d) last[0]++
    else runs.push([1, d])
  }
  const parts = (type) => {
    const b = find(buf, [type], minf.body, minf.end)
    return b ? [copy(buf, b)] : []
  }
  const table = box('stbl',
    copy(buf, find(buf, ['stsd'], stbl.body, stbl.end)),
    full('stts', u32([runs.length, ...runs.flat()])),
    full('stsc', u32([1, 1, sizes.length, 1])),
    full('stsz', u32([0, sizes.length]), u32(sizes)),
    full('stco', u32([1, 0])))
  const newMoov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, copy(buf, find(buf, ['hdlr'], mdia.body, mdia.end)), box('minf', ...parts('smhd'), ...parts('dinf'), table))))
  const ftyp = box('ftyp', Buffer.from('M4A ', 'latin1'), u32([0]), Buffer.from('M4A mp42isom', 'latin1'))
  const audio = sizes.reduce((a, b) => a + b, 0)
  const stco = find(newMoov, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])
  newMoov.writeUInt32BE(ftyp.length + newMoov.length + 8, stco.body + 8)
  return Buffer.concat([ftyp, newMoov, u32([8 + audio]), Buffer.from('mdat', 'latin1'), ...data])
}
