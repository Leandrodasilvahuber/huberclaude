import fs from 'node:fs'
import path from 'node:path'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { sleep } from './sleep.js'

export type EnxameMode = 'tool' | 'agent' | 'both'

export const ENXAME_MODES: readonly EnxameMode[] = ['tool', 'agent', 'both']
export const MAX_ENXAME_WORKERS = 10

export interface EnxameAccount {
  apiKey: string
  baseUrl: string
  model: string
  /** Tried when the main model fails for a reason other than a bad key. */
  fallbackModel?: string
  /** Swarm on/off switch; accounts are enabled unless turned off. */
  enabled: boolean
  /** Which worker kind the manager may use: stateless tool, z.ai agents, or both. */
  mode: EnxameMode
  /** Maximum number of z.ai workers running at once (1-10). */
  workers: number
}

export const DEFAULT_ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4'
export const DEFAULT_ZAI_MODEL = 'glm-4.7-flash'
export const DEFAULT_ZAI_FALLBACK_MODEL = 'glm-4.5-flash'

type StoredEnxame = {
  apiKey?: unknown
  enabled?: unknown
  mode?: unknown
  workers?: unknown
}

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

/** Clamps any value to a whole worker count in 1..MAX_ENXAME_WORKERS. */
export function clampEnxameWorkers(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return MAX_ENXAME_WORKERS
  return Math.min(MAX_ENXAME_WORKERS, Math.max(1, Math.trunc(n)))
}

function parseMode(value: unknown): EnxameMode {
  return ENXAME_MODES.includes(value as EnxameMode) ? (value as EnxameMode) : 'both'
}

/**
 * Per-process overrides for automation (benchmarks) so the stored config is
 * never rewritten: OPENCLAUDE_ENXAME_ENABLED=0|1 and OPENCLAUDE_ENXAME_MODE.
 */
function envEnabledOverride(): boolean | undefined {
  const v = process.env.OPENCLAUDE_ENXAME_ENABLED?.trim().toLowerCase()
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return undefined
}

/** Only key and swarm settings are stored; URL and models are fixed defaults. */
export function getEnxameAccount(): EnxameAccount | undefined {
  const raw = readConfig().enxame as StoredEnxame | undefined
  if (typeof raw?.apiKey !== 'string' || !raw.apiKey) return undefined
  return {
    apiKey: raw.apiKey,
    baseUrl: DEFAULT_ZAI_BASE_URL,
    model: DEFAULT_ZAI_MODEL,
    fallbackModel: DEFAULT_ZAI_FALLBACK_MODEL,
    enabled: envEnabledOverride() ?? raw.enabled !== false,
    mode: parseMode(process.env.OPENCLAUDE_ENXAME_MODE ?? raw.mode),
    workers: raw.workers === undefined ? MAX_ENXAME_WORKERS : clampEnxameWorkers(raw.workers),
  }
}

export function isEnxameEnabled(): boolean {
  return getEnxameAccount()?.enabled ?? false
}

/** The stateless Enxame tool is offered in 'tool' and 'both' modes. */
export function isEnxameToolEnabled(): boolean {
  const account = getEnxameAccount()
  return !!account?.enabled && account.mode !== 'agent'
}

/** The enxame-worker agent is offered in 'agent' and 'both' modes. */
export function isEnxameAgentEnabled(): boolean {
  const account = getEnxameAccount()
  return !!account?.enabled && account.mode !== 'tool'
}

/** Merges settings into the stored account; a no-op without an account. */
function updateStoredEnxame(patch: StoredEnxame): void {
  const config = readConfig()
  const raw = config.enxame as StoredEnxame | undefined
  if (typeof raw?.apiKey !== 'string' || !raw.apiKey) return
  writeConfig({ ...config, enxame: { ...raw, ...patch } })
}

export function setEnxameEnabled(enabled: boolean): void {
  updateStoredEnxame({ enabled })
}

export function setEnxameMode(mode: EnxameMode): void {
  updateStoredEnxame({ mode: parseMode(mode) })
}

export function setEnxameWorkers(workers: number): void {
  updateStoredEnxame({ workers: clampEnxameWorkers(workers) })
}

