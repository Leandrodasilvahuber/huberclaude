import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type Tool } from '../Tool.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import { TOOL_SEARCH_TOOL_NAME } from '../tools/ToolSearchTool/constants.js'
import type { MemoryFileInfo } from '../utils/claudemd.js'
import type { ContextWarning, ContextWarnings } from '../utils/doctorContextWarnings.js'
import {
  statusNoticeDefinitions,
  type StatusNoticeContext,
} from '../utils/statusNoticeDefinitions.js'
import {
  buildLocalModelContextLoad,
  checkLocalModelContextLoad,
  isActiveProviderLocalModel,
  isLoopbackOllamaEndpoint,
  parseOllamaPsContextWarning,
} from '../utils/statusNoticeLocalModel.js'

const emptyPermissionContext = async () => getEmptyToolPermissionContext()
const CONTEXT_NOTICE_IDS = new Set([
  'large-memory-files',
  'large-agent-descriptions',
  'local-model-context-load',
])

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map(
    Object.keys(overrides).map(key => [key, process.env[key]]),
  )

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function getActiveContextNoticeIds(context: StatusNoticeContext): string[] {
  return statusNoticeDefinitions
    .filter(notice => CONTEXT_NOTICE_IDS.has(notice.id))
    .filter(notice => notice.isActive(context))
    .map(notice => notice.id)
}

function warning(
  type: ContextWarning['type'],
  currentValue: number,
  message: string,
  details: string[] = [],
): ContextWarning {
  return {
    type,
    severity: 'warning',
    message,
    details,
    currentValue,
    threshold: 1,
  }
}

function mcpTool(descriptionLength: number): Tool {
  return {
    name: 'mcp__bigserver__search',
    isMcp: true,
    mcpInfo: { serverName: 'bigserver', toolName: 'search' },
    inputJSONSchema: { type: 'object', properties: {} },
    async prompt() {
      return 'x'.repeat(descriptionLength)
    },
  } as unknown as Tool
}

function mcpToolWithCircularSchema(): Tool {
  const schema: Record<string, unknown> = { type: 'object' }
  schema.self = schema

  return {
    name: 'mcp__badserver__bad',
    isMcp: true,
    mcpInfo: { serverName: 'badserver', toolName: 'bad' },
    inputJSONSchema: schema,
    async prompt() {
      return 'bad schema tool'
    },
  } as unknown as Tool
}

function toolSearchTool(): Tool {
  return {
    name: TOOL_SEARCH_TOOL_NAME,
    isMcp: false,
    inputJSONSchema: { type: 'object', properties: {} },
    async prompt() {
      return 'search deferred tools'
    },
  } as unknown as Tool
}

const largeMemoryFile: MemoryFileInfo = {
  path: '/repo/CLAUDE.md',
  type: 'Project',
  content: 'x'.repeat(50_000),
}

const largeAgentDefinitions: AgentDefinitionsResult = {
  activeAgents: [
    {
      agentType: 'planner',
      whenToUse: 'x'.repeat(80_000),
      source: 'userSettings',
      getSystemPrompt: () => '',
    },
  ],
  allAgents: [],
}

describe('buildLocalModelContextLoad', () => {
  test('returns null when no context thresholds are exceeded', () => {
    const result = buildLocalModelContextLoad({
      claudeMdWarning: null,
      agentWarning: null,
      mcpWarning: null,
      unreachableRulesWarning: null,
    })

    expect(result).toBeNull()
  })

  test('formats compact startup lines and preserves doctor details', () => {
    const warnings: ContextWarnings = {
      mcpWarning: warning('mcp_tools', 31_200, 'Large MCP tools context', [
        'github: 21 tools (~31,200 tokens)',
      ]),
      agentWarning: warning('agent_descriptions', 16_500, 'Large agent descriptions', [
        'planner: ~9,000 tokens',
      ]),
      claudeMdWarning: warning('claudemd_files', 2, 'Large CLAUDE.md files', [
        '/repo/CLAUDE.md: 51,200 chars',
        '/repo/.claude/CLAUDE.md: 44,000 chars',
      ]),
      unreachableRulesWarning: warning('unreachable_rules', 1, 'Shadowed rule'),
    }

    const result = buildLocalModelContextLoad(warnings)

    expect(result?.lines).toEqual([
      'MCP tools: ~31.2k tokens',
      'Agent descriptions: ~16.5k tokens',
      'CLAUDE.md: 2 large files',
    ])
    expect(result?.contributors[1]?.details).toEqual([
      'planner: ~9,000 tokens',
    ])
  })

  test('includes Ollama context length contributor without other warnings', () => {
    const result = buildLocalModelContextLoad(null, [
      {
        id: 'ollama_context_length',
        message: 'Ollama context length is too small',
        details: ['llama3.1:8b: active CONTEXT is 4K'],
        summary: 'Ollama CONTEXT: 4K (OpenClaude requests 32K)',
      },
    ])

    expect(result?.lines).toEqual([
      'Ollama CONTEXT: 4K (OpenClaude requests 32K)',
    ])
  })
})

