import { describe, expect, test } from 'bun:test'
import * as React from 'react'

import { renderToString } from '../../utils/staticRender.js'
import { UsageBody } from './OpenRouterUsageDialog.js'

describe('UsageBody', () => {
  test('renders balance, key spend and the fuel gauge', async () => {
    const output = await renderToString(
      <UsageBody
        snapshot={{
          credits: { totalCredits: 10, totalUsage: 10.03 },
          key: {
            label: null,
            usage: 10.03,
            usageDaily: 0,
            usageWeekly: 0,
            usageMonthly: 10.03,
            limit: 10,
            limitRemaining: 0,
            isFreeTier: false,
          },
        }}
      />,
      100,
    )
    expect(output).toContain('░')
    expect(output).toContain('½')
    expect(output).not.toContain('Gasto desta key')
    expect(output).not.toContain('limite da key')
    expect(output).toContain('-$0.03')
    expect(output).toContain('100%')
  })

  const withRecharge = (totalUsage: number, lastRecharge: number) => (
    <UsageBody
      snapshot={{
        credits: { totalCredits: 50, totalUsage },
        key: null,
        lastRecharge,
      }}
    />
  )

  test('fills the tank with the last recharge', async () => {
    expect(await renderToString(withRecharge(40, 10), 100)).toContain(
      '0% de $10.00 usado',
    )
    expect(await renderToString(withRecharge(45, 10), 100)).toContain(
      '50% de $10.00 usado',
    )
  })

  test('uses $5 as the smallest tank and flags the $2 reserve', async () => {
    const output = await renderToString(withRecharge(48.5, 3), 100)
    expect(output).toContain('70% de $5.00 usado')
    expect(output).toContain('reserva ($2.00)')
  })

  test('explains when account credits are unavailable', async () => {
    const output = await renderToString(
      <UsageBody
        snapshot={{
          credits: null,
          key: {
            label: null,
            usage: 1,
            usageDaily: null,
            usageWeekly: null,
            usageMonthly: null,
            limit: null,
            limitRemaining: null,
            isFreeTier: false,
          },
        }}
      />,
      100,
    )
    expect(output).toContain('Saldo da conta indisponível')
    expect(output).not.toContain('░')
  })
})
