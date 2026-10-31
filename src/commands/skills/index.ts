import type { Command } from '../../commands.js'

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: 'Show skills as a diagram and create, edit or delete them',
  load: () => import('./skills.js'),
} satisfies Command

export default skills
