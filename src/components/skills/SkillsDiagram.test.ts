import { expect, test } from 'bun:test'
import type { Command } from '../../commands.js'
import { buildSkillGroups } from './SkillsDiagram.js'

function skill(name: string, source: string, loadedFrom: string, extra: object = {}): Command {
  return {
    type: 'prompt',
    name,
    description: `Use ${name}`,
    source,
    loadedFrom,
    progressMessage: '',
    contentLength: 0,
    getPromptForCommand: async () => [],
    ...extra,
  } as unknown as Command
}

test('groups skills by source and marks only user-owned ones editable', () => {
  const groups = buildSkillGroups([
    skill('zeta', 'userSettings', 'skills', { skillFilePath: '/h/.openclaude/skills/zeta/SKILL.md' }),
    skill('alpha', 'userSettings', 'skills', { skillFilePath: '/h/.openclaude/skills/alpha/SKILL.md' }),
    skill('helper', 'bundled', 'bundled'),
    skill('linter', 'plugin', 'plugin'),
    { type: 'local', name: 'clear' } as unknown as Command,
  ])

  expect(groups.map(g => g.title)).toEqual(['Project', 'User', 'Plugins', 'Built-in'])
  const user = groups.find(g => g.title === 'User')!
  expect(user.items.map(i => i.name)).toEqual(['alpha', 'zeta'])
  expect(user.items.every(i => i.editable)).toBe(true)
  expect(groups.find(g => g.title === 'Built-in')!.items[0]!.editable).toBe(false)
  expect(groups.find(g => g.title === 'Plugins')!.items[0]!.editable).toBe(false)
  expect(groups.find(g => g.title === 'Project')!.items).toEqual([])
})
