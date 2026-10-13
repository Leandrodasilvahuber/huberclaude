import * as React from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { Box, Text, useInput } from '../../ink.js'
import type { Theme } from '../../utils/theme.js'
import {
  buildGauge,
  fetchOpenRouterUsage,
  formatUsd,
  type GaugeZone,
  groupGaugeRow,
  type OpenRouterUsageSnapshot,
} from './openRouterUsage.js'

const ZONE_COLORS: Partial<Record<GaugeZone, keyof Theme>> = {
  low: 'success',
  mid: 'warning',
  high: 'error',
  needle: 'text',
}

function Gauge({
  title,
  fraction,
  caption,
}: {
  title: string
  fraction: number
  caption: string
}): React.ReactNode {
  const rows = React.useMemo(() => buildGauge(fraction), [fraction])
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  const percentColor: keyof Theme =
    percent < 34 ? 'success' : percent < 67 ? 'warning' : 'error'
  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold>{title}</Text>
      {rows.map((row, index) => (
        <Text key={index}>
          {groupGaugeRow(row).map((run, runIndex) => (
            <Text
              key={runIndex}
              color={ZONE_COLORS[run.zone]}
              dimColor={run.zone === 'track'}
            >
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
      <Text bold color={percentColor}>
        {percent}%
      </Text>
      <Text dimColor>{caption}</Text>
    </Box>
  )
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
      <Box flexDirection="row" gap={6} justifyContent="center">
        {credits ? (
          <Gauge
            title="Créditos usados"
            fraction={
              credits.totalCredits > 0
                ? credits.totalUsage / credits.totalCredits
                : 0
            }
            caption={`${formatUsd(credits.totalUsage)} de ${formatUsd(credits.totalCredits)}`}
          />
        ) : null}
        {key && keyLimit ? (
          <Gauge
            title="Limite da key"
            fraction={key.usage / keyLimit}
            caption={`${formatUsd(key.usage)} de ${formatUsd(keyLimit)}`}
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
