import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'huber',
  description: 'Huber recommended models — pick a curated OpenRouter model',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./huber.js'),
} satisfies Command
