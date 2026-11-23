import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'melhores-atualizar',
  aliases: ['atualizar-melhores'],
  get description() {
    return 'Busca e testa os modelos grátis de todos os provedores e atualiza a lista /melhores'
  },
  argumentHint: '',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./melhoresAtualizar.js'),
} satisfies Command
