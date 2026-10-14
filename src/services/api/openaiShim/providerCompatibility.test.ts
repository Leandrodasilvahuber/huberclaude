import { afterEach, beforeEach, expect, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../../test/sharedMutationLock.js'
import { createOpenAIShimClient } from '../openaiShim.js'
import {
  filterAnthropicHeaders,
  geminiThoughtSignatureFromExtraContent,
  isGeminiModelName,
  mergeGeminiThoughtSignature,
  shouldPreserveGeminiThoughtSignature,
} from './providerCompatibility.js'

const originalEnv = {
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_KEYS: process.env.OPENAI_API_KEYS,
  OPENAI_AZURE_STYLE: process.env.OPENAI_AZURE_STYLE,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_FORMAT: process.env.OPENAI_API_FORMAT,
  OPENAI_AUTH_HEADER: process.env.OPENAI_AUTH_HEADER,
  OPENAI_AUTH_SCHEME: process.env.OPENAI_AUTH_SCHEME,
  OPENAI_AUTH_HEADER_VALUE: process.env.OPENAI_AUTH_HEADER_VALUE,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_ACCESS_TOKEN: process.env.GEMINI_ACCESS_TOKEN,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
}
const originalFetch = globalThis.fetch

beforeEach(async () => {
  await acquireSharedMutationLock('openaiShim-providerCompatibility.test.ts')
  delete process.env.CLAUDE_CODE_USE_GITHUB
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.OPENAI_API_KEYS
  delete process.env.OPENAI_AZURE_STYLE
  process.env.OPENAI_BASE_URL = 'https://api.example.test/v1'
  delete process.env.OPENAI_API_FORMAT
  delete process.env.OPENAI_AUTH_HEADER
  delete process.env.OPENAI_AUTH_SCHEME
  delete process.env.OPENAI_AUTH_HEADER_VALUE
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.MISTRAL_API_KEY
  delete process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_NIM
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.GEMINI_BASE_URL
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GOOGLE_API_KEY
})

afterEach(() => {
  try {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    globalThis.fetch = originalFetch
  } finally {
    releaseSharedMutationLock()
  }
})

type ShimClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown> & {
        withResponse: () => Promise<{
          data: AsyncIterable<Record<string, unknown>>
        }>
      }
    }
  }
}

function completionResponse({
  id = 'chatcmpl-test',
  model = 'test-model',
  content = 'ok',
  usage,
}: {
  id?: string
  model?: string
  content?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
} = {}): Response {
  return new Response(JSON.stringify({
    id,
    model,
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  }), { headers: { 'Content-Type': 'application/json' } })
}

function sseResponse(chunks: Array<Record<string, unknown>>): Response {
  const body = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

test('preserves Grep tool pattern fields for OpenAI-compatible providers', async () => {
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return completionResponse({
      id: 'chatcmpl-grep-schema',
      model: 'qwen/qwen3.6-plus',
      content: 'done',
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    })
  }) as unknown as typeof globalThis.fetch

  const client = createOpenAIShimClient({}) as unknown as ShimClient
  await client.beta.messages.create({
    model: 'qwen/qwen3.6-plus',
    system: 'test system',
    messages: [{ role: 'user', content: 'Use Grep' }],
    tools: [{
      name: 'Grep',
      description: 'Search file contents',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
          path: { type: 'string' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    }],
    max_tokens: 64,
    stream: false,
  })

  const tools = requestBody?.tools as Array<Record<string, unknown>> | undefined
  const grepTool = tools?.find(tool => (tool.function as Record<string, unknown>)?.name === 'Grep') as
    | { function?: { parameters?: { properties?: Record<string, unknown>; required?: string[] } } }
    | undefined
  expect(Object.keys(grepTool?.function?.parameters?.properties ?? {})).toContain('pattern')
  expect(grepTool?.function?.parameters?.required).toContain('pattern')
})

test('filters Anthropic and authentication headers while preserving compatible headers', () => {
  expect(filterAnthropicHeaders({
    'anthropic-version': '2023-06-01',
    'x-anthropic-version': '2023-06-01',
    'x-anthropic-additional-protection': 'true',
    'x-claude-remote-session-id': 'secret',
    'x-app': 'secret',
    'x-client-app': 'secret',
    authorization: 'Bearer secret',
    'x-api-key': 'secret',
    'x-custom': 'keep',
  })).toEqual({ 'x-custom': 'keep' })
})

