import { describe, expect, test } from 'bun:test'
import { filterHuberModels, HUBER_MODELS, isHuberModel } from './models.js'

describe('isHuberModel', () => {
  test('matches a recommended model', () => {
    expect(isHuberModel('z-ai/glm-5.2')).toBe(true)
  })

  test('rejects models outside the list, so nothing is marked current', () => {
    expect(isHuberModel('qwen/qwen3-coder-flash')).toBe(false)
    expect(isHuberModel(null)).toBe(false)
    expect(isHuberModel('')).toBe(false)
  })
})

describe('filterHuberModels', () => {
  test('returns every model for an empty query', () => {
    expect(filterHuberModels('  ')).toEqual(HUBER_MODELS)
  })

  test('filters by id or tier, case-insensitively', () => {
    expect(filterHuberModels('CLAUDE').every(m => m.id.includes('claude'))).toBe(
      true,
    )
    expect(filterHuberModels('free').every(m => m.tier === 'FREE')).toBe(true)
  })
})

test('model ids are unique', () => {
  const ids = HUBER_MODELS.map(m => m.id)
  expect(new Set(ids).size).toBe(ids.length)
})
