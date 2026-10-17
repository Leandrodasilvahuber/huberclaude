import { useEffect, useState } from 'react'
import {
  fuelCells,
  fuelTank,
  fetchOpenRouterUsage,
  RESERVE_USD,
  type OpenRouterUsageSnapshot,
} from '../commands/usage/openRouterUsage.js'
import { resolveOpenRouterApiKey } from '../utils/openclaudeConfig.js'

export type OpenRouterUsageState = {
  snapshot: OpenRouterUsageSnapshot | null
  error: string | null
  loading: boolean
}

const initialState: OpenRouterUsageState = {
  snapshot: null,
  error: null,
  loading: true,
}

let currentState: OpenRouterUsageState = { ...initialState }
const listeners = new Set<(state: OpenRouterUsageState) => void>()

let pollTimer: ReturnType<typeof setInterval> | null = null
let inflight: Promise<void> | null = null

/** Refresh interval for the OpenRouter usage snapshot (ms). */
const POLL_INTERVAL_MS = 15_000

/** Width of the status-line fuel bar, in cells. */
const FUEL_CELLS = 10

async function refresh(): Promise<void> {
  if (!resolveOpenRouterApiKey()) {
    currentState = { snapshot: null, error: null, loading: false }
    emit()
    return
  }
  try {
    const snapshot = await fetchOpenRouterUsage()
    currentState = { snapshot, error: null, loading: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Keep the previous snapshot on transient failures, only surface the error.
    currentState = {
      snapshot: currentState.snapshot,
      error: message,
      loading: false,
    }
  }
  emit()
}

function emit(): void {
  for (const listener of listeners) listener({ ...currentState })
}

function ensurePolling(): void {
  if (pollTimer) return
  // Kick off the first fetch immediately (best-effort, never throws).
  if (!inflight) {
    inflight = refresh().finally(() => {
      inflight = null
    })
  }
  pollTimer = setInterval(() => {
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null
      })
    }
  }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function getOpenRouterUsageState(): OpenRouterUsageState {
  return currentState
}

export function getOpenRouterFuelGauge(): {
  text: string
  /** Compact 5-cell form used when the status line is short on width. */
  shortText: string
  color: 'error' | 'warning' | undefined
  available: boolean
} | null {
  const { snapshot } = currentState
  if (!snapshot?.credits) return null
  const balance = snapshot.credits.totalCredits - snapshot.credits.totalUsage
  const tank = fuelTank(snapshot.lastRecharge ?? snapshot.credits.totalCredits)
  const ratio = tank > 0 ? Math.max(0, Math.min(1, balance / tank)) : 0
  const filled = fuelCells(balance, tank, FUEL_CELLS)
  const halfAt = FUEL_CELLS / 2
  // E empty, ┊ half-tank, F full.
  let bar = ''
  for (let i = 0; i < FUEL_CELLS; i++) {
    bar += i < filled ? '▰' : '▱'
    if (i + 1 === halfAt) bar += '┊'
  }
  let shortBar = ''
  const shortFilled = balance <= 0 ? 0 : Math.max(1, Math.round(ratio * 5))
  for (let i = 0; i < 5; i++) shortBar += i < shortFilled ? '▰' : '▱'
  const color: 'error' | 'warning' | undefined =
    balance <= RESERVE_USD
      ? 'error'
      : ratio <= 0.5
        ? 'warning'
        : undefined
  return {
    text: `fuel E${bar}F`,
    shortText: `fuel ${shortBar}`,
    color,
    available: true,
  }
}

export function useOpenRouterUsage(): OpenRouterUsageState {
  const [state, setState] = useState<OpenRouterUsageState>({ ...currentState })

  useEffect(() => {
    const listener = (next: OpenRouterUsageState) => {
      setState({ ...next })
    }
    listeners.add(listener)
    ensurePolling()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) stopPolling()
    }
  }, [])

  return state
}
