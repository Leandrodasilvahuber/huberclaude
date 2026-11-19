import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'
import { getActiveProvider } from '../../utils/openclaudeConfig.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Choose a ${getActiveProvider().label} model (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model-id]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command
