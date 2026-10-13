import fs from 'node:fs'
import path from 'node:path'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'

export interface OpenRouterConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
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
 * Point the OpenAI-compatible transport straight at OpenRouter. Overrides any
 * inherited base URL/model (e.g. a local LiteLLM proxy) so HuberClaude only
 * talks to OpenRouter. Returns false when no API key is available or the
 * host manages provider routing.
 */
export function applyOpenRouterConfigToEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // A host that manages provider routing (IDE/SDK) keeps control.
  if (isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    return false
  }
  const apiKey = resolveOpenRouterApiKey(env)
  if (!apiKey) {
    return false
  }
  const config = getOpenRouterConfig()
  env.CLAUDE_CODE_USE_OPENAI = '1'
  env.OPENAI_BASE_URL = (config.baseUrl?.trim() || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, '')
  delete env.OPENAI_API_BASE
  delete env.OPENAI_API_KEYS
  env.OPENAI_API_KEY = apiKey
  env.OPENROUTER_API_KEY = apiKey
  env.OPENAI_MODEL = config.model?.trim() || DEFAULT_OPENROUTER_MODEL
  return true
}
