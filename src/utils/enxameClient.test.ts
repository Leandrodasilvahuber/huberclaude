import { describe, expect, test } from 'bun:test'
import { runEnxameTasks } from './enxameClient.js'
import type { EnxameAccount } from './enxameConfig.js'

const account: EnxameAccount = {
  apiKey: 'key-1',
  baseUrl: 'https://api.z.ai/api/paas/v4',
  model: 'glm-4.7-flash',
  fallbackModel: 'glm-4.5-flash',
  enabled: true,
  mode: 'both',
  workers: 3,
}

function reply(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
  })
}

const tasks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, prompt: `p${i}` }))

describe('runEnxameTasks', () => {
  test('caps concurrency at the worker count and keeps input order', async () => {
    let active = 0
    let peak = 0
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      active++
      peak = Math.max(peak, active)
      const prompt = JSON.parse(init.body as string).messages.at(-1).content
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return reply(`done ${prompt}`)
    }) as unknown as typeof fetch

    const results = await runEnxameTasks(account, tasks(8), { fetchImpl, spacingMs: 0 })
    expect(peak).toBe(3)
    expect(results.map(r => (r.ok ? r.text : r.error))).toEqual(
      tasks(8).map(t => `done ${t.prompt}`),
    )
  })

  test('sends only the task itself, with no session history', async () => {
    let body: unknown
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return reply('ok')
    }) as unknown as typeof fetch

    await runEnxameTasks(account, [{ id: 'a', prompt: 'resuma X', system: 'seja breve' }], {
      fetchImpl,
      maxTokens: 50,
      spacingMs: 0,
    })
    expect(body).toEqual({
      model: 'glm-4.7-flash',
      messages: [
        { role: 'system', content: 'seja breve' },
        { role: 'user', content: 'resuma X' },
      ],
      max_tokens: 50,
      thinking: { type: 'disabled' },
    })
  })

  test('staggers request starts across workers', async () => {
    const starts: number[] = []
    const fetchImpl = (async () => {
      starts.push(Date.now())
      return reply('ok')
    }) as unknown as typeof fetch
    await runEnxameTasks(account, tasks(3), { fetchImpl, spacingMs: 40 })
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(35)
  })

  test('retries a 429 on the same model before falling back', async () => {
    const tried: string[] = []
    const flaky = (async (_url: string, init: RequestInit) => {
      tried.push(JSON.parse(init.body as string).model)
      return tried.length === 1
        ? new Response('{"error":{"code":"1302"}}', { status: 429 })
        : reply('second try')
    }) as unknown as typeof fetch
    expect(
      await runEnxameTasks(account, tasks(1), { fetchImpl: flaky, spacingMs: 0, retryDelaysMs: [1] }),
    ).toEqual([{ id: 't0', ok: true, model: 'glm-4.7-flash', text: 'second try' }])
    expect(tried).toEqual(['glm-4.7-flash', 'glm-4.7-flash'])
  })

  test('falls back once retries run out and stops on a rejected key', async () => {
    const tried: string[] = []
    const overloaded = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(init.body as string).model
      tried.push(model)
      return model === 'glm-4.7-flash'
        ? new Response('busy', { status: 429 })
        : reply('fallback ok')
    }) as unknown as typeof fetch
    expect(
      await runEnxameTasks(account, tasks(1), {
        fetchImpl: overloaded,
        spacingMs: 0,
        retryDelaysMs: [1, 1],
      }),
    ).toEqual([
      { id: 't0', ok: true, model: 'glm-4.5-flash', text: 'fallback ok' },
    ])
    expect(tried).toEqual(['glm-4.7-flash', 'glm-4.7-flash', 'glm-4.7-flash', 'glm-4.5-flash'])

    let calls = 0
    const unauthorized = (async () => {
      calls++
      return new Response('bad key', { status: 401 })
    }) as unknown as typeof fetch
    expect(
      await runEnxameTasks(account, tasks(1), { fetchImpl: unauthorized, spacingMs: 0 }),
    ).toEqual([
      { id: 't0', ok: false, error: 'glm-4.7-flash: HTTP 401: bad key' },
    ])
    expect(calls).toBe(1)
  })

  test('aborting rejects instead of reporting failures', async () => {
    const controller = new AbortController()
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        controller.abort()
      })) as unknown as typeof fetch
    await expect(
      runEnxameTasks(account, tasks(2), { fetchImpl, signal: controller.signal, spacingMs: 0 }),
    ).rejects.toBeDefined()
  })
})
