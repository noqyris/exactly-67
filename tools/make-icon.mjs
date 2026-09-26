#!/usr/bin/env node
/**
 * App-icon generator — "Big 67": a giant candy "67" standing on a level beam.
 *
 *   node tools/make-icon.mjs
 *
 * Writes the three iOS 18+ appearances into
 * `ios/App/App/Assets.xcassets/AppIcon.appiconset/` (`AppIcon-1024.png`,
 * `AppIcon-1024-dark.png`, `AppIcon-1024-tinted.png` + `Contents.json`, and
 * deletes any other PNG left in that folder) and copies the light icon to
 * `store/icon-1024.png`.
 *
 * Options:
 *   --out <dir>     write the three PNGs to <dir> instead (touches nothing in the repo)
 *   --sheet <file>  also render a comparison sheet: light/dark/tinted at 180/60/40 px on
 *                   a light and a dark home screen, plus a "before" row holding whatever
 *                   `store/icon-1024.png` was when the run started
 *
 * Env: PLAYWRIGHT=<path to the playwright package> overrides the default npx-cache
 * location. Needs no install: Chromium from Playwright's browser cache does the
 * drawing. The numerals are the game's own font (Baloo 2 ExtraBold), read as
 * outlines straight from node_modules/@fontsource/baloo-2 — paths, not <text>, so
 * the rim, the extrusion and the gloss clip all share one exact silhouette and no
 * font has to finish loading before the screenshot.
 *
 * Like the game, every shape is drawn in code — an inline SVG on a 1024 canvas.
 * The screenshot is then re-encoded here as an **opaque 8-bit RGB PNG with an
 * sRGB chunk** (App Store Connect rejects an icon with an alpha channel), and
 * the script fails if any pixel was not fully opaque.
 *
 * The start-screen logo is this artwork without the square; its geometry is
 * the `G` table below, and a Phaser port must keep it in step.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT ?? '/Users/djosubotic/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ICONSET = join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset')
const STORE_ICON = join(ROOT, 'store/icon-1024.png')
// WOFF 1 on purpose: its tables are plain zlib, so the outlines need no decoder
// beyond node:zlib (WOFF 2 would need Brotli plus the glyf transform).
const FONT_FILE = join(ROOT, 'node_modules/@fontsource/baloo-2/files/baloo-2-latin-800-normal.woff')

const SIZE = 1024
const FILES = { light: 'AppIcon-1024.png', dark: 'AppIcon-1024-dark.png', tinted: 'AppIcon-1024-tinted.png' }

// ── Palette (src/render/palette.ts + icon-only shades) ──────────────────────
const INK = '#2B2440'

/** Per-appearance colours. Geometry is shared; only paint changes. */
const VARIANTS = {
  // Raspberry is the one ground no neighbouring number puzzle uses (they sit in
  // blues and purples), and it is the balloon's colour family.
  light: {
    bg: ['#FF6F9F', '#E3417B', '#B32A5F'], // a shade under the concept's, for ~3:1 against the yellow faces
    rays: ['#FFFFFF', 0.1],
    rim: INK,
    seam: INK,
    face: ['#FFF4B0', '#FFE04D', '#FFC21F'],
    side: ['#F59331', '#D46A14'],
    gloss: 0.55,
    shine: '#FFFFFF',
    beam: ['#96F2D7', '#63E6BE', '#20C997'],
    beamHi: ['#E6FCF5', 0.85],
    stand: INK,
    sparkle: '#FFFFFF',
    shadow: ['#6E1238', 0.45],
  },
  // A plum-black ground keeps a trace of the raspberry without glowing in a dark
  // room. Ink would vanish into it, so the rim goes a step darker than the ground
  // and the stand lifts to a muted violet; the candy itself does not change.
  dark: {
    bg: ['#47203F', '#2C1832', '#170F1F'],
    rays: ['#FF7AA8', 0.05],
    rim: '#0F0A16',
    seam: '#0F0A16',
    face: ['#FFF4B0', '#FFE04D', '#FFC21F'],
    side: ['#F59331', '#D46A14'],
    gloss: 0.45,
    shine: '#FFFFFF',
    beam: ['#96F2D7', '#63E6BE', '#20C997'],
    beamHi: ['#E6FCF5', 0.8],
    stand: '#56466F',
    sparkle: '#FFE8A3',
    shadow: ['#000000', 0.55],
  },
  // Grayscale on black: the system maps luminance onto the user's tint, so the
  // numeral faces are pure white (the brightest thing), their walls and the beam
  // mid-grey, the stand dim and the ground black. The gloss and shine would be
  // white on white, so they are left out.
  tinted: {
    bg: ['#000000', '#000000', '#000000'],
    rays: null,
    rim: '#000000',
    seam: '#000000',
    face: ['#FFFFFF', '#FFFFFF', '#E6E6E6'],
    side: ['#8C8C8C', '#6A6A6A'],
    gloss: 0,
    shine: null,
    beam: ['#9A9A9A', '#8A8A8A', '#707070'],
    beamHi: ['#C8C8C8', 0.8],
    stand: '#4D4D4D',
    sparkle: '#9E9E9E',
    shadow: null,
  },
}

