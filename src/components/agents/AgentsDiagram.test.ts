import { expect, test } from 'bun:test'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { buildAgentGroups } from './AgentsDiagram.js'

function agent(agentType: string, source: AgentDefinition['source'], extra: object = {}): AgentDefinition {
  const base = { agentType, whenToUse: `Use ${agentType}`, getSystemPrompt: () => '', ...extra }
  if (source === 'built-in') return { ...base, source, baseDir: 'built-in' } as AgentDefinition
  return { ...base, source } as AgentDefinition
}

test('groups agents by source, flags shadowed and read-only ones', () => {
  const userReviewer = agent('reviewer', 'userSettings', { model: 'sonnet' })
  const projectReviewer = agent('reviewer', 'projectSettings')
  const builtIn = agent('general-purpose', 'built-in')
  const groups = buildAgentGroups(
    [userReviewer, projectReviewer, builtIn],
    [projectReviewer, builtIn],
  )

  expect(groups.map(g => g.title)).toEqual(['Project', 'User', 'Built-in'])
  const user = groups.find(g => g.title === 'User')!.items[0]!
  expect(user.editable).toBe(true)
  expect(user.path).toEndWith('reviewer.md')
  expect(user.note).toContain('model: sonnet')
  expect(user.note).toContain('shadowed')
  const project = groups.find(g => g.title === 'Project')!.items[0]!
  expect(project.note).not.toContain('shadowed')
  const core = groups.find(g => g.title === 'Built-in')!.items[0]!
  expect(core.editable).toBe(false)
  expect(core.path).toBeUndefined()
})
