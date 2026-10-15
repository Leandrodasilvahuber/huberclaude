import { describe, expect, test } from 'bun:test'

import {
  formatUsd,
  fuelCells,
  fuelTank,
  resolveLastRecharge,
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

describe('fuelCells', () => {
  test('scales the value to the bar width', () => {
    expect(fuelCells(5, 10, 28)).toBe(14)
    expect(fuelCells(10, 10, 28)).toBe(28)
  })

  test('clamps empty, negative and overflowing values', () => {
    expect(fuelCells(0, 10, 28)).toBe(0)
    expect(fuelCells(-1, 10, 28)).toBe(0)
    expect(fuelCells(20, 10, 28)).toBe(28)
    expect(fuelCells(5, 0, 28)).toBe(0)
  })

  test('keeps at least one cell for a tiny positive balance', () => {
    expect(fuelCells(0.01, 100, 28)).toBe(1)
  })
})

describe('fuelTank', () => {
  test('is the last recharge with a $5 minimum', () => {
    expect(fuelTank(20)).toBe(20)
    expect(fuelTank(3)).toBe(5)
    expect(fuelTank(null)).toBe(5)
  })
})

describe('resolveLastRecharge', () => {
  test('falls back to the purchased total without history', () => {
    expect(resolveLastRecharge(undefined, 15)).toEqual({
      baselineCredits: 15,
      amount: 15,
    })
  })

  test('infers the top-up from growth in total credits', () => {
    expect(
      resolveLastRecharge({ baselineCredits: 15, amount: 15 }, 20),
    ).toEqual({ baselineCredits: 20, amount: 5 })
  })

  test('keeps the last amount while total credits are unchanged', () => {
    expect(resolveLastRecharge({ baselineCredits: 20, amount: 5 }, 20)).toEqual({
      baselineCredits: 20,
      amount: 5,
    })
  })
})
