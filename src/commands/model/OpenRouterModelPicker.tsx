import * as React from 'react'
import { FuzzyPicker } from '../../components/design-system/FuzzyPicker.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import {
  fetchOpenRouterModels,
  filterOpenRouterModels,
  fitColumn,
  formatContextLength,
  formatOpenRouterModelColumns,
  formatOpenRouterPrice,
  isFreeOpenRouterModel,
  MODEL_COLUMN_WIDTHS,
  type OpenRouterModel,
} from './openRouterModels.js'

const MIN_ID_COLUMN_WIDTH = 20
const MAX_ID_COLUMN_WIDTH = 56
// Pane padding + list pointer, plus the " (current)" marker after the columns.
const ROW_CHROME_WIDTH = 6 + ' (current)'.length
const COLUMN_GAP = '  '

export function OpenRouterModelPicker({
  currentModel,
  onSelect,
  onCancel,
  onError,
}: {
  currentModel: string | null
  onSelect: (modelId: string) => void
  onCancel: () => void
  onError: (message: string) => void
}): React.ReactNode {
  const [models, setModels] = React.useState<OpenRouterModel[] | null>(null)
  const [query, setQuery] = React.useState('')
  const { columns } = useTerminalSize()

  React.useEffect(() => {
    let cancelled = false
    fetchOpenRouterModels()
      .then(result => {
        if (cancelled) return
        if (result.length === 0) {
          onError('OpenRouter returned no models.')
          return
        }
        setModels(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(
            `Failed to load OpenRouter models: ${(error as Error).message}`,
          )
        }
      })
    return () => {
      cancelled = true
    }
    // Fetch once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = React.useMemo(
    () => (models ? filterOpenRouterModels(models, query) : []),
    [models, query],
  )

  const idWidth = React.useMemo(() => {
    const longest = Math.max(
      MIN_ID_COLUMN_WIDTH,
      ...(models ?? []).map(model => model.id.length),
    )
    const fixed =
      MODEL_COLUMN_WIDTHS.context +
      2 * MODEL_COLUMN_WIDTHS.price +
      3 * COLUMN_GAP.length +
      ROW_CHROME_WIDTH
    return Math.max(
      MIN_ID_COLUMN_WIDTH,
      Math.min(longest, MAX_ID_COLUMN_WIDTH, columns - fixed),
    )
  }, [models, columns])

  if (!models) {
    return <LoadingState message="Loading OpenRouter models…" />
  }

  return (
    <FuzzyPicker
      title={`OpenRouter models (${models.length}) · prices in USD per 1M tokens`}
      placeholder="Type to filter (e.g. claude, free, qwen coder)…"
      items={items}
      getKey={model => model.id}
      visibleCount={12}
      onQueryChange={setQuery}
      onSelect={model => onSelect(model.id)}
      onCancel={onCancel}
      emptyMessage={q => `No OpenRouter models match "${q}"`}
      matchLabel={query ? `${items.length} matches` : undefined}
      header={
        <Text dimColor>
          {'  '}
          {fitColumn('Model', idWidth)}
          {COLUMN_GAP}
          {'Context'.padStart(MODEL_COLUMN_WIDTHS.context)}
          {COLUMN_GAP}
          {'Input'.padStart(MODEL_COLUMN_WIDTHS.price)}
          {COLUMN_GAP}
          {'Output'.padStart(MODEL_COLUMN_WIDTHS.price)}
        </Text>
      }
      renderItem={model => {
        const cells = formatOpenRouterModelColumns(model)
        const priceColor = isFreeOpenRouterModel(model) ? 'success' : undefined
        return (
          <Text>
            {fitColumn(model.id, idWidth)}
            {COLUMN_GAP}
            <Text dimColor>{cells.context}</Text>
            {COLUMN_GAP}
            <Text color={priceColor}>{cells.input}</Text>
            {COLUMN_GAP}
            <Text color={priceColor}>{cells.output}</Text>
            {model.id === currentModel ? (
              <Text dimColor> (current)</Text>
            ) : null}
          </Text>
        )
      }}
      renderPreview={model => (
        <Box flexDirection="column">
          <Text bold>{model.name}</Text>
          <Text dimColor>
            {model.id} · context {formatContextLength(model.contextLength)}{' '}
            tokens · {formatOpenRouterPrice(model)}
          </Text>
        </Box>
      )}
    />
  )
}
