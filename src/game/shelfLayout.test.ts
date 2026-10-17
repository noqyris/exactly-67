import { describe, expect, it } from 'vitest'
import { cellSlot, cellX, columnsFor, fullDrawerH, rowReveal, rowsFor, shelfLayout } from './shelfLayout'
import type { ShelfMetrics } from './shelfLayout'

const M: ShelfMetrics = {
  top: 16,
  cardH: 112,
  cardGap: 14,
  padTop: 20,
  padBottom: 16,
  cell: 70,
  cellGap: 10,
  cols: 4,
  revealFade: 24,
}

describe('shelf geometry', () => {
  it('a 24-level pack is six rows of four, or four rows of six', () => {
    expect(rowsFor(24, M)).toBe(6)
    expect(rowsFor(24, { cols: 6 })).toBe(4)
    expect(fullDrawerH(24, M)).toBe(20 + 6 * 70 + 5 * 10 + 16)
  })

  it('shut drawers stack the cards one gap apart', () => {
    const g = shelfLayout([24, 24, 24], [0, 0, 0], M)
    expect(g.cardTop).toEqual([16, 16 + 126, 16 + 252])
    expect(g.drawerH).toEqual([0, 0, 0])
    expect(g.bottom).toBe(16 + 3 * 112 + 2 * 14)
  })

  it('an open drawer pushes every card below it down by its height, and only those', () => {
    const shut = shelfLayout([24, 24, 24], [0, 0, 0], M)
    const open = shelfLayout([24, 24, 24], [0, 1, 0], M)
    const full = fullDrawerH(24, M)
    expect(open.cardTop[0]).toBe(shut.cardTop[0])
    expect(open.cardTop[1]).toBe(shut.cardTop[1])
    expect(open.cardTop[2]).toBe(shut.cardTop[2] + full)
    expect(open.bottom).toBe(shut.bottom + full)
  })

  it('a half-open drawer is half its height; out-of-range fractions clamp', () => {
    const g = shelfLayout([24, 24], [0.5, 7], M)
    expect(g.drawerH[0]).toBeCloseTo(fullDrawerH(24, M) / 2)
    expect(g.drawerH[1]).toBe(fullDrawerH(24, M))
  })

  it('cells sit in rows under the card, centred on the column', () => {
    expect(cellSlot(0, M)).toEqual({ row: 0, col: 0, dy: 20 + 35 })
    expect(cellSlot(5, M)).toEqual({ row: 1, col: 1, dy: 20 + 80 + 35 })
    // Four columns of 70 with 10 between: 310 wide, centred on 200.
    expect(cellX(0, 200, M)).toBe(200 - 155 + 35)
    expect(cellX(3, 200, M)).toBe(200 + 155 - 35)
  })

  it('six columns only where six cells stay wide enough', () => {
    expect(columnsFor(318, 10, 64)).toBe(4) // a 390 pt phone
    expect(columnsFor(600, 10, 64)).toBe(6) // the 680 pt frame
  })
})

describe('row reveal', () => {
  it('no row shows before the drawer edge passes its bottom, so none overlaps the next card', () => {
    const full = fullDrawerH(24, M)
    for (let step = 0; step <= 40; step++) {
      const dh = (full * step) / 40
      for (let row = 0; row < 6; row++) {
        const bottom = M.padTop + row * (M.cell + M.cellGap) + M.cell
        if (rowReveal(row, dh, M) > 0) expect(bottom).toBeLessThanOrEqual(dh + 1e-5)
      }
    }
  })

  it('every row is fully shown once the drawer is fully open', () => {
    const full = fullDrawerH(24, M)
    for (let row = 0; row < 6; row++) expect(rowReveal(row, full, M)).toBe(1)
  })

  it('fades in over the reveal distance, capped at the bottom padding', () => {
    const rowBottom = M.padTop + M.cell
    expect(rowReveal(0, rowBottom + 8, M)).toBeCloseTo(8 / 16, 5)
    expect(rowReveal(0, rowBottom - 1, M)).toBe(0)
    expect(rowReveal(0, rowBottom + 1, { ...M, revealFade: 0 })).toBe(1)
  })
})