test('the façade applies provider header filtering to a real request', async () => {
  const requests: Headers[] = []
  globalThis.fetch = (async (_input, init) => {
    requests.push(new Headers(init?.headers))
    return completionResponse({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    })
  }) as unknown as typeof globalThis.fetch
  const client = createOpenAIShimClient({
    defaultHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-anthropic-version': '2023-06-01',
      'x-anthropic-additional-protection': 'true',
      'x-claude-remote-session-id': 'remote-123',
      'x-app': 'cli',
      'x-client-app': 'sdk',
      'x-api-key': 'anthropic-secret',
      'x-safe-header': 'keep-me',
      'x-custom': 'keep',
    },
  }) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  })
  await client.beta.messages.create({
    model: 'gpt-4o',
    system: 'test system',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 64,
    stream: false,
  }, {
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      authorization: 'request-secret',
      'x-safe-header': 'keep-me',
      'x-request-custom': 'keep',
    },
  })

  expect(requests[0]?.get('anthropic-version')).toBeNull()
  expect(requests[0]?.get('anthropic-beta')).toBeNull()
  expect(requests[0]?.get('x-anthropic-version')).toBeNull()
  expect(requests[0]?.get('x-anthropic-additional-protection')).toBeNull()
  expect(requests[0]?.get('x-claude-remote-session-id')).toBeNull()
  expect(requests[0]?.get('x-app')).toBeNull()
  expect(requests[0]?.get('x-client-app')).toBeNull()
  expect(requests[0]?.get('x-api-key')).toBeNull()
  expect(requests[0]?.get('x-safe-header')).toBe('keep-me')
  expect(requests[0]?.get('x-custom')).toBe('keep')
  expect(requests[1]?.get('anthropic-version')).toBeNull()
  expect(requests[1]?.get('anthropic-beta')).toBeNull()
  expect(requests[1]?.get('authorization')).toBe('Bearer test-key')
  expect(requests[1]?.get('x-safe-header')).toBe('keep-me')
  expect(requests[1]?.get('x-request-custom')).toBe('keep')
})

test('recognizes Gemini model routes and preserves their thought signatures', () => {
  expect(isGeminiModelName('gemini-2.5-pro')).toBe(true)
  expect(isGeminiModelName('google/gemini-2.5-pro')).toBe(true)
  expect(isGeminiModelName('not-gemini')).toBe(false)
  expect(shouldPreserveGeminiThoughtSignature(undefined)).toBe(false)
  expect(shouldPreserveGeminiThoughtSignature('gemini-2.5-pro')).toBe(true)
})

test('reads and merges Gemini thought signatures without dropping metadata', () => {
  const extra = { google: { thought_signature: 'signature', other: true }, keep: 1 }
  expect(geminiThoughtSignatureFromExtraContent(extra)).toBe('signature')
  expect(geminiThoughtSignatureFromExtraContent({ google: {} })).toBeUndefined()
  expect(mergeGeminiThoughtSignature(extra, 'replacement')).toEqual({
    google: { thought_signature: 'replacement', other: true },
    keep: 1,
  })
  expect(mergeGeminiThoughtSignature(extra, undefined)).toBe(extra)
})

