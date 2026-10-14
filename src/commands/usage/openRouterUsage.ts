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

export type SegmentCell = { char: string; lit: boolean }

// Segments: a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left,
// f=top-left, g=middle.
const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
}

const SEGMENT_ROWS = 5

function digitCells(segments: string): SegmentCell[][] {
  const on = (segment: string) => segments.includes(segment)
  const blank: SegmentCell = { char: ' ', lit: false }
  const horizontal = (segment: string): SegmentCell[] => [
    blank,
    ...Array.from({ length: 3 }, () =>
      on(segment) ? { char: '━', lit: true } : { char: '╌', lit: false },
    ),
    blank,
  ]
  const side = (segment: string): SegmentCell =>
    on(segment) ? { char: '┃', lit: true } : { char: '╎', lit: false }
  const vertical = (left: string, right: string): SegmentCell[] => [
    side(left),
    blank,
    blank,
    blank,
    side(right),
  ]
  return [
    horizontal('a'),
    vertical('f', 'b'),
    horizontal('g'),
    vertical('e', 'c'),
    horizontal('d'),
  ]
}

/**
 * Renders `text` (digits, '-', '.', ' ') as a seven-segment LCD, like an old
 * digital clock. Every digit position draws all seven segments; unlit ones
 * use thin dashed glyphs with `lit: false` so they read as faint "ghost"
 * segments even without color. The integer part is left-padded with blank digits up to
 * `minDigits` so the display keeps a fixed width.
 */
export function buildSevenSegment(
  text: string,
  minDigits = 0,
): SegmentCell[][] {
  const intLength = text.split('.')[0]!.length
  const padded = ' '.repeat(Math.max(0, minDigits - intLength)) + text
  const rows: SegmentCell[][] = Array.from({ length: SEGMENT_ROWS }, () => [])
  padded.split('').forEach((char, index) => {
    if (index > 0) rows.forEach(row => row.push({ char: ' ', lit: false }))
    if (char === '.') {
      rows.forEach((row, rowIndex) =>
        row.push(
          rowIndex === SEGMENT_ROWS - 1
            ? { char: '●', lit: true }
            : { char: ' ', lit: false },
        ),
      )
      return
    }
    const cells = digitCells(DIGIT_SEGMENTS[char] ?? '')
    cells.forEach((cellRow, rowIndex) => rows[rowIndex]!.push(...cellRow))
  })
  return rows
}

/** Groups consecutive cells sharing `lit` so each run renders as one <Text>. */
export function groupSegmentRow(
  row: readonly SegmentCell[],
): { text: string; lit: boolean }[] {
  const runs: { text: string; lit: boolean }[] = []
  for (const cell of row) {
    const last = runs[runs.length - 1]
    if (last && last.lit === cell.lit) {
      last.text += cell.char
    } else {
      runs.push({ text: cell.char, lit: cell.lit })
    }
  }
  return runs
}
