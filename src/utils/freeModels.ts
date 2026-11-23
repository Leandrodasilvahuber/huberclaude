import type { ProviderDefinition, ProviderId } from './openclaudeConfig.js'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'

export interface CandidatoModelo {
  provider: ProviderId
  model: string
  label: string
  ativo: boolean
}

const FETCH_TIMEOUT_MS = 15_000

function toPerMillion(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  return n * 1_000_000
}

function parseModels(payload: unknown): { id: string; promptPrice: number | null; completionPrice: number | null }[] {
  const data =
    payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data: unknown }).data
      : null
  if (!Array.isArray(data)) return []
  const out: { id: string; promptPrice: number | null; completionPrice: number | null }[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) continue
    const pricing =
      entry.pricing && typeof entry.pricing === 'object'
        ? (entry.pricing as Record<string, unknown>)
        : {}
    out.push({
      id,
      promptPrice: toPerMillion(pricing.prompt),
      completionPrice: toPerMillion(pricing.completion),
    })
  }
  return out
}

/** Busca modelos de um provedor via seu endpoint /models (OpenAI-compatível). */
export async function fetchProviderModels(
  provider: ProviderDefinition,
  apiKey: string,
): Promise<{ id: string; promptPrice: number | null; completionPrice: number | null }[]> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const { signal, cleanup } = createCombinedAbortSignal(undefined, {
    timeoutMs: FETCH_TIMEOUT_MS,
  })
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    if (!response.ok) return []
    try {
      return parseModels(await response.json())
    } catch {
      return []
    }
  } finally {
    cleanup()
  }
}

/** Testa se um modelo responde a uma requisição de conclusão mínima. */
export async function testarModelo(
  provider: ProviderDefinition,
  apiKey: string,
  model: string,
): Promise<boolean> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const { signal, cleanup } = createCombinedAbortSignal(undefined, {
    timeoutMs: FETCH_TIMEOUT_MS,
  })
  try {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          stream: false,
        }),
        signal,
      })
      return response.ok
    } catch {
      return false
    }
  } finally {
    cleanup()
  }
}

/** Ordena modelos do mais capaz para o menos capaz (heurística de nome). */
const pesos: Record<string, number> = {
  // Modelos grandes/mais capazes primeiro
  'opus': 100,
  'sonnet': 90,
  'haiku': 80,
  'deepseek-reasoner': 95,
  'deepseek-chat': 85,
  'glm-5': 80,
  'glm-4.7': 75,
  'glm-4.6': 70,
  'glm-4.5': 65,
  'qwen3-coder': 60,
  'qwen3': 55,
  'qwen2.5': 50,
  'kimi': 45,
}

export function ordenarPorCapacidade(
  modelos: { id: string; promptPrice: number | null; completionPrice: number | null }[],
): string[] {
  const id = (m: string) => m.toLowerCase()
  return [...modelos].sort((a, b) => {
    const pa = pesoPara(id(a.id))
    const pb = pesoPara(id(b.id))
    if (pa !== pb) return pb - pa
    return a.id.localeCompare(b.id)
  }).map(m => m.id)
}

function pesoPara(id: string): number {
  for (const [chave, peso] of Object.entries(pesos)) {
    if (id.includes(chave)) return peso
  }
  return 0
}

/** Filtra apenas modelos grátis (preço 0/0 ou na lista freeModels do provedor). */
export function filtrarGratis(
  modelos: { id: string; promptPrice: number | null; completionPrice: number | null }[],
  freeModels: readonly string[] | undefined,
): string[] {
  const free = new Set(freeModels ?? [])
  return modelos
    .filter(m => (free.has(m.id) || (m.promptPrice === 0 && m.completionPrice === 0)))
    .map(m => m.id)
}
