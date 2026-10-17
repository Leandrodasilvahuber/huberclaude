import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import {
  resolveOpenRouterApiKey,
  saveOpenRouterConfig,
} from '../../utils/openclaudeConfig.js'
import { OpenRouterModelPicker } from './OpenRouterModelPicker.js'

export type OnDone = (
  result?: string,
  options?: { display?: CommandResultDisplay },
) => void

/** Persist the OpenRouter model and point the running session at it. */
export function persistOpenRouterModel(model: string): void {
  // OPENAI_MODEL takes precedence over settings.model for the OpenAI shim.
  process.env.OPENAI_MODEL = model
  saveOpenRouterConfig({ model })
}

export function useSetOpenRouterModel(onDone: OnDone): (model: string) => void {
  const setAppState = useSetAppState()
  return (model: string) => {
    try {
      persistOpenRouterModel(model)
    } catch (error) {
      onDone(`Failed to save model: ${(error as Error).message}`, {
        display: 'system',
      })
      return
    }
    setAppState(prev => ({
      ...prev,
      mainLoopModel: model,
      mainLoopModelForSession: null,
    }))
    onDone(`Set model to ${chalk.bold(model)}`)
  }
}

function OpenRouterModelPickerWrapper({ onDone }: { onDone: OnDone }) {
  const mainLoopModel = useAppState((s: AppState) => s.mainLoopModel)
  const setModel = useSetOpenRouterModel(onDone)
  const currentModel = mainLoopModel ?? getMainLoopModel()

  return (
    <OpenRouterModelPicker
      currentModel={currentModel}
      onSelect={setModel}
      onCancel={() =>
        onDone(`Kept model as ${chalk.bold(currentModel)}`, {
          display: 'system',
        })
      }
      onError={message => onDone(message, { display: 'system' })}
    />
  )
}

function SetModelAndClose({ model, onDone }: { model: string; onDone: OnDone }) {
  const setModel = useSetOpenRouterModel(onDone)
  React.useEffect(() => {
    setModel(model)
    // Run once for the requested model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function ShowModelAndClose({ onDone }: { onDone: OnDone }) {
  const mainLoopModel = useAppState((s: AppState) => s.mainLoopModel)
  React.useEffect(() => {
    onDone(
      `Current OpenRouter model: ${chalk.bold(mainLoopModel ?? getMainLoopModel())}`,
      { display: 'system' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmedArgs = args?.trim() || ''

  if (COMMON_INFO_ARGS.includes(trimmedArgs)) {
    return <ShowModelAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(trimmedArgs)) {
    onDone(
      'Run /model to pick an OpenRouter model (price and context shown), or /model <openrouter-model-id> to set it directly.',
      { display: 'system' },
    )
    return
  }

  if (!resolveOpenRouterApiKey()) {
    onDone('No OpenRouter API key configured. Run /login first.', {
      display: 'system',
    })
    return
  }

  if (trimmedArgs) {
    return <SetModelAndClose model={trimmedArgs} onDone={onDone} />
  }

  return <OpenRouterModelPickerWrapper onDone={onDone} />
}