/** Saves the single z.ai account, replacing the key but keeping its settings. */
export function saveEnxameAccount(apiKey: string): void {
  const config = readConfig()
  const { apiKey: _old, ...settings } = (config.enxame as StoredEnxame | undefined) ?? {}
  writeConfig({ ...config, enxame: { ...settings, apiKey } })
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

export type EnxameMessage = { role: 'system' | 'user'; content: string }

export type EnxameUsage = { promptTokens: number; completionTokens: number }

export type EnxameChatResult =
  | { ok: true; model: string; text: string; failures: string[]; usage: EnxameUsage }
  | { ok: false; failures: string[] }

const ENXAME_REQUEST_TIMEOUT_MS = 60_000

async function chatOnce(
  account: EnxameAccount,
  model: string,
  messages: EnxameMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ ok: true; text: string; usage: EnxameUsage } | { ok: false; status?: number; message: string }> {
  const { signal: requestSignal, cleanup } = createCombinedAbortSignal(signal, {
    timeoutMs,
  })
  try {
    const response = await fetchImpl(`${account.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.apiKey}`,
      },
      // GLM models think by default and spend max_tokens on reasoning_content,
      // leaving content empty; workers only need the direct answer.
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
      }),
      signal: requestSignal,
    })
    if (response.ok) {
      const data = (await response.json().catch(() => undefined)) as
        | {
            choices?: { message?: { content?: unknown } }[]
            usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
          }
        | undefined
      const content = data?.choices?.[0]?.message?.content
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      return {
        ok: true,
        text: typeof content === 'string' ? content : '',
        usage: {
          promptTokens: num(data?.usage?.prompt_tokens),
          completionTokens: num(data?.usage?.completion_tokens),
        },
      }
    }
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    return {
      ok: false,
      status: response.status,
      message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    cleanup()
  }
}

/** Minimum gap between the start of two z.ai requests, across all workers. */
export const ENXAME_STAGGER_MS = 600
/** Waits before retrying the same model after a 429 (rate limit or overload). */
export const ENXAME_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000]

let nextEnxameSlot = 0

/** Appends one JSON line per z.ai call when OPENCLAUDE_ENXAME_USAGE_LOG is set. */
function logEnxameUsage(label: string | undefined, model: string, usage: EnxameUsage): void {
  const file = process.env.OPENCLAUDE_ENXAME_USAGE_LOG
  if (!file) return
  try {
    fs.appendFileSync(file, JSON.stringify({ label: label ?? 'enxame', model, ...usage }) + '\n')
  } catch {
    // Usage logging is best-effort.
  }
}

/**
 * Staggers z.ai calls: each caller gets a start time at least `spacingMs`
 * after the previous one, so a burst of workers does not hit the rate limit
 * (z.ai 1302) or overload (1305) all at once. Shared by the Enxame tool and
 * enxame-worker agents.
 */
export async function waitForEnxameSlot(
  signal?: AbortSignal,
  spacingMs: number = ENXAME_STAGGER_MS,
): Promise<void> {
  if (spacingMs <= 0) return
  const now = Date.now()
  const start = Math.max(now, nextEnxameSlot)
  nextEnxameSlot = start + spacingMs
  if (start > now) await sleep(start - now, signal, { throwOnAbort: true })
}

/**
 * Sends one stateless chat request, walking the model chain. Each request
 * waits for a staggered slot; a 429 is retried on the same model after a
 * backoff, then the fallback model is tried. A rejected key stops at once.
 * Throws only when `signal` aborts.
 */
export async function enxameChat(
  account: EnxameAccount,
  messages: EnxameMessage[],
  {
    maxTokens,
    fetchImpl = fetch,
    signal,
    timeoutMs = ENXAME_REQUEST_TIMEOUT_MS,
    spacingMs = ENXAME_STAGGER_MS,
    retryDelaysMs = ENXAME_RETRY_DELAYS_MS,
    label,
  }: {
    /** Names the caller in the optional usage log (OPENCLAUDE_ENXAME_USAGE_LOG). */
    label?: string
    maxTokens: number
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    timeoutMs?: number
    spacingMs?: number
    retryDelaysMs?: readonly number[]
  },
): Promise<EnxameChatResult> {
  const failures: string[] = []
  for (const model of getEnxameModelChain(account)) {
    for (let attempt = 0; ; attempt++) {
      await waitForEnxameSlot(signal, spacingMs)
      const result = await chatOnce(account, model, messages, maxTokens, fetchImpl, signal, timeoutMs)
      if (result.ok) {
        logEnxameUsage(label, model, result.usage)
        return { ok: true, model, text: result.text, failures, usage: result.usage }
      }
      const retryDelay = retryDelaysMs[attempt]
      if (result.status === 429 && retryDelay !== undefined) {
        await sleep(retryDelay, signal, { throwOnAbort: true })
        continue
      }
      failures.push(`${model}: ${result.message}`)
      // A rejected key fails the same way on every model.
      if (result.status === 401 || result.status === 403) {
        return { ok: false, failures }
      }
      break
    }
  }
  return { ok: false, failures }
}

/** Sends a one-token chat request to confirm the key, URL and model work. */
export async function testEnxameAccount(
  account: EnxameAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<EnxameTestResult> {
  const result = await enxameChat(account, [{ role: 'user', content: 'ping' }], {
    maxTokens: 1,
    fetchImpl,
    timeoutMs: 20_000,
    // A connection check should answer fast, not wait out rate limits.
    spacingMs: 0,
    retryDelaysMs: [],
  })
  if (!result.ok) return { ok: false, message: result.failures.join(' | ') }
  return {
    ok: true,
    message:
      result.failures.length === 0
        ? `Connection OK (${result.model})`
        : `Connection OK with fallback ${result.model} (${result.failures.join('; ')})`,
  }
}
