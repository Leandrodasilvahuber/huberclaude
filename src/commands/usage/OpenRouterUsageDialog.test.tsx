import { describe, expect, test } from 'bun:test'
import * as React from 'react'

import { renderToString } from '../../utils/staticRender.js'
import { UsageBody } from './OpenRouterUsageDialog.js'

describe('UsageBody', () => {
  test('renders balance, key spend and both gauges', async () => {
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
    expect(output).toContain('Créditos usados')
    expect(output).toContain('Limite da key')
    expect(output).toContain('-$0.03')
    expect(output).toContain('100%')
    expect(output).toContain('Últimos 30 dias')
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
    expect(output).toContain('sem limite')
    expect(output).not.toContain('Limite da key')
  })
})
