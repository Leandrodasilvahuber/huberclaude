import { APIError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../../test/sharedMutationLock.js'
import { asMockFetch } from '../../../test/typedMocks.js'
import { _clearRegistryForTesting, ensureIntegrationsLoaded, registerGateway } from '../../../integrations/index.ts'
import { applyProviderFlag } from '../../../utils/providerFlag.ts'
import { getSessionId, switchSession } from '../../../bootstrap/state.ts'
import { getOpenClaudeUserAgent } from '../../../utils/userAgent.ts'
import {
  getAssistantMessageFromError,
  OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE,
} from '../errors.ts'
import { createOpenAIShimClient } from '../openaiShim.ts'

type FetchType = typeof globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_KEYS: process.env.OPENAI_API_KEYS,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_API_FORMAT: process.env.OPENAI_API_FORMAT,
  OPENAI_AZURE_STYLE: process.env.OPENAI_AZURE_STYLE,
  OPENAI_AUTH_HEADER: process.env.OPENAI_AUTH_HEADER,
  OPENAI_AUTH_SCHEME: process.env.OPENAI_AUTH_SCHEME,
  OPENAI_AUTH_HEADER_VALUE: process.env.OPENAI_AUTH_HEADER_VALUE,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  GITHUB_COPILOT_KEY: process.env.GITHUB_COPILOT_KEY,
  GITHUB_ENTERPRISE_URL: process.env.GITHUB_ENTERPRISE_URL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GEMINI_ACCESS_TOKEN: process.env.GEMINI_ACCESS_TOKEN,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  BNKR_API_KEY: process.env.BNKR_API_KEY,
  BANKR_BASE_URL: process.env.BANKR_BASE_URL,
  BANKR_MODEL: process.env.BANKR_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  MIMO_API_KEY: process.env.MIMO_API_KEY,
  OPENGATEWAY_API_KEY: process.env.OPENGATEWAY_API_KEY,
  OPENGATEWAY_BASE_URL: process.env.OPENGATEWAY_BASE_URL,
  OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID: process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
  CLAUDE_STREAM_IDLE_TIMEOUT_MS: process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS,
  HICAP_API_KEY: process.env.HICAP_API_KEY,
}

const originalFetch = globalThis.fetch

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

type OpenAIShimClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown> & {
        withResponse: () => Promise<{ data: AsyncIterable<Record<string, unknown>> }>
      }
    }
  }
}

function makeSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

function withResponseUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', {
    value: url,
    configurable: true,
  })
  return response
}

type StallingResponse = {
  response: Response
  cancelReasons: unknown[]
  close: () => void
}

function makeStallingResponse(
  firstChunk: string,
  url = 'https://api.example.test/v1/chat/completions',
  contentType = 'text/event-stream',
): StallingResponse {
  const encoder = new TextEncoder()
  const cancelReasons: unknown[] = []
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let closed = false

  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode(firstChunk))
      },
      cancel(reason) {
        closed = true
        cancelReasons.push(reason)
      },
    }),
    {
      headers: {
        'Content-Type': contentType,
      },
    },
  )

  return {
    response: withResponseUrl(response, url),
    cancelReasons,
    close: () => {
      if (closed) return
      closed = true
      try {
        streamController?.close()
      } catch {
        // The test may already have cancelled the stream.
      }
    },
  }
}

type ShimStream = AsyncIterable<Record<string, unknown>> & {
  controller: AbortController
}

type StreamDrainOutcome =
  | { status: 'completed'; events: Array<Record<string, unknown>> }
  | {
    status: 'rejected'
    events: Array<Record<string, unknown>>
    error: unknown
  }

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

async function expectAbortStopsStream({
  abort,
  cancelReasons,
  expectedEventsBeforeAbort,
  label,
  stream,
}: {
  abort: () => void
  cancelReasons: unknown[]
  expectedEventsBeforeAbort: number
  label: string
  stream: ShimStream
}): Promise<StreamDrainOutcome> {
  const events: Array<Record<string, unknown>> = []
  let resolveReady!: () => void
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
  })

  const drain = (async (): Promise<StreamDrainOutcome> => {
    try {
      for await (const event of stream) {
        events.push(event)
        if (events.length >= expectedEventsBeforeAbort) {
          resolveReady()
        }
      }
      return { status: 'completed', events }
    } catch (error) {
      return { status: 'rejected', events, error }
    }
  })()

  await waitForPromise(
    ready,
    500,
    `${label} did not produce initial stream events`,
  )
  // Let the for-await loop ask the stream reader for the next chunk, so the
  // abort has to wake a real pending read rather than only flipping a flag.
  await Promise.resolve()
  await Promise.resolve()

  abort()

  const outcome = await waitForPromise(
    drain,
    500,
    `${label} did not stop promptly after abort`,
  )
  expect(cancelReasons).toHaveLength(1)
  expect(outcome.status).toBe('rejected')
  if (outcome.status === 'rejected') {
    expect((outcome.error as { name?: unknown }).name).toBe('AbortError')
  }
  return outcome
}

async function expectPausedAbortCancelsStream({
  cancelReasons,
  label,
  stream,
}: {
  cancelReasons: unknown[]
  label: string
  stream: ShimStream
}): Promise<IteratorResult<Record<string, unknown>>> {
  const iterator = stream[Symbol.asyncIterator]()
  const first = await waitForPromise(
    iterator.next(),
    500,
    `${label} did not produce first stream event`,
  )
  expect(first.done).toBe(false)

  stream.controller.abort()
  await waitForPromise(
    (async () => {
      for (let i = 0; i < 10; i++) {
        if (cancelReasons.length > 0) return
        await Promise.resolve()
      }
      throw new Error(`${label} did not cancel source on controller abort`)
    })(),
    500,
    `${label} did not cancel source on controller abort`,
  )

  const returned = await waitForPromise(
    Promise.resolve(iterator.return?.()),
    500,
    `${label} did not return promptly after abort while paused`,
  )
  expect(cancelReasons).toHaveLength(1)
  return returned as IteratorResult<Record<string, unknown>>
}

