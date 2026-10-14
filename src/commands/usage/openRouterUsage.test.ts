import { describe, expect, test } from 'bun:test'

import {
  buildSevenSegment,
  formatUsd,
  groupSegmentRow,
  parseOpenRouterCredits,
  parseOpenRouterKeyUsage,
} from './openRouterUsage.js'

describe('parseOpenRouterCredits', () => {
  test('reads total credits and usage', () => {
    expect(
      parseOpenRouterCredits({
        data: { total_credits: 20, total_usage: '3.5' },
      }),
    ).toEqual({ totalCredits: 20, totalUsage: 3.5 })
  })

  test('returns null for malformed payloads', () => {
    expect(parseOpenRouterCredits(null)).toBeNull()
    expect(parseOpenRouterCredits({ data: { total_credits: 1 } })).toBeNull()
    expect(parseOpenRouterCredits({ error: 'nope' })).toBeNull()
  })
})

describe('parseOpenRouterKeyUsage', () => {
  test('reads usage windows and limit', () => {
    expect(
      parseOpenRouterKeyUsage({
        data: {
          label: 'sk-or-v1-abc...',
          usage: 4.2,
          usage_daily: 0.1,
          usage_weekly: 1.2,
          usage_monthly: 4,
          limit: 10,
          limit_remaining: 5.8,
          is_free_tier: false,
        },
      }),
    ).toEqual({
      label: 'sk-or-v1-abc...',
      usage: 4.2,
      usageDaily: 0.1,
      usageWeekly: 1.2,
      usageMonthly: 4,
      limit: 10,
      limitRemaining: 5.8,
      isFreeTier: false,
    })
  })

  test('treats a null limit as unlimited', () => {
    const usage = parseOpenRouterKeyUsage({
      data: { usage: 1, limit: null, limit_remaining: null },
    })
    expect(usage?.limit).toBeNull()
    expect(usage?.limitRemaining).toBeNull()
    expect(usage?.usageDaily).toBeNull()
  })

  test('returns null without usage', () => {
    expect(parseOpenRouterKeyUsage({ data: {} })).toBeNull()
  })
})

describe('formatUsd', () => {
  test('formats dollars with extra precision for tiny amounts', () => {
    expect(formatUsd(12.345)).toBe('$12.35')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(-1.5)).toBe('-$1.50')
    expect(formatUsd(null)).toBe('—')
  })
})

describe('buildSevenSegment', () => {
  function render(text: string, minDigits?: number) {
    return buildSevenSegment(text, minDigits).map(row =>
      row.map(cell => (cell.lit ? cell.char : ' ')).join(''),
    )
  }

  test('draws an 8 with every segment lit', () => {
    expect(render('8')).toEqual([
      ' ━━━ ',
      '┃   ┃',
      ' ━━━ ',
      '┃   ┃',
      ' ━━━ ',
    ])
  })

  test('draws a 1 with only the right segments lit', () => {
    expect(render('1')).toEqual([
      '     ',
      '    ┃',
      '     ',
      '    ┃',
      '     ',
    ])
  })

  test('keeps unlit segments as ghost cells', () => {
    const cells = buildSevenSegment('1').flat()
    expect(cells.some(cell => cell.char === '╌' && !cell.lit)).toBe(true)
  })

  test('renders the decimal point on the bottom row', () => {
    const rows = render('0.5')
    expect(rows[4]).toContain('●')
    expect(rows[0]).not.toContain('●')
  })

  test('pads the integer part to minDigits with blank digits', () => {
    const rows = buildSevenSegment('1.00', 3)
    const unpadded = buildSevenSegment('1.00')
    expect(rows[0]!.length).toBe(unpadded[0]!.length + 2 * 6)
    expect(new Set(rows.map(row => row.length)).size).toBe(1)
  })

  test('draws a minus sign with the middle segment', () => {
    expect(render('-')[2]).toBe(' ━━━ ')
    expect(render('-')[0]).toBe('     ')
  })
})

describe('groupSegmentRow', () => {
  test('merges consecutive cells with the same lit state', () => {
    expect(
      groupSegmentRow([
        { char: '━', lit: true },
        { char: '━', lit: true },
        { char: ' ', lit: false },
        { char: '┃', lit: false },
      ]),
    ).toEqual([
      { text: '━━', lit: true },
      { text: ' ┃', lit: false },
    ])
  })
})