test('the façade replays Gemini signatures in follow-up tool calls', async () => {
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return completionResponse({
      id: 'chatcmpl-1',
      model: bodies.length === 1
        ? 'google/gemini-3.1-pro-preview'
        : 'google/gemini-3.1-flash-lite',
      content: 'done',
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    })
  }) as unknown as typeof globalThis.fetch
  const client = createOpenAIShimClient({}) as unknown as ShimClient

  await client.beta.messages.create({
    model: 'google/gemini-3.1-pro-preview',
    system: 'test system',
    messages: [
      { role: 'user', content: 'Use Bash' },
      {
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: 'I should inspect the working tree first.',
        }, {
          type: 'tool_use',
          id: 'call_1',
          name: 'Bash',
          input: { command: 'pwd' },
          extra_content: { google: { thought_signature: 'sig-123' } },
        }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'D:\\repo' }] },
    ],
    max_tokens: 64,
    stream: false,
  })

  process.env.OPENAI_BASE_URL = 'https://api.example.test/v1'
  await client.beta.messages.create({
    model: 'google/gemini-3.1-flash-lite',
    messages: [
      { role: 'user', content: 'Use Write' },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_1',
          name: 'Write',
          input: { file_path: 'todo.md', content: 'todo' },
          signature: 'sig-opengateway',
        }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'created' }] },
    ],
    max_tokens: 64,
    stream: false,
  })

  const firstMessages = bodies[0]?.messages as Array<Record<string, unknown>>
  const firstAssistant = firstMessages.find(message => Array.isArray(message.tool_calls)) as {
    tool_calls?: Array<Record<string, unknown>>
  }
  expect(firstAssistant.tool_calls?.[0]).toMatchObject({
    id: 'call_1',
    type: 'function',
    function: { name: 'Bash', arguments: JSON.stringify({ command: 'pwd' }) },
    extra_content: { google: { thought_signature: 'sig-123' } },
  })

  const secondMessages = bodies[1]?.messages as Array<Record<string, unknown>>
  const secondAssistant = secondMessages.find(message => Array.isArray(message.tool_calls)) as {
    tool_calls?: Array<Record<string, unknown>>
  }
  expect(secondAssistant.tool_calls?.[0]).toMatchObject({
    id: 'call_1',
    extra_content: { google: { thought_signature: 'sig-opengateway' } },
  })
})

test('the façade preserves Gemini signatures from streaming tool and delta metadata', async () => {
  const signatures = [
    {
      location: 'tool',
      value: 'sig-stream',
      model: 'google/gemini-3.1-pro-preview',
      toolName: 'Bash',
      arguments: '{"command":"pwd"}',
      userText: 'Use Bash',
      system: 'test system',
    },
    {
      location: 'delta',
      value: 'sig-delta',
      model: 'google/gemini-3.1-flash-lite',
      toolName: 'Write',
      arguments: '{"file_path":"todo.md","content":"todo"}',
      userText: 'Use Write',
      system: undefined,
    },
  ] as const

  for (const { location, value, model, toolName, arguments: toolArguments, userText, system } of signatures) {
    globalThis.fetch = (async () => sseResponse([
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            ...(location === 'delta'
              ? { extra_content: { google: { thought_signature: value } } }
              : {}),
            tool_calls: [{
              index: 0,
              id: 'function-call-1',
              type: 'function',
              ...(location === 'tool'
                ? { extra_content: { google: { thought_signature: value } } }
                : {}),
              function: { name: toolName, arguments: toolArguments },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
    ])) as unknown as typeof globalThis.fetch

    const client = createOpenAIShimClient({}) as unknown as ShimClient
    const result = await client.beta.messages.create({
      model,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: userText }],
      max_tokens: 64,
      stream: true,
    }).withResponse()
    const events: Array<Record<string, unknown>> = []
    for await (const event of result.data) events.push(event)
    const toolStart = events.find(event => event.type === 'content_block_start') as {
      content_block?: Record<string, unknown>
    }

    expect(toolStart.content_block).toMatchObject({
      type: 'tool_use',
      id: 'function-call-1',
      name: toolName,
      extra_content: { google: { thought_signature: value } },
      ...(location === 'delta' ? { signature: value } : {}),
    })
  }
})

test('the façade preserves Gemini signatures from non-streaming message metadata', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: 'chatcmpl-1',
    model: 'google/gemini-3.1-flash-lite',
    choices: [{
      message: {
        role: 'assistant',
        extra_content: { google: { thought_signature: 'sig-message' } },
        tool_calls: [{
          id: 'function-call-1',
          type: 'function',
          function: { name: 'Write', arguments: '{"file_path":"todo.md","content":"todo"}' },
        }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  }), { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof globalThis.fetch
  const client = createOpenAIShimClient({}) as unknown as ShimClient

  const message = await client.beta.messages.create({
    model: 'google/gemini-3.1-flash-lite',
    messages: [{ role: 'user', content: 'Use Write' }],
    max_tokens: 64,
    stream: false,
  }) as { content?: Array<Record<string, unknown>> }

  expect(message.content?.[0]).toMatchObject({
    type: 'tool_use',
    id: 'function-call-1',
    name: 'Write',
    extra_content: { google: { thought_signature: 'sig-message' } },
    signature: 'sig-message',
  })
})