async function expectBufferedAbortRejectsNext({
  expectedText,
  label,
  stream,
}: {
  expectedText?: string
  label: string
  stream: ShimStream
}): Promise<void> {
  const iterator = stream[Symbol.asyncIterator]()

  try {
    let firstDelta: Record<string, unknown> | undefined
    for (let i = 0; i < 5; i++) {
      const next = await waitForPromise(
        iterator.next(),
        500,
        `${label} did not produce expected pre-abort events`,
      )
      expect(next.done).toBe(false)
      if (next.value?.type === 'content_block_delta') {
        firstDelta = next.value
        break
      }
    }

    expect(firstDelta).toBeDefined()
    if (expectedText !== undefined) {
      expect((firstDelta as { delta?: { text?: string } }).delta?.text).toBe(expectedText)
    }

    stream.controller.abort()
    const afterAbort = await waitForPromise(
      iterator.next().then(
        value => ({ status: 'resolved' as const, value }),
        error => ({ status: 'rejected' as const, error }),
      ),
      500,
      `${label} did not stop after abort`,
    )

    if (afterAbort.status !== 'rejected') {
      throw new Error(`${label} yielded after abort: ${JSON.stringify(afterAbort.value)}`)
    }
    expect((afterAbort.error as { name?: unknown }).name).toBe('AbortError')
  } finally {
    await Promise.resolve(iterator.return?.()).catch(() => {})
  }
}

function makeOpenAIStreamFrame(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-abort-test',
    object: 'chat.completion.chunk',
    created: 1_780_000_000,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function makeStreamChunks(chunks: unknown[]): string[] {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ]
}

function importFreshOpenAIShim(
  cacheKey: string,
): Promise<typeof import('../openaiShim.ts')> {
  return import(`../openaiShim.ts?${cacheKey}`)
}

type StreamIdleTestApi = {
  StreamIdleTimeoutError: new (timeoutMs: number) => Error
  getStreamIdleTimeoutMs: () => number
  readWithIdleTimeout: (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    options?: { signal?: AbortSignal; onTimeout?: () => void },
  ) => Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>>
}

async function getStreamIdleTestApi(cacheKey: string): Promise<StreamIdleTestApi> {
  const mod = await importFreshOpenAIShim(cacheKey)
  const testApi = mod.__test as unknown as Partial<StreamIdleTestApi>
  expect(typeof testApi.StreamIdleTimeoutError).toBe('function')
  expect(typeof testApi.getStreamIdleTimeoutMs).toBe('function')
  expect(typeof testApi.readWithIdleTimeout).toBe('function')
  return testApi as StreamIdleTestApi
}

function makeChatCompletionResponse(model: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'ok',
          },
          finish_reason: 'stop',
        },
      ],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

