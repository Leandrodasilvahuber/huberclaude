import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { asMockFetch } from '../test/typedMocks.js'

async function loadProviderDiscoveryModule() {
  return import(`./providerDiscovery.js?ts=${Date.now()}-${Math.random()}`)
}

const originalFetch = globalThis.fetch
const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

function restoreEnv(key: keyof typeof originalEnv): void {
  if (originalEnv[key] === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = originalEnv[key]
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('providerDiscovery.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
    globalThis.fetch = originalFetch
    restoreEnv('OPENAI_BASE_URL')
  } finally {
    releaseSharedMutationLock()
  }
})

test('lists models from a local openai-compatible /models endpoint', async () => {
  const { listOpenAICompatibleModels } = await loadProviderDiscoveryModule()

  globalThis.fetch = asMockFetch(mock((input, init) => {
    const url = typeof input === 'string' ? input : input.url
    expect(url).toBe('http://localhost:1234/v1/models')
    expect(init?.headers).toEqual({ Authorization: 'Bearer local-key' })

    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { id: 'qwen2.5-coder-7b-instruct' },
            { id: 'llama-3.2-3b-instruct' },
            { id: 'qwen2.5-coder-7b-instruct' },
          ],
        }),
        { status: 200 },
      ),
    )
  }))

  await expect(
    listOpenAICompatibleModels({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'local-key',
    }),
  ).resolves.toEqual([
    'qwen2.5-coder-7b-instruct',
    'llama-3.2-3b-instruct',
  ])
})

test('returns null when a local openai-compatible /models request fails', async () => {
  const { listOpenAICompatibleModels } = await loadProviderDiscoveryModule()

  globalThis.fetch = asMockFetch(mock(() =>
    Promise.resolve(new Response('not available', { status: 503 })),
  ))

  await expect(
    listOpenAICompatibleModels({ baseUrl: 'http://localhost:1234/v1' }),
  ).resolves.toBeNull()
})
