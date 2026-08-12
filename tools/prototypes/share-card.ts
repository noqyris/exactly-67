import { TARGET } from '../../src/game/types'

// ---- share string: pure, ~25 lines, belongs in src/game/share.ts ----
export interface Run { trace: number[]; pieces: number; stars: number; day: number; variant?: [number, number] }

function glyph(total: number): string {
  if (total === TARGET) return '🟩'
  return total > TARGET ? '⬛' : '🎈'   // pan down = block, pan up = balloon
}

export function shareText(r: Run): string {
  const peak = Math.max(...r.trace.map((t) => Math.abs(t - TARGET)))
  const peakTotal = r.trace.reduce((a, b) => (Math.abs(b - TARGET) > Math.abs(a - TARGET) ? b : a), TARGET)
  const line = r.trace.map(glyph).join('')
  const v = r.variant ? ` · way ${r.variant[0]}/${r.variant[1]}` : ''
  return `Exactly 67 · Daily #${r.day}\n${line}\n${r.pieces} pieces · peak ${peakTotal}${v} · ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`
}

// Three players, same board, genuinely different cards:
const clean: Run  = { trace: [90, 149, 108, 67], pieces: 4, stars: 3, day: 12, variant: [1, 3] }
const messy: Run  = { trace: [90, 149, 181, 140, 99, 58, 21, 67], pieces: 5, stars: 2, day: 12, variant: [2, 3] }
const flail: Run  = { trace: [12, 49, 30, 88, 51, 22, 60, 67], pieces: 6, stars: 1, day: 12, variant: [3, 3] }
for (const r of [clean, messy, flail]) console.log(shareText(r) + '\n')

// ---- level code: is a shareable code short enough to say out loud? ----
const A = '0123456789ABCDEFGHJKMNPQRSTUVWXYZ' // 33 chars, no I/L/O
function encode(weights: number[]): string {
  // each weight -99..99 -> 0..198 -> two base33 digits
  let s = ''
  for (const w of weights) { const v = w + 99; s += A[Math.floor(v / 33)] + A[v % 33] }
  return s
}
for (const w of [[90,77,72,65,53,49,-41,-40,-28,-25,-21,-12], [26,31,-39,-21,2,-49,64,13,-43,-31], [40,27]])
  console.log(`n=${String(w.length).padStart(2)}  code=67-${encode(w)}  (${encode(w).length} chars)`)
