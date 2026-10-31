import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_CODE_BROWSER_MCP_SERVER_NAME,
  getClaudeCodeBrowserMcpConfig,
  shouldAutoRegisterClaudeCodeBrowser,
} from './setup.js'

const hasPython = () => '/usr/bin/python3'

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
    expect(getClaudeCodeBrowserMcpConfig({ home, findPython: hasPython })).toEqual({})
  })

  test('returns a stdio config when installed', () => {
    const wrapper = install()
    expect(getClaudeCodeBrowserMcpConfig({ home, findPython: hasPython })).toEqual({
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
    expect(getClaudeCodeBrowserMcpConfig({ home, findPython: hasPython })).toEqual({})
  })

  test('returns nothing when python3 is not on PATH', () => {
    install()
    expect(getClaudeCodeBrowserMcpConfig({ home, findPython: () => null })).toEqual({})
  })

  test('does not override a server already configured', () => {
    install()
    expect(
      getClaudeCodeBrowserMcpConfig({
        home,
        findPython: hasPython,
        getExistingServerNames: () => [CLAUDE_CODE_BROWSER_MCP_SERVER_NAME],
      }),
    ).toEqual({})
  })

  test('does not read existing server names when not installed', () => {
    let called = false
    getClaudeCodeBrowserMcpConfig({
      home,
      findPython: hasPython,
      getExistingServerNames: () => {
        called = true
        return []
      },
    })
    expect(called).toBe(false)
  })
})

describe('shouldAutoRegisterClaudeCodeBrowser', () => {
  const base = { strictMcpConfig: false, bareMode: false, enterpriseMcpConfig: false }

  test('registers in a normal session', () => {
    expect(shouldAutoRegisterClaudeCodeBrowser(base)).toBe(true)
  })

  test('skips with --strict-mcp-config', () => {
    expect(shouldAutoRegisterClaudeCodeBrowser({ ...base, strictMcpConfig: true })).toBe(false)
  })

  test('skips with --bare', () => {
    expect(shouldAutoRegisterClaudeCodeBrowser({ ...base, bareMode: true })).toBe(false)
  })

  test('skips when a managed-mcp.json is present', () => {
    expect(shouldAutoRegisterClaudeCodeBrowser({ ...base, enterpriseMcpConfig: true })).toBe(false)
  })
})
