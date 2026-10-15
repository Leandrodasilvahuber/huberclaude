import * as React from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { Box, Text, useInput } from '../../ink.js'
import type { Theme } from '../../utils/theme.js'
import {
  fetchOpenRouterUsage,
  formatUsd,
  fuelCells,
  fuelTank,
  RESERVE_USD,
  type OpenRouterUsageSnapshot,
} from './openRouterUsage.js'

const FUEL_WIDTH = 28

/** Fuel-gauge bar: value on top, E ½ F scale and a fill level. */
function FuelGauge({
  value,
  total,
  color,
  caption,
}: {
  value: number
  total: number
  color: keyof Theme
  caption: string
}): React.ReactNode {
  const filled = fuelCells(value, total, FUEL_WIDTH)
  const half = Math.floor((FUEL_WIDTH - 1) / 2)
  const scale = `E${'½'.padStart(half)}${'F'.padStart(FUEL_WIDTH - half - 1)}`
  return (
    <Box flexDirection="column">
      <Box justifyContent="flex-end">
        <Text bold color={color}>
          {formatUsd(value)}
        </Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{scale}</Text>
        <Text>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text color="inactive" dimColor>
            {'░'.repeat(FUEL_WIDTH - filled)}
          </Text>
        </Text>
      </Box>
      <Text dimColor>{caption}</Text>
    </Box>
  )
}

function percentOf(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: keyof Theme
}): React.ReactNode {
  return (
    <Text>
      <Text dimColor>{label.padEnd(16)}</Text>
      <Text bold color={color}>
        {value}
      </Text>
    </Text>
  )
}

export function UsageBody({
  snapshot,
}: {
  snapshot: OpenRouterUsageSnapshot
}): React.ReactNode {
  const { credits } = snapshot
  const balance = credits ? credits.totalCredits - credits.totalUsage : null
  const tank = fuelTank(snapshot.lastRecharge ?? credits?.totalCredits)
  const inReserve = balance !== null && balance <= RESERVE_USD

  return (
    <Box flexDirection="column" gap={1}>
      {credits && balance !== null ? (
        <Box justifyContent="center">
          <FuelGauge
            value={balance}
            total={tank}
            color={inReserve ? 'error' : 'success'}
            caption={`${percentOf(Math.min(tank, Math.max(0, tank - balance)), tank)}% de ${formatUsd(tank)} usado${inReserve ? ` · reserva (${formatUsd(RESERVE_USD)})` : ''}`}
          />
        </Box>
      ) : null}

      <Box flexDirection="column">
        {credits ? (
          <>
            <Stat
              label="Saldo"
              value={formatUsd(balance)}
              color={balance !== null && balance <= 0 ? 'error' : 'success'}
            />
            <Stat label="Total comprado" value={formatUsd(credits.totalCredits)} />
            <Stat label="Total gasto" value={formatUsd(credits.totalUsage)} />
          </>
        ) : (
          <Text dimColor>
            Saldo da conta indisponível para esta key (/credits recusado).
          </Text>
        )}
      </Box>
    </Box>
  )
}

export function OpenRouterUsageDialog({
  onClose,
}: {
  onClose: () => void
}): React.ReactNode {
  const [snapshot, setSnapshot] =
    React.useState<OpenRouterUsageSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [reloadCount, setReloadCount] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchOpenRouterUsage()
      .then(result => {
        if (cancelled) return
        setSnapshot(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  useInput(input => {
    if (input === 'r' && !loading) {
      setReloadCount(count => count + 1)
    }
  })

  return (
    <Dialog
      title="OpenRouter usage"
      subtitle={loading && snapshot ? 'Atualizando…' : undefined}
      onCancel={() => onClose()}
      color="permission"
      inputGuide={exitState =>
        exitState.pending
          ? `Press ${exitState.keyName} again to exit`
          : 'r atualizar · Esc fechar'
      }
    >
      {snapshot ? (
        <UsageBody snapshot={snapshot} />
      ) : loading ? (
        <LoadingState message="Consultando OpenRouter…" />
      ) : null}
      {error ? <Text color="error">Falha ao consultar OpenRouter: {error}</Text> : null}
    </Dialog>
  )
}
