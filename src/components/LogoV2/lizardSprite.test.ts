import { expect, test } from 'bun:test'
import { getStarRows } from './lizardSprite.js'

test('getStarRows tints every painted cell when a color is given', () => {
  const cells = getStarRows('red_FOR_SUBAGENTS_ONLY').flat()
  const painted = cells.filter(c => c.fg || c.bg)
  expect(painted.length).toBeGreaterThan(0)
  for (const cell of painted) {
    if (cell.fg) expect(cell.fg).toBe('red_FOR_SUBAGENTS_ONLY')
    if (cell.bg) expect(cell.bg).toBe('red_FOR_SUBAGENTS_ONLY')
  }
})

test('getStarRows keeps the default green palette without a tint', () => {
  const painted = getStarRows().flat().filter(c => c.fg)
  expect(painted.every(c => c.fg!.startsWith('rgb('))).toBe(true)
})
