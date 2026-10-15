import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getBuiltInAgents } from '../../tools/AgentTool/builtInAgents.js'
import {
  saveEnxameAccount,
  setEnxameEnabled,
  setEnxameMode,
} from '../../utils/enxameConfig.js'
import { resolveAgentRunModelRouting } from './agentRouting.js'

let tempDir: string
let originalConfigDir: string | undefined

beforeEach(() => {
  originalConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enxame-routing-'))
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

const route = (subagentType: string) =>
  resolveAgentRunModelRouting({
    resolvedAgentModel: 'openai/gpt-5',
    parentModel: 'openai/gpt-5',
    subagentType,
    settings: null,
  })

const hasWorker = () => getBuiltInAgents().some(a => a.agentType === 'enxame-worker')

describe('enxame-worker routing', () => {
  test('routes the worker to z.ai only while the swarm offers agents', () => {
    expect(route('enxame-worker')).toEqual({ mainLoopModel: 'openai/gpt-5' })
    expect(hasWorker()).toBe(false)

    saveEnxameAccount('zai-key')
    expect(route('enxame-worker')).toEqual({
      mainLoopModel: 'glm-4.7-flash',
      providerOverride: {
        model: 'glm-4.7-flash',
        baseURL: 'https://api.z.ai/api/paas/v4',
        apiKey: 'zai-key',
      },
    })
    expect(hasWorker()).toBe(true)
    // Other agents keep the session provider.
    expect(route('general-purpose')).toEqual({ mainLoopModel: 'openai/gpt-5' })

    setEnxameMode('tool')
    expect(route('enxame-worker').providerOverride).toBeUndefined()
    expect(hasWorker()).toBe(false)

    setEnxameMode('both')
    setEnxameEnabled(false)
    expect(route('enxame-worker').providerOverride).toBeUndefined()
    expect(hasWorker()).toBe(false)
  })
})
