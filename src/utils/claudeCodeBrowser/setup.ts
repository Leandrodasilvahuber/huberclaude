import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { isEnvTruthy } from '../envUtils.js'

export const CLAUDE_CODE_BROWSER_MCP_SERVER_NAME = 'claudecodebrowser'

export function getClaudeCodeBrowserWrapperPath(home = homedir()): string {
  return join(
    home,
    '.claudecodebrowser',
    'mcp-server',
    'stdio_wrapper.py',
  )
}

/**
 * MCP config for the ClaudeCodeBrowser (Firefox) server when it is installed
 * in ~/.claudecodebrowser. Returns an empty object when it is not installed,
 * disabled by env, or already configured by the user/CLI.
 */
export function getClaudeCodeBrowserMcpConfig(
  existingServerNames: Iterable<string> = [],
  home = homedir(),
): Record<string, ScopedMcpServerConfig> {
  if (isEnvTruthy(process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER)) {
    return {}
  }
  for (const name of existingServerNames) {
    if (name === CLAUDE_CODE_BROWSER_MCP_SERVER_NAME) {
      return {}
    }
  }
  const wrapper = getClaudeCodeBrowserWrapperPath(home)
  if (!existsSync(wrapper)) {
    return {}
  }
  return {
    [CLAUDE_CODE_BROWSER_MCP_SERVER_NAME]: {
      type: 'stdio' as const,
      command: 'python3',
      args: [wrapper],
      scope: 'dynamic' as const,
    },
  }
}
