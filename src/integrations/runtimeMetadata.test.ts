import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, spyOn } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock'
import {
  resolveModelRuntimeLimits,
  resolveOpenAIShimRuntimeContext,
} from '../integrations/runtimeMetadata'
import { clearDiscoveryCache, setCachedModels } from './discoveryCache'
import {
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../utils/envUtils.js'
import {
  getDiscoveryCacheKey,
  getRouteDiscoveryHeaders,
} from './discoveryService'
import { resolveActiveRouteIdFromEnv } from './routeMetadata.js'

// The discovery cache resolves its path through getClaudeConfigHomeDir(), which
// deliberately ignores CLAUDE_CONFIG_DIR (OpenClaude config is independent of
// Claude Code config). Use the explicit test override so these fixtures land in
// the temp dir instead of the developer's real ~/.openclaude.
async function withTempConfigDir<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSharedMutationLock('integrations/runtimeMetadata.test.ts')
  const previousOverride = getClaudeConfigHomeDirOverrideForTesting()
  let tempDir: string | null = null
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'openclaude-runtime-metadata-test-'))
    setClaudeConfigHomeDirForTesting(tempDir)
    return await fn()
  } finally {
    try {
      // Drops the module-level sync snapshot so a later suite cannot read this
      // suite's fixture back out of memory after the temp dir is gone.
      await clearDiscoveryCache()
      setClaudeConfigHomeDirForTesting(previousOverride)
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    } finally {
      releaseSharedMutationLock()
    }
  }
}

describe('resolveModelRuntimeLimits', () => {
  it('uses the stable xAI OAuth cache identity for discovered runtime limits', async () => {
    await withTempConfigDir(async () => {
      const xaiCredentials = await import('../utils/xaiCredentials.js')
      const readSpy = spyOn(xaiCredentials, 'getCachedXaiCredentials').mockReturnValue({
        accessToken: 'rotating-access-token',
        refreshToken: 'stable-account-identity',
        tokenEndpoint: 'https://auth.x.ai/oauth/token',
      })
      try {
        const baseUrl = 'https://api.x.ai/v1'
        await setCachedModels(
          getDiscoveryCacheKey('xai', {
            baseUrl,
            apiKey: 'rotating-access-token',
            cacheKey: 'stable-account-identity',
          }),
          {
            models: [
              {
                id: 'grok-4.7',
                apiName: 'grok-4.7',
                label: 'grok-4.7',
                contextWindow: 500_000,
              },
            ],
          },
        )

        expect(
          resolveModelRuntimeLimits({
            model: 'grok-4.7',
            processEnv: {
              CLAUDE_CODE_USE_OPENAI: '1',
              OPENAI_BASE_URL: baseUrl,
              XAI_CREDENTIAL_SOURCE: 'oauth',
            },
          }).contextWindow,
        ).toBe(500_000)
      } finally {
        readSpy.mockRestore()
      }
    })
  })
  it('does not apply Coding Plan Flash limits on the same-host general Z.AI endpoint', () => {
    const processEnv = {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.z.ai/api/paas/v4',
    }

    expect(resolveActiveRouteIdFromEnv(processEnv)).toBe('custom')
    expect(resolveModelRuntimeLimits({
      model: 'glm-5.3-flash',
      activeProfileProvider: 'zai',
      processEnv,
    })).toEqual({
      contextWindow: undefined,
      maxOutputTokens: undefined,
    })
  })

  it.each([' ', 'undefined', 'null'])(
    'falls back from invalid OPENAI_BASE_URL %j to OPENAI_API_BASE for route limits',
    invalidPrimary => {
      const processEnv = {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: invalidPrimary,
        OPENAI_API_BASE: 'https://api.z.ai/api/coding/paas/v4',
      }

      expect(resolveActiveRouteIdFromEnv(processEnv, {
        activeProfileProvider: 'zai',
        activeProfileBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
      })).toBe('zai')
      expect(resolveModelRuntimeLimits({
        model: 'glm-5.3-flash',
        activeProfileProvider: 'zai',
        processEnv,
      })).toEqual({
        contextWindow: 1_000_000,
        maxOutputTokens: 131_072,
      })
    },
  )

  it.each([128_000, 200_000])(
    'keeps a gateway-advertised %i window for a globally larger known model',
    async advertised => {
      // User-reported path: OmniRoute + GPT-5.6 Sol ("gpt sol"), whose gateway
      // advertised a smaller window than the known descriptor. An advertised
      // `context_length` is indistinguishable from a real per-deployment cap, so
      // discovery stays authoritative — budgeting past the endpoint's real limit
      // would trade an early compact for a mid-session API failure. 128k is
      // covered explicitly because it is the value gateways most often report as
      // a flat default.
      await withTempConfigDir(async () => {
        const baseUrl = 'http://localhost:20128/v1'
        await setCachedModels(
          getDiscoveryCacheKey('custom', {
            baseUrl,
          }),
          {
            models: [
              {
                id: 'gpt-5.6-sol',
                apiName: 'gpt-5.6-sol',
                label: 'gpt-5.6-sol',
                contextWindow: advertised,
              },
            ],
          },
        )

        expect(
          resolveModelRuntimeLimits({
            model: 'gpt-5.6-sol',
            processEnv: {
              CLAUDE_CODE_USE_OPENAI: '1',
              OPENAI_BASE_URL: baseUrl,
            },
          }).contextWindow,
        ).toBe(advertised)
      })
    },
  )

  it('lets an exact env override beat a wrong discovery-cache context window', async () => {
    await withTempConfigDir(async () => {
      const baseUrl = 'http://localhost:20128/v1'
      await setCachedModels(
        getDiscoveryCacheKey('custom', {
          baseUrl,
        }),
        {
          models: [
            {
              id: 'my-codex-combo',
              apiName: 'my-codex-combo',
              label: 'my-codex-combo',
              contextWindow: 128_000,
            },
          ],
        },
      )

      expect(
        resolveModelRuntimeLimits({
          model: 'my-codex-combo',
          processEnv: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: baseUrl,
            CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({
              'my-codex-combo': 1_000_000,
            }),
          },
        }).contextWindow,
      ).toBe(1_000_000)
    })
  })

  it('lets env prefix overrides beat discovery for both context and max-output limits', async () => {
    // CodeRabbit on #2082: exact-key and settings.modelLimits vs discovery are
    // covered, but not CLAUDE_CODE_OPENAI_* prefix keys. A prefix pin is the
    // documented way to cover a family of gateway model ids without listing
    // each one, and must sit above the discovery cache for both limits.
    await withTempConfigDir(async () => {
      const baseUrl = 'http://localhost:20128/v1'
      await setCachedModels(
        getDiscoveryCacheKey('custom', {
          baseUrl,
        }),
        {
          models: [
            {
              id: 'my-codex-combo-v2',
              apiName: 'my-codex-combo-v2',
              label: 'my-codex-combo-v2',
              contextWindow: 128_000,
              maxOutputTokens: 8_192,
            },
          ],
        },
      )

      expect(
        resolveModelRuntimeLimits({
          model: 'my-codex-combo-v2',
          processEnv: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: baseUrl,
            CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({
              'my-codex-combo': 1_000_000,
            }),
            CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS: JSON.stringify({
              'my-codex-combo': 32_768,
            }),
          },
        }),
      ).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 32_768 })
    })
  })
})

