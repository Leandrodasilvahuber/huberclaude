import { APIError } from '@anthropic-ai/sdk'
import { createCombinedAbortSignal } from '../../../utils/combinedAbortSignal.js'
import {
  registerInterruptionController,
  registerInterruptionSignal,
  requestAbort,
} from '../../../utils/interruptionTrace.js'
import { resolveProviderRequest, type ResolvedProviderRequest } from '../providerConfig.js'
import type { AnthropicStreamEvent, ShimCreateParams } from './types.js'

type CreateOptions = {
  signal?: AbortSignal
  headers?: Record<string, string>
}

type ProviderOverride = {
  model: string
  baseURL: string
  apiKey: string
}

export type ClientDispatchDependencies = {
  processEnv?: NodeJS.ProcessEnv
  providerOverride?: ProviderOverride
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  doRequest(
    request: ResolvedProviderRequest,
    params: ShimCreateParams,
    options?: CreateOptions,
    processEnv?: NodeJS.ProcessEnv,
  ): Promise<Response>
  convertNonStreamingResponse(data: unknown, model: string): unknown
  createStreamAbortError(): DOMException
  openaiStreamToAnthropic(
    response: Response,
    model: string,
    signal?: AbortSignal,
    requestUrl?: string,
  ): AsyncGenerator<AnthropicStreamEvent>
  makeMessageId(): string
}

type ShimResponse = {
  data: unknown
  response: Response
  request_id: string
}

export type ShimRequestPromise = Promise<unknown> & {
  withResponse(): Promise<ShimResponse>
}

export function headersWithRequestUrl(
  headers: Headers,
  requestUrl?: string,
): Headers {
  const next = new Headers(headers)
  if (requestUrl) next.set('x-opencode-request-url', requestUrl)
  return next
}

export class OpenAIShimStream implements AsyncIterable<AnthropicStreamEvent> {
  private makeGenerator: (signal: AbortSignal) => AsyncGenerator<AnthropicStreamEvent>
  private parentSignal?: AbortSignal
  private generator?: AsyncGenerator<AnthropicStreamEvent>
  private cleanupCombinedSignal?: () => void
  private cleanupPreIterationAbort?: () => void
  // The controller property is checked by claude.ts to distinguish streams from error messages
  controller = new AbortController()

  constructor(
    makeGenerator: (signal: AbortSignal) => AsyncGenerator<AnthropicStreamEvent>,
    parentSignal?: AbortSignal,
    cancelBeforeIteration?: () => void,
  ) {
    this.makeGenerator = makeGenerator
    this.parentSignal = parentSignal
    const parentId = parentSignal
      ? registerInterruptionSignal(parentSignal, {
          subsystem: 'openai_shim_dispatch',
          controllerRole: 'combined-parent',
        })
      : undefined
    registerInterruptionController(this.controller, {
      subsystem: 'openai_shim_dispatch',
      controllerRole: 'stream-controller',
      ...(parentId && { parentControllerIds: [parentId] }),
    })

    if (cancelBeforeIteration) {
      let cleaned = false
      let cancelled = false
      let onAbort: () => void = () => {}
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        this.controller.signal.removeEventListener('abort', onAbort)
        parentSignal?.removeEventListener('abort', onAbort)
      }
      onAbort = () => {
        if (!this.generator && !cancelled) {
          cancelled = true
          cancelBeforeIteration()
        }
        cleanup()
      }

      this.controller.signal.addEventListener('abort', onAbort, { once: true })
      parentSignal?.addEventListener('abort', onAbort, { once: true })
      this.cleanupPreIterationAbort = cleanup

      if (this.controller.signal.aborted || parentSignal?.aborted) {
        onAbort()
      }
    }
  }

  private getGenerator(): AsyncGenerator<AnthropicStreamEvent> {
    if (this.generator) {
      return this.generator
    }

    this.cleanupPreIterationAbort?.()
    this.cleanupPreIterationAbort = undefined

    const combined = createCombinedAbortSignal(this.parentSignal, {
      signalB: this.controller.signal,
      trace: {
        subsystem: 'openai_shim_dispatch',
        controllerRole: 'stream-combined',
      },
    })
    this.cleanupCombinedSignal = combined.cleanup
    this.generator = this.makeGenerator(combined.signal)
    return this.generator
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AnthropicStreamEvent> {
    const generator = this.getGenerator()
    let completed = false
    let failed = false
    try {
      yield* generator
      completed = true
    } catch (error) {
      failed = true
      throw error
    } finally {
      if (!completed && !failed && !this.controller.signal.aborted) {
        requestAbort(this.controller, undefined, {
          source: 'iterator_closed',
          subsystem: 'openai_shim_dispatch',
          controllerRole: 'stream-controller',
        })
      }
      this.cleanupCombinedSignal?.()
      this.cleanupCombinedSignal = undefined
      this.cleanupPreIterationAbort?.()
      this.cleanupPreIterationAbort = undefined
      if (!completed) {
        void generator.return?.(undefined as never).catch(() => {})
      }
    }
  }
}

export function createShimRequest(
  params: ShimCreateParams,
  options: CreateOptions | undefined,
  dependencies: ClientDispatchDependencies,
): ShimRequestPromise {
  const {
    convertNonStreamingResponse,
    createStreamAbortError,
    doRequest,
    makeMessageId,
    openaiStreamToAnthropic,
    providerOverride,
    processEnv,
    reasoningEffort,
  } = dependencies

  let httpResponse: Response | undefined

  const promise = (async (): Promise<unknown> => {
    const request = resolveProviderRequest({
      model: providerOverride?.model ?? params.model,
      baseUrl: providerOverride?.baseURL,
      reasoningEffortOverride: reasoningEffort,
      processEnv,
    })
    const response = await doRequest(request, params, options, processEnv)
    httpResponse = response

    if (params.stream) {
      const cancelBeforeIteration = () => {
        void response.body?.cancel(createStreamAbortError()).catch(() => {})
      }
      return new OpenAIShimStream(
        signal =>
          openaiStreamToAnthropic(
            response,
            request.resolvedModel,
            signal,
            response.url || undefined,
          ),
        options?.signal,
        cancelBeforeIteration,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const data = await response.json()
      return convertNonStreamingResponse(data, request.resolvedModel)
    }

    await response.text().catch(() => '')
    throw APIError.generate(
      response.status,
      undefined,
      `OpenAI API error ${response.status}: unexpected response content-type: ${response.headers.get('content-type') ?? 'unknown'}`,
      response.headers as unknown as Headers,
    )
  })() as ShimRequestPromise

  ;(promise as unknown as Record<string, unknown>).withResponse =
    async () => {
      const data = await promise
      return {
        data,
        response: httpResponse ?? new Response(),
        request_id:
          httpResponse?.headers.get('x-request-id') ?? makeMessageId(),
      }
    }

  return promise
}
