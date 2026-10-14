import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../test/sharedMutationLock.js'

import { getMaxOutputTokensForModel } from '../services/api/claude.ts'
import { resolveOpenAIShimRuntimeContext } from '../integrations/runtimeMetadata.ts'
import {
  calculateContextPercentages,
  getContextWindowForModel,
  getModelMaxOutputTokens,
  modelSupports1M,
  clearSessionContextWindowOverride,
} from './context.ts'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
  CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS:
    process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS,
  CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS:
    process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AIMLAPI_API_KEY: process.env.AIMLAPI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  LONGCAT_API_KEY: process.env.LONGCAT_API_KEY,
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  USER_TYPE: process.env.USER_TYPE,
  OPENCLAUDE_MAX_TURNS: process.env.OPENCLAUDE_MAX_TURNS,
  CLAUDE_CODE_MAX_TURNS: process.env.CLAUDE_CODE_MAX_TURNS,
}

beforeEach(async () => {
  await acquireSharedMutationLock('context.test.ts')
  clearSessionContextWindowOverride()
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
  delete process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_API_KEY
  delete process.env.AIMLAPI_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
  delete process.env.MINIMAX_API_KEY
  delete process.env.XAI_API_KEY
  delete process.env.LONGCAT_API_KEY
  delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  delete process.env.USER_TYPE
  delete process.env.OPENCLAUDE_MAX_TURNS
  delete process.env.CLAUDE_CODE_MAX_TURNS
})

afterEach(() => {
  try {
    if (originalEnv.CLAUDE_CODE_USE_OPENAI === undefined) {
      delete process.env.CLAUDE_CODE_USE_OPENAI
    } else {
      process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
    }
    if (originalEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS === undefined) {
      delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
    } else {
      process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS =
        originalEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS
    }
    if (originalEnv.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS === undefined) {
      delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
    } else {
      process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS =
        originalEnv.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
    }
    if (originalEnv.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS === undefined) {
      delete process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
    } else {
      process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS =
        originalEnv.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
    }
    if (originalEnv.OPENAI_MODEL === undefined) {
      delete process.env.OPENAI_MODEL
    } else {
      process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
    }
    if (originalEnv.OPENAI_BASE_URL === undefined) {
      delete process.env.OPENAI_BASE_URL
    } else {
      process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
    }
    if (originalEnv.OPENAI_API_BASE === undefined) {
      delete process.env.OPENAI_API_BASE
    } else {
      process.env.OPENAI_API_BASE = originalEnv.OPENAI_API_BASE
    }
    if (originalEnv.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
    }
    if (originalEnv.AIMLAPI_API_KEY === undefined) {
      delete process.env.AIMLAPI_API_KEY
    } else {
      process.env.AIMLAPI_API_KEY = originalEnv.AIMLAPI_API_KEY
    }
    if (originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === undefined) {
      delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    } else {
      process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED =
        originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    }
    if (originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID === undefined) {
      delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    } else {
      process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID =
        originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    }
    if (originalEnv.MINIMAX_API_KEY === undefined) {
      delete process.env.MINIMAX_API_KEY
    } else {
      process.env.MINIMAX_API_KEY = originalEnv.MINIMAX_API_KEY
    }
    if (originalEnv.XAI_API_KEY === undefined) {
      delete process.env.XAI_API_KEY
    } else {
      process.env.XAI_API_KEY = originalEnv.XAI_API_KEY
    }
    if (originalEnv.LONGCAT_API_KEY === undefined) {
      delete process.env.LONGCAT_API_KEY
    } else {
      process.env.LONGCAT_API_KEY = originalEnv.LONGCAT_API_KEY
    }
    if (originalEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS === undefined) {
      delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    } else {
      process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = originalEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    }
    if (originalEnv.USER_TYPE === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = originalEnv.USER_TYPE
    }
    if (originalEnv.OPENCLAUDE_MAX_TURNS === undefined) {
      delete process.env.OPENCLAUDE_MAX_TURNS
    } else {
      process.env.OPENCLAUDE_MAX_TURNS = originalEnv.OPENCLAUDE_MAX_TURNS
    }
    if (originalEnv.CLAUDE_CODE_MAX_TURNS === undefined) {
      delete process.env.CLAUDE_CODE_MAX_TURNS
    } else {
      process.env.CLAUDE_CODE_MAX_TURNS = originalEnv.CLAUDE_CODE_MAX_TURNS
    }
  } finally {
    clearSessionContextWindowOverride()
    releaseSharedMutationLock()
  }
})

