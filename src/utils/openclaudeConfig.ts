import fs from 'node:fs'
import path from 'node:path'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'

export interface OpenRouterConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  /** Tracked by /usage: credits total last seen and the size of the last top-up. */
  lastRecharge?: { baselineCredits: number; amount: number }
  /** Active provider chosen with /provedor (defaults to openrouter). */
  provider?: string
  /** Keys/models for providers other than OpenRouter. */
  providers?: Record<string, unknown>
}

export type ProviderId = 'openrouter' | 'zai' | 'modelscope' | 'deepseek'

export interface ProviderDefinition {
  id: ProviderId
  label: string
  description: string
  baseUrl: string
  defaultModel: string
  keyUrl: string
  keyPlaceholder: string
  /** Shown in the /model price columns when the API reports no pricing. */
  priceLabel?: string
  /**
   * Models that cost nothing on this provider. /model labels them "grátis",
   * lists them first and adds them when the provider's /models omits them.
   */
  freeModels?: readonly string[]
  /** Extra env names checked (in order) when no key is saved. */
  envKeys: string[]
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'centenas de modelos, vários :free',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen3-coder',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-v1-…',
    envKeys: ['HUBERCLAUDE_OPENROUTER_API_KEY'],
  },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    // Endpoint geral: os glm-*-flash são grátis. O Coding Plan
    // (api/coding/paas/v4, glm-5.x) exige pacote pago; sem saldo dá erro 1113.
    description: 'GLM da Zhipu; glm-4.5-flash e glm-4.7-flash grátis',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-4.5-flash',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    keyPlaceholder: 'chave da z.ai',
    priceLabel: 'saldo',
    // O /models da Z.ai não lista estes; os demais (glm-4.5, glm-5.x e até
    // glm-5.3-flash) exigem saldo e respondem 1113 sem ele.
    freeModels: ['glm-4.5-flash', 'glm-4.7-flash', 'glm-4.6v-flash'],
    envKeys: ['HUBERCLAUDE_ZAI_API_KEY', 'ZAI_API_KEY'],
  },
  {
    id: 'modelscope',
    label: 'ModelScope (Alibaba)',
    description: 'grátis com cota diária: DeepSeek, Qwen, Kimi',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    defaultModel: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
    keyPlaceholder: 'ms-…',
    priceLabel: 'grátis',
    envKeys: ['HUBERCLAUDE_MODELSCOPE_API_KEY', 'MODELSCOPE_API_KEY'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'deepseek-chat e deepseek-reasoner via API',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
    priceLabel: 'saldo',
    envKeys: ['HUBERCLAUDE_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
  },
]

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find(p => p.id === id)
}

// The shell may export a z.ai key as the generic OPENAI_* pair; remember it
// before applyOpenRouterConfigToEnv() overwrites those vars.
const INITIAL_OPENAI_ENV = {
  baseUrl: process.env.OPENAI_BASE_URL ?? '',
  apiKey: process.env.OPENAI_API_KEY ?? '',
}

export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3-coder'

// ~/.openclaude by default; honors OPENCLAUDE_CONFIG_DIR.
function getConfigDir(): string {
  return getClaudeConfigHomeDir()
}

function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json')
}

export function getOpenRouterConfig(): OpenRouterConfig {
  try {
    const configFile = getConfigFile()
    if (fs.existsSync(configFile)) {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      return {
        apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
        baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : undefined,
        model: typeof data.model === 'string' ? data.model : undefined,
        lastRecharge:
          Number.isFinite(data.lastRecharge?.baselineCredits) &&
          Number.isFinite(data.lastRecharge?.amount)
            ? {
                baselineCredits: data.lastRecharge.baselineCredits,
                amount: data.lastRecharge.amount,
              }
            : undefined,
      }
    }
  } catch {
    // Retorna vazio caso ocorra erro de leitura ou parse
  }
  return {}
}

