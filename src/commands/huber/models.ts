export type HuberTier = 'FREE' | 'LOW' | 'MID' | 'HIGH'

export interface HuberModel {
  id: string
  tier: HuberTier
  /** USD per 1M tokens, input/output. */
  cost: string
}

export const HUBER_MODELS: HuberModel[] = [
  { id: 'cohere/north-mini-code:free', tier: 'FREE', cost: '0.00/0.00' },
  { id: 'poolside/laguna-s-2.1:free', tier: 'FREE', cost: '0.00/0.00' },
  { id: 'deepseek/deepseek-r1', tier: 'LOW', cost: '0.70/2.50' },
  { id: 'qwen/qwen3-coder', tier: 'LOW', cost: '0.30/1.00' },
  { id: 'z-ai/glm-5.2', tier: 'MID', cost: '0.62/2.42' },
  { id: 'google/gemini-2.5-flash', tier: 'MID', cost: '0.30/2.50' },
  { id: '~anthropic/claude-haiku-latest', tier: 'MID', cost: '0.10/0.50' },
  { id: 'openai/gpt-4o-mini', tier: 'MID', cost: '0.15/0.60' },
  { id: '~anthropic/claude-sonnet-latest', tier: 'HIGH', cost: '2.00/10.00' },
  { id: 'openai/gpt-4o', tier: 'HIGH', cost: '2.50/10.00' },
  { id: '~anthropic/claude-opus-latest', tier: 'HIGH', cost: '4.00/20.00' },
]

const TIER_COLORS = {
  FREE: 'ansi:green',
  LOW: 'ansi:yellowBright',
  MID: 'ansi:cyan',
  HIGH: 'ansi:magenta',
} as const

export function getTierColor(tier: HuberTier): (typeof TIER_COLORS)[HuberTier] {
  return TIER_COLORS[tier]
}

/** True when the given model id is one of the Huber recommendations. */
export function isHuberModel(modelId: string | null | undefined): boolean {
  return !!modelId && HUBER_MODELS.some(model => model.id === modelId)
}

export function filterHuberModels(query: string): HuberModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return HUBER_MODELS
  return HUBER_MODELS.filter(
    model =>
      model.id.toLowerCase().includes(q) || model.tier.toLowerCase().includes(q),
  )
}
