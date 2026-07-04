/** The chunky "physics toy" look: candy fills, one thick ink outline. */
import { u } from './layout'

export const INK = 0x2b2440
export const INK_CSS = '#2B2440'
export const BG = 0xf6eedf
export const BG_CSS = '#F6EEDF'
export const PAPER = 0xfdf8ee
export const CREAM_CSS = '#FFF8EA'

export const BEAM = 0xf5b942
export const BEAM_DARK = 0xd99a26
export const PAN = 0x7fb8a4
export const PAN_DARK = 0x639882
export const TARGET_BLOCK = 0x2b2440

export const BALLOON = 0xf783ac
export const BALLOON_DARK = 0xd66690
export const STRING = 0x2b2440

export const GOOD = 0x37b24d
export const OVER = 0xe8590c
export const UNDER = 0x4dabf7
export const LOCKED_TINT = 0x9a93ad

export const STAR = 0xffd43b
export const STAR_EMPTY = 0xd8cfbf

/** Outline width scales a little with the element, but this is the base. */
export const OUTLINE = u(4)

export const FONT = '"Baloo 2", sans-serif'

/** Down-weight fill by magnitude — bigger numbers read as heavier colors. */
export function weightColor(value: number): { fill: number; dark: number } {
  const v = Math.abs(value)
  if (v < 10) return { fill: 0xffd43b, dark: 0xdbaf16 } // yellow
  if (v < 20) return { fill: 0xffa94d, dark: 0xdd8524 } // orange
  if (v < 35) return { fill: 0xff6b6b, dark: 0xd94848 } // coral
  if (v < 55) return { fill: 0x9775fa, dark: 0x7554d6 } // purple
  return { fill: 0x4dabf7, dark: 0x2b87d4 } // blue
}

/** Ink text on light fills, cream text on dark fills. */
export function labelColorFor(fill: number): string {
  return fill === 0x9775fa || fill === 0x4dabf7 || fill === TARGET_BLOCK
    ? CREAM_CSS
    : INK_CSS
}
