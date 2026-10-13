import { describe, expect, test } from 'bun:test'

import {
  buildGauge,
  formatUsd,
  groupGaugeRow,
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

describe('buildGauge', () => {
  function zones(fraction: number) {
    return buildGauge(fraction).flat().map(cell => cell.zone)
  }

  test('an empty gauge is all track with a hub', () => {
    const z = zones(0)
    expect(z).not.toContain('low')
    expect(z).toContain('track')
    expect(z).toContain('needle')
  })

  test('a full gauge fills every zone and leaves no track', () => {
    const z = zones(1)
    expect(z).toContain('low')
    expect(z).toContain('mid')
    expect(z).toContain('high')
    expect(z).not.toContain('track')
  })

  test('half way reaches the mid zone but not the high zone', () => {
    const z = zones(0.5)
    expect(z).toContain('mid')
    expect(z).not.toContain('high')
  })

  test('clamps out-of-range and non-finite fractions', () => {
    expect(zones(5)).toEqual(zones(1))
    expect(zones(Number.NaN)).toEqual(zones(0))
  })

  test('rows have equal width', () => {
    const widths = new Set(buildGauge(0.3).map(row => row.length))
    expect(widths.size).toBe(1)
  })
})

describe('groupGaugeRow', () => {
  test('merges consecutive cells of the same zone', () => {
    expect(
      groupGaugeRow([
        { char: '█', zone: 'low' },
        { char: '█', zone: 'low' },
        { char: ' ', zone: 'empty' },
        { char: '░', zone: 'track' },
      ]),
    ).toEqual([
      { text: '██', zone: 'low' },
      { text: ' ', zone: 'empty' },
      { text: '░', zone: 'track' },
    ])
  })
})
