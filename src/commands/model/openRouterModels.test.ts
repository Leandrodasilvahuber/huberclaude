import { describe, expect, test } from 'bun:test'
import {
  filterOpenRouterModels,
  formatContextLength,
  formatOpenRouterPrice,
  parseOpenRouterModels,
} from './openRouterModels.js'

const payload = {
  data: [
    {
      id: 'qwen/qwen-2.5-7b-instruct:free',
      name: 'Qwen 2.5 7B (free)',
      context_length: 32768,
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      context_length: 128000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
    },
    { id: '', name: 'broken' },
    'not-an-object',
  ],
}

describe('openRouterModels', () => {
  test('parses models with per-1M pricing and context, sorted by id', () => {
    const models = parseOpenRouterModels(payload)
    expect(models.map(m => m.id)).toEqual([
      'openai/gpt-4o',
      'qwen/qwen-2.5-7b-instruct:free',
    ])
    expect(models[0]!.promptPrice).toBeCloseTo(2.5)
    expect(models[0]!.completionPrice).toBeCloseTo(10)
    expect(models[0]!.contextLength).toBe(128000)
  })

  test('returns empty list for malformed payload', () => {
    expect(parseOpenRouterModels(null)).toEqual([])
    expect(parseOpenRouterModels({ data: 'x' })).toEqual([])
  })

  test('formats price and context', () => {
    const [gpt, qwen] = parseOpenRouterModels(payload)
    expect(formatOpenRouterPrice(gpt!)).toBe('$2.50/$10.00 per 1M')
    expect(formatOpenRouterPrice(qwen!)).toBe('free')
    expect(formatContextLength(128000)).toBe('128K')
    expect(formatContextLength(1_048_576)).toBe('1M')
    expect(formatContextLength(1_500_000)).toBe('1.5M')
    expect(formatContextLength(null)).toBe('?')
  })

  test('filters by all terms across id and name', () => {
    const models = parseOpenRouterModels(payload)
    expect(filterOpenRouterModels(models, 'qwen free').map(m => m.id)).toEqual([
      'qwen/qwen-2.5-7b-instruct:free',
    ])
    expect(filterOpenRouterModels(models, '')).toHaveLength(2)
    expect(filterOpenRouterModels(models, 'gpt claude')).toHaveLength(0)
  })
})
