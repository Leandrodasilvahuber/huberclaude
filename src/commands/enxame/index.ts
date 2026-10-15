import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'enxame',
  description: 'Register z.ai accounts for the swarm',
  load: () => import('./enxame.js'),
} satisfies Command
