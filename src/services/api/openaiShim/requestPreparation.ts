import {
  resolveModelReasoningControl,
  resolveOpenAIShimReasoningRequestPlan,
} from '../../../utils/effort.js'
import {
  resolveModelRuntimeLimits,
  resolveOpenAIShimRuntimeContext,
} from '../../../integrations/runtimeMetadata.js'
import { compressToolHistory } from '../compressToolHistory.js'
import type { ResolvedProviderRequest } from '../providerConfig.js'
import { stableStringifyJson } from '../../../utils/stableStringify.js'
import type { ShimCreateParams } from './types.js'

type RawMessage = {
  role: string
  message?: { role?: string; content?: unknown }
  content?: unknown
}

type Dependencies = {
  convertMessages(
    messages: RawMessage[],
    system: unknown,
    options: {
      preserveReasoningContent?: boolean
      reasoningContentFallback?: '' | 'omit'
      preserveGeminiThoughtSignature?: boolean
      supportsImageInputs?: boolean
    },
  ): unknown
  convertTools(
    tools: Array<{
      name: string
      description?: string
      input_schema?: Record<string, unknown>
    }>,
  ): unknown[]
  shouldPreserveGeminiThoughtSignature(model: string | undefined): boolean
}

export function prepareOpenAIRequest({
  request,
  params,
  requestProcessEnv,
  providerOverride,
  dependencies,
}: {
  request: ResolvedProviderRequest
  params: ShimCreateParams
  requestProcessEnv: NodeJS.ProcessEnv
  providerOverride?: { model: string; baseURL: string; apiKey: string }
  dependencies: Dependencies
}) {
  const {
    convertMessages,
    convertTools,
    shouldPreserveGeminiThoughtSignature,
  } = dependencies
  const rawMessages = params.messages as RawMessage[]
  const runtimeModel = request.requestedModel
  const runtimeShimContext = resolveOpenAIShimRuntimeContext({
    processEnv: requestProcessEnv,
    baseUrl: request.baseUrl,
    model: runtimeModel,
    preferBaseUrlRoute: Boolean(providerOverride),
  })
  const runtimeLimits = resolveModelRuntimeLimits({
    model: runtimeModel,
    baseUrl: request.baseUrl,
    processEnv: requestProcessEnv,
    resolvedRouteId: runtimeShimContext.routeId,
  })
  const shimConfig = runtimeShimContext.openaiShimConfig

  const compressedMessages = compressToolHistory(rawMessages, runtimeModel, {
    textBlockSeparator: '\n\n',
    runtimeLimits,
  })
  const openaiMessages = convertMessages(compressedMessages, params.system, {
    preserveReasoningContent: shimConfig.preserveReasoningContent,
    reasoningContentFallback: shimConfig.reasoningContentFallback,
    preserveGeminiThoughtSignature: shouldPreserveGeminiThoughtSignature(
      request.resolvedModel,
    ),
    supportsImageInputs: shimConfig.supportsImageInputs,
  })

  const reasoningControl = resolveModelReasoningControl(runtimeModel, {
    routeId: runtimeShimContext.routeId,
    useRuntimeFallback: false,
    openaiShimConfig: shimConfig,
    baseUrl: request.baseUrl,
    processEnv: requestProcessEnv,
  })
  const reasoningRequestPlan = resolveOpenAIShimReasoningRequestPlan({
    model: runtimeModel,
    requestedEffort: request.reasoning?.effort,
    requestThinkingType:
      (params.thinking as { type?: string } | undefined)?.type,
    defaultThinkingType: request.thinking?.type,
    thinkingRequestFormat: shimConfig.thinkingRequestFormat,
    routeId: runtimeShimContext.routeId ?? 'custom',
    useRuntimeFallback: false,
    reasoningControl,
  })

  const body: Record<string, unknown> = {
    model: request.resolvedModel,
    messages: openaiMessages,
    stream: params.stream ?? false,
    store: false,
  }
  if (
    reasoningRequestPlan.wireFormat === 'reasoning_effort' &&
    reasoningRequestPlan.reasoningEffort
  ) body.reasoning_effort = reasoningRequestPlan.reasoningEffort
  if (
    reasoningRequestPlan.wireFormat === 'reasoning_effort' &&
    reasoningRequestPlan.thinkingType === 'disabled'
  ) {
    body.thinking = { type: 'disabled' }
    delete body.reasoning_effort
  }

  const maxTokensValue =
    typeof params.max_tokens === 'number' && params.max_tokens > 0
      ? params.max_tokens
      : undefined
  const maxCompletionTokensValue =
    typeof (params as Record<string, unknown>).max_completion_tokens === 'number'
      ? (params as Record<string, unknown>).max_completion_tokens as number
      : undefined
  if (maxTokensValue !== undefined) body.max_completion_tokens = maxTokensValue
  else if (maxCompletionTokensValue !== undefined) {
    body.max_completion_tokens = maxCompletionTokensValue
  }
  if (params.stream) {
    body.stream_options = { include_usage: true }
  }

  if (
    shimConfig.maxTokensField === 'max_tokens' &&
    body.max_completion_tokens !== undefined
  ) {
    body.max_tokens = body.max_completion_tokens
    delete body.max_completion_tokens
  }
  for (const field of shimConfig.removeBodyFields ?? []) delete body[field]
  if (params.temperature !== undefined) body.temperature = params.temperature
  if (params.top_p !== undefined) body.top_p = params.top_p

  if (
    !(shimConfig.removeBodyFields ?? []).includes('tools') &&
    params.tools?.length
  ) {
    const converted = convertTools(params.tools as Array<{
      name: string
      description?: string
      input_schema?: Record<string, unknown>
    }>)
    if (converted.length > 0) {
      body.tools = converted
      if (params.stream && shimConfig.enableToolStreaming === true) {
        body.tool_stream = true
      }
      const toolChoice = params.tool_choice as {
        type?: string
        name?: string
      } | undefined
      if (toolChoice?.type === 'auto') body.tool_choice = 'auto'
      else if (toolChoice?.type === 'tool' && toolChoice.name) {
        body.tool_choice = {
          type: 'function',
          function: { name: toolChoice.name },
        }
      } else if (toolChoice?.type === 'any') body.tool_choice = 'required'
      else if (toolChoice?.type === 'none') body.tool_choice = 'none'
    }
  }

  // Byte-identical serialization (sorted keys) keeps implicit prefix caching
  // stable across rebuilds of `body`.
  const serializeBody = (): string => stableStringifyJson(body)

  return {
    runtimeShimContext,
    shimConfig,
    body,
    serializeBody,
  }
}
