import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import {
  DEFAULT_OPENROUTER_BASE_URL,
  getOpenRouterConfig,
  resolveOpenRouterApiKey,
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

export type GaugeZone = 'low' | 'mid' | 'high' | 'track' | 'needle' | 'empty'

export type GaugeCell = { char: string; zone: GaugeZone }

/**
 * Speedometer arc as a character grid. `fraction` (clamped to 0..1) sweeps the
 * needle from left (0) to right (1). Cells up to the needle are colored by zone
 * (green/yellow/red thirds); cells beyond it are the dim track. Columns are
 * doubled horizontally because terminal cells are about twice as tall as wide.
 */
export function buildGauge(fraction: number, radius = 7): GaugeCell[][] {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const outer = radius
  const inner = radius - 1.6
  const width = radius * 4 + 1
  const center = radius * 2
  // The needle angle: π (left) → 0 (right).
  const needleAngle = Math.PI * (1 - f)

  const rows: GaugeCell[][] = []
  for (let row = 0; row <= radius; row++) {
    const y = radius - row
    const cells: GaugeCell[] = []
    for (let col = 0; col < width; col++) {
      const x = (col - center) / 2
      const dist = Math.hypot(x, y)
      const angle = Math.atan2(y, x)
      const progress = 1 - angle / Math.PI

      if (dist >= inner && dist <= outer + 0.3) {
        if (f > 0 && progress <= f) {
          const zone: GaugeZone =
            progress < 1 / 3 ? 'low' : progress < 2 / 3 ? 'mid' : 'high'
          cells.push({ char: '█', zone })
        } else {
          cells.push({ char: '░', zone: 'track' })
        }
        continue
      }

      // Needle: points within half a cell of the needle ray, inside the arc.
      if (dist < inner - 0.4) {
        const perp = Math.abs(
          x * Math.sin(needleAngle) - y * Math.cos(needleAngle),
        )
        const along = x * Math.cos(needleAngle) + y * Math.sin(needleAngle)
        if (along >= 0 && perp <= 0.45) {
          cells.push({ char: '●', zone: 'needle' })
          continue
        }
      }
      cells.push({ char: ' ', zone: 'empty' })
    }
    rows.push(cells)
  }
  // Hub of the needle sits on the bottom row.
  const lastRow = rows[rows.length - 1]!
  lastRow[center] = { char: '◉', zone: 'needle' }
  return rows
}

/** Groups consecutive cells sharing a zone so each run renders as one <Text>. */
export function groupGaugeRow(
  row: readonly GaugeCell[],
): { text: string; zone: GaugeZone }[] {
  const runs: { text: string; zone: GaugeZone }[] = []
  for (const cell of row) {
    const last = runs[runs.length - 1]
    if (last && last.zone === cell.zone) {
      last.text += cell.char
    } else {
      runs.push({ text: cell.char, zone: cell.zone })
    }
  }
  return runs
}