async function captureChatCompletionRequest(
  model = 'mimo-v2.5-pro',
  defaultHeaders: Record<string, string> = {},
): Promise<{
  authorization: string | null
  headers: Record<string, string>
  url: string | null
}> {
  let authorization: string | null = null
  let headers: Record<string, string> = {}
  let url: string | null = null

  globalThis.fetch = (async (input, init) => {
    url = String(input)
    headers = (init?.headers as Record<string, string> | undefined) ?? {}
    authorization = headers.Authorization ?? headers.authorization ?? null

    return makeChatCompletionResponse(model)
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders }) as OpenAIShimClient

  await client.beta.messages.create({
    model,
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  return { authorization, headers, url }
}

beforeEach(async () => {
  await acquireSharedMutationLock('openaiShim.test.ts')
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  delete process.env.OPENAI_API_BASE
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.OPENAI_API_KEYS
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_API_FORMAT
  delete process.env.OPENAI_AZURE_STYLE
  delete process.env.OPENAI_AUTH_HEADER
  delete process.env.OPENAI_AUTH_SCHEME
  delete process.env.OPENAI_AUTH_HEADER_VALUE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_COPILOT_KEY
  delete process.env.GITHUB_ENTERPRISE_URL
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_MODEL
  delete process.env.GOOGLE_CLOUD_PROJECT
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
  delete process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.MINIMAX_API_KEY
  delete process.env.BNKR_API_KEY
  delete process.env.BANKR_BASE_URL
  delete process.env.BANKR_MODEL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.MIMO_API_KEY
  delete process.env.OPENGATEWAY_API_KEY
  delete process.env.OPENGATEWAY_BASE_URL
  delete process.env.OPENCODE_API_KEY
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
  delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS
  delete process.env.HICAP_API_KEY
})
afterEach(() => {
  try {
    restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
    restoreEnv('OPENAI_API_BASE', originalEnv.OPENAI_API_BASE)
    restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
    restoreEnv('OPENAI_API_KEYS', originalEnv.OPENAI_API_KEYS)
    restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
    restoreEnv('OPENAI_API_FORMAT', originalEnv.OPENAI_API_FORMAT)
    restoreEnv('OPENAI_AZURE_STYLE', originalEnv.OPENAI_AZURE_STYLE)
    restoreEnv('OPENAI_AUTH_HEADER', originalEnv.OPENAI_AUTH_HEADER)
    restoreEnv('OPENAI_AUTH_SCHEME', originalEnv.OPENAI_AUTH_SCHEME)
    restoreEnv('OPENAI_AUTH_HEADER_VALUE', originalEnv.OPENAI_AUTH_HEADER_VALUE)
    restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
    restoreEnv('GITHUB_COPILOT_KEY', originalEnv.GITHUB_COPILOT_KEY)
    restoreEnv('GITHUB_ENTERPRISE_URL', originalEnv.GITHUB_ENTERPRISE_URL)
    restoreEnv('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN)
    restoreEnv('GH_TOKEN', originalEnv.GH_TOKEN)
    restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
    restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
    restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
    restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
    restoreEnv('GEMINI_ACCESS_TOKEN', originalEnv.GEMINI_ACCESS_TOKEN)
    restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
    restoreEnv('GEMINI_BASE_URL', originalEnv.GEMINI_BASE_URL)
    restoreEnv('GEMINI_MODEL', originalEnv.GEMINI_MODEL)
    restoreEnv('GOOGLE_CLOUD_PROJECT', originalEnv.GOOGLE_CLOUD_PROJECT)
    restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
    restoreEnv('NVIDIA_API_KEY', originalEnv.NVIDIA_API_KEY)
    restoreEnv('NVIDIA_NIM', originalEnv.NVIDIA_NIM)
    restoreEnv('MINIMAX_API_KEY', originalEnv.MINIMAX_API_KEY)
    restoreEnv('BNKR_API_KEY', originalEnv.BNKR_API_KEY)
    restoreEnv('BANKR_BASE_URL', originalEnv.BANKR_BASE_URL)
    restoreEnv('BANKR_MODEL', originalEnv.BANKR_MODEL)
    restoreEnv('OPENROUTER_API_KEY', originalEnv.OPENROUTER_API_KEY)
    restoreEnv('DEEPSEEK_API_KEY', originalEnv.DEEPSEEK_API_KEY)
    restoreEnv('MIMO_API_KEY', originalEnv.MIMO_API_KEY)
    restoreEnv('OPENGATEWAY_API_KEY', originalEnv.OPENGATEWAY_API_KEY)
    restoreEnv('OPENGATEWAY_BASE_URL', originalEnv.OPENGATEWAY_BASE_URL)
    restoreEnv('OPENCODE_API_KEY', originalEnv.OPENCODE_API_KEY)
    restoreEnv('CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED', originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED)
    restoreEnv('CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID', originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID)
    restoreEnv('CLAUDE_STREAM_IDLE_TIMEOUT_MS', originalEnv.CLAUDE_STREAM_IDLE_TIMEOUT_MS)
    restoreEnv('HICAP_API_KEY', originalEnv.HICAP_API_KEY)
    globalThis.fetch = originalFetch
    _clearRegistryForTesting()
    ensureIntegrationsLoaded()
  } finally {
    releaseSharedMutationLock()
  }
})










test('defaults Authorization custom auth header to bearer scheme', async () => {
  process.env.OPENAI_API_KEY = 'authorization-key'
  process.env.OPENAI_AUTH_HEADER = 'Authorization'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBe('Bearer authorization-key')
})


test('ignores custom auth header value when no custom header is configured', async () => {
  delete process.env.OPENAI_API_KEY
  process.env.OPENAI_AUTH_HEADER_VALUE = 'gateway-header-value'
  let capturedHeaders: Headers | undefined

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers as HeadersInit)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({ defaultHeaders: {} }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBeNull()
})


test('applies descriptor static headers before client and request headers', async () => {
  let capturedHeaders: Headers | undefined

  registerGateway({
    id: 'shim-header-test',
    label: 'Shim Header Test',
    category: 'hosted',
    defaultBaseUrl: 'https://shim-header-test.example/v1',
    defaultModel: 'shim-test-model',
    setup: {
      requiresAuth: true,
      authMode: 'api-key',
      credentialEnvVars: ['OPENAI_API_KEY'],
    },
    transportConfig: {
      kind: 'openai-compatible',
      openaiShim: {
        headers: {
          'x-static-header': 'from-descriptor',
          'x-override-header': 'from-descriptor',
        },
      },
    },
  })

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://shim-header-test.example/v1'
  process.env.OPENAI_MODEL = 'shim-test-model'

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'shim-test-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 3,
          total_tokens: 11,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    defaultHeaders: {
      'x-override-header': 'from-client',
    },
  }) as OpenAIShimClient

  await client.beta.messages.create(
    {
      model: 'shim-test-model',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    },
    {
      headers: {
        'x-override-header': 'from-request',
      },
    },
  )

  expect(capturedHeaders?.get('x-static-header')).toBe('from-descriptor')
  expect(capturedHeaders?.get('x-override-header')).toBe('from-request')
})



// Extraction seam: stream conversion usage | shared stream control.


// Extraction seam: shared stream control | Gemini stream conversion.

test('OpenAI-compatible stream rejects with idle timeout when it stalls after a chunk', async () => {
  await getStreamIdleTestApi('stream-idle-openai-stall')
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '25'
  const stalled = makeStallingResponse(
    makeOpenAIStreamFrame({ role: 'assistant', content: 'partial' }),
  )

  globalThis.fetch = (async () => stalled.response) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'glm-5.2',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const events: Array<Record<string, unknown>> = []
  const startedAt = Date.now()
  let caught: unknown
  try {
    for await (const event of result.data) {
      events.push(event)
    }
  } catch (error) {
    caught = error
  } finally {
    stalled.close()
  }

  expect(Date.now() - startedAt).toBeLessThan(500)
  expect((caught as Error).name).toBe('StreamIdleTimeoutError')
  expect((stalled.cancelReasons[0] as Error).name).toBe('StreamIdleTimeoutError')
  const textDeltas = events.flatMap(event => {
    const eventDelta = event.delta as { type?: string; text?: string } | undefined
    return eventDelta?.type === 'text_delta' && typeof eventDelta.text === 'string'
      ? [eventDelta.text]
      : []
  })
  expect(textDeltas).toEqual(['partial'])
})

test('OpenAI-compatible stream keeps slow active chunks alive under the idle timeout', async () => {
  await getStreamIdleTestApi('stream-idle-openai-active')
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '500'
  const startedAt = Date.now()
  const encoder = new TextEncoder()
  const chunks = makeStreamChunks([
    {
      id: 'chatcmpl-active',
      object: 'chat.completion.chunk',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'hel' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-active',
      object: 'chat.completion.chunk',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          delta: { content: 'lo' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-active',
      object: 'chat.completion.chunk',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    },
  ])
  let emitTimer: ReturnType<typeof setTimeout> | undefined

  globalThis.fetch = asMockFetch(mock(async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let index = 0
          const emit = () => {
            emitTimer = undefined
            const chunk = chunks[index++]
            if (chunk === undefined) {
              controller.close()
              return
            }
            controller.enqueue(encoder.encode(chunk))
            emitTimer = setTimeout(emit, 200)
          }
          emit()
        },
        cancel() {
          if (emitTimer !== undefined) {
            clearTimeout(emitTimer)
            emitTimer = undefined
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
        },
      },
    )))

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'glm-5.2',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const streamDelta = (event as { delta?: { type?: string; text?: string } }).delta
    if (
      streamDelta?.type === 'text_delta' &&
      typeof streamDelta.text === 'string'
    ) {
      textDeltas.push(streamDelta.text)
    }
  }

  expect(Date.now() - startedAt).toBeGreaterThan(500)
  expect(textDeltas.join('')).toBe('hello')
})


