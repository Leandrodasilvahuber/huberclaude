import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setCachedModels } from './discoveryCache.js'
import { _clearRegistryForTesting, ensureIntegrationsLoaded, registerGateway } from './index.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { publicBuildVersion } from '../utils/version.js'
import { setClaudeConfigHomeDirForTesting } from '../utils/envUtils.js'

const originalFetch = globalThis.fetch
const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENGATEWAY_API_KEY: process.env.OPENGATEWAY_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_KEYS: process.env.OPENAI_API_KEYS,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  APISMART_API_KEY: process.env.APISMART_API_KEY,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
}

let tempDir: string

async function loadDiscoveryServiceModule() {
  return import(`./discoveryService.js?ts=${Date.now()}-${Math.random()}`)
}

function setMockFetch(
  implementation: typeof globalThis.fetch,
): void {
  globalThis.fetch = implementation
}

function restoreEnvValue(
  key: keyof typeof originalEnv,
): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function clearProviderEnv(): void {
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEYS
  delete process.env.OPENAI_MODEL
  delete process.env.APISMART_API_KEY
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
}

beforeEach(async () => {
  await acquireSharedMutationLock('discoveryService.test.ts')
  mock.restore()
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-discovery-service-test-'))
  setClaudeConfigHomeDirForTesting(tempDir)
  process.env.CLAUDE_CONFIG_DIR = tempDir
  delete process.env.OPENROUTER_API_KEY
  delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  clearProviderEnv()
  globalThis.fetch = originalFetch
})

