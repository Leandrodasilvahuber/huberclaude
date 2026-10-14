import { expect, test } from 'bun:test'
import { ensureIntegrationsLoaded } from '../../../integrations/index.js'
import { resolveProviderRequest } from '../providerConfig.js'
import { prepareOpenAIRequest } from './requestPreparation.js'

const convertedTools = [{
  type: 'function',
  function: {
    name: 'Read',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} },
  },
}]

const dependencies = {
  convertMessages: (
    messages: Array<{ role: string; content?: unknown }>,
    system: unknown,
  ) => [
    ...(system ? [{ role: 'system', content: String(system) }] : []),
    ...messages,
  ],
  convertTools: () => convertedTools,
  shouldPreserveGeminiThoughtSignature: () => false,
}

test('prepares a chat-completions request body for OpenRouter', async () => {
  await ensureIntegrationsLoaded()
  const processEnv = {
    OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENAI_API_KEY: 'test-key',
  }
  const request = resolveProviderRequest({
    model: 'openai/gpt-5-mini',
    processEnv,
  })
  const prepared = prepareOpenAIRequest({
    request,
    requestProcessEnv: processEnv,
    params: {
      model: 'openai/gpt-5-mini',
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 64,
      temperature: 0.2,
      stream: false,
    },
    dependencies,
  })

  expect(prepared.body).toMatchObject({
    model: 'openai/gpt-5-mini',
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ],
    max_completion_tokens: 64,
    temperature: 0.2,
    stream: false,
    store: false,
  })
  expect(prepared.body).not.toHaveProperty('stream_options')
})

test('prepares tools and streaming usage options', async () => {
  await ensureIntegrationsLoaded()
  const processEnv = {
    OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENAI_API_KEY: 'test-key',
  }
  const request = resolveProviderRequest({ model: 'openai/gpt-5-mini', processEnv })
  const prepared = prepareOpenAIRequest({
    request,
    requestProcessEnv: processEnv,
    params: {
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        name: 'Read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: {} },
      }],
      tool_choice: { type: 'tool', name: 'Read' },
      max_tokens: 64,
      stream: true,
    },
    dependencies,
  })

  expect(prepared.body.stream_options).toEqual({ include_usage: true })
  expect(prepared.body.tools).toEqual(convertedTools)
  expect(prepared.body.tool_choice).toEqual({
    type: 'function',
    function: { name: 'Read' },
  })
  expect(JSON.parse(prepared.serializeBody()).stream_options).toEqual({
    include_usage: true,
  })
})
