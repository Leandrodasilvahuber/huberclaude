import chalk from 'chalk'
import * as React from 'react'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import { useSetAppState } from '../../state/AppState.js'
import { readMelhores, type MelhorModelo } from '../../utils/freeModels.js'
import {
  applyOpenRouterConfigToEnv,
  getActiveProviderId,
  resolveProviderApiKey,
  saveProviderSettings,
  setActiveProvider,
} from '../../utils/openclaudeConfig.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { OnDone } from '../model/model.js'

/**
 * Salva o modelo no provedor antes de ativá-lo, para que
 * applyOpenRouterConfigToEnv() aponte OPENAI_MODEL para ele.
 */
export function switchToMelhor(item: MelhorModelo): void {
  if (!resolveProviderApiKey(item.provider)) {
    throw new Error(`sem chave para ${item.label}; configure com /provedor ${item.provider}`)
  }
  saveProviderSettings(item.provider, { model: item.model })
  setActiveProvider(item.provider)
  applyOpenRouterConfigToEnv()
}

function MelhorFlow({
  lista,
  onDone,
  onChangeAPIKey,
}: {
  lista: MelhorModelo[]
  onDone: OnDone
  onChangeAPIKey: () => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const current = getActiveProviderId()
  const cancel = () => onDone('Modelo mantido', { display: 'system' })

  const select = (item: MelhorModelo) => {
    try {
      switchToMelhor(item)
    } catch (error) {
      onDone(`Falha ao trocar o modelo: ${(error as Error).message}`, {
        display: 'system',
      })
      return
    }
    setAppState(prev => ({
      ...prev,
      mainLoopModel: item.model,
      mainLoopModelForSession: null,
    }))
    onChangeAPIKey()
    onDone(`Modelo: ${chalk.bold(item.model)} · provedor ${chalk.bold(item.label)}.`)
  }

  return (
    <Dialog title="Melhores modelos grátis" onCancel={cancel} color="permission">
      <Box flexDirection="column" gap={1}>
        <Text>Selecione um modelo para usá-lo:</Text>
        <Select
          defaultValue={0}
          options={lista.map((item, i) => ({
            value: i,
            label: `${item.model} · ${item.label}`,
            description:
              item.provider === current ? 'provedor atual' : 'muda o provedor e o modelo',
          }))}
          onChange={index => select(lista[index]!)}
          onCancel={cancel}
        />
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const lista = readMelhores()
  if (lista.length === 0) {
    onDone(
      'A lista /melhores está vazia. Rode /melhores-atualizar para preenchê-la.',
      { display: 'system' },
    )
    return
  }
  return <MelhorFlow lista={lista} onDone={onDone} onChangeAPIKey={context.onChangeAPIKey} />
}
