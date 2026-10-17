/**
 * The level map's pack shelves as pure geometry: a column of pack cards, each
 * with a drawer of level cells that slides open under it. Every number is in
 * the caller's units (device px); nothing here knows about Phaser.
 *
 * A drawer opens by a fraction `open` (0 shut … 1 fully open). The cards below
 * follow its edge, and a row of cells shows only once the edge has passed its
 * bottom, so a half-open drawer never draws a cell over the next card.
 */
export interface ShelfMetrics {
  /** Top of the first card (content coordinates). */
  top: number
  cardH: number
  /** Space between one shelf (card + open drawer) and the next card. */
  cardGap: number
  /** Drawer space above the first row and below the last. */
  padTop: number
  padBottom: number
  cell: number
  cellGap: number
  cols: number
  /** How far past a row's bottom the drawer edge travels while that row fades in. */
  revealFade: number
}

export interface ShelfGeometry {
  /** Each card's top edge. */
  cardTop: number[]
  /** Each drawer's height as drawn now (0 when shut). */
  drawerH: number[]
  /** Bottom of the last shelf: the scrollable content's height before padding. */
  bottom: number
}

/** Rows a pack of `count` levels takes. */
export function rowsFor(count: number, m: Pick<ShelfMetrics, 'cols'>): number {
  return Math.ceil(count / m.cols)
}

/** A fully open drawer's height for `count` levels. */
export function fullDrawerH(count: number, m: ShelfMetrics): number {
  const rows = rowsFor(count, m)
  if (rows === 0) return 0
  return m.padTop + rows * m.cell + (rows - 1) * m.cellGap + m.padBottom
}

/** Lay out every shelf for the packs' sizes and how far each drawer is open. */
export function shelfLayout(packSizes: readonly number[], open: readonly number[], m: ShelfMetrics): ShelfGeometry {
  const cardTop: number[] = []
  const drawerH: number[] = []
  let y = m.top
  packSizes.forEach((count, i) => {
    const t = Math.min(1, Math.max(0, open[i] ?? 0))
    cardTop.push(y)
    const dh = fullDrawerH(count, m) * t
    drawerH.push(dh)
    y += m.cardH + dh + m.cardGap
  })
  return { cardTop, drawerH, bottom: y - (packSizes.length > 0 ? m.cardGap : 0) }
}

/** Where a level's cell sits: its row/column and its centre below the card's bottom edge. */
export function cellSlot(levelIndex: number, m: ShelfMetrics): { row: number; col: number; dy: number } {
  const row = Math.floor(levelIndex / m.cols)
  const col = levelIndex % m.cols
  return { row, col, dy: m.padTop + row * (m.cell + m.cellGap) + m.cell / 2 }
}

/** The centre x of column `col`, for a grid centred on `cx`. */
export function cellX(col: number, cx: number, m: ShelfMetrics): number {
  const gridW = m.cols * m.cell + (m.cols - 1) * m.cellGap
  return cx - gridW / 2 + m.cell / 2 + col * (m.cell + m.cellGap)
}

/**
 * How visible a row is (0–1) in a drawer drawn `drawerH` tall: nothing until the
 * drawer's edge has passed the row's bottom, then a fade over `revealFade` —
 * capped at the bottom padding, so the last row is fully shown once the drawer
 * is fully open.
 */
export function rowReveal(row: number, drawerH: number, m: ShelfMetrics): number {
  const rowBottom = m.padTop + row * (m.cell + m.cellGap) + m.cell
  // A hair of tolerance: the drawer's full height and a row's bottom are sums in
  // a different order, and a last row at 0.9999 alpha would never count as shown.
  const past = drawerH - rowBottom + 1e-6
  if (past < 0) return 0
  const fade = Math.min(m.revealFade, m.padBottom)
  if (fade <= 0) return 1
  return Math.min(1, past / fade)
}

/**
 * Columns for a drawer `inner` px wide: six where six cells can each still be
 * `minWide` (a tablet, the unfolded Duo: four rows instead of six), else four.
 */
export function columnsFor(inner: number, gap: number, minWide: number): number {
  return (inner - gap * 5) / 6 >= minWide ? 6 : 4
}