test('calculateContextPercentages preserves tiny nonzero usage', () => {
  expect(
    calculateContextPercentages(
      {
        input_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      1_000_000,
    ),
  ).toEqual({
    used: 0.01,
    remaining: 99.99,
  })
})

test('Ollama deepseek-v4-pro cloud variant keeps the local max_tokens transport field', () => {
  const runtimeContext = resolveOpenAIShimRuntimeContext({
    processEnv: {
      ...process.env,
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
    },
    baseUrl: 'http://localhost:11434/v1',
    model: 'deepseek-v4-pro:cloud',
  })

  expect(runtimeContext.routeId).toBe('ollama')
  expect(runtimeContext.openaiShimConfig.maxTokensField).toBe('max_tokens')
})

test('gpt-4o uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('gpt-4o')).toBe(128_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 16_384,
    upperLimit: 16_384,
  })
  expect(getMaxOutputTokensForModel('gpt-4o')).toBe(16_384)
})

test('gpt-4o clamps oversized max output overrides to the provider limit', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '32000'
  delete process.env.OPENAI_MODEL

  expect(getMaxOutputTokensForModel('gpt-4o')).toBe(16_384)
})

test('gpt-5.5 uses conservative Codex-route context window (issue #1118)', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  // gpt-5.5 is primarily routed through the Codex transport in this repo
  // (see src/services/api/providerConfig.ts). The 1.05M API descriptor value
  // caused /context to under-report and auto-compact to fire too late,
  // resulting in mid-turn 500s. The descriptor is pinned to the Codex
  // effective limit until provider-aware context windows land.
  expect(getContextWindowForModel('gpt-5.5')).toBe(272_000)
})

test('gpt-5.6 family keeps the full window on the direct-OpenAI route', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.OPENAI_BASE_URL
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  // Unlike gpt-5.5 (Codex-only, blanket-capped in the vendor catalog), the
  // gpt-5.6 family is also served directly by api.openai.com /v1/responses
  // at its true 1.05M window; the openai-route catalog entry preserves it.
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    expect(getContextWindowForModel(model)).toBe(1_050_000)
  }
})

test('gpt-5.4 family uses provider-specific context and output caps', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('gpt-5.4')).toBe(1_050_000)
  expect(getModelMaxOutputTokens('gpt-5.4')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })

  expect(getContextWindowForModel('gpt-5.4-mini')).toBe(400_000)
  expect(getModelMaxOutputTokens('gpt-5.4-mini')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })

  expect(getContextWindowForModel('gpt-5.4-nano')).toBe(400_000)
  expect(getModelMaxOutputTokens('gpt-5.4-nano')).toEqual({
    default: 128_000,
    upperLimit: 128_000,
  })
})

test('gpt-5.4 family keeps large max output overrides within provider limits', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '200000'

  expect(getMaxOutputTokensForModel('gpt-5.4')).toBe(128_000)
  expect(getMaxOutputTokensForModel('gpt-5.4-mini')).toBe(128_000)
  expect(getMaxOutputTokensForModel('gpt-5.4-nano')).toBe(128_000)
})

test('env-only xAI key uses provider-specific context and output caps before client setup', () => {
  process.env.XAI_API_KEY = 'xai-test-key'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('grok-4.6')).toBe(500_000)
  expect(getModelMaxOutputTokens('grok-4.6').upperLimit).toBe(500_000)
  expect(getContextWindowForModel('grok-4.5')).toBe(500_000)
  expect(getContextWindowForModel('grok-4.3')).toBe(1_000_000)
  expect(getModelMaxOutputTokens('grok-4.3')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
  expect(getMaxOutputTokensForModel('grok-4.3')).toBe(32_768)
  expect(getContextWindowForModel('grok-4')).toBe(1_000_000)
  expect(getModelMaxOutputTokens('grok-4')).toEqual({
    default: 32_768,
    upperLimit: 32_768,
  })
  expect(getMaxOutputTokensForModel('grok-4')).toBe(32_768)
})

