import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_CODE_BROWSER_MCP_SERVER_NAME,
  getClaudeCodeBrowserMcpConfig,
} from './setup.js'

describe('getClaudeCodeBrowserMcpConfig', () => {
  const originalDisable = process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ccbrowser-'))
    delete process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER
  })

  afterEach(() => {
    if (originalDisable === undefined) {
      delete process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER
    } else {
      process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER = originalDisable
    }
    rmSync(home, { recursive: true, force: true })
  })

  function install(): string {
    const dir = join(home, '.claudecodebrowser', 'mcp-server')
    mkdirSync(dir, { recursive: true })
    const wrapper = join(dir, 'stdio_wrapper.py')
    writeFileSync(wrapper, '')
    return wrapper
  }

  test('returns nothing when not installed', () => {
    expect(getClaudeCodeBrowserMcpConfig([], home)).toEqual({})
  })

  test('returns a stdio config when installed', () => {
    const wrapper = install()
    expect(getClaudeCodeBrowserMcpConfig([], home)).toEqual({
      [CLAUDE_CODE_BROWSER_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: 'python3',
        args: [wrapper],
        scope: 'dynamic',
      },
    })
  })

  test('respects the opt-out env var', () => {
    install()
    process.env.OPENCLAUDE_DISABLE_CLAUDECODEBROWSER = '1'
    expect(getClaudeCodeBrowserMcpConfig([], home)).toEqual({})
  })

  test('does not override a server already configured', () => {
    install()
    expect(
      getClaudeCodeBrowserMcpConfig([CLAUDE_CODE_BROWSER_MCP_SERVER_NAME], home),
    ).toEqual({})
  })
})