// Extraction seam: Gemini stream conversion | native Ollama stream adaptation.


test('keeps max_completion_tokens for non-local non-github providers', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'

  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.max_completion_tokens).toBe(64)
    expect(body.max_tokens).toBeUndefined()

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })
})

test('uses route-specific credential env vars for descriptor-backed openai-compatible routes', async () => {
  let capturedHeaders: Headers | undefined

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENROUTER_API_KEY = 'or-route-key'
  delete process.env.OPENAI_API_KEY

  globalThis.fetch = (async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'openai/gpt-5-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          total_tokens: 6,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })

  expect(capturedHeaders?.get('authorization')).toBe('Bearer or-route-key')
})

test('OpenGateway MiMo replays real reasoning_content without adding empty fallback', async () => {
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-opengateway-mimo',
        model: 'mimo-v2.5-pro',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [
      { role: 'user', content: 'Use an agent' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect code with an agent.',
          },
          {
            type: 'tool_use',
            id: 'call_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect code',
              prompt: 'Look at the relevant code',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_agent_1',
            content: 'Agent finished',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect code with an agent.',
  )
  expect(requestBody).not.toHaveProperty('store')
})

test('Xiaomi MiMo replays real reasoning_content without adding empty fallback', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-test-key'
  delete process.env.OPENAI_API_KEY
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-mimo',
        model: 'mimo-v2.5-pro',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [
      { role: 'user', content: 'Use an agent' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect code with an agent.',
          },
          {
            type: 'tool_use',
            id: 'call_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect code',
              prompt: 'Look at the relevant code',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_agent_1',
            content: 'Agent finished',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect code with an agent.',
  )
  expect(requestBody).not.toHaveProperty('store')
})

test('OpenGateway MiMo does not synthesize empty reasoning_content when missing', async () => {
  process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-opengateway-mimo',
        model: 'mimo-v2.5-pro',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [
      { role: 'user', content: 'Use an agent' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect code',
              prompt: 'Look at the relevant code',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_agent_1',
            content: 'Agent finished',
          },
        ],
      },
    ],
    max_tokens: 64,
    stream: false,
  })

  const assistantWithToolCall = (requestBody?.messages as Array<Record<string, unknown>>).find(
    message => Array.isArray(message.tool_calls),
  )

  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall).not.toHaveProperty('reasoning_content')
  expect(requestBody).not.toHaveProperty('store')
})

test('strips unsupported stream_options for Xiaomi MiMo streams', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.xiaomimimo.com/v1'
  process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
  process.env.MIMO_API_KEY = 'mimo-test-key'
  delete process.env.OPENAI_API_KEY
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))

    return makeSseResponse(
      makeStreamChunks([
        {
          id: 'chatcmpl-mimo',
          object: 'chat.completion.chunk',
          model: 'mimo-v2.5-pro',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'done' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-mimo',
          object: 'chat.completion.chunk',
          model: 'mimo-v2.5-pro',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        },
      ]),
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'mimo-v2.5-pro',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: true,
  })

  expect(requestBody).toMatchObject({
    stream: true,
    max_completion_tokens: 64,
  })
  expect(requestBody).not.toHaveProperty('stream_options')
  expect(requestBody).not.toHaveProperty('store')
})


test('does not use stale NVIDIA_API_KEY for non-NVIDIA OpenAI-compatible routes', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openrouter',
        model: 'openai/gpt-5-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})

test('does not use MINIMAX_API_KEY for non-MiniMax OpenAI-compatible routes', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openrouter',
        model: 'openai/gpt-5-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})

test('openai route still sends OPENAI_API_KEY as bearer auth', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  process.env.OPENAI_API_KEY = 'fake-openai-key'
  delete process.env.OPENGATEWAY_API_KEY

  const captured = await captureChatCompletionRequest('gpt-5.5')

  expect(captured.authorization).toBe('Bearer fake-openai-key')
})
test('does not use BNKR_API_KEY for non-Bankr OpenAI-compatible routes', async () => {
  let capturedAuthorization: string | null = null

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.BNKR_API_KEY = 'bankr-live-key'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY

  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    capturedAuthorization =
      headers?.Authorization ?? headers?.authorization ?? null

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-openrouter',
        model: 'openai/gpt-5-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'openai/gpt-5-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 32,
    stream: false,
  })

  expect(capturedAuthorization).toBeNull()
})

