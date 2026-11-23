import chalk from 'chalk'
import * as React from 'react'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import { useSetAppState } from '../../state/AppState.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  applyOpenRouterConfigToEnv,
  getActiveProvider,
  getActiveProviderId,
  saveOpenRouterConfig,
  saveProviderSettings,
  setActiveProvider,
  type ProviderId,
} from '../../utils/openclaudeConfig.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { OnDone } from '../model/model.js'

interface MelhorModelo {
  provider: ProviderId
  model: string
  label: string
}

/** Chave sob providers.* usada para persistir a lista /melhores. */
const MELHORES_KEY = 'melhores'

function readMelhores(): MelhorModelo[] {
  try {
    const configFile = path.join(getClaudeConfigHomeDir(), 'config.json')
    if (!fs.existsSync(configFile)) return []
    const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    const providers = data && typeof data === 'object' ? data.providers : undefined
    const raw = providers && typeof providers === 'object' ? (providers as Record<string, unknown>)[MELHORES_KEY] : undefined
    if (!raw || !Array.isArray(raw)) return []
    return raw
      .filter(
        (item): item is MelhorModelo =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as MelhorModelo).provider === 'string' &&
          typeof (item as MelhorModelo).model === 'string' &&
          typeof (item as MelhorModelo).label === 'string',
      )
      .slice(0, 50)
  } catch {
    return []
  }
}

function switchToMelhor(item: MelhorModelo): string {
  const current = getActiveProviderId()
  if (item.provider !== current) {
    setActiveProvider(item.provider)
    applyOpenRouterConfigToEnv()
  }
  saveProviderSettings(item.provider, { model: item.model })
  return item.model
}

function useSwitchMelhor(
  onDone: OnDone,
): (item: MelhorModelo) => void {
  const setAppState = useSetAppState()
  return item => {
    let model: string
    try {
      model = switchToMelhor(item)
    } catch (error) {
      onDone(`Falha ao salvar o modelo: ${(error as Error).message}`, {
        display: 'system',
      })
      return
    }
    setAppState(prev => ({
      ...prev,
      mainLoopModel: model,
      mainLoopModelForSession: null,
    }))
    onDone(
      `Modelo: ${chalk.bold(item.label)} · provedor ${chalk.bold(
        item.provider,
      )}.`,
    )
  }
}

function MelhorFlow({
  onDone,
  context,
}: {
  onDone: OnDone
  context: { onChangeAPIKey: () => void }
}): React.ReactNode {
  const lista = readMelhores()
  const currentProvider = getActiveProviderId()
  const doSelect = useSwitchMelhor(onDone)

  return (
    <Dialog
      title="Melhores modelos grátis"
      onCancel={() => onDone('Melhores mantidos', { display: 'system' })}
      color="permission"
    >
      <Box flexDirection="column" gap={1}>
        <Text>Selecione um modelo para usá-lo:</Text>
        <Select
          defaultValue={0}
          options={lista.map((item, i) => ({
            value: i,
            label: `${item.label} · ${item.provider} · ${item.model}`,
            description:
              item.provider === currentProvider
                ? 'provedor atual'
                : 'muda o provedor e o modelo',
          }))}
          onChange={index => {
            const item = lista[index]
            doSelect(item)
            context.onChangeAPIKey()
          }}
          onCancel={() => onDone('Melhores mantidos', { display: 'system' })}
        />
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (_onDone, context, _args) => {
  const lista = readMelhores()
  if (lista.length === 0) {
    _onDone(
      'A lista /melhores está vazia. Rode /atualizar-modelos-free para preenchê-la.',
      { display: 'system' },
    )
    return
  }

  return (
    <MelhorFlow onDone={_onDone} context={context} />
  )
}