test('unknown openai-compatible models use the 128k fallback window (not 8k, see #635)', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  expect(getContextWindowForModel('some-unknown-3p-model')).toBe(128_000)
})

test('unknown openai-compatible model fallback logs one debug warning and no console errors', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_MODEL

  const actualDebugModule = await import('./debug.js')
  const logForDebugging = spyOn(
    actualDebugModule,
    'logForDebugging',
  ).mockImplementation((_message, _options) => {})

  const originalConsoleError = console.error
  const consoleError = mock(() => {})
  console.error = consoleError
  try {
    const contextModule = await import(
      `./context.ts?contextDedupe=${Date.now()}-${Math.random()}`
    )

    expect(
      contextModule.getContextWindowForModel('another-unknown-3p-model'),
    ).toBe(128_000)
    expect(
      contextModule.getContextWindowForModel('another-unknown-3p-model'),
    ).toBe(128_000)
    expect(consoleError).not.toHaveBeenCalled()
    const contextWarnings = logForDebugging.mock.calls.filter(
      ([message, options]) =>
        typeof message === 'string' &&
        message.startsWith('[context] Warning:') &&
        options?.level === 'warn',
    )
    expect(contextWarnings).toHaveLength(1)
  } finally {
    console.error = originalConsoleError
    mock.restore()
  }
})

test('OpenAI-compatible custom model limits honor documented env overrides', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'custom-model': 262_144,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'custom-model': 12_288,
  })

  expect(getContextWindowForModel('custom-model')).toBe(262_144)
  expect(getModelMaxOutputTokens('custom-model')).toEqual({
    default: 12_288,
    upperLimit: 12_288,
  })
})

test('OpenAI-compatible env overrides take precedence over integration metadata', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'gpt-4o': 64_000,
  })
  process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS = JSON.stringify({
    'gpt-4o': 4_096,
  })

  expect(getContextWindowForModel('gpt-4o')).toBe(64_000)
  expect(getModelMaxOutputTokens('gpt-4o')).toEqual({
    default: 4_096,
    upperLimit: 4_096,
  })
})

test('GLM-5.3-Flash direct limits do not leak to OpenRouter', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('glm-5.3-flash')).toBe(128_000)
  expect(getModelMaxOutputTokens('glm-5.3-flash')).toEqual({
    default: 32_000,
    upperLimit: 128_000,
  })
})

test('Anthropic model with high CLAUDE_CODE_MAX_OUTPUT_TOKENS still caps at model upper limit (#1604)', () => {
  // Regression guard: the fix for #1604 must not relax the cap for Anthropic
  // models where the API itself rejects values above the model's real limit.
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.OPENAI_BASE_URL
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '128000'

  expect(getMaxOutputTokensForModel('sonnet-4-6')).toBe(128_000)
  expect(getMaxOutputTokensForModel('opus-4-1')).toBe(32_000)
  expect(getMaxOutputTokensForModel('claude-3-opus')).toBe(4_096)
})

test('recent Opus models (4.8/4.7/4.6) get the elevated output-token limits (#1769)', () => {
  // Regression: 4.8/4.7 used to fall through to the generic opus-4 branch and
  // cap at 32k, while the default Opus is now 4.8.
  const elevated = { default: 64_000, upperLimit: 128_000 }
  expect(getModelMaxOutputTokens('claude-opus-4-8')).toEqual(elevated)
  expect(getModelMaxOutputTokens('claude-opus-4-7')).toEqual(elevated)
  expect(getModelMaxOutputTokens('claude-opus-4-6')).toEqual(elevated)
  // Older Opus still capped lower.
  expect(getModelMaxOutputTokens('claude-opus-4-1')).toEqual({
    default: 32_000,
    upperLimit: 32_000,
  })
})