// Extraction seam: provider signature metadata | raw streaming tool fallback.

// Extraction seam: streaming conversion | non-streaming response conversion.

test('normalizes plain string Bash tool arguments from OpenAI-compatible responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    stop_reason?: string
    content?: Array<Record<string, unknown>>
  }

  expect(message.stop_reason).toBe('tool_use')
  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    },
  ])
})

test('normalizes Bash tool arguments that are valid JSON strings', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '"pwd"',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    },
  ])
})

test.each([
  ['false', false],
  ['null', null],
  ['[]', []],
])(
  'preserves malformed Bash JSON literals as parsed values in non-streaming responses: %s',
  async (argumentsValue, expectedInput) => {
    globalThis.fetch = (async (_input, _init) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          model: 'google/gemini-3.1-pro-preview',
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'function-call-1',
                    type: 'function',
                    function: {
                      name: 'Bash',
                      arguments: argumentsValue,
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
    }) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient

    const message = await client.beta.messages.create({
      model: 'google/gemini-3.1-pro-preview',
      system: 'test system',
      messages: [{ role: 'user', content: 'Use Bash' }],
      max_tokens: 64,
      stream: false,
    }) as {
      content?: Array<Record<string, unknown>>
    }

    expect(message.content).toEqual([
      {
        type: 'tool_use',
        id: 'function-call-1',
        name: 'Bash',
        input: expectedInput,
      },
    ])
  },
)

test('keeps terminal empty Bash tool arguments invalid in non-streaming responses', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'Bash',
                    arguments: '',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Bash' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'Bash',
      input: {},
    },
  ])
})

// Extraction seam: completed tool parsing | streamed tool normalization.

// Extraction seam: streamed tool normalization | schema and tool conversion.

test('preserves raw input for unknown plain string tool arguments', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'UnknownTool',
                    arguments: 'pwd',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use tool' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'UnknownTool',
      input: {},
    },
  ])
})

test('preserves parsed string input for unknown JSON string tool arguments', async () => {
  globalThis.fetch = (async (_input, _init) => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'google/gemini-3.1-pro-preview',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'function-call-1',
                  type: 'function',
                  function: {
                    name: 'UnknownTool',
                    arguments: '"pwd"',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use tool' }],
    max_tokens: 64,
    stream: false,
  }) as {
    content?: Array<Record<string, unknown>>
  }

  expect(message.content).toEqual([
    {
      type: 'tool_use',
      id: 'function-call-1',
      name: 'UnknownTool',
      input: 'pwd',
    },
  ])
})

test('non-streaming: preserves response body when usage parsing fails', async () => {
  const json = JSON as unknown as { parse: typeof JSON.parse }
  const originalJSONParse = json.parse
  const responseBody = JSON.stringify({
    id: 'chatcmpl-1',
    model: 'glm-5',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'ok',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  })
  let usageParseFailed = false

  // Throw only for the usage-extraction parse of the response body.
  // A global "throw once" mock is unreliable here: Bun's native
  // Response.json() does not go through JS-level JSON.parse, so the
  // second parse the original test relied on never happens (parseCalls
  // stays at 1 and `toBeGreaterThan(1)` fails). Scoping the failure to
  // the response body targets the _doRequest parse without breaking
  // unrelated JSON.parse calls in the request pipeline, and works in
  // both Bun (native Response.json) and Node (undici, which does call
  // JSON.parse — guarded by `usageParseFailed` so it won't throw again).
  json.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    if (!usageParseFailed && text === responseBody) {
      usageParseFailed = true
      throw new Error('simulated usage parse failure')
    }
    return originalJSONParse(text, reviver)
  }) as typeof JSON.parse

  try {
    globalThis.fetch = (async () => {
      return new Response(responseBody, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as unknown as FetchType

    const client = createOpenAIShimClient({}) as OpenAIShimClient

    const result = (await client.beta.messages.create({
      model: 'glm-5',
      system: 'test system',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: false,
    })) as { content: Array<Record<string, unknown>> }

    // Usage extraction threw, but the recreated Response still holds the
    // body so downstream response.json() can read it.
    expect(usageParseFailed).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
  } finally {
    json.parse = originalJSONParse
  }
})


// Extraction seam: non-streaming response conversion | streaming event conversion.

// Extraction boundary: response conversion | executor network behavior.
// The executor suite owns the contiguous network-classification block below.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: executor network behavior | native Ollama routing.
// Native Ollama endpoint selection remains an adapter/facade integration concern.
// Keep this marker stable for independent adjacent test migrations.

// Extraction boundary: executor tool self-healing | message conversion.
// Message-history normalization below belongs to the message converter.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: native Ollama routing | executor tool self-healing.
// The single retry test below moves with request execution.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: executor tool self-healing | message conversion.
// Message-history normalization below belongs to the message converter.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: executor tool self-healing | message/provider shaping.
// Provider request shaping below is not owned by the executor.
// Keep this marker stable for independent adjacent test migrations.
test('Moonshot: uses max_tokens (not max_completion_tokens) and strips store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})



test('requests streaming usage from local OpenAI-compatible servers', async () => {
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'local-vllm-model',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: true,
  })

  expect(requestBody?.stream).toBe(true)
  expect(requestBody?.stream_options).toEqual({ include_usage: true })
})

