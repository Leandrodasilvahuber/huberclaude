import { APIError } from '@anthropic-ai/sdk'
import { expect, test } from 'bun:test'
import { formatQuotaExhaustedMessage } from './withRetry.js'

test('quota message keeps the OpenRouter key-limit reason and remedy hint', () => {
  const error = APIError.generate(
    403,
    {
      error: {
        message:
          'Key limit exceeded (monthly limit). $16.01 of $16.00 used; resets 2026-11-01T00:00:00.000Z.',
        code: 403,
        metadata: {
          remedy_hint:
            "Raise or remove this API key's usage limit at https://openrouter.ai/settings/keys, or use a key without a limit.",
        },
      },
    },
    undefined,
    new Headers(),
  )

  const message = formatQuotaExhaustedMessage(error)
  expect(message).toContain('Key limit exceeded (monthly limit)')
  expect(message).toContain('$16.01 of $16.00 used')
  expect(message).toContain("Raise or remove this API key's usage limit")
  expect(message).not.toContain('/provider')
})

test('quota message falls back to the OpenRouter remedy without a provider body', () => {
  const message = formatQuotaExhaustedMessage(new Error('402 Payment Required'))
  expect(message).toBe(
    'API quota exhausted or not enabled.\n' +
      'Fix:\n' +
      '- Add credits or raise the API key limit at https://openrouter.ai/settings/keys',
  )
})