test('modelSupports1M recognizes the current default Opus (4.8) as 1M-capable', () => {
  const original = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  try {
    // Regression: the firstParty default session model is claude-opus-4-8[1m]
    // (getDefaultMainLoopModelSetting), so dropping 4.8 here downgrades a 1M
    // session to 200K and trips a spurious "Context limit reached" — exactly
    // what resolveSkillModelOverride relies on this predicate to prevent.
    expect(modelSupports1M('claude-opus-4-8')).toBe(true)
    expect(modelSupports1M('claude-opus-4-8[1m]')).toBe(true)
    expect(modelSupports1M('claude-opus-4-7')).toBe(true)
    expect(modelSupports1M('claude-opus-4-7[1m]')).toBe(true)
    // Existing 1M models must keep working.
    expect(modelSupports1M('claude-opus-4-6')).toBe(true)
    expect(modelSupports1M('claude-sonnet-4-6')).toBe(true)
    expect(modelSupports1M('claude-sonnet-4-5')).toBe(true)
    // Models without a 1M variant must stay false.
    expect(modelSupports1M('claude-opus-4-1')).toBe(false)
    expect(modelSupports1M('claude-opus-4-0')).toBe(false)
    expect(modelSupports1M('claude-3-5-haiku')).toBe(false)
  } finally {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    } else {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = original
    }
  }
})

test('modelSupports1M honors the 1M disable switch even for Opus 4.7', () => {
  const original = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
  try {
    expect(modelSupports1M('claude-opus-4-7')).toBe(false)
  } finally {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    } else {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = original
    }
  }
})

// --- Session-scoped context window overrides ---

import {
  setSessionContextWindowOverride,
  getSessionContextWindowOverride,
  getSessionContextWindowOverrides,
} from './context.ts'

test('setSessionContextWindowOverride sets and gets override', () => {
  const result = setSessionContextWindowOverride('gpt-4o', 256_000)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.normalizedModel).toBe('gpt-4o')
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(256_000)
})

