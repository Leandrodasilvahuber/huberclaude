import { afterEach, describe, expect, test } from 'bun:test'

import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { computeStandaloneAgentContext } from './sessionRestore.js'

const originalSessionColor = getGlobalConfig().sessionColor

afterEach(() => {
  saveGlobalConfig(c => ({ ...c, sessionColor: originalSessionColor }))
})

describe('computeStandaloneAgentContext — color saved by /color', () => {
  test('new sessions start with the saved color', () => {
    saveGlobalConfig(c => ({ ...c, sessionColor: 'red' }))
    expect(computeStandaloneAgentContext(undefined, undefined)).toEqual({
      name: '',
      color: 'red',
    })
  })

  test('no saved color keeps the default look', () => {
    saveGlobalConfig(c => ({ ...c, sessionColor: undefined }))
    expect(computeStandaloneAgentContext(undefined, undefined)).toBeUndefined()
  })

  test("a resumed session's own color wins over the saved one", () => {
    saveGlobalConfig(c => ({ ...c, sessionColor: 'red' }))
    expect(computeStandaloneAgentContext(undefined, 'blue')?.color).toBe('blue')
    expect(computeStandaloneAgentContext(undefined, 'default')?.color).toBeUndefined()
  })
})