describe('LLMTR runtime attribution', () => {
  it('keeps query-bearing endpoints on the generic custom transport', () => {
    const result = resolveOpenAIShimRuntimeContext({
      activeProfileProvider: 'llmtr',
      baseUrl: 'https://llmtr.com/v1?tenant=proxy',
      model: 'proxy-model',
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_FORMAT: 'responses',
      },
    })

    expect(result.routeId).not.toBe('llmtr')
    expect(result.openaiShimConfig.requiredApiFormat).toBeUndefined()
    expect(result.openaiShimConfig.maxTokensField).toBeUndefined()
  })
})

describe('AIMLAPI runtime attribution', () => {
})

describe('resolveOpenAIShimRuntimeContext - Z.A.I GLM-5.2', () => {
})

describe('resolveOpenAIShimRuntimeContext - Z.A.I GLM-5.3', () => {
})

describe('resolveOpenAIShimRuntimeContext - Z.A.I GLM-5.3-Flash', () => {
  it('does not apply the Coding Plan catalog entry on the same-host general endpoint', () => {
    const result = resolveOpenAIShimRuntimeContext({
      model: 'glm-5.3-flash',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      activeProfileProvider: 'zai',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })

    expect(result.routeId).toBe('custom')
    expect(result.catalogEntry).toBeNull()
    expect(result.openaiShimConfig.enableToolStreaming).toBe(false)
  })
})

describe('resolveOpenAIShimRuntimeContext - GLM on a non-Z.AI gateway (#1896)', () => {
  it('infers the GLM reasoning shim but not tool streaming for a third-party gateway', () => {
    const result = resolveOpenAIShimRuntimeContext({
      model: 'z-ai/glm-5.2',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      processEnv: {},
    })

    // No catalog entry for a custom OpenAI-compatible gateway, so the shim is
    // inferred from the model name.
    expect(result.catalogEntry).toBeNull()
    // Reasoning-shaping fields still apply — GLM needs them on any gateway.
    expect(result.openaiShimConfig.thinkingRequestFormat).toBe('zai-compatible')
    expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    // tool_stream is Z.AI-proprietary and must NOT be inferred; NVIDIA NIM (and
    // other third-party gateways) reject it with 400 Unsupported parameter(s).
    expect(result.openaiShimConfig.enableToolStreaming).toBe(false)
  })
})