test('retries a strict custom local stream once without rejected stream_options', async () => {
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1'
  process.env.OPENAI_API_KEY = 'strict-local-key'

  const requestBodies: Array<Record<string, unknown>> = []
  const authorizations: Array<string | null> = []
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const headers = init?.headers as Record<string, string> | undefined
    authorizations.push(headers?.Authorization ?? headers?.authorization ?? null)
    if (requestBodies.length === 1) {
      return new Response(
        '{"error":{"message":"Unsupported parameter: stream_options","param":"stream_options"}}',
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-strict-local',
        object: 'chat.completion.chunk',
        model: 'strict-local-model',
        choices: [{ index: 0, delta: { content: 'fallback works' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-strict-local',
        object: 'chat.completion.chunk',
        model: 'strict-local-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]))
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  const result = await client.beta.messages
    .create({
      model: 'strict-local-model',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        name: 'Read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: { filePath: { type: 'string' } },
          required: ['filePath'],
        },
      }],
      max_tokens: 64,
      stream: true,
    })
    .withResponse()

  const textDeltas: string[] = []
  for await (const event of result.data) {
    const delta = event.delta as { type?: string; text?: string } | undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      textDeltas.push(delta.text)
    }
  }

  expect(requestBodies).toHaveLength(2)
  expect(requestBodies[0]?.stream_options).toEqual({ include_usage: true })
  expect(requestBodies[1]).not.toHaveProperty('stream_options')
  expect(requestBodies[1]?.tools).toEqual(requestBodies[0]?.tools)
  expect(authorizations).toEqual(['Bearer strict-local-key', 'Bearer strict-local-key'])
  expect(textDeltas.join('')).toBe('fallback works')
})

test('stops after one stream_options compatibility retry', async () => {
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1'

  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('Unsupported parameter: stream_options', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    })
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'strict-local-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    }),
  ).rejects.toThrow()

  expect(requestBodies).toHaveLength(2)
  expect(requestBodies[0]?.stream_options).toEqual({ include_usage: true })
  expect(requestBodies[1]).not.toHaveProperty('stream_options')
})

test('does not remove stream_options or retry an unrelated custom-provider 400', async () => {
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1'

  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(
      '{"error":{"message":"Invalid request for model; received stream_options in the request body"}}',
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'strict-local-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    }),
  ).rejects.toThrow()

  expect(requestBodies).toHaveLength(1)
  expect(requestBodies[0]?.stream_options).toEqual({ include_usage: true })
})

test('does not retry a nested stream_options validation failure', async () => {
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1'

  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(
      'Invalid parameter: stream_options.include_usage must be a boolean',
      { status: 400, headers: { 'Content-Type': 'text/plain' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await expect(
    client.beta.messages.create({
      model: 'strict-local-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      stream: true,
    }),
  ).rejects.toThrow()

  expect(requestBodies).toHaveLength(1)
  expect(requestBodies[0]?.stream_options).toEqual({ include_usage: true })
})

test('does not retry a stream_options rejection after user cancellation', async () => {
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1'

  const controller = new AbortController()
  const abortReason = new DOMException('The operation was aborted.', 'AbortError')
  const requestBodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const response = new Response(null, {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    })
    Object.defineProperty(response, 'text', {
      value: async () => {
        controller.abort(abortReason)
        return 'Unsupported parameter: stream_options'
      },
      configurable: true,
    })
    return response
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  let caught: unknown
  try {
    await client.beta.messages.create(
      {
        model: 'strict-local-model',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        stream: true,
      },
      { signal: controller.signal },
    )
  } catch (error) {
    caught = error
  }

  expect(requestBodies).toHaveLength(1)
  expect(caught).toBe(abortReason)
})





test('Moonshot: echoes reasoning_content on assistant tool-call messages', async () => {
  // Regression for: "API Error: 400 {"error":{"message":"thinking is enabled
  // but reasoning_content is missing in assistant tool call message at index
  // N"}}" when the agent sends a prior-turn assistant response back to Kimi.
  // The thinking block captured from the inbound response must round-trip
  // as reasoning_content on the outgoing echoed assistant message.
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [
      { role: 'user', content: 'check the logs' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect logs via Bash; running a cat.',
          },
          { type: 'text', text: "I'll inspect the logs." },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat /tmp/app.log' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'log line 1\nlog line 2',
          },
        ],
      },
    ],
    max_tokens: 256,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect logs via Bash; running a cat.',
  )
})

test('DeepSeek echoes reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe('thought')
})

test('generic OpenAI-compatible providers do not echo reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'sk-openai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test',
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'text', text: 'hello' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'files' },
        ],
      },
    ],
    max_tokens: 32,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBeUndefined()
})


test('Moonshot: cn host is also detected', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.cn/v1'
  process.env.OPENAI_API_KEY = 'sk-moonshot-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-k2.6',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-k2.6',
    system: 'you are kimi',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.store).toBeUndefined()
})

test('Kimi Code endpoint inherits Moonshot max_tokens/store compatibility', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
  process.env.OPENAI_API_KEY = 'sk-kimi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-for-coding',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-for-coding',
    system: 'you are kimi code',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})

test('Kimi Code endpoint echoes reasoning_content on assistant tool-call messages', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
  process.env.OPENAI_API_KEY = 'sk-kimi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'kimi-for-coding',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'kimi-for-coding',
    system: 'you are kimi code',
    messages: [
      { role: 'user', content: 'check the logs' },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Need to inspect logs via Bash; running a cat.',
          },
          { type: 'text', text: "I'll inspect the logs." },
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'Bash',
            input: { command: 'cat /tmp/app.log' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_bash_1',
            content: 'log line 1\nlog line 2',
          },
        ],
      },
    ],
    max_tokens: 256,
    stream: false,
  })

  const messages = requestBody?.messages as Array<Record<string, unknown>>
  const assistantWithToolCall = messages.find(
    m => m.role === 'assistant' && Array.isArray(m.tool_calls),
  )
  expect(assistantWithToolCall).toBeDefined()
  expect(assistantWithToolCall?.reasoning_content).toBe(
    'Need to inspect logs via Bash; running a cat.',
  )
})


