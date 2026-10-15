// Generates build/icon.png (512×512): an orange rounded square with a white paper-plane shape.
// Plain zlib + a hand-written PNG encoder, so no image dependencies are needed.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const S = 512
const px = Buffer.alloc(S * S * 4)
const inPoly = (x, y, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const plane = [
  [120, 270],
  [392, 140],
  [300, 392],
  [250, 300],
]
const fold = [
  [250, 300],
  [392, 140],
  [270, 330],
]
const r = 96
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    const cx = Math.min(Math.max(x, r), S - r)
    const cy = Math.min(Math.max(y, r), S - r)
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    if (!inside) continue
    let [R, G, B] = [255, 108, 55] // brand orange
    if (inPoly(x + 0.5, y + 0.5, plane)) [R, G, B] = inPoly(x + 0.5, y + 0.5, fold) ? [255, 214, 196] : [255, 255, 255]
    px[i] = R
    px[i + 1] = G
    px[i + 2] = B
    px[i + 3] = 255
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
writeFileSync(new URL('../build/icon.png', import.meta.url), png)
console.log('build/icon.png', png.length, 'bytes')
