// Generates build/icon.png (512×512): an orange circle (Postman's badge shape and colour) with a white
// paper plane — related, without copying Postman's trademarked logo. 4×4 supersampled edges.
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
  [132, 268],
  [380, 152],
  [296, 380],
  [250, 296],
]
const fold = [
  [250, 296],
  [380, 152],
  [268, 324],
]
const colour = (x, y) => {
  if ((x - S / 2) ** 2 + (y - S / 2) ** 2 > (S / 2 - 8) ** 2) return null
  if (inPoly(x, y, plane)) return inPoly(x, y, fold) ? [255, 214, 196] : [255, 255, 255]
  return [255, 108, 55] // brand orange
}
const N = 4
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let [R, G, B, A] = [0, 0, 0, 0]
    for (let sy = 0; sy < N; sy++)
      for (let sx = 0; sx < N; sx++) {
        const c = colour(x + (sx + 0.5) / N, y + (sy + 0.5) / N)
        if (!c) continue
        R += c[0]
        G += c[1]
        B += c[2]
        A++
      }
    const i = (y * S + x) * 4
    if (!A) continue
    px[i] = R / A
    px[i + 1] = G / A
    px[i + 2] = B / A
    px[i + 3] = (A * 255) / (N * N)
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
