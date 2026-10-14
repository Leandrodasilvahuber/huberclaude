import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'
import {
  __getInterruptionTraceSnapshotForTests,
  __resetInterruptionTraceForTests,
} from '../../../utils/interruptionTrace.js'
import type { AnthropicStreamEvent } from './types.js'
import { openaiStreamToAnthropic } from './responseAdapters.js'

const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE
const originalIdleTimeout = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS

beforeAll(async () => {
  await acquireSharedMutationLock('providerStreamInterruptionTrace.test.ts')
  process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
})

afterEach(() => {
  if (originalIdleTimeout === undefined) {
    delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS
  } else {
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = originalIdleTimeout
  }
})

afterAll(() => {
  __resetInterruptionTraceForTests()
  if (originalTrace === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
  if (originalIdleTimeout === undefined) {
    delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS
  } else {
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = originalIdleTimeout
  }
  releaseSharedMutationLock()
})

function responseFromText(text: string): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function openResponseFromText(
  text: string,
  onCancel?: () => void,
): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text))
      },
      cancel() {
        onCancel?.()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

async function collect(
  stream: AsyncIterable<AnthropicStreamEvent>,
): Promise<AnthropicStreamEvent[]> {
  const events: AnthropicStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

test('all non-Codex readers distinguish raw, parsed, control, and ignored frames', async () => {
  const cases = [
    {
      transport: 'openai_chat_completions',
      text: [
        ': keepalive',
        'data: not-json',
        'data: []',
        'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}',
        'data: [DONE]',
        '',
      ].join('\n'),
      expected: { parsed: 1, control: 2, ignored: 2 },
      stream: (text: string) =>
        openaiStreamToAnthropic(responseFromText(text), 'test-model'),
    },
  ]

  for (const scenario of cases) {
    __resetInterruptionTraceForTests()
    await collect(scenario.stream(scenario.text))

    const closed = __getInterruptionTraceSnapshotForTests().find(
      entry =>
        entry.event === 'provider_stream.reader_closed' &&
        entry.transport === scenario.transport,
    )
    expect(closed).toMatchObject({
      outcome: 'complete',
      rawByteCount: new TextEncoder().encode(scenario.text).byteLength,
      parsedFrameCount: scenario.expected.parsed,
      controlFrameCount: scenario.expected.control,
      ignoredFrameCount: scenario.expected.ignored,
    })
  }
})

for (const traceEnabled of [false, true]) {
  test(`OpenAI-compatible null payloads fail with tracing ${traceEnabled ? 'enabled' : 'disabled'}`, async () => {
    const previousTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE
    try {
      if (traceEnabled) process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
      else delete process.env.OPENCLAUDE_INTERRUPT_TRACE

      const cases = [
        {
          transport: 'openai_chat_completions',
          stream: () =>
            openaiStreamToAnthropic(
              responseFromText('data: null\n\ndata: [DONE]\n\n'),
              'test-model',
            ),
        },
      ]

      for (const scenario of cases) {
        __resetInterruptionTraceForTests()
        await expect(collect(scenario.stream())).rejects.toBeInstanceOf(TypeError)
        const snapshot = __getInterruptionTraceSnapshotForTests()
        if (!traceEnabled) {
          expect(snapshot).toEqual([])
          continue
        }
        expect(
          snapshot.find(
            entry =>
              entry.event === 'provider_stream.reader_closed' &&
              entry.transport === scenario.transport,
          ),
        ).toMatchObject({
          outcome: 'failed',
          ignoredFrameCount: 1,
        })
      }
    } finally {
      __resetInterruptionTraceForTests()
      if (previousTrace === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE
      else process.env.OPENCLAUDE_INTERRUPT_TRACE = previousTrace
    }
  })
}

test('all non-Codex readers report a failure after terminal evidence then timeout', async () => {
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '20'
  const cases = [
    {
      transport: 'openai_chat_completions',
      stream: () =>
        openaiStreamToAnthropic(
          openResponseFromText(
            'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n',
          ),
          'test-model',
        ),
    },
  ]

  for (const scenario of cases) {
    __resetInterruptionTraceForTests()
    await expect(collect(scenario.stream())).rejects.toBeDefined()
    const closed = __getInterruptionTraceSnapshotForTests().find(
      entry =>
        entry.event === 'provider_stream.reader_closed' &&
        entry.transport === scenario.transport,
    )
    expect(closed?.outcome).toBe('failed')
  }
})

test('all non-Codex readers distinguish transport EOF from protocol completion', async () => {
  const cases = [
    {
      transport: 'openai_chat_completions',
      stream: () =>
        openaiStreamToAnthropic(
          responseFromText(
            'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n',
          ),
          'test-model',
        ),
    },
  ]

  for (const scenario of cases) {
    __resetInterruptionTraceForTests()
    await collect(scenario.stream())

    const closed = __getInterruptionTraceSnapshotForTests().find(
      entry =>
        entry.event === 'provider_stream.reader_closed' &&
        entry.transport === scenario.transport,
    )
    expect(closed?.outcome).toBe('eof_without_terminal')
  }
})

test('all non-Codex reader idle errors carry the provider timeout causal event', async () => {
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '20'
  const cases = [
    {
      transport: 'openai_chat_completions',
      stream: (response: Response) =>
        openaiStreamToAnthropic(response, 'test-model'),
    },
  ]

  for (const scenario of cases) {
    __resetInterruptionTraceForTests()
    const response = new Response(new ReadableStream<Uint8Array>())
    let caught: unknown
    try {
      await collect(scenario.stream(response))
    } catch (error) {
      caught = error
    }

    const idleTimeout = __getInterruptionTraceSnapshotForTests().find(
      entry =>
        entry.event === 'provider_stream.idle_timeout' &&
        entry.transport === scenario.transport,
    )
    const readerClosed = __getInterruptionTraceSnapshotForTests().find(
      entry =>
        entry.event === 'provider_stream.reader_closed' &&
        entry.transport === scenario.transport,
    )
    expect(caught).toBeDefined()
    expect(idleTimeout).toBeDefined()
    expect(readerClosed?.causalEventId).toBe(idleTimeout?.eventId)
  }
})
