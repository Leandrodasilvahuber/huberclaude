import * as React from 'react'
import { FuzzyPicker } from '../../components/design-system/FuzzyPicker.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import { fitColumn } from '../model/openRouterModels.js'
import { filterHuberModels, getTierColor, HUBER_MODELS } from './models.js'

const MIN_ID_COLUMN_WIDTH = 20
const TIER_WIDTH = 4
const COST_WIDTH = 11
// Pane padding + list pointer, plus the " (current)" marker after the columns.
const ROW_CHROME_WIDTH = 6 + ' (current)'.length
const COLUMN_GAP = '  '

export function HuberPicker({
  currentModel,
  onSelect,
  onCancel,
}: {
  currentModel: string | null
  onSelect: (modelId: string) => void
  onCancel: () => void
}): React.ReactNode {
  const [query, setQuery] = React.useState('')
  const { columns } = useTerminalSize()

  const items = React.useMemo(() => filterHuberModels(query), [query])

  const idWidth = React.useMemo(() => {
    const longest = Math.max(...HUBER_MODELS.map(model => model.id.length))
    const fixed =
      TIER_WIDTH + COST_WIDTH + 2 * COLUMN_GAP.length + ROW_CHROME_WIDTH
    return Math.max(MIN_ID_COLUMN_WIDTH, Math.min(longest, columns - fixed))
  }, [columns])

  return (
    <FuzzyPicker
      title={`Huber recommended models (${HUBER_MODELS.length}) · prices in USD per 1M tokens`}
      placeholder="Type to filter (e.g. free, claude, high)…"
      items={items}
      getKey={model => model.id}
      visibleCount={12}
      onQueryChange={setQuery}
      onSelect={model => onSelect(model.id)}
      onCancel={onCancel}
      emptyMessage={q => `No Huber models match "${q}"`}
      matchLabel={query ? `${items.length} matches` : undefined}
      header={
        <Text dimColor>
          {'  '}
          {fitColumn('Model', idWidth)}
          {COLUMN_GAP}
          {'Tier'.padEnd(TIER_WIDTH)}
          {COLUMN_GAP}
          {'Input/Output'.padStart(COST_WIDTH)}
        </Text>
      }
      renderItem={model => (
        <Text>
          {fitColumn(model.id, idWidth)}
          {COLUMN_GAP}
          <Text color={getTierColor(model.tier)}>
            {model.tier.padEnd(TIER_WIDTH)}
          </Text>
          {COLUMN_GAP}
          <Text dimColor>{model.cost.padStart(COST_WIDTH)}</Text>
          {model.id === currentModel ? (
            <Text dimColor> (current)</Text>
          ) : null}
        </Text>
      )}
      renderPreview={model => (
        <Box flexDirection="column">
          <Text bold>{model.id}</Text>
          <Text dimColor>
            {model.tier} · ${model.cost} input/output per 1M tokens
          </Text>
        </Box>
      )}
    />
  )
}
