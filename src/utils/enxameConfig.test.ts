import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getEnxameAccount,
  removeEnxameAccount,
  saveEnxameAccount,
  setEnxameEnabled,
  testEnxameAccount,
} from './enxameConfig.js'
import { saveOpenRouterConfig } from './openclaudeConfig.js'

let tempDir: string
let originalConfigDir: string | undefined

const account = {
  apiKey: 'key-1',
  baseUrl: 'https://api.z.ai/api/paas/v4',
  model: 'glm-4.7-flash',
  fallbackModel: 'glm-4.5-flash',
  enabled: true,
}

beforeEach(() => {
  originalConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enxame-config-'))
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

describe('enxameConfig', () => {
  test('starts empty', () => {
    expect(getEnxameAccount()).toBeUndefined()
  })

  test('saves, replaces and removes the single account', () => {
    saveEnxameAccount('key-1')
    saveEnxameAccount('key-2')
    expect(getEnxameAccount()).toEqual({ ...account, apiKey: 'key-2' })
    removeEnxameAccount()
    expect(getEnxameAccount()).toBeUndefined()
  })

  test('toggles enabled and keeps it when the key is replaced', () => {
    saveEnxameAccount('key-1')
    setEnxameEnabled(false)
    expect(getEnxameAccount()?.enabled).toBe(false)
    saveEnxameAccount('key-2')
    expect(getEnxameAccount()?.enabled).toBe(false)
    setEnxameEnabled(true)
    expect(getEnxameAccount()?.enabled).toBe(true)
  })

  test('keeps other config keys and stays owner-only', () => {
    saveOpenRouterConfig({ apiKey: 'or-key' })
    saveEnxameAccount('key-1')
    removeEnxameAccount()
    saveEnxameAccount('key-1')
    const file = path.join(tempDir, 'config.json')
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).apiKey).toBe('or-key')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  test('test button reports success and failure', async () => {
    let seen: { url: string; auth: string } | undefined
    const ok = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).Authorization! }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await testEnxameAccount(account, ok)).toEqual({
      ok: true,
      message: 'Connection OK (glm-4.7-flash)',
    })
    expect(seen).toEqual({
      url: 'https://api.z.ai/api/paas/v4/chat/completions',
      auth: 'Bearer key-1',
    })

    let calls = 0
    const unauthorized = (async () => {
      calls++
      return new Response('bad key', { status: 401 })
    }) as unknown as typeof fetch
    expect(await testEnxameAccount(account, unauthorized)).toEqual({
      ok: false,
      message: 'glm-4.7-flash: HTTP 401: bad key',
    })

    expect(calls).toBe(1) // a bad key does not try the fallback

    const tried: string[] = []
    const overloaded = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(init.body as string).model
      tried.push(model)
      return model === 'glm-4.7-flash'
        ? new Response('busy', { status: 429 })
        : new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const fellBack = await testEnxameAccount(account, overloaded)
    expect(tried).toEqual(['glm-4.7-flash', 'glm-4.5-flash'])
    expect(fellBack.ok).toBe(true)
    expect(fellBack.message).toContain('fallback glm-4.5-flash')

    const down = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect((await testEnxameAccount(account, down)).message).toBe(
      'glm-4.7-flash: network down | glm-4.5-flash: network down',
    )
  })
})
