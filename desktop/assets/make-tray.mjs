import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 64
const SS = 4
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tray.png')

const BG = [63, 91, 217]
const FG = [255, 255, 255]

function insideRoundRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r)
  const cy = Math.min(Math.max(y, r), h - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const c1 = vx * wx + vy * wy
  const c2 = vx * vx + vy * vy
  const t = c2 > 0 ? Math.min(1, Math.max(0, c1 / c2)) : 0
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return Math.sqrt(dx * dx + dy * dy)
}

const stroke = 5.2
const check = [
  [17, 33],
  [27, 43],
  [47, 21]
]

function checkAlpha(x, y) {
  const d = Math.min(
    distToSegment(x, y, ...check[0], ...check[1]),
    distToSegment(x, y, ...check[1], ...check[2])
  )
  return d <= stroke ? 1 : 0
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
let offset = 0
for (let y = 0; y < SIZE; y++) {
  raw[offset++] = 0
  for (let x = 0; x < SIZE; x++) {
    let bg = 0
    let fg = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS
        const py = y + (sy + 0.5) / SS
        if (!insideRoundRect(px, py, SIZE, SIZE, 15)) continue
        bg++
        if (checkAlpha(px, py)) fg++
      }
    }
    const total = SS * SS
    const alpha = Math.round((bg / total) * 255)
    const mix = bg ? fg / bg : 0
    raw[offset++] = Math.round(BG[0] + (FG[0] - BG[0]) * mix)
    raw[offset++] = Math.round(BG[1] + (FG[1] - BG[1]) * mix)
    raw[offset++] = Math.round(BG[2] + (FG[2] - BG[2]) * mix)
    raw[offset++] = alpha
  }
}

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`tray icon written: ${OUT} (${png.length} bytes)`)
