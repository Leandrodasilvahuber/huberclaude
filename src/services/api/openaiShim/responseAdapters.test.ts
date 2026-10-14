import { expect, test } from 'bun:test'
import type { AnthropicStreamEvent } from './types.js'
import {
  openaiStreamToAnthropic,
  parseTextToolCalls,
  parseXmlToolCalls,
} from './responseAdapters.js'

function makeSseResponse(frames: unknown[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          const data = frame === '[DONE]' ? frame : JSON.stringify(frame)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

async function collectStreamEvents(
  generator: AsyncGenerator<AnthropicStreamEvent>,
): Promise<AnthropicStreamEvent[]> {
  const events: AnthropicStreamEvent[] = []
  for await (const event of generator) events.push(event)
  return events
}

test('raw-text and XML fallback tool calls use one unique sequence', () => {
  const text = parseTextToolCalls('{"name":"from_text","arguments":{}}')
  const xml = parseXmlToolCalls(
    '<tool_call>{"name":"from_xml","arguments":{}}</tool_call>',
  )

  expect(text.calls[0]?.id).toMatch(/^ollama_tc_\d+$/)
  expect(xml.calls[0]?.id).toMatch(/^xml_tc_\d+$/)
  const textSequence = Number(text.calls[0]?.id?.replace(/^\D+/, ''))
  const xmlSequence = Number(xml.calls[0]?.id?.replace(/^\D+/, ''))
  expect(xmlSequence).toBe(textSequence + 1)
})

test('openaiStreamToAnthropic wrapper emits text, usage, and terminal stop', async () => {
  const events = await collectStreamEvents(openaiStreamToAnthropic(
    makeSseResponse([
      {
        choices: [{
          index: 0,
          delta: { content: 'hello' },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      },
      '[DONE]',
    ]),
    'test-model',
  ))

  expect(events.map(event => event.type)).toContain('message_start')
  expect(events).toContainEqual({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'hello' },
  })
  expect(events.at(-2)).toMatchObject({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: {
      input_tokens: 7,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  })
  expect(events.at(-1)).toEqual({ type: 'message_stop' })
})