export function saveOpenRouterConfig(config: OpenRouterConfig): void {
  const configDir = getConfigDir()
  const configFile = getConfigFile()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  let existing: Record<string, unknown> = {}
  if (fs.existsSync(configFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    } catch {}
  }

  const updated = { ...existing, ...config }
  // The file holds the API key, so keep it owner-only.
  fs.writeFileSync(configFile, JSON.stringify(updated, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
  fs.chmodSync(configFile, 0o600)
}

function readConfigFile(): Record<string, unknown> {
  try {
    const configFile = getConfigFile()
    if (fs.existsSync(configFile)) {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (data && typeof data === 'object') return data
    }
  } catch {}
  return {}
}

export interface ProviderSettings {
  apiKey?: string
  baseUrl?: string
  model?: string
}

export function getActiveProviderId(): ProviderId {
  const id = readConfigFile().provider
  return typeof id === 'string' && getProviderDefinition(id)
    ? (id as ProviderId)
    : 'openrouter'
}

export function getActiveProvider(): ProviderDefinition {
  return getProviderDefinition(getActiveProviderId())!
}

/** OpenRouter keeps the legacy top-level fields; others live under providers.<id>. */
export function getProviderSettings(id: ProviderId): ProviderSettings {
  if (id === 'openrouter') {
    const { apiKey, baseUrl, model } = getOpenRouterConfig()
    return { apiKey, baseUrl, model }
  }
  const all = readConfigFile().providers
  const raw =
    all && typeof all === 'object'
      ? (all as Record<string, unknown>)[id]
      : undefined
  if (!raw || typeof raw !== 'object') return {}
  const entry = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
  return { apiKey: str(entry.apiKey), baseUrl: str(entry.baseUrl), model: str(entry.model) }
}

export function saveProviderSettings(id: ProviderId, settings: ProviderSettings): void {
  if (id === 'openrouter') {
    saveOpenRouterConfig(settings)
    return
  }
  const existing = readConfigFile().providers
  const providers =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {}
  const current = (providers[id] as Record<string, unknown> | undefined) ?? {}
  providers[id] = { ...current, ...settings }
  saveOpenRouterConfig({ providers })
}

export function setActiveProvider(id: ProviderId): void {
  saveOpenRouterConfig({ provider: id })
}

export function resolveProviderApiKey(
  id: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (id === 'openrouter') return resolveOpenRouterApiKey(env)
  const saved = getProviderSettings(id).apiKey?.trim()
  if (saved) return saved
  const def = getProviderDefinition(id)!
  for (const name of def.envKeys) {
    const value = env[name]?.trim()
    if (value) return value
  }
  const host = new URL(def.baseUrl).host
  if (INITIAL_OPENAI_ENV.apiKey && INITIAL_OPENAI_ENV.baseUrl.includes(host)) {
    return INITIAL_OPENAI_ENV.apiKey.trim()
  }
  return undefined
}

export function resolveActiveProviderApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveProviderApiKey(getActiveProviderId(), env)
}

export function getActiveProviderModel(): string {
  const id = getActiveProviderId()
  return (
    getProviderSettings(id).model?.trim() ||
    getProviderDefinition(id)!.defaultModel
  )
}

export function getActiveProviderBaseUrl(): string {
  const id = getActiveProviderId()
  return (
    getProviderSettings(id).baseUrl?.trim() ||
    getProviderDefinition(id)!.baseUrl
  ).replace(/\/+$/, '')
}

/**
 * Saved key first, then HUBERCLAUDE_OPENROUTER_API_KEY. The generic
 * OPENROUTER_API_KEY is deliberately ignored so an unrelated export (or a
 * provider test fixture) cannot switch the whole session to OpenRouter.
 */
export function resolveOpenRouterApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    getOpenRouterConfig().apiKey?.trim() ||
    env.HUBERCLAUDE_OPENROUTER_API_KEY?.trim() ||
    undefined
  )
}

/**
 * Point the OpenAI-compatible transport at the active provider (/provedor).
 * Overrides any inherited base URL/model (e.g. a z.ai export in .bashrc) so
 * the saved choice always wins. Returns false when no API key is available or
 * the host manages provider routing.
 */
export function applyOpenRouterConfigToEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // A host that manages provider routing (IDE/SDK) keeps control.
  if (isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    return false
  }
  const id = getActiveProviderId()
  const apiKey = resolveProviderApiKey(id, env)
  if (!apiKey) {
    return false
  }
  env.CLAUDE_CODE_USE_OPENAI = '1'
  env.OPENAI_BASE_URL = getActiveProviderBaseUrl()
  delete env.OPENAI_API_BASE
  delete env.OPENAI_API_KEYS
  env.OPENAI_API_KEY = apiKey
  if (id === 'openrouter') {
    env.OPENROUTER_API_KEY = apiKey
  }
  env.OPENAI_MODEL = getActiveProviderModel()
  return true
}
