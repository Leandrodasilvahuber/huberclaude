import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { asMockFetch } from '../test/typedMocks.js'
import {
  filtrarGratis,
  ordenarPorCapacidade,
  testarModelo,
  fetchProviderModels,
} from './freeModels.js'

const originalFetch = globalThis.fetch

function modelEntry(
  id: string,
  promptPrice = 0,
  completionPrice = 0,
): Record<string, unknown> {
  return {
    id,
    pricing: { prompt: promptPrice, completion: completionPrice },
  }
}

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

function errorResponse(status = 500): Response {
  return new Response(JSON.stringify({ error: 'boom' }), { status })
}

beforeEach(() => {
  mock.restore()
  globalThis.fetch = originalFetch
})

afterEach(() => {
  mock.restore()
  globalThis.fetch = originalFetch
})

describe('ordenarPorCapacidade', () => {
  test('ordena modelos mais capazes primeiro', () => {
    const modelos = [
      { id: 'qwen2.5-coder', promptPrice: null, completionPrice: null },
      { id: 'glm-4.5-flash', promptPrice: null, completionPrice: null },
      { id: 'deepseek-chat', promptPrice: null, completionPrice: null },
    ]
    expect(ordenarPorCapacidade(modelos)).toEqual([
      'deepseek-chat',
      'glm-4.5-flash',
      'qwen2.5-coder',
    ])
  })

  test('empate de peso usa ordem alfabética do id', () => {
    const modelos = [
      { id: 'z-model', promptPrice: null, completionPrice: null },
      { id: 'a-model', promptPrice: null, completionPrice: null },
    ]
    expect(ordenarPorCapacidade(modelos)).toEqual(['a-model', 'z-model'])
  })

  test('modelos sem peso conhecido ficam por último', () => {
    const modelos = [
      { id: 'modelo-desconhecido-xyz', promptPrice: null, completionPrice: null },
      { id: 'opus-4', promptPrice: null, completionPrice: null },
    ]
    expect(ordenarPorCapacidade(modelos)).toEqual(['opus-4', 'modelo-desconhecido-xyz'])
  })

  test('não modifica o array de entrada', () => {
    const modelos = [
      { id: 'glm-4.5', promptPrice: null, completionPrice: null },
      { id: 'haiku-3', promptPrice: null, completionPrice: null },
    ]
    const copia = [...modelos].map(m => ({ ...m }))
    ordenarPorCapacidade(modelos)
    expect(modelos).toEqual(copia)
  })
})

describe('filtrarGratis', () => {
  test('mantém modelos na lista freeModels do provedor', () => {
    const modelos = [
      { id: 'glm-4.5-flash', promptPrice: 1, completionPrice: 1 },
      { id: 'glm-4.5', promptPrice: 1, completionPrice: 1 },
      { id: 'pago', promptPrice: 1, completionPrice: 1 },
    ]
    expect(filtrarGratis(modelos, ['glm-4.5-flash', 'glm-4.5'])).toEqual([
      'glm-4.5-flash',
      'glm-4.5',
    ])
  })

  test('mantém modelos com preço 0/0 mesmo sem freeModels', () => {
    const modelos = [
      { id: 'gratis-por-preco', promptPrice: 0, completionPrice: 0 },
      { id: 'quase-gratis', promptPrice: 0, completionPrice: 1 },
      { id: 'pago', promptPrice: 1, completionPrice: 1 },
    ]
    expect(filtrarGratis(modelos, [])).toEqual(['gratis-por-preco'])
  })

  test('retorna vazio para lista vazia', () => {
    expect(filtrarGratis([], ['x'])).toEqual([])
  })
})

describe('fetchProviderModels', () => {
  test('busca modelos do endpoint /models com bearer token', async () => {
    globalThis.fetch = asMockFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        expect(url).toBe('https://api.example.com/models')
        expect(init?.headers).toEqual({ Authorization: 'Bearer minha-chave' })
        return okResponse({ data: [modelEntry('modelo-a')] })
      }),
    )

    const provider = { baseUrl: 'https://api.example.com', id: 'openrouter' }
    const modelos = await fetchProviderModels(
      provider as Parameters<typeof fetchProviderModels>[0],
      'minha-chave',
    )
    expect(modelos).toEqual([
      { id: 'modelo-a', promptPrice: 0, completionPrice: 0 },
    ])
  })

  test('retorna vazio quando o endpoint responde erro', async () => {
    globalThis.fetch = asMockFetch(mock(async () => errorResponse(500)))

    const provider = { baseUrl: 'https://api.example.com', id: 'openrouter' }
    const modelos = await fetchProviderModels(
      provider as Parameters<typeof fetchProviderModels>[0],
      'chave',
    )
    expect(modelos).toEqual([])
  })

  test('retorna vazio quando o body não é json válido', async () => {
    globalThis.fetch = asMockFetch(
      mock(async () => new Response('não é json', { status: 200 })),
    )

    const provider = { baseUrl: 'https://api.example.com', id: 'openrouter' }
    const modelos = await fetchProviderModels(
      provider as Parameters<typeof fetchProviderModels>[0],
      'chave',
    )
    expect(modelos).toEqual([])
  })
})

describe('testarModelo', () => {
  test('retorna true quando o endpoint responde 2xx', async () => {
    globalThis.fetch = asMockFetch(
      mock(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        expect(url).toContain('/chat/completions')
        return okResponse({})
      }),
    )

    const provider = { baseUrl: 'https://api.example.com', id: 'openrouter' }
    const ativo = await testarModelo(
      provider as Parameters<typeof testarModelo>[0],
      'chave',
      'modelo-a',
    )
    expect(ativo).toBe(true)
  })

  test('retorna false quando o endpoint responde erro', async () => {
    globalThis.fetch = asMockFetch(mock(async () => errorResponse(401)))

    const provider = { baseUrl: 'https://api.example.com', id: 'openrouter' }
    const ativo = await testarModelo(
      provider as Parameters<typeof testarModelo>[0],
      'chave',
      'modelo-a',
    )
    expect(ativo).toBe(false)
  })

  test('retorna false quando a requisição falha (rede)', async () => {
    globalThis.fetch = asMockFetch(mock(async () => {
      throw new TypeError('falha de rede')
    }))

    const provider = { baseUrl: 'https://api.example.com', id: 'openrouter' }
    const ativo = await testarModelo(
      provider as Parameters<typeof testarModelo>[0],
      'chave',
      'modelo-a',
    )
    expect(ativo).toBe(false)
  })
})
