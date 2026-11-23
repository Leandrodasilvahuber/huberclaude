import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'melhores',
  aliases: ['best'],
  get description() {
    return 'Lista os melhores modelos grátis salvos (atualize com /melhores-atualizar)'
  },
  argumentHint: '',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./melhores.js'),
} satisfies Command
