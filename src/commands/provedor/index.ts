import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getActiveProvider } from '../../utils/openclaudeConfig.js'

export default {
  type: 'local-jsx',
  name: 'provedor',
  aliases: ['provider'],
  get description() {
    return `Trocar o provedor de modelos: OpenRouter, Z.ai, ModelScope ou DeepSeek (atual: ${getActiveProvider().label})`
  },
  argumentHint: '[openrouter|zai|modelscope|deepseek]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./provedor.js'),
} satisfies Command
