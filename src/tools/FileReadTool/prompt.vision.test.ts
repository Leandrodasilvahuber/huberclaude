import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { ToolUseContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'

const moduleNonce = `vision-${Date.now()}-${Math.random()}`
const { FileReadTool } = (await import(
  `./FileReadTool.js?${moduleNonce}`
)) as typeof import('./FileReadTool.js')
const { renderPromptTemplate } = (await import(
  `./prompt.js?${moduleNonce}`
)) as typeof import('./prompt.js')

const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL
const originalOpenAIApiBase = process.env.OPENAI_API_BASE

beforeEach(async () => {
  await acquireSharedMutationLock('tools/FileReadTool/prompt.vision.test.ts')
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
})

afterEach(() => {
  try {
    if (originalOpenAIBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL
    } else {
      process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl
    }
    if (originalOpenAIApiBase === undefined) {
      delete process.env.OPENAI_API_BASE
    } else {
      process.env.OPENAI_API_BASE = originalOpenAIApiBase
    }
  } finally {
    releaseSharedMutationLock()
  }
})

function createToolUseContext(
  mainLoopModel: string,
  providerOverride?: ToolUseContext['options']['providerOverride'],
): ToolUseContext {
  return {
    options: {
      mainLoopModel,
      providerOverride,
    },
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
  } as unknown as ToolUseContext
}

describe('renderPromptTemplate — vision sentence (issue #1421)', () => {
  test('includes the image-reading sentence when the active model supports vision (default Claude)', () => {
    const rendered = renderPromptTemplate(
      '- Results are returned using cat -n format, with line numbers starting at 1',
      '',
      '',
    )

    expect(rendered).toContain('This tool allows Claude Code to read images')
  })

  test('always includes the Jupyter notebook sentence and the directory-listing hint', () => {
    const rendered = renderPromptTemplate(
      '- Results are returned using cat -n format, with line numbers starting at 1',
      '',
      '',
    )

    expect(rendered).toContain('Jupyter notebooks')
    expect(rendered).toContain('not directories')
  })
})
