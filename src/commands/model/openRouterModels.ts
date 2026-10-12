import { getOpenRouterConfig } from '../../utils/openclaudeConfig.js'

export type OpenRouterModel = {
  id: string
  name: string
  contextLength: number | null
  /** USD per 1M prompt tokens, null when unknown. */
  promptPrice: number | null
  /** USD per 1M completion tokens, null when unknown. */
  completionPrice: number | null
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const FETCH_TIMEOUT_MS = 15_000

function toPerMillion(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    return null
  }
  return n * 1_000_000
}

export function parseOpenRouterModels(payload: unknown): OpenRouterModel[] {
  const data =
    payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data: unknown }).data
      : null
  if (!Array.isArray(data)) {
    return []
  }

  const models: OpenRouterModel[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) continue
    const pricing =
      entry.pricing && typeof entry.pricing === 'object'
        ? (entry.pricing as Record<string, unknown>)
        : {}
    const contextLength =
      typeof entry.context_length === 'number' && entry.context_length > 0
        ? entry.context_length
        : null
    models.push({
      id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : id,
      contextLength,
      promptPrice: toPerMillion(pricing.prompt),
      completionPrice: toPerMillion(pricing.completion),
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const config = getOpenRouterConfig()
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY

  const response = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`OpenRouter returned HTTP ${response.status}`)
  }
  return parseOpenRouterModels(await response.json())
}

export function isFreeOpenRouterModel(model: OpenRouterModel): boolean {
  return model.promptPrice === 0 && model.completionPrice === 0
}

function formatPrice(value: number | null): string {
  if (value === null) return '?'
  if (value === 0) return '0'
  return value < 0.01 ? value.toFixed(4) : value.toFixed(2)
}

/** e.g. "$0.15/$0.60 per 1M" or "free". */
export function formatOpenRouterPrice(model: OpenRouterModel): string {
  if (isFreeOpenRouterModel(model)) return 'free'
  return `$${formatPrice(model.promptPrice)}/$${formatPrice(model.completionPrice)} per 1M`
}

/** e.g. "128K", "1M", "?". */
export function formatContextLength(tokens: number | null): string {
  if (!tokens) return '?'
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number(m.toFixed(1))}M`
  }
  return `${Math.round(tokens / 1000)}K`
}

/** Case-insensitive match where every whitespace-separated term must hit id or name. */
export function filterOpenRouterModels(
  models: readonly OpenRouterModel[],
  query: string,
): OpenRouterModel[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...models]
  return models.filter(model => {
    const haystack = `${model.id} ${model.name}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}
