import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import {
  DEFAULT_OPENROUTER_BASE_URL,
  getOpenRouterConfig,
  resolveOpenRouterApiKey,
  saveOpenRouterConfig,
} from '../../utils/openclaudeConfig.js'

/** Account-wide credits from GET /credits. */
export type OpenRouterCredits = {
  totalCredits: number
  totalUsage: number
}

/** Per-key usage from GET /key. */
export type OpenRouterKeyUsage = {
  label: string | null
  usage: number
  usageDaily: number | null
  usageWeekly: number | null
  usageMonthly: number | null
  limit: number | null
  limitRemaining: number | null
  isFreeTier: boolean
}

export type OpenRouterUsageSnapshot = {
  credits: OpenRouterCredits | null
  key: OpenRouterKeyUsage | null
  /** Size of the most recent top-up, when known (see resolveLastRecharge). */
  lastRecharge?: number | null
}

/** Smallest tank the fuel gauge scales to, even after a smaller top-up. */
export const MIN_TANK_USD = 5
/** At or below this balance the gauge is in reserve (shown in red). */
export const RESERVE_USD = 2

/** Gauge capacity: the last recharge, never below MIN_TANK_USD. */
export function fuelTank(lastRecharge: number | null | undefined): number {
  return Math.max(MIN_TANK_USD, lastRecharge ?? 0)
}

export type StoredRecharge = { baselineCredits: number; amount: number }

/**
 * OpenRouter exposes no purchase history, so the last top-up is inferred from
 * total_credits growing between two /usage checks. With no history yet, the
 * whole purchased total stands in for it.
 */
export function resolveLastRecharge(
  stored: StoredRecharge | undefined,
  totalCredits: number,
): StoredRecharge {
  if (!stored) {
    return { baselineCredits: totalCredits, amount: totalCredits }
  }
  if (totalCredits > stored.baselineCredits) {
    return {
      baselineCredits: totalCredits,
      amount: totalCredits - stored.baselineCredits,
    }
  }
  return { ...stored, baselineCredits: totalCredits }
}

const FETCH_TIMEOUT_MS = 15_000

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function getData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    return null
  }
  const data = (payload as { data: unknown }).data
  return data && typeof data === 'object'
    ? (data as Record<string, unknown>)
    : null
}

export function parseOpenRouterCredits(
  payload: unknown,
): OpenRouterCredits | null {
  const data = getData(payload)
  if (!data) return null
  const totalCredits = toNumber(data.total_credits)
  const totalUsage = toNumber(data.total_usage)
  if (totalCredits === null || totalUsage === null) return null
  return { totalCredits, totalUsage }
}

export function parseOpenRouterKeyUsage(
  payload: unknown,
): OpenRouterKeyUsage | null {
  const data = getData(payload)
  if (!data) return null
  const usage = toNumber(data.usage)
  if (usage === null) return null
  return {
    label: typeof data.label === 'string' && data.label ? data.label : null,
    usage,
    usageDaily: toNumber(data.usage_daily),
    usageWeekly: toNumber(data.usage_weekly),
    usageMonthly: toNumber(data.usage_monthly),
    limit: toNumber(data.limit),
    limitRemaining: toNumber(data.limit_remaining),
    isFreeTier: data.is_free_tier === true,
  }
}

async function fetchJson(
  url: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  if (!response.ok) {
    throw new Error(`OpenRouter returned HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * Fetches account credits and key usage in parallel. Either half may be null
 * (e.g. /credits can be refused for restricted keys); throws only when both fail.
 */
export async function fetchOpenRouterUsage(): Promise<OpenRouterUsageSnapshot> {
  const apiKey = resolveOpenRouterApiKey()
  if (!apiKey) {
    throw new Error('No OpenRouter API key configured. Run /login first.')
  }
  const baseUrl = (
    getOpenRouterConfig().baseUrl || DEFAULT_OPENROUTER_BASE_URL
  ).replace(/\/+$/, '')

  const { signal, cleanup } = createCombinedAbortSignal(undefined, {
    timeoutMs: FETCH_TIMEOUT_MS,
  })
  try {
    const [credits, key] = await Promise.allSettled([
      fetchJson(`${baseUrl}/credits`, apiKey, signal),
      fetchJson(`${baseUrl}/key`, apiKey, signal),
    ])
    const snapshot: OpenRouterUsageSnapshot = {
      credits:
        credits.status === 'fulfilled'
          ? parseOpenRouterCredits(credits.value)
          : null,
      key: key.status === 'fulfilled' ? parseOpenRouterKeyUsage(key.value) : null,
    }
    if (snapshot.credits) {
      const config = getOpenRouterConfig()
      const recharge = resolveLastRecharge(
        config.lastRecharge,
        snapshot.credits.totalCredits,
      )
      snapshot.lastRecharge = recharge.amount
      try {
        if (
          recharge.amount !== config.lastRecharge?.amount ||
          recharge.baselineCredits !== config.lastRecharge?.baselineCredits
        ) {
          saveOpenRouterConfig({ lastRecharge: recharge })
        }
      } catch {
        // Tracking is best-effort; never fail /usage over it.
      }
    }
    if (!snapshot.credits && !snapshot.key) {
      const reason =
        credits.status === 'rejected' ? credits.reason : undefined
      throw reason instanceof Error
        ? reason
        : new Error('OpenRouter returned no usage data')
    }
    return snapshot
  } finally {
    cleanup()
  }
}

/** e.g. "$12.34", "$0.0042". */
export function formatUsd(value: number | null): string {
  if (value === null) return '—'
  const abs = Math.abs(value)
  const digits = abs !== 0 && abs < 0.01 ? 4 : 2
  return `${value < 0 ? '-' : ''}$${abs.toFixed(digits)}`
}

/** Number of filled cells (0..width) for a fuel bar showing `value` of `total`. */
export function fuelCells(value: number, total: number, width: number): number {
  if (total <= 0 || value <= 0) return 0
  return Math.min(width, Math.max(1, Math.round((value / total) * width)))
}
