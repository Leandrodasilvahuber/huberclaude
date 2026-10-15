import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { saveEnxameAccount, setEnxameMode } from '../../utils/enxameConfig.js'
import { EnxameTool } from './EnxameTool.js'

let tempDir: string
let originalConfigDir: string | undefined

beforeEach(() => {
  originalConfigDir = process.env.OPENCLAUDE_CONFIG_DIR
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enxame-tool-'))
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

describe('EnxameTool', () => {
  test('is offered only in tool or both mode', () => {
    expect(EnxameTool.isEnabled()).toBe(false)
    saveEnxameAccount('zai-key')
    expect(EnxameTool.isEnabled()).toBe(true)
    setEnxameMode('agent')
    expect(EnxameTool.isEnabled()).toBe(false)
  })

  test('caps tasks at 10 and returns compact JSON to the model', () => {
    const task = { id: 'a', prompt: 'x' }
    expect(
      EnxameTool.inputSchema.safeParse({ tasks: Array(11).fill(task) }).success,
    ).toBe(false)

    const block = EnxameTool.mapToolResultToToolResultBlockParam(
      {
        results: [
          { id: 'a', ok: true, model: 'glm-4.7-flash', text: 'resumo' },
          { id: 'b', ok: false, error: 'HTTP 429' },
        ],
      },
      'tool-1',
    )
    expect(block.content).toBe(
      '[{"id":"a","ok":true,"text":"resumo"},{"id":"b","ok":false,"error":"HTTP 429"}]',
    )
  })
})
