import * as React from 'react'
import { FuzzyPicker } from '../../components/design-system/FuzzyPicker.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { Box, Text } from '../../ink.js'
import {
  fetchOpenRouterModels,
  filterOpenRouterModels,
  formatContextLength,
  formatOpenRouterPrice,
  isFreeOpenRouterModel,
  type OpenRouterModel,
} from './openRouterModels.js'

const ID_COLUMN_WIDTH = 48

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

  if (!models) {
    return <LoadingState message="Loading OpenRouter models…" />
  }

  return (
    <FuzzyPicker
      title={`OpenRouter models (${models.length}) · price input/output per 1M tokens`}
      placeholder="Type to filter (e.g. claude, free, qwen coder)…"
      items={items}
      getKey={model => model.id}
      visibleCount={12}
      onQueryChange={setQuery}
      onSelect={model => onSelect(model.id)}
      onCancel={onCancel}
      emptyMessage={q => `No OpenRouter models match "${q}"`}
      matchLabel={query ? `${items.length} matches` : undefined}
      renderItem={(model, isFocused) => {
        const id =
          model.id.length > ID_COLUMN_WIDTH
            ? `${model.id.slice(0, ID_COLUMN_WIDTH - 1)}…`
            : model.id.padEnd(ID_COLUMN_WIDTH)
        const isCurrent = model.id === currentModel
        return (
          <Text color={isFocused ? 'suggestion' : undefined}>
            {id} <Text dimColor={!isFocused}>{formatContextLength(model.contextLength).padStart(6)} ctx</Text>
            {'  '}
            <Text color={isFreeOpenRouterModel(model) ? 'success' : undefined}>
              {formatOpenRouterPrice(model)}
            </Text>
            {isCurrent ? <Text dimColor> (current)</Text> : null}
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