describe('resolveOpenAIShimRuntimeContext - NVIDIA NIM GLM-5.2 (regression #1950)', () => {
  // The user selected `z-ai/glm-5.2` from NVIDIA NIM's discovered (dynamic)
  // model catalog. Even when a GLM catalog entry exists on a non-Z.AI gateway,
  // `tool_stream` must stay off (Z.AI-proprietary); the reasoning-shaping shim
  // still applies because GLM needs it on any gateway.
})

describe('resolveOpenAIShimRuntimeContext - Moonshot and Kimi Code catalog metadata', () => {
})

describe('resolveOpenAIShimRuntimeContext - GLM catalog-aware gating', () => {
})

describe('resolveOpenAIShimRuntimeContext - Hicap catalog metadata', () => {
})

describe('resolveOpenAIShimRuntimeContext - xAI catalog metadata', () => {
  it('uses live xAI model metadata and per-model shim overrides', () => {
    expect(
      resolveModelRuntimeLimits({
        model: 'grok-4.6',
        baseUrl: 'https://api.x.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 500_000 })

    const grok46 = resolveOpenAIShimRuntimeContext({
      model: 'grok-4.6-latest',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(grok46.routeId).toBe('xai')
    expect(grok46.catalogEntry?.id).toBe('grok-4.6')
    expect(grok46.catalogEntry?.reasoning?.levels).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])

    expect(
      resolveModelRuntimeLimits({
        model: 'grok-4.5',
        baseUrl: 'https://api.x.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 500_000, maxOutputTokens: 32_768 })

    expect(
      resolveModelRuntimeLimits({
        model: 'grok-4.20-0309-reasoning',
        baseUrl: 'https://api.x.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 32_768 })

    const grok420Reasoning = resolveOpenAIShimRuntimeContext({
      model: 'grok-4.20',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(grok420Reasoning.catalogEntry?.id).toBe('grok-4.20-0309-reasoning')
    expect(grok420Reasoning.openaiShimConfig.endpointPath).toBe('/responses')
    expect(grok420Reasoning.openaiShimConfig.removeBodyFields).toContain('reasoning_effort')

    expect(
      resolveModelRuntimeLimits({
        model: 'grok-build-0.1',
        baseUrl: 'https://api.x.ai/v1',
        processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
      }),
    ).toEqual({ contextWindow: 256_000, maxOutputTokens: 64_000 })

    const grok43 = resolveOpenAIShimRuntimeContext({
      model: 'grok-4',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(grok43.routeId).toBe('xai')
    expect(grok43.catalogEntry?.id).toBe('grok-4.3')
    expect(grok43.catalogEntry?.reasoning?.levels).toEqual([
      'low',
      'medium',
      'high',
    ])

    const build = resolveOpenAIShimRuntimeContext({
      model: 'grok-code-fast-1',
      baseUrl: 'https://api.x.ai/v1',
      processEnv: { CLAUDE_CODE_USE_OPENAI: '1' },
    })
    expect(build.routeId).toBe('xai')
    expect(build.catalogEntry?.id).toBe('grok-build-0.1')
    expect(build.catalogEntry?.capabilities?.supportsReasoning).toBe(false)
    expect(build.catalogEntry?.reasoning).toBeUndefined()
    expect(build.openaiShimConfig.endpointPath).toBe('/responses')
    expect(build.openaiShimConfig.removeBodyFields).toContain('reasoning_effort')
  })
})

describe('resolveOpenAIShimRuntimeContext - provider override route preference', () => {
  it('does not inherit ambient route config when the preferred base URL is unrecognized', () => {
    const result = resolveOpenAIShimRuntimeContext({
      model: 'gpt-4o',
      baseUrl: 'https://custom.example.test/v1',
      preferBaseUrlRoute: true,
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.groq.com/openai/v1',
      },
    })

    expect(result.routeId).toBeNull()
    expect(result.descriptor).toBeNull()
    expect(result.catalogEntry).toBeNull()
    expect(result.openaiShimConfig.removeBodyFields).toBeUndefined()
    expect(result.openaiShimConfig.thinkingRequestFormat).toBeUndefined()
  })

})

describe('resolveOpenAIShimRuntimeContext - segment-boundary heuristic', () => {
  describe('DeepSeek models', () => {
    it('should NOT infer preserveReasoningContent for custom aliases (false-positive case)', () => {
      // my-deepseek-rag is a custom alias, NOT a provider path
      // Should NOT trigger the DeepSeek detection
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'my-deepseek-rag',
      })
      // Custom aliases should NOT get preserveReasoningContent
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })

    it('should infer preserveReasoningContent for openrouter/deepseek/... paths (true-positive case)', () => {
      // openrouter/deepseek/deepseek-chat is a provider path with segments
      // Should trigger the DeepSeek detection
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'openrouter/deepseek/deepseek-chat',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
      expect(result.openaiShimConfig.reasoningContentFallback).toBe('')
    })

    it('should infer preserveReasoningContent for accounts/fireworks/... paths (true-positive case)', () => {
      // accounts/fireworks/models/deepseek-v3 is a provider path with multiple segments
      // Should trigger the DeepSeek detection
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'accounts/fireworks/models/deepseek-v3',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
      expect(result.openaiShimConfig.reasoningContentFallback).toBe('')
    })

    it('should infer preserveReasoningContent for deepseek-chat directly (standard case)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'deepseek-chat',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })

    it('should infer preserveReasoningContent for deepseek-coder (model name)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'deepseek-coder',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })
  })

  describe('Kimi/Moonshot models', () => {
    it('should NOT infer preserveReasoningContent for custom kimi aliases', () => {
      // Custom alias should not trigger
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'my-kimi-assistant',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })

    it('should infer preserveReasoningContent for moonshot AI paths', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'openrouter/moonshotai/moonshot-v1-8k',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })

    it('should infer preserveReasoningContent for direct moonshot model names', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'moonshot-v1-8k',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
    })
  })

  describe('GLM models', () => {
    it('should NOT infer Z.A.I overrides for custom glm aliases', () => {
      for (const model of ['my-glm-assistant', 'glm-assistant', 'glm-router']) {
        const result = resolveOpenAIShimRuntimeContext({
          processEnv: {},
          model,
        })
        expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
        expect(result.openaiShimConfig.thinkingRequestFormat).toBeUndefined()
        expect(result.openaiShimConfig.requireReasoningContentOnAssistantMessages).toBeUndefined()
        expect(result.openaiShimConfig.reasoningContentFallback).toBeUndefined()
        expect(result.openaiShimConfig.maxTokensField).toBeUndefined()
        expect(result.openaiShimConfig.removeBodyFields).toBeUndefined()
      }
    })

    it('should NOT infer Z.A.I overrides for Fireworks GLM catalog entries', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'accounts/fireworks/models/glm-5p2',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
      expect(result.openaiShimConfig.thinkingRequestFormat).toBeUndefined()
      expect(result.openaiShimConfig.requireReasoningContentOnAssistantMessages).toBeUndefined()
      expect(result.openaiShimConfig.reasoningContentFallback).toBeUndefined()
      expect(result.openaiShimConfig.maxTokensField).toBeUndefined()
      expect(result.openaiShimConfig.removeBodyFields).toBeUndefined()
    })

    it('should infer full GLM config for GLM paths', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'openrouter/zhipu/glm-5.2',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
      expect(result.openaiShimConfig.thinkingRequestFormat).toBe('zai-compatible')
      expect(result.openaiShimConfig.requireReasoningContentOnAssistantMessages).toBe(true)
      expect(result.openaiShimConfig.reasoningContentFallback).toBe('')
      expect(result.openaiShimConfig.maxTokensField).toBe('max_tokens')
      expect(result.openaiShimConfig.removeBodyFields).toEqual(['store'])
    })

    it('should infer full GLM config for direct glm model names', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'glm-5.2',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBe(true)
      expect(result.openaiShimConfig.thinkingRequestFormat).toBe('zai-compatible')
      expect(result.openaiShimConfig.requireReasoningContentOnAssistantMessages).toBe(true)
      expect(result.openaiShimConfig.reasoningContentFallback).toBe('')
      expect(result.openaiShimConfig.maxTokensField).toBe('max_tokens')
      expect(result.openaiShimConfig.removeBodyFields).toEqual(['store'])
    })
  })

  describe('Non-matching models', () => {
    it('should return undefined for gpt-4o (negative case)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'gpt-4o',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })

    it('should return undefined for claude models (negative case)', () => {
      const result = resolveOpenAIShimRuntimeContext({
        processEnv: {},
        model: 'claude-sonnet-4-20250514',
      })
      expect(result.openaiShimConfig.preserveReasoningContent).toBeUndefined()
    })
  })
})
