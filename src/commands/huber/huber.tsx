import chalk from 'chalk'
import * as React from 'react'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { resolveOpenRouterApiKey } from '../../utils/openclaudeConfig.js'
import { type OnDone, useSetOpenRouterModel } from '../model/model.js'
import { HuberPicker } from './HuberPicker.js'
import { isHuberModel } from './models.js'

function HuberPickerWrapper({ onDone }: { onDone: OnDone }) {
  // Same source of truth as /model, so a pick in either command shows up in
  // the other. A model outside the Huber list leaves no row marked current.
  const mainLoopModel = useAppState((s: AppState) => s.mainLoopModel)
  const setModel = useSetOpenRouterModel(onDone)
  const activeModel = mainLoopModel ?? getMainLoopModel()
  const currentModel = isHuberModel(activeModel) ? activeModel : null

  return (
    <HuberPicker
      currentModel={currentModel}
      onSelect={setModel}
      onCancel={() =>
        onDone(`Kept model as ${chalk.bold(activeModel)}`, {
          display: 'system',
        })
      }
    />
  )
}

export const call: LocalJSXCommandCall = async onDone => {
  if (!resolveOpenRouterApiKey()) {
    onDone('No OpenRouter API key configured. Run /login first.', {
      display: 'system',
    })
    return
  }

  return <HuberPickerWrapper onDone={onDone} />
}
