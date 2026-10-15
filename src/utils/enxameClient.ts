import {
  type EnxameAccount,
  type EnxameMessage,
  clampEnxameWorkers,
  enxameChat,
} from './enxameConfig.js'

export type EnxameTask = {
  id: string
  prompt: string
  system?: string
}

export type EnxameTaskResult =
  | { id: string; ok: true; model: string; text: string }
  | { id: string; ok: false; error: string }

export const DEFAULT_ENXAME_MAX_TOKENS = 1024

/**
 * Runs each task as an isolated, stateless z.ai request (only its own system
 * and prompt, never the session history), at most `account.workers` at once,
 * with request starts staggered to stay under z.ai rate limits. Results keep
 * the input order. Throws only when `signal` aborts.
 */
export async function runEnxameTasks(
  account: EnxameAccount,
  tasks: EnxameTask[],
  {
    signal,
    fetchImpl = fetch,
    maxTokens = DEFAULT_ENXAME_MAX_TOKENS,
    spacingMs,
    retryDelaysMs,
  }: {
    signal?: AbortSignal
    fetchImpl?: typeof fetch
    maxTokens?: number
    /** Overrides the stagger between request starts (tests pass 0). */
    spacingMs?: number
    /** Overrides the 429 backoff schedule (tests pass short delays). */
    retryDelaysMs?: readonly number[]
  } = {},
): Promise<EnxameTaskResult[]> {
  const results: EnxameTaskResult[] = new Array(tasks.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      signal?.throwIfAborted()
      const index = next++
      const task = tasks[index]!
      const messages: EnxameMessage[] = task.system
        ? [
            { role: 'system', content: task.system },
            { role: 'user', content: task.prompt },
          ]
        : [{ role: 'user', content: task.prompt }]
      const result = await enxameChat(account, messages, {
        maxTokens,
        fetchImpl,
        signal,
        spacingMs,
        retryDelaysMs,
        label: `tool:${task.id}`,
      })
      results[index] = result.ok
        ? { id: task.id, ok: true, model: result.model, text: result.text }
        : { id: task.id, ok: false, error: result.failures.join(' | ') }
    }
  }

  const poolSize = Math.min(clampEnxameWorkers(account.workers), tasks.length)
  await Promise.all(Array.from({ length: poolSize }, worker))
  return results
}