// ── Geometry (1024 canvas; everything important inside x 101–923, y 179–902) ─
const G = {
  numeral: {
    size: 720, // font size, px
    baseline: 650, // baseline of the faces
    cx: 512, // the pair's ink is centred on this
    gap: 23.2, // between the two ink boxes: the 22 px rims touch, so the pair reads as one mark
    depth: 32, // extrusion straight down
    step: 3, // the extrusion is the glyph re-drawn every `step` px down to `depth`
    rim: 22, // ink outline outside the silhouette (a stroke of twice this)
    seam: 10, // ink stroke under the face, 5 px of it showing against the walls
  },
  gloss: { lift: 43.2, rx: 316.8, ry: 259.2 }, // ellipse centred `lift` above the face top
  // One capsule highlight per digit (clipped to the glyph). The 6's is kept short
  // and dim so the 7's bar stays the single hottest pixel at 40 px.
  shine6: { cx: 236, cy: 318, w: 40, h: 96, deg: 28, alpha: 0.6 },
  shine7: { cx: 635.2, cy: 251.8, w: 144, h: 40, deg: 0, alpha: 0.9 },
  beam: { x: 112, y: 676, w: 800, h: 88, stroke: 22 }, // 16% thicker than the concept, so "balance" survives 40 px
  beamHi: { x: 146, y: 689, w: 732, h: 14 },
  stand: { apex: [512, 720], base: [[420, 872], [604, 872]], join: 14 },
  foot: { x: 377, y: 862, w: 270, h: 40 },
  rays: { cx: 512, cy: 440, n: 18, r: 900 }, // 10° wedges, 10° gaps, from 0°
  sparkles: [[132, 172, 40], [196, 112, 19], [902, 560, 26]],
}

