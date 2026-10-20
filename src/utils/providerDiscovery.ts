import { DEFAULT_OPENROUTER_BASE_URL as DEFAULT_OPENAI_BASE_URL } from './openclaudeConfig.js'

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal
  clear: () => void
} {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}

function getOpenAICompatibleModelsBaseUrl(baseUrl?: string): string {
  return (
    baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL
  ).replace(/\/+$/, '')
}

export async function listOpenAICompatibleModels(options?: {
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
}): Promise<string[] | null> {
  const { signal, clear } = withTimeoutSignal(5000)
  try {
    const baseUrl = getOpenAICompatibleModelsBaseUrl(options?.baseUrl)
    const headers = {
      ...(options?.headers ?? {}),
      ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    }
    const response = await fetch(
      `${baseUrl}/models`,
      {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        signal,
      },
    )
    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      data?: Array<{ id?: string }>
    }

    return Array.from(
      new Set(
        (data.data ?? [])
          .filter(model => Boolean(model.id))
          .map(model => model.id!),
      ),
    )
  } catch {
    return null
  } finally {
    clear()
  }
}

export async function fetchOpenAICompatibleModelsRaw(options?: {
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
}): Promise<Record<string, unknown>[] | null> {
  const { signal, clear } = withTimeoutSignal(5000)
  try {
    const baseUrl = getOpenAICompatibleModelsBaseUrl(options?.baseUrl)
    const headers = {
      ...(options?.headers ?? {}),
      ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    }
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      signal,
    })
    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      data?: Array<Record<string, unknown>>
    }

    return data.data ?? null
  } catch {
    return null
  } finally {
    clear()
  }
}
