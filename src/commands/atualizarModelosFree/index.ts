import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'atualizar-modelos-free',
  aliases: ['atualizar-free'],
  get description() {
    return `Busca e testa modelos grátis em todos os provedores e atualiza a lista /melhores`
  },
  argumentHint: '',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./atualizarModelosFree.js'),
} satisfies Command
