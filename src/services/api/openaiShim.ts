/**
 * OpenAI-compatible API shim for HuberClaude.
 *
 * Translates Anthropic SDK calls (anthropic.beta.messages.create) into
 * OpenAI-compatible chat completion requests (sent to OpenRouter) and streams
 * back events in the Anthropic streaming format so the rest of the codebase
 * is unaware.
 *
 * Environment variables (set by applyOpenRouterConfigToEnv):
 *   CLAUDE_CODE_USE_OPENAI=1          — enable this provider
 *   OPENAI_API_KEY=sk-or-...          — OpenRouter API key
 *   OPENAI_BASE_URL=https://openrouter.ai/api/v1
 *   OPENAI_MODEL=...                  — default model
 *
 * Smart auto-routing (opt-in; startup defaults, overridden by settings.smartRouting):
 *   OPENCLAUDE_SMART_ROUTING=1|true   — route simple turns to a cheaper model
 *   OPENCLAUDE_SMART_ROUTING_SIMPLE=<key> — agentModels key or model id for simple turns
 *   OPENCLAUDE_SMART_ROUTING_STRONG=<key> — agentModels key or model id for strong turns
 */

import { logForDebugging } from '../../utils/debug.js'
import { createStreamAbortError, getStreamIdleTimeoutMs, readWithIdleTimeout, StreamIdleTimeoutError } from './openaiShim/streamControl.js'
export { getStreamIdleTimeoutMs } from './openaiShim/streamControl.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { type OpenAIShimEffortLevel } from '../../utils/effort.js'
import { prepareOpenAIRequest } from './openaiShim/requestPreparation.js'
import {
  convertNonStreamingResponseToAnthropicMessage,
  makeMessageId,
  openaiStreamToAnthropic as convertOpenAIResponseStream,
} from './openaiShim/responseAdapters.js'
export { parseTextToolCalls, parseXmlToolCalls } from './openaiShim/responseAdapters.js'
export { getApiTimeoutMs } from './openaiShim/transport.js'
import { executeOpenAIRequest, requestBodyContainsImages } from './openaiShim/requestExecutor.js'
import { resolveProviderRequest } from './providerConfig.js'
import {
  filterAnthropicHeaders,
  geminiThoughtSignatureFromExtraContent,
  mergeGeminiThoughtSignature,
  shouldPreserveGeminiThoughtSignature,
} from './openaiShim/providerCompatibility.js'
import {
  convertMessages as convertAnthropicMessages,
  convertSystemPrompt as convertSystemPromptImpl,
} from './openaiShim/messageConversion.js'
import {
  convertTools as convertToolsModule,
  normalizeSchemaForOpenAI as normalizeSchemaForOpenAIModule,
} from './openaiShim/toolConversion.js'
import { createShimRequest, headersWithRequestUrl } from './openaiShim/clientDispatch.js'
import { getApiTimeoutMs } from './openaiShim/transport.js'
import { CredentialPool, parseCredentialList } from './credentialPool.js'
import type { NonStreamingOpenAIResponse } from './openaiShim/responseConversion.js'
import type { ShimCreateParams } from './openaiShim/types.js'

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIContentPart[]
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
    extra_content?: Record<string, unknown>
  }>
  tool_call_id?: string
  name?: string
  /**
   * Per-assistant-message chain-of-thought, attached when echoing an
   * assistant message back to providers that require it (notably Moonshot:
   * "thinking is enabled but reasoning_content is missing in assistant
   * tool call message at index N" 400). Derived from the Anthropic thinking
   * block captured when the original response was translated.
   */
  reasoning_content?: string
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

function convertSystemPrompt(system: unknown): string {
  return convertSystemPromptImpl(system)
}

function convertMessages(
  messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
  system: unknown,
  options?: {
    preserveReasoningContent?: boolean
    reasoningContentFallback?: '' | 'omit'
    preserveGeminiThoughtSignature?: boolean
    supportsImageInputs?: boolean
  },
): OpenAIMessage[] {
  return convertAnthropicMessages(messages, system, {
    ...options,
    getGeminiThoughtSignature: geminiThoughtSignatureFromExtraContent,
    mergeGeminiThoughtSignature,
    log: message => logForDebugging(message),
  })
}