test('setSessionContextWindowOverride normalizes case and provider prefix', () => {
  setSessionContextWindowOverride('OpenAI/GPT-4o', 200_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(200_000)
  expect(getSessionContextWindowOverride('OpenAI/GPT-4o')).toBe(200_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(200_000)
})

test('provider-qualified and unqualified model names map to the same canonical key', () => {
  setSessionContextWindowOverride('zai-org/glm-5.2', 256_000)
  expect(getSessionContextWindowOverride('zai-org/glm-5.2')).toBe(256_000)
  expect(getSessionContextWindowOverride('glm-5.2')).toBe(256_000)

  setSessionContextWindowOverride('glm-5.2', 128_000)
  expect(getSessionContextWindowOverride('zai-org/glm-5.2')).toBe(128_000)
  expect(getSessionContextWindowOverride('glm-5.2')).toBe(128_000)
})

test('mixed-order setting and clearing qualified/unqualified aliases', () => {
  // Path 1: Set qualified, then set unqualified, then clear unqualified
  setSessionContextWindowOverride('openai/gpt-4o', 256_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(256_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(256_000)

  setSessionContextWindowOverride('gpt-4o', 128_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(128_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(128_000)

  clearSessionContextWindowOverride('gpt-4o')
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBeUndefined()
  expect(getSessionContextWindowOverride('gpt-4o')).toBeUndefined()

  // Path 2: Set unqualified, then set qualified, then clear qualified
  setSessionContextWindowOverride('gpt-4o', 200_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(200_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(200_000)

  setSessionContextWindowOverride('openai/gpt-4o', 300_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(300_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(300_000)

  clearSessionContextWindowOverride('openai/gpt-4o')
  expect(getSessionContextWindowOverride('gpt-4o')).toBeUndefined()
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBeUndefined()
})

test('writing openai/gpt-4o is readable via gpt-4o', () => {
  setSessionContextWindowOverride('openai/gpt-4o', 256_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(256_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(256_000)
})

test('setSessionContextWindowOverride rejects below minimum', () => {
  const result = setSessionContextWindowOverride('gpt-4o', 10_000)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain('at least')
  expect(getSessionContextWindowOverride('gpt-4o')).toBeUndefined()
})

test('setSessionContextWindowOverride rejects non-integer values', () => {
  expect(setSessionContextWindowOverride('gpt-4o', NaN).ok).toBe(false)
  expect(setSessionContextWindowOverride('gpt-4o', Infinity).ok).toBe(false)
  expect(setSessionContextWindowOverride('gpt-4o', -1).ok).toBe(false)
  expect(setSessionContextWindowOverride('gpt-4o', 64_000.5).ok).toBe(false)
})

test('clearSessionContextWindowOverride clears specific model', () => {
  setSessionContextWindowOverride('gpt-4o', 256_000)
  setSessionContextWindowOverride('claude-sonnet-4', 200_000)
  clearSessionContextWindowOverride('gpt-4o')
  expect(getSessionContextWindowOverride('gpt-4o')).toBeUndefined()
  expect(getSessionContextWindowOverride('claude-sonnet-4')).toBe(200_000)
})

test('clearSessionContextWindowOverride clears stripped fallback when clearing qualified name', () => {
  setSessionContextWindowOverride('gpt-4o', 256_000)
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBe(256_000)
  clearSessionContextWindowOverride('openai/gpt-4o')
  expect(getSessionContextWindowOverride('gpt-4o')).toBeUndefined()
  expect(getSessionContextWindowOverride('openai/gpt-4o')).toBeUndefined()
})

test('clearSessionContextWindowOverride clears all when no model specified', () => {
  setSessionContextWindowOverride('gpt-4o', 256_000)
  setSessionContextWindowOverride('claude-sonnet-4', 200_000)
  clearSessionContextWindowOverride()
  expect(getSessionContextWindowOverrides().size).toBe(0)
})

test('getSessionContextWindowOverrides returns a copy', () => {
  setSessionContextWindowOverride('gpt-4o', 256_000)
  const copy = getSessionContextWindowOverrides()
  copy.delete('gpt-4o')
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(256_000)
})

test('session override takes precedence over env override for OpenAI-compatible model', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({ 'custom-model': 64_000 })
  expect(getContextWindowForModel('custom-model')).toBe(64_000)
  setSessionContextWindowOverride('custom-model', 256_000)
  expect(getContextWindowForModel('custom-model')).toBe(256_000)
  clearSessionContextWindowOverride()
  expect(getContextWindowForModel('custom-model')).toBe(64_000)
})

test('session override takes precedence over unknown model fallback', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  setSessionContextWindowOverride('unknown-model', 200_000)
  expect(getContextWindowForModel('unknown-model')).toBe(200_000)
  clearSessionContextWindowOverride()
  expect(getContextWindowForModel('unknown-model')).toBe(128_000)
})

test('session override takes precedence over known model catalog metadata', () => {
  const defaultWindow = getContextWindowForModel('gpt-4o')
  setSessionContextWindowOverride('gpt-4o', 500_000)
  expect(getContextWindowForModel('gpt-4o')).toBe(500_000)
  clearSessionContextWindowOverride()
  expect(getContextWindowForModel('gpt-4o')).toBe(defaultWindow)
})

test('CLAUDE_CODE_MAX_CONTEXT_TOKENS takes precedence over session override', () => {
  process.env.USER_TYPE = 'ant'
  process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '50000'
  setSessionContextWindowOverride('gpt-4o', 200_000)
  expect(getContextWindowForModel('gpt-4o')).toBe(50_000)
})

test('provider-qualified override maps to canonical key', () => {
  setSessionContextWindowOverride('zai-org/glm-5.2', 256_000)
  expect(getSessionContextWindowOverride('zai-org/glm-5.2')).toBe(256_000)
  expect(getSessionContextWindowOverride('glm-5.2')).toBe(256_000)
})

test('clearSessionContextWindowOverride resets state for session isolation', () => {
  setSessionContextWindowOverride('gpt-4o', 256_000)
  expect(getSessionContextWindowOverride('gpt-4o')).toBe(256_000)
  clearSessionContextWindowOverride()
  expect(getSessionContextWindowOverride('gpt-4o')).toBeUndefined()
  expect(getContextWindowForModel('gpt-4o')).not.toBe(256_000)
})
