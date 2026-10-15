import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const ORIGINAL_ENV = { ...process.env }

// Bun's mock.restore() does not undo mock.module(), so module mocks leak into
// every later test file in the same process. Mock with the real exports
// spread in, and put the real modules back once this file is done.
const realProviders = { ...(await import('./model/providers.js')) }
const realMTLS = { ...(await import('./mtls.js')) }

function mockProviders(provider: string): void {
  mock.module('./model/providers.js', () => ({
    ...realProviders,
    getAPIProvider: () => provider,
    getAPIProviderForStatsig: () => provider,
    isFirstPartyAnthropicBaseUrl: () => true,
    isGithubNativeAnthropicMode: () => false,
  }))
}

function mockMTLSConfig(config: { cert: string; key: string } | undefined): void {
  mock.module('./mtls.js', () => ({
    ...realMTLS,
    getMTLSConfig: Object.assign(() => config, {
      cache: realMTLS.getMTLSConfig.cache,
    }),
  }))
}

afterAll(() => {
  mock.module('./model/providers.js', () => realProviders)
  mock.module('./mtls.js', () => realMTLS)
})

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

async function readPropertyValue(
  label: string,
  provider:
    | 'firstParty'
    | 'bedrock'
    | 'vertex'
    | 'foundry'
    | 'openai'
    | 'codex'
    | 'nvidia-nim'
    | 'minimax',
): Promise<unknown> {
  mock.restore()
  mockProviders(provider)
  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  return buildAPIProviderProperties().find(property => property.label === label)
    ?.value
}

async function readAPIProviderProperties(
  provider:
    | 'firstParty'
    | 'bedrock'
    | 'vertex'
    | 'foundry'
    | 'openai'
    | 'gemini'
    | 'mistral',
) {
  mock.restore()
  mockProviders(provider)
  mockMTLSConfig(undefined)
  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  return buildAPIProviderProperties()
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/status.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
    restoreEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

test('buildAPIProviderProperties redacts credentials in OpenAI-compatible base URLs', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    'https://user:pass@example.com/v1?api_key=sk-statusLeak1234567890ABCdef&model=qwen'

  expect(await readPropertyValue('OpenAI base URL', 'openai')).toBe(
    'https://redacted:redacted@example.com/v1?api_key=redacted&model=qwen',
  )
})

test('buildAPIProviderProperties redacts token-bearing OpenAI-compatible base URLs', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    'https://api.example.test/v1?token=OPENAI_LEAK&mode=test#access_token=fragment-leak'

  const properties = await readAPIProviderProperties('openai')
  const value = properties.find(property => property.label === 'OpenAI base URL')
    ?.value

  expect(value).toBe('https://api.example.test/v1?token=redacted&mode=test')
  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('OPENAI_LEAK')
  expect(serialized).not.toContain('fragment-leak')
})

test('buildAPIProviderProperties does not substring-redact short configured secrets', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1?credential=1'
  process.env.OPENAI_MODEL = 'gpt-4.1'
  process.env.OPENAI_API_KEY = '1'

  const properties = await readAPIProviderProperties('openai')

  expect(properties.find(property => property.label === 'OpenAI base URL')?.value).toBe(
    'https://api.openai.com/v1?credential=redacted',
  )
  expect(properties.find(property => property.label === 'Model')?.value).toBe(
    'gpt-4.1',
  )
})

test('buildAPIProviderProperties redacts double-encoded configured secrets outside URL query values', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    'https://api.openai.com/abc%252FdefSecret987/v1'
  process.env.OPENAI_MODEL = 'gpt-4o abc%252FdefSecret987'
  process.env.OPENAI_API_KEY = 'abc/defSecret987'

  const properties = await readAPIProviderProperties('openai')

  expect(properties.find(property => property.label === 'OpenAI base URL')?.value).toBe(
    'https://api.openai.com/redacted/v1',
  )
  expect(properties.find(property => property.label === 'Model')?.value).toBe(
    'gpt-4o redacted',
  )
  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('abc%252FdefSecret987')
})

