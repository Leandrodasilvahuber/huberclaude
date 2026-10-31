import type { Command } from '../../commands.js'

const agents = {
  type: 'local-jsx',
  name: 'agents',
  description: 'Show agents as a diagram and create, edit or delete them',
  load: () => import('./agents.js'),
} satisfies Command

export default agents