test('DeepSeek omits thinking controls when the Anthropic-side request does not set them', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_API_KEY = 'sk-deepseek'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'deepseek-v4-flash',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'deepseek-v4-flash',
    system: 'test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
    stream: false,
  })

  expect(requestBody?.thinking).toBeUndefined()
  expect(requestBody?.reasoning_effort).toBeUndefined()
})



test('Z.AI: uses max_tokens (not max_completion_tokens) and strips store', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
  process.env.OPENAI_API_KEY = 'sk-zai-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'GLM-5.1',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'GLM-5.1',
    system: 'you are glm',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    stream: false,
  })

  expect(requestBody?.max_tokens).toBe(256)
  expect(requestBody?.max_completion_tokens).toBeUndefined()
  expect(requestBody?.store).toBeUndefined()
})








// Extraction boundary: provider reasoning compatibility | tool-stream routing.
// The gateway emission regression below remains provider/request-shaping coverage.
// Keep this marker stable for independent adjacent test migrations.
// Regression test for #1950: GLM-5.2 served through NVIDIA NIM
// (`integrate.api.nvidia.com`) must never receive the Z.AI-proprietary
// `tool_stream` parameter. Streaming tool calls are simply not streamed on
// this gateway; sending the parameter aborts the request with
// `400 Unsupported parameter(s): tool_stream`.
test('NVIDIA NIM Z.AI GLM streaming request with tools does not send tool_stream (regression #1950)', async () => {
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvapi-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return makeSseResponse(makeStreamChunks([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'z-ai/glm-5.2',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'z-ai/glm-5.2',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]))
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'z-ai/glm-5.2',
    messages: [{ role: 'user', content: 'run pwd' }],
    tools: [
      {
        name: 'Bash',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ],
    max_tokens: 64,
    stream: true,
  })

  // tool_stream is a Z.AI-only streaming extension; NVIDIA NIM rejects it with
  // `400 Unsupported parameter(s): tool_stream`. Streaming tool calls simply
  // aren't streamed on this gateway.
  expect(requestBody?.tool_stream).toBeUndefined()
})

// Extraction boundary: executor tool-stream retry | provider tool-stream shaping.
// Provider emission rules below remain with compatibility/request planning.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: provider tool-stream shaping | executor tool-stream retry.
// The three retry-state tests below move together with request execution.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: executor tool-stream retry | provider tool-stream shaping.
// Provider emission rules below remain with compatibility/request planning.
// Keep this marker stable for independent adjacent test migrations.
test.each([
  ['non-streaming Z.AI request with tools', 'https://api.z.ai/api/coding/paas/v4', false, true, 'glm-5.2'],
  ['streaming Z.AI request without tools', 'https://api.z.ai/api/coding/paas/v4', true, false, 'glm-5.2'],
  ['streaming non-Z.AI request with tools', 'https://api.openai.com/v1', true, true, 'gpt-4o'],
] as const)('does not send tool_stream for %s', async (_name, baseUrl, stream, includeTools, model) => {
  process.env.OPENAI_BASE_URL = baseUrl
  process.env.OPENAI_API_KEY = 'sk-test'

  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    if (stream) {
      return makeSseResponse(makeStreamChunks([
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ]))
    }
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model,
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    tools: includeTools
      ? [
          {
            name: 'Bash',
            description: 'Run a shell command',
            input_schema: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        ]
      : undefined,
    max_tokens: 64,
    stream,
  })

  expect(requestBody?.tool_stream).toBeUndefined()
})


test('emits reasoning_effort on chat_completions when reasoningEffort is passed', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_API_FORMAT = 'chat_completions'

  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-5.4',
        choices: [
          {
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({
    reasoningEffort: 'xhigh',
  }) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 16,
    stream: false,
  })

  expect(requestBody?.reasoning_effort).toBe('xhigh')
})

test('omits reasoning_effort on chat_completions when no override and model has no alias default', async () => {
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'

  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 16,
    stream: false,
  })

  expect(requestBody && 'reasoning_effort' in requestBody).toBe(false)
})


// Extraction boundary: history pruning | executor Copilot refresh behavior.
// The contiguous Copilot authentication retry block below moves with execution.
// Keep this marker stable for independent adjacent test migrations.
// Extraction boundary: executor Copilot refresh behavior | JSON fallback conversion.
// JSON fallback response conversion below is not owned by request execution.
// Keep this marker stable for independent adjacent test migrations.
// --- JSON fallback regression tests (#1749) -------------------------------
// Some OpenAI-compatible providers ignore `stream: true` and return a full
// `application/json` chat completion. The fallback inside
// openaiStreamToAnthropic must route that response through the same
// non-streaming converter so tool_calls, Anthropic stop reasons, array
// content, and <think> stripping are all preserved (jatmn CHANGES_REQUESTED).

function makeJsonChatCompletion(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
}

async function collectFallbackEvents(
  body: Record<string, unknown>,
  model = 'fake-model',
): Promise<Array<Record<string, unknown>>> {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => makeJsonChatCompletion(body)) as unknown as FetchType
  try {
    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()
    const events: Array<Record<string, unknown>> = []
    for await (const event of result.data) {
      events.push(event)
    }
    return events
  } finally {
    // Restore so the global fetch stub does not leak past this helper.
    globalThis.fetch = previousFetch
  }
}