test('buildAPIProviderProperties redacts percent-encoded configured secret punctuation outside URL query values', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    'https://api.openai.com/abc%21defSecret987/v1'
  process.env.OPENAI_MODEL = 'gpt-4o abc%21defSecret987'
  process.env.OPENAI_API_KEY = 'abc!defSecret987'

  const properties = await readAPIProviderProperties('openai')

  expect(properties.find(property => property.label === 'OpenAI base URL')?.value).toBe(
    'https://api.openai.com/redacted/v1',
  )
  expect(properties.find(property => property.label === 'Model')?.value).toBe(
    'gpt-4o redacted',
  )
  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('abc%21defSecret987')
})

test('buildAPIProviderProperties redacts proxy credentials and mTLS paths', async () => {
  const home = '/home/openclaude-status-test'
  process.env.HOME = home
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.HTTP_PROXY
  process.env.HTTPS_PROXY = 'https://alice:secret@proxy.example.com:8080'
  process.env.NODE_EXTRA_CA_CERTS = `${home}/.config/ca-bundle.crt`
  process.env.CLAUDE_CODE_CLIENT_CERT = `${home}/.config/client.crt`
  process.env.CLAUDE_CODE_CLIENT_KEY = `${home}/.config/client.key`

  mock.restore()
  mockProviders('openai')
  // getProxyUrl accepts env directly (not memoized), so no stub needed.
  mockMTLSConfig({ cert: 'loaded-cert', key: 'loaded-key' })

  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  const properties = buildAPIProviderProperties()
  const byLabel = (label: string): unknown =>
    properties.find(property => property.label === label)?.value

  // Proxy URL is fully redacted: no username, no password.
  expect(byLabel('Proxy')).toBe(
    'https://redacted:redacted@proxy.example.com:8080/',
  )

  // CA cert path: home directory shortened to ~.
  expect(byLabel('Additional CA cert(s)')).toBe('~/.config/ca-bundle.crt')

  // mTLS cert path: home directory shortened to ~.
  expect(byLabel('mTLS client cert')).toBe('~/.config/client.crt')

  // mTLS client key: never reveal the private key path.
  expect(byLabel('mTLS client key')).toBe('configured')

  // No raw secrets leak into any property value. Cover every home-directory
  // source redactPathForStatus consults (HOME, USERPROFILE, os.homedir()).
  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('alice')
  expect(serialized).not.toContain('secret')
  const homeCandidates = [
    process.env.HOME,
    process.env.USERPROFILE,
  ].filter((v): v is string => Boolean(v))
  for (const candidate of homeCandidates) {
    expect(serialized).not.toContain(candidate)
  }
})

test('buildAPIProviderProperties redacts proxy credentials from lowercase https_proxy', async () => {
  // getProxyUrl() prefers the lowercase variant. Confirm the redaction path
  // covers it — both env spellings flow through the same redactUrlForStatus.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.http_proxy
  delete process.env.HTTPS_PROXY
  delete process.env.HTTP_PROXY
  process.env.https_proxy = 'https://bob:hunter2@proxy.example.com:9090'

  mock.restore()
  mockProviders('openai')
  mockMTLSConfig(undefined)

  const nonce = `${Date.now()}-${Math.random()}`
  const { buildAPIProviderProperties } = await import(`./status.js?ts=${nonce}`)
  const properties = buildAPIProviderProperties()
  const byLabel = (label: string): unknown =>
    properties.find(property => property.label === label)?.value

  expect(byLabel('Proxy')).toBe(
    'https://redacted:redacted@proxy.example.com:9090/',
  )

  const serialized = JSON.stringify(properties)
  expect(serialized).not.toContain('bob')
  expect(serialized).not.toContain('hunter2')
})
