/**
 * Dev-only test bridge for Playwright-driven E2E.
 *
 * It is imported and installed **only** behind an `import.meta.env.DEV` guard in
 * `main.ts`, and `import.meta.env.DEV` is statically `false` in a production
 * build, so Vite tree-shakes this whole module (and its call site) out of the
 * shipped bundle — no test surface ever reaches the App Store / Play build.
 *
 * It exposes a read-mostly view of the running Phaser game on `window.__e67`:
 * the game instance, the active scene key, every visible Text string (HUD /
 * overlay assertions), and every on-screen `WeightView` with its world position
 * (so a test can click a specific weight by index instead of eyeballing pixels),
 * plus a progress seeder. It never mutates game state — placing/removing is done
 * by clicking the reported coordinates, exactly as a player would.
 */
import type Phaser from 'phaser'

interface WeightInfo {
  index: number
  value: number
  isBalloon: boolean
  locked: boolean
  placed: boolean
  /** World (game-pixel) position of the weight's origin; == CSS px when DPR=1. */
  x: number
  y: number
}

interface E67Bridge {
  game: Phaser.Game
  scene: () => string | undefined
  /** Current global level number while in GameScene, else undefined. */
  level: () => number | undefined
  /** Solver-proven minimum piece count for the current level (for star checks). */
  minWeights: () => number | undefined
  texts: () => string[]
  weights: () => WeightInfo[]
  /** Interactive containers (buttons, map cells) with their label + world pos. */
  buttons: () => { label: string; x: number; y: number }[]
  seedProgress: (clearedUpTo: number) => void
}

/** Depth-first flatten of a scene's display list, descending into Containers. */
function flatten(objs: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = []
  const visit = (list: Phaser.GameObjects.GameObject[]) => {
    for (const o of list) {
      out.push(o)
      const kids = (o as unknown as { list?: Phaser.GameObjects.GameObject[] }).list
      if (Array.isArray(kids)) visit(kids)
    }
  }
  visit(objs)
  return out
}

export function installTestBridge(game: Phaser.Game): void {
  const active = (): Phaser.Scene | undefined => game.scene.getScenes(true).slice(-1)[0]

  const worldXY = (obj: Phaser.GameObjects.GameObject): { x: number; y: number } => {
    const m = (
      obj as unknown as {
        getWorldTransformMatrix?: () => { tx: number; ty: number }
      }
    ).getWorldTransformMatrix?.()
    if (m) return { x: m.tx, y: m.ty }
    const p = obj as unknown as { x: number; y: number }
    return { x: p.x, y: p.y }
  }

  // GameScene keeps these as fields (render/GameScene.ts); read them via a cast
  // so the bridge needs no changes to the scene itself.
  const gameScene = (): Record<string, unknown> | undefined => {
    const s = active()
    return s && s.scene.key === 'Game' ? (s as unknown as Record<string, unknown>) : undefined
  }

  const bridge: E67Bridge = {
    game,
    scene: () => active()?.scene.key,

    level: () => (gameScene()?.ref as { global?: number } | undefined)?.global,

    minWeights: () => gameScene()?.minWeights as number | undefined,

    texts: () => {
      const s = active()
      if (!s) return []
      return flatten(s.children.list)
        .filter((o) => (o as unknown as { type?: string }).type === 'Text')
        .map((o) => (o as unknown as { text: string }).text)
        .filter((t) => t && t.trim().length > 0)
    },

    weights: () => {
      const s = active()
      if (!s) return []
      const placedArr = (gameScene()?.placed as boolean[] | undefined) ?? []
      // A WeightView is the only display object carrying both `index` and
      // `value` numbers (see render/WeightView.ts).
      return flatten(s.children.list)
        .filter((o) => {
          const w = o as unknown as { index?: unknown; value?: unknown }
          return typeof w.index === 'number' && typeof w.value === 'number'
        })
        .map((o) => {
          const w = o as unknown as {
            index: number
            value: number
            isBalloon: boolean
            locked: boolean
          }
          const { x, y } = worldXY(o)
          return {
            index: w.index,
            value: w.value,
            isBalloon: w.isBalloon,
            locked: w.locked,
            placed: placedArr[w.index] === true,
            x,
            y,
          }
        })
    },

    buttons: () => {
      const s = active()
      if (!s) return []
      return flatten(s.children.list)
        .filter((o) => {
          const inp = (o as unknown as { input?: { enabled?: boolean } }).input
          const kids = (o as unknown as { list?: unknown }).list
          // Interactive containers only (buttons/cells have a child list).
          return !!inp && inp.enabled === true && Array.isArray(kids)
        })
        .map((o) => {
          const { x, y } = worldXY(o)
          const kids = (o as unknown as { list: Phaser.GameObjects.GameObject[] }).list
          const t = flatten(kids).find(
            (k) => (k as unknown as { type?: string }).type === 'Text',
          )
          const label = t ? (t as unknown as { text: string }).text : ''
          return { label, x, y }
        })
    },

    seedProgress: (clearedUpTo: number) => {
      const stars: Record<string, number> = {}
      const best: Record<string, number> = {}
      for (let i = 1; i <= clearedUpTo; i++) {
        stars[i] = 3
        best[i] = 1
      }
      // Capacitor Preferences web backend prefixes keys with `CapacitorStorage.`.
      localStorage.setItem(
        'CapacitorStorage.exactly67.progress',
        JSON.stringify({ stars, best }),
      )
    },
  }

  ;(window as unknown as { __e67: E67Bridge }).__e67 = bridge
}