afterEach(() => {
  try {
    mock.restore()
    globalThis.fetch = originalFetch
    rmSync(tempDir, { recursive: true, force: true })
    setClaudeConfigHomeDirForTesting(undefined)
    restoreEnvValue('CLAUDE_CONFIG_DIR')
    restoreEnvValue('OPENROUTER_API_KEY')
    restoreEnvValue('OPENGATEWAY_API_KEY')
    restoreEnvValue('OPENAI_BASE_URL')
    restoreEnvValue('OPENAI_API_BASE')
    restoreEnvValue('OPENAI_API_KEY')
    restoreEnvValue('OPENAI_API_KEYS')
    restoreEnvValue('OPENAI_MODEL')
    restoreEnvValue('APISMART_API_KEY')
    restoreEnvValue('ANTHROPIC_CUSTOM_HEADERS')
    restoreEnvValue('CLAUDE_CODE_USE_OPENAI')
    restoreEnvValue('CLAUDE_CODE_USE_GEMINI')
    restoreEnvValue('CLAUDE_CODE_USE_MISTRAL')
    restoreEnvValue('CLAUDE_CODE_USE_GITHUB')
    restoreEnvValue('CLAUDE_CODE_USE_BEDROCK')
    restoreEnvValue('CLAUDE_CODE_USE_VERTEX')
    restoreEnvValue('CLAUDE_CODE_USE_FOUNDRY')
    restoreEnvValue('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
    _clearRegistryForTesting()
    ensureIntegrationsLoaded()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('discoverModelsForRoute', () => {

  test('uses opaque cache partitions for credential-scoped discovery', async () => {
    const { getDiscoveryCacheKey } = await loadDiscoveryServiceModule()

    const first = getDiscoveryCacheKey('custom', {
      baseUrl: 'https://example.test/v1',
      apiKey: 'discovery-cache-secret-a',
    })
    const second = getDiscoveryCacheKey('custom', {
      baseUrl: 'https://example.test/v1',
      apiKey: 'discovery-cache-secret-b',
    })

    expect(first).toMatch(/^custom:[0-9a-f]{32}$/)
    expect(first).not.toContain('discovery-cache-secret-a')
    expect(second).not.toContain('discovery-cache-secret-b')
    expect(first).not.toBe(second)
  })

  test('hybrid routes keep curated descriptor entries ahead of discovered duplicates', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    // OpenRouter lists models publicly; discovery no longer requires a key.
    delete process.env.OPENROUTER_API_KEY
    const openRouterCalls: Array<{ url: string; headers: unknown }> = []
    setMockFetch(mock((input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      openRouterCalls.push({ url, headers: init?.headers })
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'openai/gpt-5-mini',
                name: 'OpenAI: GPT-5 Mini',
                context_length: 400000,
                supported_parameters: ['tools'],
              },
              {
                id: 'anthropic/claude-sonnet-4',
                name: 'Anthropic: Claude Sonnet 4',
                context_length: 200000,
                supported_parameters: ['tools', 'reasoning'],
              },
              { id: 'openai/text-embedding-3-large', name: 'Embedding' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('openrouter', {
      forceRefresh: true,
    })

    expect(openRouterCalls).toHaveLength(1)
    expect(openRouterCalls[0]?.url).toContain('/models')
    expect(openRouterCalls[0]?.headers).toBeUndefined()
    expect(result?.models.map((model: { apiName: string }) => model.apiName)).toEqual([
      'openai/gpt-5-mini',
      'x-ai/grok-4.6',
      'x-ai/grok-4.5',
      'anthropic/claude-sonnet-4',
    ])
    expect(result?.models[0]?.label).toBe('GPT-5 Mini (via OpenRouter)')
    expect(result?.models[3]?.label).toBe('Anthropic: Claude Sonnet 4')
    expect(result?.models[3]?.contextWindow).toBe(200000)
  })

  test('openrouter discovery preserves credentials and custom headers for overridden base URL', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    let capturedUrl: string | undefined
    let capturedHeaders: unknown
    setMockFetch(mock((input, init) => {
      capturedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      capturedHeaders = init?.headers
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'custom-proxy/model-1' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('openrouter', {
      baseUrl: 'https://proxy.corp.internal/v1',
      apiKey: 'sk-or-proxy-key',
      headers: {
        'X-Proxy-Auth': 'secret-proxy-token',
      },
      forceRefresh: true,
    })

    expect(capturedUrl).toBe('https://proxy.corp.internal/v1/models')
    expect(capturedHeaders).toEqual({
      'X-Proxy-Auth': 'secret-proxy-token',
      Authorization: 'Bearer sk-or-proxy-key',
    })
    expect(result?.source).toBe('network')
    expect(result?.models.some(m => m.apiName === 'custom-proxy/model-1')).toBe(true)
  })

  test('openai-compatible discovery applies descriptor static headers with auth', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    registerGateway({
      id: 'discovery-header-test',
      label: 'Discovery Header Test',
      category: 'hosted',
      defaultBaseUrl: 'https://discovery-header-test.example/v1',
      setup: {
        requiresAuth: true,
        authMode: 'api-key',
        credentialEnvVars: ['DISCOVERY_HEADER_TEST_API_KEY'],
      },
      transportConfig: {
        kind: 'openai-compatible',
        openaiShim: {
          headers: {
            'X-Static-Client': 'openclaude',
          },
        },
      },
      catalog: {
        source: 'dynamic',
        discovery: {
          kind: 'openai-compatible',
        },
      },
    })

    setMockFetch(mock((_input, init) => {
      expect(init?.headers).toEqual({
        'X-Static-Client': 'profile',
        'X-Profile-Header': 'enabled',
        Authorization: 'Bearer discovery-key',
      })
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'discovered-model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('discovery-header-test', {
      apiKey: 'discovery-key',
      headers: {
        'X-Static-Client': 'profile',
        'X-Profile-Header': 'enabled',
      },
      forceRefresh: true,
    })

    expect(result?.source).toBe('network')
    expect(result?.models.map((model: { apiName: string }) => model.apiName)).toEqual(['discovered-model'])
  })

  test('openai-compatible discovery can opt out of auth', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    registerGateway({
      id: 'discovery-no-auth-test',
      label: 'Discovery No Auth Test',
      category: 'hosted',
      defaultBaseUrl: 'https://discovery-no-auth-test.example/v1',
      setup: {
        requiresAuth: true,
        authMode: 'api-key',
        credentialEnvVars: ['DISCOVERY_NO_AUTH_TEST_API_KEY'],
      },
      transportConfig: {
        kind: 'openai-compatible',
      },
      catalog: {
        source: 'dynamic',
        discovery: {
          kind: 'openai-compatible',
          requiresAuth: false,
        },
        discoveryCacheTtl: '1d',
      },
    })

    let callCount = 0
    setMockFetch(mock((_input, init) => {
      callCount++
      expect(init?.headers).toBeUndefined()
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'public-model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('discovery-no-auth-test', {
      forceRefresh: true,
    })
    const cached = await discoverModelsForRoute('discovery-no-auth-test')

    expect(result?.source).toBe('network')
    expect(result?.models.map((model: { apiName: string }) => model.apiName)).toEqual(['public-model'])
    expect(cached?.source).toBe('cache')
    expect(cached?.models.map((model: { apiName: string }) => model.apiName)).toEqual(['public-model'])
    expect(callCount).toBe(1)
  })

  test('skips descriptor network discovery when nonessential traffic is disabled', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    process.env.OPENROUTER_API_KEY = 'or-key'
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    setMockFetch(mock(() => {
      throw new Error('unexpected model discovery request')
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('openrouter', {
      apiKey: 'privacy-test-key',
      forceRefresh: true,
    })

    const modelNames =
      result?.models.map((model: { apiName: string }) => model.apiName) ?? []
    expect(['static', 'cache', 'stale-cache']).toContain(result?.source)
    expect(modelNames).toContain('openai/gpt-5-mini')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('openai-compatible discovery does not use invalid pooled credentials', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    registerGateway({
      id: 'discovery-invalid-pool-test',
      label: 'Invalid Pool Test',
      defaultBaseUrl: 'https://invalid-pool.example/v1',
      defaultModel: 'gpt-5.5',
      setup: {
        requiresAuth: true,
        authMode: 'api-key',
        credentialEnvVars: ['OPENAI_API_KEYS', 'OPENAI_API_KEY'],
      },
      transportConfig: { kind: 'openai-compatible' },
      catalog: {
        source: 'dynamic',
        discovery: { kind: 'openai-compatible' },
      },
    })

    setMockFetch(mock((_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('api-key')).toBeNull()
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'gpt-5.5' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('discovery-invalid-pool-test', {
      apiKey: 'key-a,SUA_CHAVE',
      forceRefresh: true,
    })

    expect(result?.routeId).toBe('discovery-invalid-pool-test')
    expect(result?.source).toBe('network')
  })

  test('refreshStartupDiscoveryForActiveRoute still skips anthropic route', async () => {
    const { refreshStartupDiscoveryForActiveRoute } =
      await loadDiscoveryServiceModule()

    const startupEnv: NodeJS.ProcessEnv = {
      CLAUDE_CODE_USE_ANTHROPIC: '1',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    }

    const result = await refreshStartupDiscoveryForActiveRoute({
      processEnv: startupEnv,
    })

    expect(result).toBeNull()
  })

  test('openai-compatible discovery applies mapModel to filter and shape raw entries', async () => {
    const { discoverModelsForRoute } = await loadDiscoveryServiceModule()

    registerGateway({
      id: 'mapmodel-test',
      label: 'MapModel Test',
      category: 'aggregating',
      defaultBaseUrl: 'https://mapmodel-test.example/v1',
      setup: {
        requiresAuth: true,
        authMode: 'api-key',
        credentialEnvVars: ['MAPMODEL_TEST_API_KEY'],
      },
      transportConfig: { kind: 'openai-compatible' },
      catalog: {
        source: 'dynamic',
        discovery: {
          kind: 'openai-compatible',
          mapModel(raw: unknown) {
            const model = raw as { id?: string; active?: boolean; context_window?: number }
            if (!model.id || model.active === false) return null
            if (/(guard|whisper)/i.test(model.id)) return null
            return {
              id: model.id,
              apiName: model.id,
              label: model.id,
              ...(model.context_window ? { contextWindow: model.context_window } : {}),
            }
          },
        },
        discoveryCacheTtl: '1d',
      },
    })

    setMockFetch(mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: 'llama-3.3-70b', context_window: 131072 },
              { id: 'whisper-large-v3' },
              { id: 'llama-guard-3' },
              { id: 'inactive-model', active: false },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    ) as unknown as typeof globalThis.fetch)

    const result = await discoverModelsForRoute('mapmodel-test', {
      forceRefresh: true,
    })

    expect(result?.source).toBe('network')
    expect(result?.models).toEqual([
      { id: 'llama-3.3-70b', apiName: 'llama-3.3-70b', label: 'llama-3.3-70b', contextWindow: 131072 },
    ])
  })
})

describe('resolveDiscoveryRouteIdFromBaseUrl', () => {

  test('falls back to local-provider heuristics for Ollama aliases', async () => {
    const { resolveDiscoveryRouteIdFromBaseUrl } =
      await loadDiscoveryServiceModule()

    expect(
      resolveDiscoveryRouteIdFromBaseUrl('http://127.0.0.1:11434/v1'),
    ).toBe('ollama')
  })
})