/**
 * OpenAI requires every key in `properties` to also appear in `required`.
 * Anthropic schemas often mark fields as optional (omitted from `required`),
 * which causes 400 errors. This normalizes the schema by ensuring `required`
 * is a superset of `properties` keys.
 */
function normalizeSchemaForOpenAI(
  schema: Record<string, unknown>,
  strict = true,
): Record<string, unknown> {
  return normalizeSchemaForOpenAIModule(schema, strict)
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
): OpenAITool[] {
  return convertToolsModule(tools, {
    disableStrictTools: isEnvTruthy(process.env.OPENCLAUDE_DISABLE_STRICT_TOOLS),
    normalizeSchema: normalizeSchemaForOpenAI,
  })
}

async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
  signal?: AbortSignal,
  requestUrl?: string,
) {
  yield* convertOpenAIResponseStream(
    response,
    model,
    signal,
    requestUrl,
    headersWithRequestUrl,
  )
}

class OpenAIShimMessages {
  private defaultHeaders: Record<string, string>
  private reasoningEffort?: OpenAIShimEffortLevel
  private providerOverride?: { model: string; baseURL: string; apiKey: string }
  private credentialPool?: CredentialPool
  private credentialPoolRaw?: string

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: OpenAIShimEffortLevel, providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.defaultHeaders = filterAnthropicHeaders(defaultHeaders)
    this.reasoningEffort = reasoningEffort
    this.providerOverride = providerOverride
  }

  private getCredentialPool(raw: string): CredentialPool | null {
    const credentials = parseCredentialList(raw)
    if (credentials.length === 0) {
      this.credentialPool = undefined
      this.credentialPoolRaw = undefined
      return null
    }

    if (!this.credentialPool || this.credentialPoolRaw !== raw) {
      this.credentialPool = new CredentialPool(credentials)
      this.credentialPoolRaw = raw
    }

    return this.credentialPool
  }

  create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    return createShimRequest(params, options, {
      providerOverride: this.providerOverride,
      reasoningEffort: this.reasoningEffort,
      processEnv: process.env,
      doRequest: this._doRequest.bind(this),
      convertNonStreamingResponse: (data, model) =>
        convertNonStreamingResponseToAnthropicMessage(
          data as NonStreamingOpenAIResponse,
          model,
        ),
      createStreamAbortError,
      openaiStreamToAnthropic,
      makeMessageId,
    })
  }

  private async _doRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
    requestProcessEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<Response> {
    const { runtimeShimContext, shimConfig, body, serializeBody } =
      prepareOpenAIRequest({
        request,
        params,
        requestProcessEnv,
        providerOverride: this.providerOverride,
        dependencies: {
          convertMessages,
          convertTools,
          shouldPreserveGeminiThoughtSignature,
        },
      })

    return executeOpenAIRequest({
      defaultHeaders: this.defaultHeaders,
      providerOverride: this.providerOverride,
      getCredentialPool: value => this.getCredentialPool(value),
      request,
      params,
      options,
      requestProcessEnv,
      shimConfig,
      runtimeShimContext,
      body,
      serializeBody,
    })
  }
}

class OpenAIShimBeta {
  messages: OpenAIShimMessages
  reasoningEffort?: OpenAIShimEffortLevel

  constructor(defaultHeaders: Record<string, string>, reasoningEffort?: OpenAIShimEffortLevel, providerOverride?: { model: string; baseURL: string; apiKey: string }) {
    this.messages = new OpenAIShimMessages(defaultHeaders, reasoningEffort, providerOverride)
    this.reasoningEffort = reasoningEffort
  }
}

export function createOpenAIShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
  reasoningEffort?: OpenAIShimEffortLevel
  providerOverride?: { model: string; baseURL: string; apiKey: string }
}): unknown {
  const beta = new OpenAIShimBeta({
    ...(options.defaultHeaders ?? {}),
  }, options.reasoningEffort, options.providerOverride)

  return {
    beta,
    messages: beta.messages,
  }
}

// Test-only surface (same pattern as WebSearchTool's __test export).
export const __test = {
  convertMessages,
  convertSystemPrompt,
  getApiTimeoutMs,
  requestBodyContainsImages,
  getStreamIdleTimeoutMs,
  readWithIdleTimeout,
  StreamIdleTimeoutError,
}
