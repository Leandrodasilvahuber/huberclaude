import { dirname } from 'path'
import * as React from 'react'
import { useCallback } from 'react'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import {
  type AgentDefinition,
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getCwd } from '../../utils/cwd.js'
import { getDisplayPath } from '../../utils/file.js'
import { plural } from '../../utils/stringUtils.js'
import {
  type DiagramGroup,
  type DiagramItem,
  ResourceDiagram,
} from '../diagram/ResourceDiagram.js'
import {
  deleteAgentFromFile,
  getActualAgentFilePath,
  getNewAgentFilePath,
  saveAgentToFile,
} from './agentFileUtils.js'
import { validateAgentType } from './validateAgent.js'

type Props = {
  onExit: (message: string) => void
  onSetActiveAgent?: (agent: AgentDefinition) => void
}

type AgentLocation = 'projectSettings' | 'userSettings'

const GROUPS: { source: AgentDefinition['source']; title: string }[] = [
  { source: 'projectSettings', title: 'Project' },
  { source: 'localSettings', title: 'Local' },
  { source: 'userSettings', title: 'User' },
  { source: 'policySettings', title: 'Managed' },
  { source: 'flagSettings', title: 'CLI flag' },
  { source: 'plugin', title: 'Plugins' },
  { source: 'sdk', title: 'SDK' },
  { source: 'built-in', title: 'Built-in' },
]

// Agents backed by a markdown file the user owns.
const EDITABLE_SOURCES = new Set<AgentDefinition['source']>([
  'projectSettings',
  'localSettings',
  'userSettings',
])

const NEW_AGENT_PROMPT = `You are a specialized agent. Describe here your role, the steps you follow and what you return when you are done.`

function agentKey(agent: AgentDefinition): string {
  return `${agent.source}:${agent.agentType}`
}

function agentsDirFor(location: AgentLocation): string {
  // getNewAgentFilePath returns <dir>/<name>.md; show only the folder.
  return getDisplayPath(dirname(getNewAgentFilePath({ source: location, agentType: 'x' })))
}

export function buildAgentGroups(
  agents: AgentDefinition[],
  activeAgents: AgentDefinition[],
): DiagramGroup[] {
  const groups: DiagramGroup[] = []
  for (const { source, title } of GROUPS) {
    const groupAgents = agents
      .filter(agent => agent.source === source)
      .sort((a, b) => a.agentType.localeCompare(b.agentType))
    const showWhenEmpty = source === 'projectSettings' || source === 'userSettings'
    if (groupAgents.length === 0 && !showWhenEmpty) continue
    const items: DiagramItem[] = groupAgents.map(agent => {
      const editable = EDITABLE_SOURCES.has(agent.source)
      // An agent with the same name from a higher-priority source wins.
      const shadowed = !activeAgents.some(
        active => active.agentType === agent.agentType && active.source === agent.source,
      )
      return {
        key: agentKey(agent),
        name: agent.agentType,
        description: agent.whenToUse,
        path: editable ? getActualAgentFilePath(agent) : undefined,
        editable,
        note: [
          agent.model ? `model: ${agent.model}` : undefined,
          agent.tools && !(agent.tools.length === 1 && agent.tools[0] === '*')
            ? `${agent.tools.length} ${plural(agent.tools.length, 'tool')}`
            : 'all tools',
          shadowed ? 'shadowed' : undefined,
          editable ? undefined : 'read-only',
        ]
          .filter(Boolean)
          .join(' · '),
      }
    })
    groups.push({
      key: source,
      title,
      subtitle: showWhenEmpty ? agentsDirFor(source as AgentLocation) : undefined,
      items,
    })
  }
  return groups
}

export function AgentsDiagram({ onExit, onSetActiveAgent }: Props): React.ReactNode {
  const agentDefinitions = useAppState(s => s.agentDefinitions)
  const activeAgentName = useAppState(s => s.agent)
  const setAppState = useSetAppState()
  const { allAgents, activeAgents } = agentDefinitions

  const reload = useCallback(async () => {
    getAgentDefinitionsWithOverrides.cache.clear?.()
    const fresh = await getAgentDefinitionsWithOverrides(getCwd())
    setAppState(state => {
      // --agents (CLI flag) agents are not on disk; keep them.
      const cliAgents = state.agentDefinitions.allAgents.filter(a => a.source === 'flagSettings')
      const freshAllAgents = [...fresh.allAgents, ...cliAgents]
      return {
        ...state,
        agentDefinitions: {
          ...fresh,
          allAgents: freshAllAgents,
          activeAgents: getActiveAgentsFromList(freshAllAgents),
        },
      }
    })
  }, [setAppState])

  return (
    <ResourceDiagram
      title={activeAgentName ? `Agents · session agent: ${activeAgentName}` : 'Agents'}
      noun="agent"
      groups={buildAgentGroups(allAgents, activeAgents)}
      locations={[
        { value: 'projectSettings', label: 'Project', description: agentsDirFor('projectSettings') },
        { value: 'userSettings', label: 'User (all projects)', description: agentsDirFor('userSettings') },
      ]}
      validateName={name => {
        const problem = validateAgentType(name)
        if (problem) return problem
        const taken = allAgents.some(
          agent => agent.agentType === name && EDITABLE_SOURCES.has(agent.source),
        )
        return taken ? `An agent named "${name}" already exists` : null
      }}
      onCreate={async (location, name, description) => {
        await saveAgentToFile(location as AgentLocation, name, description, undefined, NEW_AGENT_PROMPT)
        return getNewAgentFilePath({ source: location as AgentLocation, agentType: name })
      }}
      onDelete={async item => {
        const agent = allAgents.find(a => agentKey(a) === item.key)
        if (!agent) throw new Error(`Agent not found: ${item.name}`)
        await deleteAgentFromFile(agent)
      }}
      onReload={reload}
      extraAction={
        onSetActiveAgent
          ? {
              input: 'a',
              label: 'use in this session',
              run: item => {
                const agent = activeAgents.find(a => agentKey(a) === item.key)
                if (!agent) return `${item.name} is shadowed by another agent with the same name`
                onSetActiveAgent(agent)
                return `Session agent: ${agent.agentType}`
              },
            }
          : undefined
      }
      onExit={changes =>
        onExit(
          changes.length > 0
            ? `${changes.length} ${plural(changes.length, 'change')}:\n${changes.map(c => `  · ${c}`).join('\n')}`
            : 'Agents dialog dismissed',
        )
      }
    />
  )
}