// ── Baloo 2 outlines (TrueType glyf) → SVG path data ────────────────────────
function loadFont(file) {
  const b = readFileSync(file)
  const tables = {}
  for (let i = 0; i < b.readUInt16BE(12); i++) {
    const o = 44 + i * 20
    const [off, comp, orig] = [b.readUInt32BE(o + 4), b.readUInt32BE(o + 8), b.readUInt32BE(o + 12)]
    const raw = b.subarray(off, off + comp)
    tables[b.toString('latin1', o, o + 4)] = comp === orig ? Buffer.from(raw) : zlib.inflateSync(raw)
  }
  const { head, cmap, glyf } = tables
  const unitsPerEm = head.readUInt16BE(18)
  const longLoca = head.readInt16BE(50) === 1
  const loca = (g) => (longLoca ? tables.loca.readUInt32BE(g * 4) : tables.loca.readUInt16BE(g * 2) * 2)

  // cmap format 4, Windows Unicode BMP — all the two digits need.
  let sub = -1
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const [pid, eid, off] = [cmap.readUInt16BE(4 + i * 8), cmap.readUInt16BE(6 + i * 8), cmap.readUInt32BE(8 + i * 8)]
    if (pid === 3 && (eid === 1 || eid === 10) && cmap.readUInt16BE(off) === 4) sub = off
  }
  if (sub < 0) throw new Error('no format-4 cmap in the font')
  const segX2 = cmap.readUInt16BE(sub + 6)
  const [ends, starts] = [sub + 14, sub + 16 + segX2]
  const [deltas, ranges] = [starts + segX2, starts + 2 * segX2]
  function glyphId(code) {
    for (let s = 0; s < segX2; s += 2) {
      if (code > cmap.readUInt16BE(ends + s)) continue
      const start = cmap.readUInt16BE(starts + s)
      if (code < start) break
      const [delta, ro] = [cmap.readInt16BE(deltas + s), cmap.readUInt16BE(ranges + s)]
      if (ro === 0) return (code + delta) & 0xffff
      const g = cmap.readUInt16BE(ranges + s + ro + (code - start) * 2)
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    throw new Error(`U+${code.toString(16)} is not in the font`)
  }

  /** Simple-glyph contours in font units, y up. The digits are never composites. */
  function contours(g) {
    const o = loca(g)
    const n = glyf.readInt16BE(o)
    if (n < 0) throw new Error(`glyph ${g} is a composite`)
    const endPts = Array.from({ length: n }, (_, i) => glyf.readUInt16BE(o + 10 + i * 2))
    const total = endPts[n - 1] + 1
    let p = o + 10 + n * 2
    p += 2 + glyf.readUInt16BE(p) // skip the hinting instructions
    const flags = []
    while (flags.length < total) {
      const f = glyf[p++]
      flags.push(f)
      if (f & 8) for (let r = glyf[p++]; r > 0; r--) flags.push(f)
    }
    const coords = (short, same) => {
      let v = 0
      return flags.map((f) => {
        if (f & short) {
          const d = glyf[p++]
          v += f & same ? d : -d
        } else if (!(f & same)) {
          v += glyf.readInt16BE(p)
          p += 2
        }
        return v
      })
    }
    const xs = coords(2, 16)
    const ys = coords(4, 32)
    let s = 0
    return endPts.map((e) => {
      const c = []
      for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 })
      s = e + 1
      return c
    })
  }

  /**
   * The glyph at `size` px with the pen at (x0, y0) on the baseline, as SVG path
   * data: `outline` is every contour (the filled shape), `holes` the counters alone.
   */
  function glyph(ch, size, x0, y0) {
    const g = glyphId(ch.codePointAt(0))
    const k = size / unitsPerEm
    const X = (v) => +(x0 + v * k).toFixed(2)
    const Y = (v) => +(y0 - v * k).toFixed(2)
    const cs = contours(g)
    // The biggest contour is the outline; every other one in a digit is a counter.
    const area = (c) => Math.abs(c.reduce((a, q, i) => a + q.x * c[(i + 1) % c.length].y - c[(i + 1) % c.length].x * q.y, 0))
    const outer = cs.reduce((best, c, i) => (area(c) > area(cs[best]) ? i : best), 0)
    const paths = cs.map((c) => {
      // TrueType leaves the on-curve point between two off-curve ones implied.
      const pts = []
      c.forEach((a, i) => {
        const b = c[(i + 1) % c.length]
        pts.push(a)
        if (!a.on && !b.on) pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true })
      })
      const first = pts.findIndex((q) => q.on)
      const seq = pts.slice(first).concat(pts.slice(0, first))
      let d = `M${X(seq[0].x)} ${Y(seq[0].y)}`
      for (let i = 1; i <= seq.length; i++) {
        const q = seq[i % seq.length]
        if (q.on) d += `L${X(q.x)} ${Y(q.y)}`
        else {
          const n = seq[(i + 1) % seq.length]
          d += `Q${X(q.x)} ${Y(q.y)} ${X(n.x)} ${Y(n.y)}`
          i++
        }
      }
      return `${d}Z`
    })
    return { outline: paths.join(''), holes: paths.filter((_, i) => i !== outer).join('') }
  }

  /** Ink bounds in font units (y up). */
  function bounds(ch) {
    const o = loca(glyphId(ch.codePointAt(0)))
    return { xMin: glyf.readInt16BE(o + 2), yMin: glyf.readInt16BE(o + 4), xMax: glyf.readInt16BE(o + 6), yMax: glyf.readInt16BE(o + 8) }
  }

  return { unitsPerEm, glyph, bounds }
}

