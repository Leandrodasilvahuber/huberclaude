import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { isEnvTruthy } from '../envUtils.js'
import { whichSync } from '../which.js'

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
 * Auto-registration only happens when MCP discovery is on: --strict-mcp-config
 * and --bare mean "only what I passed", and a managed-mcp.json rejects every
 * dynamic stdio server (startup would exit with an error).
 */
export function shouldAutoRegisterClaudeCodeBrowser({
  strictMcpConfig,
  bareMode,
  enterpriseMcpConfig,
}: {
  strictMcpConfig: boolean
  bareMode: boolean
  enterpriseMcpConfig: boolean
}): boolean {
  return !strictMcpConfig && !bareMode && !enterpriseMcpConfig
}

export type ClaudeCodeBrowserMcpOptions = {
  /**
   * Names of servers already configured by the user/CLI. Called only when the
   * browser is installed, so config files are not parsed for nothing.
   */
  getExistingServerNames?: () => Iterable<string>
  home?: string
  findPython?: (command: string) => string | null
}

/**
 * MCP config for the ClaudeCodeBrowser (Firefox) server when it is installed
 * in ~/.claudecodebrowser. Returns an empty object when it is not installed,
 * python3 is missing, it is disabled by env, or already configured by the
 * user/CLI.
 */
export function getClaudeCodeBrowserMcpConfig({
  getExistingServerNames = () => [],
  home = homedir(),
  findPython = whichSync,
}: ClaudeCodeBrowserMcpOptions = {}): Record<string, ScopedMcpServerConfig> {
  if (isEnvTruthy(process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER)) {
    return {}
  }
  const wrapper = getClaudeCodeBrowserWrapperPath(home)
  if (!existsSync(wrapper)) {
    return {}
  }
  // Without python3 the server would show up as failed on every session.
  if (!findPython('python3')) {
    return {}
  }
  for (const name of getExistingServerNames()) {
    if (name === CLAUDE_CODE_BROWSER_MCP_SERVER_NAME) {
      return {}
    }
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
