import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyOpenRouterConfigToEnv,
  getOpenRouterConfig,
  saveOpenRouterConfig,
} from './openclaudeConfig.js'

let tempDir: string
let originalConfigDir: string | undefined

beforeEach(() => {
  originalConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaude-config-'))
  process.env.OPENCLAUDE_CONFIG_DIR = tempDir
})

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.OPENCLAUDE_CONFIG_DIR
  } else {
    process.env.OPENCLAUDE_CONFIG_DIR = originalConfigDir
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('openclaudeConfig', () => {
  test('saves owner-only and merges fields', () => {
    saveOpenRouterConfig({ apiKey: 'sk-or-test', baseUrl: 'https://example.test/v1' })
    saveOpenRouterConfig({ model: 'qwen/qwen3-coder' })
    expect(getOpenRouterConfig()).toEqual({
      apiKey: 'sk-or-test',
      baseUrl: 'https://example.test/v1',
      model: 'qwen/qwen3-coder',
    })
    const mode = fs.statSync(path.join(tempDir, 'config.json')).mode
    expect(mode & 0o777).toBe(0o600)
  })

  test('returns false and leaves env untouched without a key', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_BASE_URL: 'http://localhost:4000/v1' }
    expect(applyOpenRouterConfigToEnv(env)).toBe(false)
    expect(env).toEqual({ OPENAI_BASE_URL: 'http://localhost:4000/v1' })
  })

  test('overrides inherited proxy env with the saved OpenRouter config', () => {
    saveOpenRouterConfig({ apiKey: 'sk-or-test', model: 'openai/gpt-4o' })
    const env: NodeJS.ProcessEnv = {
      OPENAI_BASE_URL: 'http://localhost:4000/v1',
      OPENAI_API_BASE: 'http://localhost:4000/v1',
      OPENAI_API_KEYS: 'a,b',
      OPENAI_MODEL: 'openrouter',
    }
    expect(applyOpenRouterConfigToEnv(env)).toBe(true)
    expect(env).toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_API_KEY: 'sk-or-test',
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENAI_MODEL: 'openai/gpt-4o',
    })
  })

  test('falls back to HUBERCLAUDE_OPENROUTER_API_KEY and the default model', () => {
    const env: NodeJS.ProcessEnv = { HUBERCLAUDE_OPENROUTER_API_KEY: 'sk-or-env' }
    expect(applyOpenRouterConfigToEnv(env)).toBe(true)
    expect(env.OPENAI_API_KEY).toBe('sk-or-env')
    expect(env.OPENAI_MODEL).toBe('qwen/qwen3-coder')
  })

  test('ignores the generic OPENROUTER_API_KEY', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'sk-or-other' }
    expect(applyOpenRouterConfigToEnv(env)).toBe(false)
    expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  })
})

test('leaves host-managed provider routing alone', () => {
  saveOpenRouterConfig({ apiKey: 'sk-or-test' })
  const env: NodeJS.ProcessEnv = {
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
  }
  expect(applyOpenRouterConfigToEnv(env)).toBe(false)
  expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
})
