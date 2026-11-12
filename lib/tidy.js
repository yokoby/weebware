// only fixes what's clearly junk, a clean name comes back the same
const JUNK =/\s*[([][^)\]]*(official|video|visuali[sz]er|lyric|\baudio\b|exclusive|wshh|in desc|\bhq\b|free download)[^)\]]*[)\]]/gi

function balance(s, open, close) {
  const opens = s.split(open).length - 1
  const closes = s.split(close).length - 1
  if (opens === closes + 1 && s.lastIndexOf(open) > s.lastIndexOf(close)) return s + close
  if (closes === opens + 1 && s.endsWith(close)) return s.slice(0, -1).trimEnd()
  return s
}

function once(s) {
  if (/_-_/.test(s) || (!/\s/.test(s) && s.includes('_'))) s = s.replace(/_+/g, ' ')
  s = s
    .replace(/[‐-―−]/g, '-')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/ _([^_]+)_(?=\s|$)/g, ' ($1)')
    .replace(/([\p{L}\p{N}])_(?=\s|$)/gu, '$1')
    .replace(/\s+sing master\b/gi, '')
    .replace(JUNK, '')
    .replace(/\s+official(\s+(audio|video|music video|song|visuali[sz]er|lyric video))?(?=\s+-\s|$)/gi, '')
    .replace(/\s*(out\s+)?(now\s+)?on\s+(itunes|spotify|apple music)(\s+(and|&)\s+(itunes|spotify|apple music))*\s*$/gi, '')
    .replace(/\s+@[\w.]+$/, '')
    .replace(/([\p{L}\p{N}])- (?=\S)/gu, '$1 - ')
    .replace(/^(.+?) - \1 - /i, '$1 - ')
    .replace(/ \([1-9]\)$/, '')
    .replace(/([)\]])-[1-9]$/, '$1')
  s = balance(balance(s, '(', ')'), '[', ']')
  return s
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-.]+|[\s\-.]+$/g, '')
}

export function tidy(stem) {
  let s = String(stem)
  for (let prev = null; s !== prev;) {
    prev = s
    s = once(s)
  }
  return s || String(stem)
}

export function tidyName(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? tidy(name.slice(0, dot)) + name.slice(dot).toLowerCase() : tidy(name)
}
