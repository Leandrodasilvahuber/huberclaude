import type Anthropic from '@anthropic-ai/sdk'
import {
  convertEffortValueToLevel,
  type EffortValue,
  resolveAppliedEffort,
  resolveModelReasoningControl,
  modelSupportsShimReasoningEffort,
  modelSupportsWireEffort,
  standardEffortToOpenAI,
  type OpenAIShimEffortLevel,
} from 'src/utils/effort.js'
import { getUserAgent } from 'src/utils/http.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { getSessionId } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { resolveOpenAIShimRuntimeContext } from '../../integrations/runtimeMetadata.js'
import type { ProviderOverride } from './authRouting.js'
import { getApiTimeoutMs } from './openaiShim/transport.js'

/**
 * HuberClaude only talks to OpenRouter, through the OpenAI-compatible shim.
 * The shim reads OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL, which
 * applyOpenRouterConfigToEnv() points at OpenRouter.
 */
export async function getAnthropicClient({
  maxRetries,
  model,
  providerOverride,
  effortValue,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: unknown
  source?: string
  providerOverride?: ProviderOverride
  effortValue?: EffortValue
}): Promise<Anthropic> {
  // Convert the runtime effort value to the OpenAI-shaped enum the shim
  // expects. Undefined → shim falls back to descriptor/alias defaults.
  const effortProcessEnv = providerOverride
    ? { ...process.env, OPENAI_AZURE_STYLE: undefined }
    : process.env
  const effortModel = providerOverride?.model ?? model
  const effortBaseUrl =
    providerOverride?.baseURL ??
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE
  const effortRuntimeContext = effortModel
    ? resolveOpenAIShimRuntimeContext({
      processEnv: effortProcessEnv,
      baseUrl: effortBaseUrl,
      model: effortModel,
      preferBaseUrlRoute:
        providerOverride !== undefined || isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI),
    })
    : undefined
  const effortShimConfig = effortRuntimeContext?.openaiShimConfig
  const effortContext = effortRuntimeContext
      ? {
        routeId: effortRuntimeContext.routeId ?? 'custom',
        useRuntimeFallback: false,
        openaiShimConfig: effortShimConfig,
        baseUrl: effortBaseUrl,
        processEnv: effortProcessEnv,
        // Per-agent overrides always use the OpenAI-compatible shim, regardless
        // of the parent session's provider.
        apiProvider: providerOverride ? 'openai' as const : getAPIProvider(),
      }
    : undefined
  const supportsShimReasoningEffort = effortModel
    ? effortShimConfig
      ? modelSupportsShimReasoningEffort(
        effortModel,
        effortShimConfig.thinkingRequestFormat,
        effortShimConfig.removeBodyFields,
        effortContext,
      )
      : modelSupportsWireEffort(effortModel, effortContext)
    : false
  const reasoningControl = effortModel
    ? resolveModelReasoningControl(effortModel, effortContext)
    : undefined
  const k3ReasoningControl =
    reasoningControl?.source === 'metadata' &&
    reasoningControl.wireFormat === 'reasoning_effort' &&
    reasoningControl.levels.length === 3 &&
    reasoningControl.levels.includes('low') &&
    reasoningControl.levels.includes('high') &&
    reasoningControl.levels.includes('max')
  const appliedEffort = effortModel && effortValue !== undefined
    ? resolveAppliedEffort(
      effortModel,
      effortValue,
      effortContext,
    )
    : undefined
  const appliedEffortLevel = appliedEffort === undefined
    ? undefined
    : convertEffortValueToLevel(appliedEffort)
  const shimReasoningEffort: OpenAIShimEffortLevel | undefined =
    appliedEffortLevel !== undefined && supportsShimReasoningEffort
      ? (reasoningControl?.source === 'metadata' &&
          reasoningControl.wireFormat === 'reasoning_effort' &&
          appliedEffortLevel === 'max' &&
          k3ReasoningControl
            ? 'max'
          : standardEffortToOpenAI(appliedEffortLevel))
      : undefined
  const containerId = process.env.CLAUDE_CODE_CONTAINER_ID
  const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-claude-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-claude-remote-session-id': remoteSessionId }
      : {}),
    // SDK consumers can identify their app/library for backend analytics
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  logForDebugging(
    `[API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: ${!!process.env.ANTHROPIC_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders['Authorization']}`,
  )

  // Per-agent overrides carry their own credentials; never forward auth
  // headers from the parent session to them.
  let headers = defaultHeaders
  if (providerOverride) {
    headers = {}
    for (const [k, v] of Object.entries(defaultHeaders)) {
      const lower = k.toLowerCase()
      if (lower === 'authorization' || lower === 'x-api-key' || lower === 'api-key') continue
      headers[k] = v
    }
  }

  const { createOpenAIShimClient } = await import('./openaiShim.js')
  return createOpenAIShimClient({
    defaultHeaders: headers,
    maxRetries,
    timeout: getApiTimeoutMs(),
    ...(providerOverride ? { providerOverride } : {}),
    reasoningEffort: shimReasoningEffort,
  }) as unknown as Anthropic
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Reject raw CR characters — these indicate a header value containing \r\n
  // that would be split into an injected header entry after splitting.
  if (customHeadersEnv.includes('\r')) return customHeaders

  // Split by newlines to support multiple headers (intentional \n delimiters)
  for (const headerString of customHeadersEnv.split('\n')) {
    if (!headerString.trim()) continue
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    const lowerName = name.toLowerCase()
    if (
      name &&
      lowerName !== 'authorization' &&
      lowerName !== 'x-api-key' &&
      lowerName !== 'api-key'
    ) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
