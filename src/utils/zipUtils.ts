// ---------------------------------------------------------------------------
// Minimal ZIP builder — stored (uncompressed) entries, no external dep.
// Enough for packaging 4 small export files into a single download.
// ---------------------------------------------------------------------------

let _crc32Table: Uint32Array | null = null

function crc32Table(): Uint32Array {
  if (_crc32Table) return _crc32Table
  _crc32Table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    _crc32Table[i] = c
  }
  return _crc32Table
}

function crc32(data: Uint8Array): number {
  const t = crc32Table()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ t[(crc ^ data[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function u16(view: DataView, o: number, v: number) { view.setUint16(o, v, true) }
function u32(view: DataView, o: number, v: number) { view.setUint32(o, v, true) }

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const offsets: number[] = []
  const crcs: number[] = []
  let pos = 0

  for (const entry of entries) {
    offsets.push(pos)
    const name = enc.encode(entry.name)
    const checksum = crc32(entry.data)
    crcs.push(checksum)

    const local = new Uint8Array(30 + name.length + entry.data.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0); u16(lv, 8, 0)
    u16(lv, 10, 0); u16(lv, 12, 0)
    u32(lv, 14, checksum)
    u32(lv, 18, entry.data.length); u32(lv, 22, entry.data.length)
    u16(lv, 26, name.length); u16(lv, 28, 0)
    local.set(name, 30)
    local.set(entry.data, 30 + name.length)
    locals.push(local)
    pos += local.length
  }

  const cdOffset = pos
  for (let i = 0; i < entries.length; i++) {
    const name = enc.encode(entries[i].name)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0); u16(cv, 10, 0)
    u16(cv, 12, 0); u16(cv, 14, 0)
    u32(cv, 16, crcs[i])
    u32(cv, 20, entries[i].data.length); u32(cv, 24, entries[i].data.length)
    u16(cv, 28, name.length); u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0)
    u32(cv, 38, 0); u32(cv, 42, offsets[i])
    cd.set(name, 46)
    centralParts.push(cd)
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0)
  u16(ev, 8, entries.length); u16(ev, 10, entries.length)
  u32(ev, 12, cdSize); u32(ev, 16, cdOffset); u16(ev, 20, 0)

  const total = locals.reduce((s, p) => s + p.length, 0) + cdSize + 22
  const out = new Uint8Array(total)
  let w = 0
  for (const p of locals)       { out.set(p, w); w += p.length }
  for (const p of centralParts) { out.set(p, w); w += p.length }
  out.set(eocd, w)
  return out
}
