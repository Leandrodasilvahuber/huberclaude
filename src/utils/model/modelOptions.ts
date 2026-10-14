import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getDefaultMainLoopModelSetting,
  getUserSpecifiedModelSetting,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getDefaultOptionForUser(): ModelOption {
  return {
    value: null,
    label: 'Default (recommended)',
    description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`,
  }
}

/**
 * Options for the in-session model list. HuberClaude talks only to OpenRouter,
 * whose catalog is browsed by the `/model` OpenRouter picker, so this list is
 * the default plus whichever custom model is currently selected.
 */
export function getModelOptions(): ModelOption[] {
  const options: ModelOption[] = [getDefaultOptionForUser()]

  const customModel: ModelSetting =
    getUserSpecifiedModelSetting() ?? getInitialMainLoopModel()
  if (customModel !== null && customModel !== undefined) {
    options.push({
      value: customModel,
      label: customModel,
      description: 'Custom model',
    })
  }

  return filterModelOptionsByAllowlist(options)
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  const filtered = !settings.availableModels
    ? options
    : options.filter(opt => opt.value === null || isModelAllowed(opt.value))

  // Select state uses option values as identity keys; drop duplicates.
  const seen = new Set<string>()
  return filtered.filter(opt => {
    const key = String(opt.value)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
