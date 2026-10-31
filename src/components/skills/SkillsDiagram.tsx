import * as React from 'react'
import { useCallback, useState } from 'react'
import {
  type Command,
  type CommandBase,
  clearCommandsCache,
  getCommands,
  type PromptCommand,
} from '../../commands.js'
import { getCwd } from '../../utils/cwd.js'
import { getDisplayPath } from '../../utils/file.js'
import { plural } from '../../utils/stringUtils.js'
import {
  type DiagramGroup,
  type DiagramItem,
  ResourceDiagram,
} from '../diagram/ResourceDiagram.js'
import {
  createSkillFile,
  deleteSkillFiles,
  getSkillsDir,
  type SkillLocation,
  validateSkillName,
} from './skillFileUtils.js'

type SkillCommand = CommandBase & PromptCommand

type Props = {
  commands: Command[]
  onExit: (message: string) => void
}

const GROUPS: { source: string; title: string }[] = [
  { source: 'projectSettings', title: 'Project' },
  { source: 'localSettings', title: 'Local' },
  { source: 'userSettings', title: 'User' },
  { source: 'policySettings', title: 'Managed' },
  { source: 'flagSettings', title: 'CLI flag' },
  { source: 'plugin', title: 'Plugins' },
  { source: 'mcp', title: 'MCP' },
  { source: 'bundled', title: 'Built-in' },
]

// Only skills the user wrote can be changed from here; managed, plugin, MCP
// and built-in ones come from somewhere else and would come back anyway.
const EDITABLE_SOURCES = new Set(['projectSettings', 'localSettings', 'userSettings'])

export function isSkillCommand(cmd: Command): cmd is SkillCommand {
  return (
    cmd.type === 'prompt' &&
    (cmd.loadedFrom === 'skills' ||
      cmd.loadedFrom === 'commands_DEPRECATED' ||
      cmd.loadedFrom === 'plugin' ||
      cmd.loadedFrom === 'mcp' ||
      cmd.loadedFrom === 'bundled')
  )
}

function skillKey(skill: SkillCommand): string {
  return `${skill.source}:${skill.name}`
}

export function buildSkillGroups(commands: Command[]): DiagramGroup[] {
  const skills = commands.filter(isSkillCommand)
  const bySource = new Map<string, SkillCommand[]>()
  for (const skill of skills) {
    const source = skill.loadedFrom === 'bundled' ? 'bundled' : skill.source
    bySource.set(source, [...(bySource.get(source) ?? []), skill])
  }

  const groups: DiagramGroup[] = []
  for (const { source, title } of GROUPS) {
    const groupSkills = (bySource.get(source) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    const showWhenEmpty = source === 'projectSettings' || source === 'userSettings'
    if (groupSkills.length === 0 && !showWhenEmpty) continue
    const items: DiagramItem[] = groupSkills.map(skill => {
      const editable = EDITABLE_SOURCES.has(source) && Boolean(skill.skillFilePath)
      const pluginName = skill.pluginInfo?.pluginManifest.name
      return {
        key: skillKey(skill),
        name: skill.name,
        description: skill.description || skill.whenToUse || '',
        path: skill.skillFilePath,
        editable,
        note: [
          pluginName,
          skill.loadedFrom === 'commands_DEPRECATED' ? 'legacy commands/ file' : undefined,
          editable ? undefined : 'read-only',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      }
    })
    groups.push({
      key: source,
      title,
      subtitle: source === 'projectSettings' || source === 'userSettings'
        ? getDisplayPath(getSkillsDir(source as SkillLocation))
        : undefined,
      items,
    })
  }
  return groups
}

export function SkillsDiagram({ commands: initialCommands, onExit }: Props): React.ReactNode {
  const [commands, setCommands] = useState(initialCommands)

  const reload = useCallback(async () => {
    clearCommandsCache()
    setCommands(await getCommands(getCwd()))
  }, [])

  const findSkill = (item: DiagramItem) =>
    commands.filter(isSkillCommand).find(skill => skillKey(skill) === item.key)

  return (
    <ResourceDiagram
      title="Skills"
      noun="skill"
      groups={buildSkillGroups(commands)}
      locations={[
        {
          value: 'projectSettings',
          label: 'Project',
          description: getDisplayPath(getSkillsDir('projectSettings')),
        },
        {
          value: 'userSettings',
          label: 'User (all projects)',
          description: getDisplayPath(getSkillsDir('userSettings')),
        },
      ]}
      validateName={name => {
        const problem = validateSkillName(name)
        if (problem) return problem
        const taken = commands.some(cmd => cmd.name === name)
        return taken ? `A skill or command named "${name}" already exists` : null
      }}
      onCreate={(location, name, description) =>
        createSkillFile(location as SkillLocation, name, description)
      }
      onDelete={async item => {
        const skill = findSkill(item)
        if (!skill) throw new Error(`Skill not found: ${item.name}`)
        await deleteSkillFiles(skill)
      }}
      onReload={reload}
      onExit={changes =>
        onExit(
          changes.length > 0
            ? `${changes.length} ${plural(changes.length, 'change')}:\n${changes.map(c => `  · ${c}`).join('\n')}`
            : 'Skills dialog dismissed',
        )
      }
    />
  )
}
