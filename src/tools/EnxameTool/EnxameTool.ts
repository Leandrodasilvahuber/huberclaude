import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { type EnxameTaskResult, runEnxameTasks } from '../../utils/enxameClient.js'
import {
  MAX_ENXAME_WORKERS,
  getEnxameAccount,
  isEnxameToolEnabled,
} from '../../utils/enxameConfig.js'
import { ENXAME_TOOL_NAME, getDescription } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    tasks: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('Short unique id to match the result.'),
          prompt: z
            .string()
            .min(1)
            .describe('Self-contained instruction with all the data the worker needs.'),
          system: z.string().optional().describe('Optional short system instruction.'),
        }),
      )
      .min(1)
      .max(MAX_ENXAME_WORKERS)
      .describe('Independent sub-tasks, run in parallel by z.ai workers.'),
    max_tokens: z
      .number()
      .int()
      .min(16)
      .max(8192)
      .optional()
      .describe('Max output tokens per worker. Default: 1024.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    results: z.array(
      z.union([
        z.object({ id: z.string(), ok: z.literal(true), model: z.string(), text: z.string() }),
        z.object({ id: z.string(), ok: z.literal(false), error: z.string() }),
      ]),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = { results: EnxameTaskResult[] }

function currentWorkers(): number {
  return getEnxameAccount()?.workers ?? MAX_ENXAME_WORKERS
}

export const EnxameTool = buildTool({
  name: ENXAME_TOOL_NAME,
  searchHint: 'parallel z.ai worker swarm for independent text sub-tasks',
  maxResultSizeChars: 100_000,
  async description() {
    return getDescription(currentWorkers())
  },
  userFacingName() {
    return 'Enxame'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    return `Running ${input?.tasks?.length ?? 0} z.ai workers`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isEnxameToolEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `enxame ${input.tasks.length} tasks`
  },
  async prompt() {
    return getDescription(currentWorkers())
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    // Compact one-line JSON: only what the manager needs to continue.
    const compact = output.results.map(r =>
      r.ok ? { id: r.id, ok: true, text: r.text } : { id: r.id, ok: false, error: r.error },
    )
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(compact),
    }
  },
  async validateInput({ tasks }) {
    const ids = new Set(tasks.map(t => t.id))
    if (ids.size !== tasks.length) {
      return { result: false, message: 'Task ids must be unique.', errorCode: 1 }
    }
    return { result: true }
  },
  async call({ tasks, max_tokens }, { abortController }) {
    const account = getEnxameAccount()
    if (!account) {
      throw new Error(
        'Enxame requires a z.ai API token. Configure it with /enxame.\n' +
        'The z.ai free tier provides unlimited sub-agent executions at zero cost.',
      )
    }
    if (!account.apiKey || account.apiKey.length < 8) {
      throw new Error(
        'Invalid z.ai API token configured. Please set a valid token with /enxame.\n' +
        'Only z.ai GLM (free tier) is supported for the enxame swarm.',
      )
    }
    if (!account.baseUrl || !account.baseUrl.includes('z.ai')) {
      throw new Error(
        'Enxame is restricted to z.ai GLM infrastructure only.\n' +
        'Invalid base URL configured. Contact support if you believe this is an error.',
      )
    }
    const results = await runEnxameTasks(account, tasks, {
      signal: abortController.signal,
      maxTokens: max_tokens,
    })
    return { data: { results } }
  },
} satisfies ToolDef<InputSchema, Output>)
