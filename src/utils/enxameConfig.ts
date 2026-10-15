import fs from 'node:fs'
import path from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export interface EnxameAccount {
  apiKey: string
  baseUrl: string
  model: string
  /** Tried when the main model fails for a reason other than a bad key. */
  fallbackModel?: string
  /** Swarm on/off switch; accounts are enabled unless turned off. */
  enabled: boolean
}

export const DEFAULT_ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4'
export const DEFAULT_ZAI_MODEL = 'glm-4.7-flash'
export const DEFAULT_ZAI_FALLBACK_MODEL = 'glm-4.5-flash'

function getConfigFile(): string {
  return path.join(getClaudeConfigHomeDir(), 'config.json')
}

function readConfig(): Record<string, unknown> {
  try {
    const configFile = getConfigFile()
    if (fs.existsSync(configFile)) {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      if (data && typeof data === 'object') return data
    }
  } catch {
    // Unreadable or invalid config reads as empty.
  }
  return {}
}

function writeConfig(config: Record<string, unknown>): void {
  const configDir = getClaudeConfigHomeDir()
  const configFile = getConfigFile()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  // The file holds API keys, so keep it owner-only.
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
  fs.chmodSync(configFile, 0o600)
}

/** Only the key is stored; URL and models are fixed defaults. */
export function getEnxameAccount(): EnxameAccount | undefined {
  const raw = readConfig().enxame as { apiKey?: unknown } | undefined
  if (typeof raw?.apiKey !== 'string' || !raw.apiKey) return undefined
  return {
    apiKey: raw.apiKey,
    baseUrl: DEFAULT_ZAI_BASE_URL,
    model: DEFAULT_ZAI_MODEL,
    fallbackModel: DEFAULT_ZAI_FALLBACK_MODEL,
    enabled: (raw as { enabled?: unknown }).enabled !== false,
  }
}

export function isEnxameEnabled(): boolean {
  return getEnxameAccount()?.enabled ?? false
}

export function setEnxameEnabled(enabled: boolean): void {
  const config = readConfig()
  const raw = config.enxame as { apiKey?: unknown } | undefined
  if (typeof raw?.apiKey !== 'string' || !raw.apiKey) return
  writeConfig({ ...config, enxame: { ...raw, enabled } })
}

/** Saves the single z.ai account, replacing any previous one. */
export function saveEnxameAccount(apiKey: string): void {
  const config = readConfig()
  const previous = config.enxame as { enabled?: unknown } | undefined
  writeConfig({
    ...config,
    enxame: { apiKey, enabled: previous?.enabled !== false },
  })
}

export function removeEnxameAccount(): void {
  const { enxame: _removed, ...rest } = readConfig()
  writeConfig(rest)
}

export type EnxameTestResult = { ok: boolean; message: string }

/** Models to try in order: the main one, then the fallback if it differs. */
export function getEnxameModelChain(account: EnxameAccount): string[] {
  return account.fallbackModel && account.fallbackModel !== account.model
    ? [account.model, account.fallbackModel]
    : [account.model]
}

async function pingModel(
  account: EnxameAccount,
  model: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status?: number; message: string }> {
  try {
    const response = await fetchImpl(`${account.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (response.ok) return { ok: true, message: 'ok' }
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    return {
      ok: false,
      status: response.status,
      message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Sends a one-token chat request to confirm the key, URL and model work. If
 * the main model fails (not for a rejected key), the fallback model is tried.
 */
export async function testEnxameAccount(
  account: EnxameAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<EnxameTestResult> {
  const failures: string[] = []
  for (const model of getEnxameModelChain(account)) {
    const result = await pingModel(account, model, fetchImpl)
    if (result.ok) {
      return {
        ok: true,
        message:
          failures.length === 0
            ? `Connection OK (${model})`
            : `Connection OK with fallback ${model} (${failures.join('; ')})`,
      }
    }
    failures.push(`${model}: ${result.message}`)
    // A rejected key fails the same way on every model.
    if (result.status === 401 || result.status === 403) break
  }
  return { ok: false, message: failures.join(' | ') }
}