/** Pen positions and ink boxes for "6" and "7", the pair's ink centred on G.numeral.cx. */
function numeralLayout(font) {
  const { size, baseline, cx, gap } = G.numeral
  const k = size / font.unitsPerEm
  const [six, seven] = [font.bounds('6'), font.bounds('7')]
  const w6 = (six.xMax - six.xMin) * k
  const w7 = (seven.xMax - seven.xMin) * k
  const left6 = cx - (w6 + gap + w7) / 2
  const left7 = left6 + w6 + gap
  const top = baseline - Math.max(six.yMax, seven.yMax) * k
  const digit = (ch, b, left, w) => {
    const pen = left - b.xMin * k
    return { ch, pen, left, right: left + w, cx: left + w / 2, ...font.glyph(ch, size, pen, baseline) }
  }
  return { top, six: digit('6', six, left6, w6), seven: digit('7', seven, left7, w7) }
}

const rr = ({ x, y, w, h }, attrs) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${attrs}/>`

/** Four-point candy glint centred on (x, y). */
const sparkle = (x, y, r) => {
  const q = r * 0.16
  return `M${x} ${y - r}Q${x + q} ${y - q} ${x + r} ${y}Q${x + q} ${y + q} ${x} ${y + r}Q${x - q} ${y + q} ${x - r} ${y}Q${x - q} ${y - q} ${x} ${y - r}Z`
}

function raysPath({ cx, cy, n, r }) {
  let d = ''
  for (let i = 0; i < n; i++) {
    const [a0, a1] = [(i / n) * 2 * Math.PI, ((i + 0.5) / n) * 2 * Math.PI]
    d += `M${cx} ${cy}L${(cx + r * Math.cos(a0)).toFixed(1)} ${(cy + r * Math.sin(a0)).toFixed(1)}L${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy + r * Math.sin(a1)).toFixed(1)}Z`
  }
  return d
}

function iconSvg(v, L) {
  const p = VARIANTS[v]
  const N = G.numeral
  const { beam: b, rays } = G
  const offsets = []
  for (let d = 0; d <= N.depth; d += N.step) offsets.push(d)
  if (offsets.at(-1) !== N.depth) offsets.push(N.depth)
  const shadow = (id, dy, blur, k = 1) =>
    p.shadow
      ? `<filter id="${id}" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="${p.shadow[0]}" flood-opacity="${(p.shadow[1] * k).toFixed(2)}"/></filter>`
      : ''
  const useShadow = (id) => (p.shadow ? ` filter="url(#${id})"` : '')
  const capsule = (s, fill, clip) =>
    `<g clip-path="url(#${clip})"><rect x="${s.cx - s.w / 2}" y="${s.cy - s.h / 2}" width="${s.w}" height="${s.h}" rx="${Math.min(s.w, s.h) / 2}" fill="${fill}" opacity="${s.alpha}" transform="rotate(${s.deg} ${s.cx} ${s.cy})"/></g>`

  const ground = `<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>${p.rays ? `<path d="${raysPath(rays)}" fill="url(#rayFade)"/>` : ''}`

  const digit = (id, dg, shine) => {
    const d = dg.outline
    return `
  <!-- "${dg.ch}": rim + depth (the silhouette swept straight down), side walls, face, gloss -->
  <g${useShadow('drop')}>
    ${offsets.map((o) => `<path d="${d}" transform="translate(0 ${o})" fill="${p.rim}" stroke="${p.rim}" stroke-width="${2 * N.rim}" stroke-linejoin="round"/>`).join('\n    ')}
  </g>
  ${offsets.slice(1).map((o) => `<path d="${d}" transform="translate(0 ${o})" fill="url(#side)"/>`).join('\n  ')}
  <path d="${d}" fill="url(#face)" stroke="${p.seam}" stroke-width="${N.seam}" paint-order="stroke" stroke-linejoin="round"/>
  ${dg.holes ? `<!-- the counter: the extrusion's inner wall showing through the 6 read as an open
       mouth at 40 px, so the ground is painted back in and only the ink rim is left -->
  <clipPath id="${id}Hole"><path d="${dg.holes}"/></clipPath>
  <g clip-path="url(#${id}Hole)">${ground}<path d="${dg.holes}" fill="none" stroke="${p.rim}" stroke-width="${2 * N.rim}"/></g>` : ''}
  <clipPath id="${id}"><path d="${d}"/></clipPath>
  ${p.gloss ? `<g clip-path="url(#${id})"><ellipse cx="${dg.cx.toFixed(1)}" cy="${(L.top - G.gloss.lift).toFixed(1)}" rx="${G.gloss.rx}" ry="${G.gloss.ry}" fill="#FFFFFF" opacity="${p.gloss}"/></g>` : ''}
  ${p.shine ? capsule(shine, p.shine, id) : ''}`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.38" r="0.75">
      <stop offset="0" stop-color="${p.bg[0]}"/><stop offset="0.55" stop-color="${p.bg[1]}"/><stop offset="1" stop-color="${p.bg[2]}"/>
    </radialGradient>
    ${p.rays ? `<radialGradient id="rayFade" gradientUnits="userSpaceOnUse" cx="${rays.cx}" cy="${rays.cy}" r="${rays.r}">
      <stop offset="0" stop-color="${p.rays[0]}" stop-opacity="${p.rays[1]}"/><stop offset="1" stop-color="${p.rays[0]}" stop-opacity="0"/>
    </radialGradient>` : ''}
    <linearGradient id="face" gradientUnits="userSpaceOnUse" x1="0" y1="${L.top.toFixed(1)}" x2="0" y2="${N.baseline}">
      <stop offset="0" stop-color="${p.face[0]}"/><stop offset="0.45" stop-color="${p.face[1]}"/><stop offset="1" stop-color="${p.face[2]}"/>
    </linearGradient>
    <linearGradient id="side" gradientUnits="userSpaceOnUse" x1="0" y1="${L.top.toFixed(1)}" x2="0" y2="${N.baseline + N.depth}">
      <stop offset="0" stop-color="${p.side[0]}"/><stop offset="1" stop-color="${p.side[1]}"/>
    </linearGradient>
    <linearGradient id="beamG" gradientUnits="userSpaceOnUse" x1="0" y1="${b.y}" x2="0" y2="${b.y + b.h}">
      <stop offset="0" stop-color="${p.beam[0]}"/><stop offset="0.55" stop-color="${p.beam[1]}"/><stop offset="1" stop-color="${p.beam[2]}"/>
    </linearGradient>
    ${shadow('drop', 16, 12)}
    ${shadow('low', 10, 9, 0.9)}
  </defs>
  ${ground}

  <!-- fulcrum -->
  <g${useShadow('low')}>
    <polygon points="${G.stand.apex} ${G.stand.base[0]} ${G.stand.base[1]}" fill="${p.stand}" stroke="${p.stand}" stroke-width="${G.stand.join}" stroke-linejoin="round"/>
    ${rr(G.foot, `fill="${p.stand}"`)}
  </g>

  <!-- beam, level: "exactly" -->
  <g${useShadow('low')}>
    ${rr(b, `fill="url(#beamG)" stroke="${p.rim}" stroke-width="${b.stroke}"`)}
  </g>
  ${rr(G.beamHi, `fill="${p.beamHi[0]}" opacity="${p.beamHi[1]}"`)}
  ${digit('six', L.six, G.shine6)}
  ${digit('seven', L.seven, G.shine7)}

  ${G.sparkles.map(([x, y, r]) => `<path d="${sparkle(x, y, r)}" fill="${p.sparkle}"/>`).join('\n  ')}
</svg>`
}

