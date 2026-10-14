import * as React from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { Box, Text, useInput } from '../../ink.js'
import type { Theme } from '../../utils/theme.js'
import {
  buildSevenSegment,
  fetchOpenRouterUsage,
  formatUsd,
  groupSegmentRow,
  type OpenRouterUsageSnapshot,
} from './openRouterUsage.js'

/** Old digital-clock style readout: lit segments in color, unlit as ghosts. */
function LcdDisplay({
  title,
  value,
  color,
  caption,
}: {
  title: string
  value: number
  color: keyof Theme
  caption: string
}): React.ReactNode {
  const rows = React.useMemo(
    () => buildSevenSegment(value.toFixed(2), 3),
    [value],
  )
  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold>{title}</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color}
        paddingX={1}
      >
        {rows.map((row, index) => (
          <Text key={index}>
            <Text color={color}>{index === 2 ? '$ ' : '  '}</Text>
            {groupSegmentRow(row).map((run, runIndex) =>
              run.lit ? (
                <Text key={runIndex} color={color} bold>
                  {run.text}
                </Text>
              ) : (
                <Text key={runIndex} color="inactive" dimColor>
                  {run.text}
                </Text>
              ),
            )}
          </Text>
        ))}
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
  const { credits, key } = snapshot
  const balance = credits ? credits.totalCredits - credits.totalUsage : null
  const keyLimit = key?.limit && key.limit > 0 ? key.limit : null

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={4} justifyContent="center">
        {credits && balance !== null ? (
          <LcdDisplay
            title="Saldo"
            value={balance}
            color={balance <= 0 ? 'error' : 'success'}
            caption={`${percentOf(credits.totalUsage, credits.totalCredits)}% de ${formatUsd(credits.totalCredits)} usado`}
          />
        ) : null}
        {key && keyLimit && key.limitRemaining !== null ? (
          <LcdDisplay
            title="Restante da key"
            value={key.limitRemaining}
            color={key.limitRemaining <= 0 ? 'error' : 'warning'}
            caption={`${percentOf(key.usage, keyLimit)}% de ${formatUsd(keyLimit)} usado`}
          />
        ) : null}
      </Box>

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

      {key ? (
        <Box flexDirection="column">
          <Text bold>
            Gasto desta key{key.label ? <Text dimColor> ({key.label})</Text> : null}
          </Text>
          <Stat label="Hoje" value={formatUsd(key.usageDaily)} />
          <Stat label="Últimos 7 dias" value={formatUsd(key.usageWeekly)} />
          <Stat label="Últimos 30 dias" value={formatUsd(key.usageMonthly)} />
          <Stat label="Total" value={formatUsd(key.usage)} />
          {keyLimit ? (
            <Stat
              label="Restante"
              value={formatUsd(key.limitRemaining)}
              color={
                key.limitRemaining !== null && key.limitRemaining <= 0
                  ? 'error'
                  : undefined
              }
            />
          ) : (
            <Stat label="Limite" value="sem limite" />
          )}
          {key.isFreeTier ? (
            <Text color="warning">Conta no free tier</Text>
          ) : null}
        </Box>
      ) : null}
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