describe('parseOllamaPsContextWarning', () => {
  test('warns when a loaded Ollama model has a small active context', () => {
    const result = parseOllamaPsContextWarning(`
NAME            ID              SIZE      PROCESSOR    UNTIL              CONTEXT
llama3.1:8b     46e0c10c039e    6.7 GB    100% GPU     4 minutes from now 4K
`)

    expect(result).toMatchObject({
      id: 'ollama_context_length',
      summary: 'Ollama CONTEXT: 4K (OpenClaude requests 32K)',
    })
    expect(result?.details.join('\n')).toContain('OpenClaude requests 32768')
  })

  test('does not warn when the active context is already large enough', () => {
    const result = parseOllamaPsContextWarning(`
NAME            ID              SIZE      PROCESSOR    UNTIL              CONTEXT
llama3.1:8b     46e0c10c039e    6.7 GB    100% GPU     4 minutes from now 32K
`)

    expect(result).toBeNull()
  })

  test('only warns for the active model when multiple Ollama models are loaded', () => {
    const output = `
NAME            ID              SIZE      PROCESSOR    UNTIL              CONTEXT
tinyllama:1b    46e0c10c039e    1.1 GB    100% GPU     4 minutes from now 4K
llama3.1:8b     7e0c10c039e46    6.7 GB    100% GPU     4 minutes from now 32K
`

    expect(parseOllamaPsContextWarning(output, 'llama3.1:8b')).toBeNull()
    expect(parseOllamaPsContextWarning(output, 'tinyllama:1b')).toMatchObject({
      summary: 'Ollama CONTEXT: 4K (OpenClaude requests 32K)',
    })
  })

  test('ignores older ollama ps output without a context column', () => {
    const result = parseOllamaPsContextWarning(`
NAME            ID              SIZE      PROCESSOR    UNTIL
llama3.1:8b     46e0c10c039e    6.7 GB    100% GPU     4 minutes from now
`)

    expect(result).toBeNull()
  })
})

describe('startup status notices', () => {
  test('local providers use the aggregate context warning without duplicate generic notices', () => {
    const context = {
      config: {},
      agentDefinitions: largeAgentDefinitions,
      memoryFiles: [largeMemoryFile],
      isLocalModel: true,
      localModelContextLoad: {
        contributors: [
          {
            id: 'claudemd_files',
            message: 'Large CLAUDE.md file detected',
            details: ['/repo/CLAUDE.md: 50,000 chars'],
            summary: 'CLAUDE.md: 1 large file',
          },
        ],
        lines: ['CLAUDE.md: 1 large file'],
      },
    } as StatusNoticeContext

    const ids = getActiveContextNoticeIds(context)

    expect(ids).toContain('local-model-context-load')
    expect(ids).not.toContain('large-memory-files')
    expect(ids).not.toContain('large-agent-descriptions')
  })

  test('cloud providers keep existing generic context notices', () => {
    const context = {
      config: {},
      agentDefinitions: largeAgentDefinitions,
      memoryFiles: [largeMemoryFile],
      isLocalModel: false,
      localModelContextLoad: null,
    } as StatusNoticeContext

    const ids = getActiveContextNoticeIds(context)

    expect(ids).toContain('large-memory-files')
    expect(ids).toContain('large-agent-descriptions')
    expect(ids).not.toContain('local-model-context-load')
  })

  test('local providers fall back to generic context notices when aggregate warning is unavailable', () => {
    const context = {
      config: {},
      agentDefinitions: largeAgentDefinitions,
      memoryFiles: [largeMemoryFile],
      isLocalModel: true,
      localModelContextLoad: null,
    } as StatusNoticeContext

    const ids = getActiveContextNoticeIds(context)

    expect(ids).toContain('large-memory-files')
    expect(ids).toContain('large-agent-descriptions')
    expect(ids).not.toContain('local-model-context-load')
  })

  test('local providers keep generic context notices while aggregate warning is pending', () => {
    const context = {
      config: {},
      agentDefinitions: largeAgentDefinitions,
      memoryFiles: [largeMemoryFile],
      isLocalModel: true,
      localModelContextLoad: undefined,
    } as StatusNoticeContext

    const ids = getActiveContextNoticeIds(context)

    expect(ids).toContain('large-memory-files')
    expect(ids).toContain('large-agent-descriptions')
    expect(ids).not.toContain('local-model-context-load')
  })
})
