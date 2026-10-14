import { describe, expect, test } from 'bun:test'

import {
  checkVisionCapabilityForFile,
  findModelDescriptorForApiName,
  findModelDescriptorForApiNameWithRoute,
  isVisionSupported,
  VISION_NOT_SUPPORTED_ERROR_CODE,
} from './visionUtils.js'

describe('VISION_NOT_SUPPORTED_ERROR_CODE', () => {
  test('is a non-conflicting positive integer distinct from other Read error codes', () => {
    expect(VISION_NOT_SUPPORTED_ERROR_CODE).toBe(10)
  })
})

describe('findModelDescriptorForApiName', () => {
  test('returns undefined for empty / whitespace input', () => {
    expect(findModelDescriptorForApiName(undefined)).toBeUndefined()
    expect(findModelDescriptorForApiName('')).toBeUndefined()
    expect(findModelDescriptorForApiName('   ')).toBeUndefined()
  })

  test('returns the registered descriptor for a prefix match', () => {
    const descriptor = findModelDescriptorForApiName('claude-sonnet-4-6')
    expect(descriptor).toBeDefined()
    expect(descriptor?.id).toContain('claude')
  })

  test('uses route-specific catalog aliases before global model ids', () => {
    const descriptor = findModelDescriptorForApiNameWithRoute(
      'grok-code-fast-1',
      'xai',
    )
    expect(descriptor?.id).toBe('xai/grok-build-0.1')
    expect(descriptor?.capabilities?.supportsVision).toBe(false)
  })

  test('resolves gateway Grok 4.6 names to the shared descriptor', () => {
    expect(findModelDescriptorForApiName('grok-4.6')?.id).toBe('grok-4.6')
    expect(findModelDescriptorForApiName('x-ai/grok-4.6')?.id).toBe('grok-4.6')
    expect(findModelDescriptorForApiName('xai/grok-4.6')?.id).toBe('grok-4.6')
    expect(findModelDescriptorForApiName('grok-4.5')?.id).toBe('grok-4.5')
    expect(isVisionSupported('grok-4.6')).toBe(true)
    expect(isVisionSupported('x-ai/grok-4.6')).toBe(true)
  })

  test('does not resolve catalog aliases without a known route', () => {
    expect(findModelDescriptorForApiName('grok-code-fast-1-0825')).toBeUndefined()
  })

  test('returns undefined for unknown models so callers fail open', () => {
    expect(findModelDescriptorForApiName('definitely-not-a-real-model-xyz')).toBeUndefined()
  })
})

describe('isVisionSupported', () => {
  test('returns true for the registered vision variant (Xiaomi Mimo V2.5)', () => {
    expect(isVisionSupported('mimo-v2.5')).toBe(true)
  })

  test('does not let ambient OPENAI_BASE_URL change route-free checks', () => {
    const originalBaseUrl = process.env.OPENAI_BASE_URL
    process.env.OPENAI_BASE_URL = 'https://opencode.ai/zen/go/v1'
    try {
      expect(isVisionSupported('mimo-v2.5')).toBe(true)
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.OPENAI_BASE_URL
      } else {
        process.env.OPENAI_BASE_URL = originalBaseUrl
      }
    }
  })

  test('returns true for Claude models', () => {
    expect(isVisionSupported('claude-sonnet-4-6')).toBe(true)
  })

  test('returns true for Gemini models', () => {
    expect(isVisionSupported('gemini-2.5-pro')).toBe(true)
  })

  test('allows GLM-5.3-Flash images on the direct Z.AI catalog route', () => {
    expect(
      isVisionSupported('glm-5.3-flash', {
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      }),
    ).toBe(true)
  })

  test('falls open for unknown models so custom / non-registered providers keep working', () => {
    expect(isVisionSupported('custom-vision-corp/secret-model-v1')).toBe(true)
    expect(isVisionSupported('not-a-real-model-xyz')).toBe(true)
  })
})

describe('checkVisionCapabilityForFile (issue #1421)', () => {
  test('allows PNG read for a registered vision-capable model', () => {
    const result = checkVisionCapabilityForFile(
      'C:\\temp\\openclaude\\tests\\fixtures\\screenshot.png',
      'claude-sonnet-4-6',
    )
    expect(result.result).toBe(true)
  })

  test('allows PNG read for unknown models (fail-open so non-registered providers keep working)', () => {
    const result = checkVisionCapabilityForFile(
      'C:\\foo\\bar.png',
      'my-custom-provider/vision-experimental',
    )
    expect(result.result).toBe(true)
  })

  test('allows GLM-5.3-Flash PNG and JPEG reads on the direct Z.AI route', () => {
    for (const filePath of ['x.png', 'x.jpeg']) {
      expect(
        checkVisionCapabilityForFile(filePath, 'glm-5.3-flash', {
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        }).result,
      ).toBe(true)
    }
  })

  test('does not gate text-file reads on non-vision models', () => {
    const result = checkVisionCapabilityForFile('C:\\foo\\bar.txt', 'mimo-v2.5-pro')
    expect(result.result).toBe(true)
  })

  test('does not gate PDF reads (PDF has its own capability gate)', () => {
    const result = checkVisionCapabilityForFile('C:\\foo\\bar.pdf', 'mimo-v2.5-pro')
    expect(result.result).toBe(true)
  })

  test('handles files without an extension', () => {
    expect(
      checkVisionCapabilityForFile('C:\\foo\\bar', 'mimo-v2.5-pro').result,
    ).toBe(true)
  })
})
