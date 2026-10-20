/**
 * Lagartixa (HuberClaude mascot) as half-block pixel art, hand-drawn after the
 * mascot artwork. Each string is one pixel row; every two rows render as one
 * terminal row using ▀ / ▄ with foreground and background colors.
 * '.' is transparent, digits index LIZARD_PALETTE.
 */
export const LIZARD_PALETTE = [
  'rgb(85,92,25)', // 0 shadow/nostril
  'rgb(130,140,40)', // 1 body olive
  'rgb(165,175,60)', // 2 highlight
  'rgb(185,200,140)', // 3 belly
  'rgb(235,235,200)', // 4 eye white
  'rgb(40,35,10)', // 5 pupil
] as const

export const LIZARD_PIXELS: readonly string[] = [
  '........................111....',
  '......................1111111..',
  '.....................144111111.',
  '.....................4451111111',
  '.....................1441111111',
  '......................111111101',
  '......................133333330',
  '.....................113333331.',
  '.111.................11133331..',
  '1..11...11111111111111111331...',
  '1...11111111111111111111131....',
  '11.11111111112211111111111.....',
  '.11111111111111111111111.......',
  '..11.111111..1111.11111........',
  '.11..111.......111..1111.......',
  '.1....11.0.....00....00........',
]

export type LizardCell = { char: string; fg?: string; bg?: string }

/** Block letter H (large header mascot, mascot green). */
export const STAR_PIXELS: readonly string[] = [
  '.............',
  '.............',
  '..111...111..',
  '..111...111..',
  '..111...111..',
  '..111...111..',
  '..111111111..',
  '..111111111..',
  '..111...111..',
  '..111...111..',
  '..111...111..',
  '..111...111..',
]

const STAR_PALETTE = ['', 'rgb(150,175,55)', 'rgb(185,205,100)'] as const

function toCells(pixels: readonly string[], color: (i: number) => string): LizardCell[][] {
  const rows: LizardCell[][] = []
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y]!
    const bottom = pixels[y + 1] ?? ''.padEnd(top.length, '.')
    const row: LizardCell[] = []
    for (let x = 0; x < top.length; x++) {
      const t = top[x]!
      const b = bottom[x] ?? '.'
      const tc = t === '.' ? undefined : color(Number(t))
      const bc = b === '.' ? undefined : color(Number(b))
      if (!tc && !bc) row.push({ char: ' ' })
      else if (!bc) row.push({ char: '\u2580', fg: tc })
      else if (!tc) row.push({ char: '\u2584', fg: bc })
      else row.push({ char: '\u2580', fg: tc, bg: bc })
    }
    rows.push(row)
  }
  return rows
}

/** Terminal rows (each a list of cells) for the lizard sprite. */
export function getLizardRows(): LizardCell[][] {
  return toCells(LIZARD_PIXELS, i => LIZARD_PALETTE[i]!)
}

/** Terminal rows for the star sprite, optionally tinted with a single color. */
export function getStarRows(tint?: string): LizardCell[][] {
  return toCells(STAR_PIXELS, i => tint ?? STAR_PALETTE[i]!)
}