test('JSON fallback: preserves tool_calls as a tool_use block', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-tool',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'Bash', arguments: '{"command":"pwd"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  })

  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'call_1',
    name: 'Bash',
  })

  const inputDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'input_json_delta',
  ) as { delta?: { partial_json?: string } } | undefined
  expect(JSON.parse(inputDelta?.delta?.partial_json ?? '{}')).toEqual({
    command: 'pwd',
  })

  const stopEvent = events.find(e => e.type === 'message_delta') as
    | { delta?: { stop_reason?: string } }
    | undefined
  expect(stopEvent?.delta?.stop_reason).toBe('tool_use')
})

test('JSON fallback: maps finish_reason=length to max_tokens', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-len',
    model: 'fake-model',
    choices: [
      { message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' },
    ],
  })
  const stopEvent = events.find(e => e.type === 'message_delta') as
    | { delta?: { stop_reason?: string } }
    | undefined
  expect(stopEvent?.delta?.stop_reason).toBe('max_tokens')
})

test('JSON fallback: preserves OpenCode Go quota error guidance', async () => {
  process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/go/v1'
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    withResponseUrl(
      makeJsonChatCompletion({
        error: {
          type: 'FreeUsageLimitError',
          message: 'free usage limit reached',
        },
      }),
      'https://opencode.ai/zen/go/v1/chat/completions',
    )) as unknown as FetchType

  try {
    const client = createOpenAIShimClient({}) as OpenAIShimClient
    const result = await client.beta.messages
      .create({
        model: 'fake-model',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
        stream: true,
      })
      .withResponse()

    let caught: unknown
    try {
      for await (const _event of result.data) {
        // Consume until the JSON error is surfaced.
      }
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(APIError)
    const apiError = caught as APIError
    expect(apiError.headers?.get('x-opencode-request-url')).toBe(
      'https://opencode.ai/zen/go/v1/chat/completions',
    )
    const message = getAssistantMessageFromError(apiError, 'glm-5.1')
    const first = message.message.content[0]
    expect(typeof first === 'object' && first && 'text' in first ? first.text : '').toBe(
      OPENCODE_GO_FREE_LIMIT_ERROR_MESSAGE,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('JSON fallback: strips <think> tags from emitted text', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-think',
    model: 'fake-model',
    choices: [
      {
        message: { role: 'assistant', content: '<think>private plan</think>visible answer' },
        finish_reason: 'stop',
      },
    ],
  })
  const textDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'text_delta',
  ) as { delta?: { text?: string } } | undefined
  expect(textDelta?.delta?.text).toBe('visible answer')
  expect(textDelta?.delta?.text).not.toContain('private plan')
})

test('JSON fallback: normalizes array content into a text string', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-array',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
        },
        finish_reason: 'stop',
      },
    ],
  })
  const textDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'text_delta',
  ) as { delta?: { text?: unknown } } | undefined
  expect(typeof textDelta?.delta?.text).toBe('string')
  expect(textDelta?.delta?.text).toBe('line one\nline two')
})

test('JSON fallback façade terminates converted messages', async () => {
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-boundary',
    model: 'boundary-model',
    choices: [{
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    }],
  })

  expect(events.at(-1)?.type).toBe('message_stop')
})

test('JSON fallback: preserves HY3-looking text for non-Tencent model names', async () => {
  const text =
    '<tool_call:example>TaskCreate\nsubject: merely a documentation example\n</tool_call:example>'
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-non-tencent-hy3',
    model: 'other/hy3-documentation',
    choices: [
      {
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
  }, 'other/hy3-documentation')
  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  )
  const textDelta = events.find(
    event =>
      event.type === 'content_block_delta' &&
      typeof event.delta === 'object' &&
      event.delta !== null &&
      (event.delta as Record<string, unknown>).type === 'text_delta',
  ) as { delta?: { text?: string } } | undefined

  expect(toolStart).toBeUndefined()
  expect(textDelta?.delta?.text).toBe(text)
})

test('JSON fallback: empty tool_calls array does not block raw-text recovery', async () => {
  // tool_calls: [] is truthy; it must be treated as "no structured tool calls"
  // so the raw "Tool calls requested" recovery still runs.
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-empty-tc',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          tool_calls: [],
          content:
            'Tool calls requested:\n- Bash({"command":"ls"}) [id: call_empty_tc]',
        },
        finish_reason: 'stop',
      },
    ],
  })
  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'call_empty_tc',
    name: 'Bash',
  })
})

test('JSON fallback: empty tool_calls does not block raw-text recovery on array content', async () => {
  // Companion to the string-content case above: the array-content branch must
  // also treat tool_calls: [] as "no structured tool calls" so raw recovery runs.
  const events = await collectFallbackEvents({
    id: 'chatcmpl-json-empty-tc-array',
    model: 'fake-model',
    choices: [
      {
        message: {
          role: 'assistant',
          tool_calls: [],
          content: [
            { type: 'text', text: 'Tool calls requested:' },
            { type: 'text', text: '- Bash({"command":"ls"}) [id: call_empty_tc_arr]' },
          ],
        },
        finish_reason: 'stop',
      },
    ],
  })
  const toolStart = events.find(
    event =>
      event.type === 'content_block_start' &&
      typeof event.content_block === 'object' &&
      event.content_block !== null &&
      (event.content_block as Record<string, unknown>).type === 'tool_use',
  ) as { content_block?: Record<string, unknown> } | undefined
  expect(toolStart?.content_block).toMatchObject({
    type: 'tool_use',
    id: 'call_empty_tc_arr',
    name: 'Bash',
  })
})