const page0 = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000}svg{display:block}</style></head><body>${body}</body></html>`

// ── PNG: decode Chromium's screenshot, re-encode opaque RGB + sRGB ───────────
const crc32 =
  zlib.crc32 ??
  ((buf) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  })

function decodePng(buf) {
  let off = 8
  let w, h, depth, type, interlace
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const tag = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      ;[depth, type, interlace] = [data[8], data[9], data[12]]
    } else if (tag === 'IDAT') idat.push(data)
    else if (tag === 'IEND') break
    off += 12 + len
  }
  if (depth !== 8 || interlace !== 0 || (type !== 6 && type !== 2)) {
    throw new Error(`unexpected PNG layout: depth ${depth}, colour type ${type}, interlace ${interlace}`)
  }
  const bpp = type === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const cur = y * stride
    const prev = cur - stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[cur + i - bpp] : 0
      const b = y > 0 ? px[prev + i] : 0
      const c = y > 0 && i >= bpp ? px[prev + i - bpp] : 0
      let v = raw[src + i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const q = a + b - c
        const [pa, pb, pc] = [Math.abs(q - a), Math.abs(q - b), Math.abs(q - c)]
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[cur + i] = v & 255
    }
  }
  return { w, h, bpp, px }
}

function chunk(tag, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(tag, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Opaque 8-bit RGB PNG with an sRGB chunk. Throws on any translucent pixel. */
function toOpaqueRgbPng(png, { gray = false } = {}) {
  const { w, h, bpp, px } = decodePng(png)
  if (w !== SIZE || h !== SIZE) throw new Error(`screenshot is ${w}×${h}, not ${SIZE}×${SIZE}`)
  const stride = w * 3
  const raw = Buffer.alloc(h * (stride + 1))
  const rgb = Buffer.alloc(h * stride)
  for (let i = 0, j = 0; i < w * h; i++) {
    if (bpp === 4 && px[i * 4 + 3] !== 255) throw new Error(`pixel ${i} is not opaque`)
    let [r, g, b] = [px[i * bpp], px[i * bpp + 1], px[i * bpp + 2]]
    if (gray) r = g = b = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    rgb[j++] = r
    rgb[j++] = g
    rgb[j++] = b
  }
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1)
    raw[o] = 1 // Sub filter: flat fills and gradients collapse to small deltas
    for (let i = 0; i < stride; i++) {
      raw[o + 1 + i] = (rgb[y * stride + i] - (i >= 3 ? rgb[y * stride + i - 3] : 0)) & 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])), // perceptual
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Single-size universal icon with iOS 18+ dark and tinted appearances — the
// exact shape Xcode 26/27 writes for a new App Icon set.
const CONTENTS = {
  images: [
    { filename: FILES.light, idiom: 'universal', platform: 'ios', size: '1024x1024' },
    {
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: FILES.dark,
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
    {
      appearances: [{ appearance: 'luminosity', value: 'tinted' }],
      filename: FILES.tinted,
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
  ],
  info: { author: 'xcode', version: 1 },
}

/** Xcode's JSON style: `"key" : value`, two-space indent. */
const xcodeJson = (o) => JSON.stringify(o, null, 2).replace(/"([^"]+)": /g, '"$1" : ') + '\n'

function sheetHtml(rows) {
  const src = (png) => `data:image/png;base64,${png.toString('base64')}`
  const panel = (bg, fg) => `
    <div class="panel" style="background:${bg};color:${fg}">
      ${rows
        .map(
          ([label, png]) => `<div class="row"><span class="lbl">${label}</span>${[180, 60, 40]
            .map((s) => `<img src="${src(png)}" style="width:${s}px;height:${s}px;border-radius:${(s * 0.2237).toFixed(1)}px">`)
            .join('')}</div>`,
        )
        .join('')}
    </div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font:600 13px -apple-system,Helvetica,sans-serif}
    #sheet{display:inline-flex}
    .panel{padding:20px 24px;display:flex;flex-direction:column;gap:18px}
    .row{display:flex;align-items:center;gap:22px}
    .lbl{width:48px}
    img{display:block}
  </style></head><body><div id="sheet">${panel('#F2F2F7', '#3A3A3C')}${panel('#1C1C1E', '#D1D1D6')}</div></body></html>`
}

async function launch() {
  try {
    return await chromium.launch()
  } catch {
    return chromium.launch({ channel: 'chrome' }) // no Playwright Chromium cached: use the installed Chrome
  }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? resolve(args[i + 1]) : null
  }
  const outDir = opt('--out')
  const sheet = opt('--sheet')
  // Read before anything is written, so the sheet's "before" row is the icon this run replaces.
  const before = existsSync(STORE_ICON) ? readFileSync(STORE_ICON) : null

  const L = numeralLayout(loadFont(FONT_FILE))
  const f1 = (n) => n.toFixed(1)
  console.log(
    `numerals: "6" pen x ${f1(L.six.pen)}, ink x ${f1(L.six.left)}–${f1(L.six.right)}; ` +
      `"7" pen x ${f1(L.seven.pen)}, ink x ${f1(L.seven.left)}–${f1(L.seven.right)}; ` +
      `face top y ${f1(L.top)}, baseline y ${G.numeral.baseline}`,
  )

  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
    const pngs = {}
    for (const v of Object.keys(VARIANTS)) {
      await page.setContent(page0(iconSvg(v, L)))
      const shot = await page.screenshot({ type: 'png', omitBackground: false, clip: { x: 0, y: 0, width: SIZE, height: SIZE } })
      pngs[v] = toOpaqueRgbPng(shot, { gray: v === 'tinted' })
    }

    if (outDir) {
      mkdirSync(outDir, { recursive: true })
      for (const [v, buf] of Object.entries(pngs)) writeFileSync(join(outDir, FILES[v]), buf)
      console.log(`wrote ${Object.values(FILES).join(', ')} → ${outDir}`)
    } else {
      for (const f of readdirSync(ICONSET)) {
        if (f.endsWith('.png') && !Object.values(FILES).includes(f)) {
          unlinkSync(join(ICONSET, f))
          console.log(`removed stale ${f}`)
        }
      }
      for (const [v, buf] of Object.entries(pngs)) writeFileSync(join(ICONSET, FILES[v]), buf)
      writeFileSync(join(ICONSET, 'Contents.json'), xcodeJson(CONTENTS))
      writeFileSync(STORE_ICON, pngs.light)
      console.log(`wrote ${Object.values(FILES).join(', ')}, Contents.json → ${ICONSET}`)
      console.log(`wrote ${STORE_ICON}`)
    }

    if (sheet) {
      const rows = Object.entries(pngs)
      if (before) rows.push(['before', before])
      const sp = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })
      await sp.setContent(sheetHtml(rows))
      await sp.waitForFunction(() => [...document.images].every((i) => i.complete))
      mkdirSync(dirname(sheet), { recursive: true })
      await sp.locator('#sheet').screenshot({ path: sheet })
      console.log(`wrote ${sheet}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
