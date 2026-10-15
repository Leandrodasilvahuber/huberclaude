import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'
import type { DebugLogLevel } from '../../utils/debug.js'

type DebugModule = typeof import('../../utils/debug.js')
type DebugSpy = ReturnType<
  typeof mock<(message: string, options?: { level?: DebugLogLevel }) => void>
>
type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const originalFetch = globalThis.fetch
const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}
let actualDebugModule: DebugModule | undefined

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('openaiShim.diagnostics.test.ts')
})

afterEach(() => {
  try {
    globalThis.fetch = originalFetch
    restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
    restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
    restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
    mock.restore()
    restoreDebugModule()
  } finally {
    releaseSharedMutationLock()
  }
})

test('logs classified transport diagnostics with category and code', async () => {
  const debugSpy = await mockDebugLogging()

  const nonce = `${Date.now()}-${Math.random()}`
  const { createOpenAIShimClient } = await import(`./openaiShim.ts?ts=${nonce}`)

  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  process.env.OPENAI_API_KEY = 'ollama'

  const transportError = Object.assign(new TypeError('fetch failed'), {
    code: 'ECONNREFUSED',
  })

  globalThis.fetch = mockFetch(async (): Promise<Response> => {
    throw transportError
  })

  const client = createOpenAIShimClient({}) as {
    beta: {
      messages: {
        create: (params: Record<string, unknown>) => Promise<unknown>
      }
    }
  }

  await expect(
    client.beta.messages.create({
      model: 'qwen2.5-coder:7b',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    }),
  ).rejects.toThrow('openai_category=connection_refused')

  const transportLog = debugSpy.mock.calls.find(call =>
    typeof call?.[0] === 'string' && call[0].includes('transport failure'),
  )

  expect(transportLog).toBeDefined()
  expect(String(transportLog?.[0])).toContain('category=connection_refused')
  expect(String(transportLog?.[0])).toContain('code=ECONNREFUSED')
  expect(transportLog?.[1]).toEqual({ level: 'warn' })
})

async function mockDebugLogging(): Promise<DebugSpy> {
  actualDebugModule ??= await import(
    `../../utils/debug.ts?openaiShimDiagnosticsActual=${Date.now()}-${Math.random()}`
  )
  const debugSpy = mock(
    (_message: string, _options?: { level?: DebugLogLevel }) => {},
  )
  mock.module('../../utils/debug.js', () => ({
    ...actualDebugModule!,
    logForDebugging: debugSpy,
  }))
  return debugSpy
}

function restoreDebugModule(): void {
  if (actualDebugModule) {
    mock.module('../../utils/debug.js', () => ({ ...actualDebugModule! }))
  }
}

function mockFetch(fetchMock: FetchMock): typeof globalThis.fetch {
  return mock(fetchMock) as unknown as typeof globalThis.fetch
}

function getFetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}
