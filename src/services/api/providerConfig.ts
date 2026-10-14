import { logForDebugging } from '../../utils/debug.js'
import { getCatalogEntriesForRoute } from '../../integrations/registry.js'
import { resolveOpenAIShimRuntimeContext } from '../../integrations/runtimeMetadata.js'
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from '../../utils/openclaudeConfig.js'

/**
 * HuberClaude talks to OpenRouter only, through the OpenAI-compatible
 * chat-completions API. The shim reads OPENAI_BASE_URL / OPENAI_MODEL, which
 * applyOpenRouterConfigToEnv() points at OpenRouter.
 */

const warnedUndefinedEnvNames = new Set<string>()

export type OpenAICompatibleApiFormat = 'chat_completions'
type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ThinkingType = 'enabled' | 'disabled'

export type ResolvedProviderRequest = {
  requestedModel: string
  resolvedModel: string
  baseUrl: string
  reasoning?: {
    effort: ReasoningEffort
  }
  thinking?: {
    type: ThinkingType
  }
}

type ModelDescriptor = {
  baseModel: string
  reasoning?: {
    effort: ReasoningEffort
  }
  thinking?: {
    type: ThinkingType
  }
}

// Reads an env-var-style string intended as a URL, rejecting both empty
// strings and the literal "undefined"/"null" that Windows shells can write
// when a variable is unset-then-referenced without quotes (issue #336).
function asEnvUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const normalized = trimmed.toLowerCase()
  if (normalized === 'undefined' || normalized === 'null') {
    return undefined
  }
  return trimmed
}

function asNamedEnvUrl(
  value: string | undefined,
  envName: string,
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const normalized = trimmed.toLowerCase()
  if (normalized === 'undefined' || normalized === 'null') {
    if (!warnedUndefinedEnvNames.has(envName)) {
      warnedUndefinedEnvNames.add(envName)
      logForDebugging(
        `[provider-config] Environment variable ${envName} is the literal string "${trimmed}"; ignoring it.`,
        { level: 'warn' },
      )
    }
    return undefined
  }

  return trimmed
}

function normalizeModelLookupKey(model: string): string {
  return model.trim().split('?', 1)[0]?.trim().toLowerCase() ?? ''
}

function resolveRouteCatalogAliasApiName(options: {
  model: string
  baseUrl: string | undefined
  processEnv: NodeJS.ProcessEnv
}): string {
  const normalizedModel = normalizeModelLookupKey(options.model)
  if (!normalizedModel) return options.model

  const routeId = resolveOpenAIShimRuntimeContext({
    processEnv: options.processEnv,
    baseUrl: options.baseUrl,
    model: options.model,
    preferBaseUrlRoute: options.baseUrl !== undefined,
  }).routeId
  if (!routeId || routeId === 'anthropic' || routeId === 'openai') {
    return options.model
  }

  const entry = getCatalogEntriesForRoute(routeId).find(catalogEntry =>
    normalizeModelLookupKey(catalogEntry.apiName) === normalizedModel ||
    normalizeModelLookupKey(catalogEntry.id) === normalizedModel ||
    (catalogEntry.aliases ?? []).some(
      alias => normalizeModelLookupKey(alias) === normalizedModel,
    ),
  )
  return entry?.apiName ?? options.model
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh' || normalized === 'max') {
    return normalized
  }
  return undefined
}

function parseThinkingType(value: string | undefined): ThinkingType | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  return normalized === 'enabled' || normalized === 'disabled'
    ? normalized
    : undefined
}

function parseModelDescriptor(model: string): ModelDescriptor {
  // A trailing [1m] suffix is the client-side 1M-context opt-in (see
  // has1mContext) — never part of the wire model id or the ?query syntax.
  const trimmed = model.trim().replace(/\[1m]$/i, '').trim()
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) {
    return { baseModel: trimmed }
  }

  const baseModel = trimmed
    .slice(0, queryIndex)
    .trim()
    .replace(/\[1m]$/i, '')
  const params = new URLSearchParams(trimmed.slice(queryIndex + 1))
  const reasoning = parseReasoningEffort(params.get('reasoning') ?? undefined)
  const thinking = parseThinkingType(params.get('thinking') ?? undefined)

  return {
    baseModel,
    reasoning: reasoning ? { effort: reasoning } : undefined,
    thinking: thinking ? { type: thinking } : undefined,
  }
}

export function resolveProviderRequest(options?: {
  model?: string
  baseUrl?: string
  fallbackModel?: string
  reasoningEffortOverride?: ReasoningEffort
  processEnv?: NodeJS.ProcessEnv
}): ResolvedProviderRequest {
  const processEnv = options?.processEnv ?? process.env

  const requestedModel =
    options?.model?.trim() ||
    processEnv.OPENAI_MODEL?.trim() ||
    options?.fallbackModel?.trim() ||
    DEFAULT_OPENROUTER_MODEL
  const descriptor = parseModelDescriptor(requestedModel)

  const baseUrl = (
    asEnvUrl(options?.baseUrl) ??
    asNamedEnvUrl(processEnv.OPENAI_BASE_URL, 'OPENAI_BASE_URL') ??
    asNamedEnvUrl(processEnv.OPENAI_API_BASE, 'OPENAI_API_BASE') ??
    DEFAULT_OPENROUTER_BASE_URL
  ).replace(/\/+$/, '')

  const resolvedModel = resolveRouteCatalogAliasApiName({
    model: descriptor.baseModel,
    baseUrl,
    processEnv,
  })

  const requestedReasoning = options?.reasoningEffortOverride
    ? { effort: options.reasoningEffortOverride }
    : descriptor.reasoning
  // OpenRouter's reasoning_effort has no "max" level.
  const reasoning =
    requestedReasoning?.effort === 'max' ? undefined : requestedReasoning

  return {
    requestedModel,
    resolvedModel,
    baseUrl,
    reasoning,
    thinking: descriptor.thinking,
  }
}
