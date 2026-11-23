import chalk from 'chalk'
import * as React from 'react'
import { useState } from 'react'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import TextInput from '../../components/TextInput.js'
import { Box, Text } from '../../ink.js'
import { useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  applyOpenRouterConfigToEnv,
  getActiveProviderId,
  getActiveProviderModel,
  getProviderDefinition,
  PROVIDERS,
  type ProviderDefinition,
  type ProviderId,
  resolveProviderApiKey,
  saveProviderSettings,
  setActiveProvider,
} from '../../utils/openclaudeConfig.js'
import type { OnDone } from '../model/model.js'

/**
 * Switch the active provider: saves the key (if new) and the choice to
 * ~/.openclaude/config.json, then points the running session at it.
 */
export function switchProvider(id: ProviderId, apiKey?: string): string {
  if (apiKey) {
    saveProviderSettings(id, { apiKey })
  }
  setActiveProvider(id)
  applyOpenRouterConfigToEnv()
  return getActiveProviderModel()
}

function useSwitchProvider(
  onDone: OnDone,
  onChangeAPIKey: () => void,
): (provider: ProviderDefinition, apiKey?: string) => void {
  const setAppState = useSetAppState()
  return (provider, apiKey) => {
    let model: string
    try {
      model = switchProvider(provider.id, apiKey)
    } catch (error) {
      onDone(`Falha ao salvar o provedor: ${(error as Error).message}`, {
        display: 'system',
      })
      return
    }
    setAppState(prev => ({
      ...prev,
      mainLoopModel: model,
      mainLoopModelForSession: null,
    }))
    onChangeAPIKey()
    onDone(
      `Provedor: ${chalk.bold(provider.label)} · modelo ${chalk.bold(model)}. Use /model para ver a lista deste provedor.`,
    )
  }
}

function KeyPrompt({
  provider,
  onSubmit,
  onCancel,
}: {
  provider: ProviderDefinition
  onSubmit: (apiKey: string) => void
  onCancel: () => void
}): React.ReactNode {
  const [value, setValue] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog
      title={`Chave do ${provider.label}`}
      onCancel={onCancel}
      color="permission"
    >
      <Box flexDirection="column" gap={1}>
        <Text>Cole a chave da API do {provider.label}:</Text>
        <Box flexDirection="row" gap={1}>
          <Text>›</Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={() => {
              const trimmed = value.trim()
              if (!trimmed) {
                setError('A chave é obrigatória')
                return
              }
              onSubmit(trimmed)
            }}
            focus
            showCursor
            mask="*"
            placeholder={provider.keyPlaceholder}
            columns={80}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
          />
        </Box>
        <Text dimColor>Crie uma chave em {provider.keyUrl}</Text>
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    </Dialog>
  )
}

function ProviderFlow({
  initial,
  onDone,
  onChangeAPIKey,
}: {
  initial: ProviderDefinition | null
  onDone: OnDone
  onChangeAPIKey: () => void
}): React.ReactNode {
  const [needsKey, setNeedsKey] = useState<ProviderDefinition | null>(null)
  const doSwitch = useSwitchProvider(onDone, onChangeAPIKey)
  const current = getActiveProviderId()

  const choose = (provider: ProviderDefinition) => {
    const existing = resolveProviderApiKey(provider.id)
    if (existing) {
      // Persist keys found only in the environment so the choice survives.
      doSwitch(provider, existing)
    } else {
      setNeedsKey(provider)
    }
  }

  React.useEffect(() => {
    if (initial) choose(initial)
    // Run once for a provider passed as argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (needsKey) {
    return (
      <KeyPrompt
        provider={needsKey}
        onSubmit={key => doSwitch(needsKey, key)}
        onCancel={() =>
          onDone('Troca de provedor cancelada', { display: 'system' })
        }
      />
    )
  }
  if (initial) return null

  return (
    <Dialog
      title="Provedor de modelos"
      onCancel={() =>
        onDone('Provedor mantido', { display: 'system' })
      }
      color="permission"
    >
      <Select
        defaultValue={current}
        defaultFocusValue={current}
        options={PROVIDERS.map(p => ({
          value: p.id,
          label: `${p.label}${p.id === current ? ' (atual)' : ''}`,
          description: `${p.description} · ${resolveProviderApiKey(p.id) ? 'chave ok' : 'pede a chave'}`,
        }))}
        onChange={value => choose(getProviderDefinition(value)!)}
        onCancel={() => onDone('Provedor mantido', { display: 'system' })}
      />
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const arg = args?.trim().toLowerCase() || ''
  let initial: ProviderDefinition | null = null
  if (arg) {
    const alias: Record<string, ProviderId> = {
      'z.ai': 'zai',
      glm: 'zai',
      zhipu: 'zai',
      ms: 'modelscope',
      modelscope: 'modelscope',
      or: 'openrouter',
      openrouter: 'openrouter',
      deepseek: 'deepseek',
      ds: 'deepseek',
    }
    initial = getProviderDefinition(alias[arg] ?? arg) ?? null
    if (!initial) {
      onDone(
        `Provedor desconhecido: ${arg}. Opções: ${PROVIDERS.map(p => p.id).join(', ')}`,
        { display: 'system' },
      )
      return
    }
  }
  return (
    <ProviderFlow
      initial={initial}
      onDone={onDone}
      onChangeAPIKey={context.onChangeAPIKey}
    />
  )
}
