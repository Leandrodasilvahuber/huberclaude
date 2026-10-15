import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToString } from '../../utils/staticRender.js'
import { EnxameBody } from './EnxameDialog.js'

const noop = () => {}

describe('EnxameBody', () => {
  test('shows the account without exposing the key', async () => {
    const apiKey = 'abcdef1234567890secretkey'
    const output = await renderToString(
      <EnxameBody
        account={{ apiKey, baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.7-flash', fallbackModel: 'glm-4.5-flash', enabled: true }}
        testResult={{ ok: true, message: 'Connection OK (glm-4.7-flash)' }}
        testing={false}
        onSelect={noop}
        onCancel={noop}
      />,
      100,
    )
    expect(output).toContain('glm-4.7-flash → glm-4.5-flash')
    expect(output).toContain('Enabled')
    expect(output).toContain('Disable swarm')
    expect(output).toContain('Test connection')
    expect(output).toContain('Connection OK')
    expect(output).not.toContain(apiKey)
  })
})
