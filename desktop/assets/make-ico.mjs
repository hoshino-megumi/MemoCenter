/**
 * 生成 Windows 应用图标 app.ico
 *
 * 设计说明：
 * - 复用 make-tray.mjs 的程序化绘制（圆角矩形背景 + 白色对勾），保证托盘图标与快捷方式图标视觉一致
 * - 每个尺寸都按设计稿（64px 基准）等比重新矢量光栅化，而不是把 64px 位图缩放，小尺寸更清晰
 * - ICO 内嵌 32 位 BMP(DIB) 数据而非 PNG：System.Drawing.Icon 等传统 API 无法解析 PNG 压缩条目，
 *   BMP 条目在 Win10/11 shell 与传统 GDI 路径下兼容性最好
 *
 * 运行：node desktop/assets/make-ico.mjs
 * 零第三方依赖（仅用 node 内置模块）
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 目标尺寸：Windows 快捷方式/资源管理器常用 16/32/48，大图标视图用 64 */
const SIZES = [16, 32, 48, 64]
/** 设计稿基准尺寸，所有几何参数都以 64px 画布定义 */
const BASE = 64

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'app.ico')

// 与 make-tray.mjs 保持一致的配色
const BG = [63, 91, 217]
const FG = [255, 255, 255]

// 以下几何量均为 64px 画布下的像素值
const RADIUS = 15
const STROKE = 5.2
const CHECK = [
  [17, 33],
  [27, 43],
  [47, 21]
]

/**
 * 判断点是否落在圆角矩形内。
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r 圆角半径
 * @returns {boolean}
 */
function insideRoundRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r)
  const cy = Math.min(Math.max(y, r), h - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/**
 * 点到线段的距离。
 * @returns {number}
 */
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

/**
 * 在指定尺寸下按设计稿坐标（等比缩放）光栅化图标。
 *
 * @param {number} size 输出边长（像素）
 * @returns {Buffer} 长度为 size*size*4 的 RGBA 数据，按「从上到下」行序排列
 */
function drawRgba(size) {
  const scale = size / BASE
  const radius = RADIUS * scale
  const stroke = STROKE * scale
  const check = CHECK.map(([x, y]) => [x * scale, y * scale])

  // 小尺寸用更高的超采样倍数，避免对勾糊成一团
  const ss = size <= 24 ? 8 : size <= 48 ? 5 : 4
  const total = ss * ss

  const out = Buffer.alloc(size * size * 4)
  let offset = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0
      let fgHits = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss
          const py = y + (sy + 0.5) / ss
          if (!insideRoundRect(px, py, size, size, radius)) continue
          bgHits++
          const d = Math.min(
            distToSegment(px, py, check[0][0], check[0][1], check[1][0], check[1][1]),
            distToSegment(px, py, check[1][0], check[1][1], check[2][0], check[2][1])
          )
          if (d <= stroke) fgHits++
        }
      }
      const alpha = Math.round((bgHits / total) * 255)
      const mix = bgHits ? fgHits / bgHits : 0
      out[offset++] = Math.round(BG[0] + (FG[0] - BG[0]) * mix)
      out[offset++] = Math.round(BG[1] + (FG[1] - BG[1]) * mix)
      out[offset++] = Math.round(BG[2] + (FG[2] - BG[2]) * mix)
      out[offset++] = alpha
    }
  }
  return out
}

/**
 * 把 RGBA 位图编码成 ICO 里的 32 位 BMP(DIB) 条目。
 * 结构：BITMAPINFOHEADER(40B) + 自底向上的 BGRA 像素 + 1bpp AND 掩码。
 *
 * @param {Buffer} rgba 上到下行序的 RGBA 数据
 * @param {number} size 边长
 * @returns {Buffer}
 */
function encodeDib(rgba, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // biWidth
  header.writeInt32LE(size * 2, 8) // biHeight = 像素 + 掩码高度
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4, 20) // biSizeImage

  // 像素数据：BMP 行序为自底向上，通道序为 BGRA
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4
    const dstRow = y * size * 4
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4
      const d = dstRow + x * 4
      pixels[d] = rgba[s + 2]
      pixels[d + 1] = rgba[s + 1]
      pixels[d + 2] = rgba[s]
      pixels[d + 3] = rgba[s + 3]
    }
  }

  // AND 掩码：每行按 4 字节对齐，1 表示透明（兼容不认 alpha 的旧路径）
  const maskStride = (((size + 31) >> 5) << 2)
  const mask = Buffer.alloc(maskStride * size)
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4
    const dstRow = y * maskStride
    for (let x = 0; x < size; x++) {
      if (rgba[srcRow + x * 4 + 3] < 128) {
        mask[dstRow + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
  }

  return Buffer.concat([header, pixels, mask])
}

const images = SIZES.map((size) => ({ size, data: encodeDib(drawRgba(size), size) }))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = 1 (icon)
header.writeUInt16LE(images.length, 4) // 图像数量

let dataOffset = 6 + 16 * images.length
const entries = []
for (const image of images) {
  const entry = Buffer.alloc(16)
  entry[0] = image.size >= 256 ? 0 : image.size // width（0 表示 256）
  entry[1] = image.size >= 256 ? 0 : image.size // height
  entry[2] = 0 // 调色板颜色数
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // 色彩平面
  entry.writeUInt16LE(32, 6) // 位深
  entry.writeUInt32LE(image.data.length, 8)
  entry.writeUInt32LE(dataOffset, 12)
  dataOffset += image.data.length
  entries.push(entry)
}

const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, ico)
console.log(
  `app icon written: ${OUT} (${ico.length} bytes, sizes: ${SIZES.join('/')}, format: 32bpp BMP)`
)
