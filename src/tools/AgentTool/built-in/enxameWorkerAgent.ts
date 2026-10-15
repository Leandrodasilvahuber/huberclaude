import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { AGENT_TOOL_NAME } from '../constants.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

export const ENXAME_WORKER_AGENT_TYPE = 'enxame-worker'

const ENXAME_WORKER_WHEN_TO_USE =
  'Cheap, fast worker running on a z.ai GLM flash model (the Enxame swarm). Use it for well-scoped, mechanical sub-tasks that need tools (read/search files, run a command, make a small edit) so you save your own tokens; launch several in parallel in one message (respect the configured worker limit). Give it a precise, self-contained brief: exact files, exact goal, expected output format. It does not see this conversation. Keep planning, hard reasoning and final decisions for yourself, and verify its result.'

function getEnxameWorkerSystemPrompt(): string {
  return `You are a worker in a swarm. A manager agent gave you one precise task.

- Do exactly that task, nothing more. Do not expand scope.
- Use tools only as needed; prefer the fewest calls.
- Your final message is returned to the manager as data: give only the result, short and structured (bullets or JSON if asked). No greetings, no explanations of your process.
- If the task cannot be done, say why in one line.`
}

export const ENXAME_WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: ENXAME_WORKER_AGENT_TYPE,
  whenToUse: ENXAME_WORKER_WHEN_TO_USE,
  // No recursion: workers never spawn more agents.
  disallowedTools: [AGENT_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME],
  source: 'built-in',
  baseDir: 'built-in',
  // The model and provider are replaced by the z.ai route in agentRouting.
  model: 'inherit',
  omitClaudeMd: true,
  getSystemPrompt: () => getEnxameWorkerSystemPrompt(),
}
