import { APIError } from '@anthropic-ai/sdk'
import type { OpenAIShimRuntimeContext } from '../../../integrations/runtimeMetadata.js'
import { resolveRouteCredentialValue } from '../../../integrations/routeMetadata.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  redactEncodedSecretSubstringsForDisplay,
  redactSecretSubstringsForDisplay,
} from '../../../utils/providerSecrets.js'
import { redactSecretValueForDisplay } from '../../../utils/providerProfile.js'
import { logApiCallEnd, logApiCallStart } from '../../../utils/requestLogging.js'
import {
  CredentialPool,
  hasInvalidCredentialPlaceholder,
  parseCredentialList,
  type CredentialLease,
} from '../credentialPool.js'
import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
  markOpenAIRequestNonReplayable,
} from '../openaiErrorClassification.js'
import { filterAnthropicHeaders } from './providerCompatibility.js'
import {
  fetchWithHeadersDeadline,
  getApiTimeoutMs,
  redactUrlForDiagnostics,
  redactUrlsInMessage,
  ResponseHeadersTimeoutError,
} from './transport.js'
import { headersWithRequestUrl } from './clientDispatch.js'

export function formatRetryAfterHint(response: Response): string {
  const retryAfter = response.headers.get('retry-after')
  return retryAfter ? ` (Retry-After: ${retryAfter})` : ''
}

export function sleepMs(
  ms: number,
  schedule: (callback: () => void, delay: number) => unknown = setTimeout,
): Promise<void> {
  return new Promise((resolve) => schedule(resolve, ms))
}

function isAbortLikeError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError')
  )
}

function contentBlocksContainImages(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (!block || typeof block !== 'object') return false
    const record = block as Record<string, unknown>
    if (
      record.type === 'image' ||
      record.type === 'image_url' ||
      record.type === 'input_image'
    ) {
      return true
    }
    return record.type === 'tool_result' && contentBlocksContainImages(record.content)
  })
}

/** True when any chat message carries an image part. */
export function requestBodyContainsImages(
  payload: Record<string, unknown> | undefined,
): boolean {
  const messages = payload?.messages
  return (
    Array.isArray(messages) &&
    messages.some(message => {
      if (!message || typeof message !== 'object') return false
      return contentBlocksContainImages((message as Record<string, unknown>).content)
    })
  )
}

type RequestExecutorContext = {
  defaultHeaders: Record<string, string>
  providerOverride?: { apiKey?: string }
  getCredentialPool: (rawCredentials: string) => CredentialPool | null
  request: {
    baseUrl: string
    resolvedModel: string
  }
  params: { stream?: boolean }
  options?: { headers?: Record<string, string>; signal?: AbortSignal }
  requestProcessEnv: NodeJS.ProcessEnv
  shimConfig: {
    headers?: Record<string, string>
    defaultAuthHeader?: { name: string; scheme?: string }
  }
  runtimeShimContext: OpenAIShimRuntimeContext
  body: Record<string, unknown>
  serializeBody: () => string
}

export async function executeOpenAIRequest(
  context: RequestExecutorContext,
): Promise<Response> {
  const {
    defaultHeaders,
    providerOverride,
    getCredentialPool,
    request,
    params,
    options,
    requestProcessEnv,
    shimConfig,
    runtimeShimContext,
    body,
    serializeBody,
  } = context
  const apiTimeoutMs = getApiTimeoutMs()
  const fetchRequest = (url: string, init: RequestInit) =>
    fetchWithHeadersDeadline(url, init, {
      callerSignal: options?.signal,
      timeoutMs: apiTimeoutMs,
    })

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...filterAnthropicHeaders(shimConfig.headers),
    ...defaultHeaders,
    ...filterAnthropicHeaders(options?.headers),
  }

  const routeCredential = resolveRouteCredentialValue({
    routeId: runtimeShimContext.routeId ?? undefined,
    baseUrl: request.baseUrl,
    processEnv: requestProcessEnv,
  })
  const openAIApiKeysPoolRaw = requestProcessEnv.OPENAI_API_KEYS
  const openAIApiKeyRaw = requestProcessEnv.OPENAI_API_KEY?.trim()
  const apiKeyRaw =
    providerOverride?.apiKey ??
    (parseCredentialList(openAIApiKeysPoolRaw).length > 0
      ? openAIApiKeysPoolRaw
      : undefined) ??
    routeCredential ??
    (parseCredentialList(openAIApiKeyRaw).length > 0 ? openAIApiKeyRaw : undefined) ??
    ''
  if (hasInvalidCredentialPlaceholder(apiKeyRaw)) {
    throw APIError.generate(
      401,
      undefined,
      buildOpenAICompatibilityErrorMessage(
        'OpenAI API error 401: invalid credential placeholder detected',
        {
          category: 'auth_invalid',
          requestUrl: request.baseUrl,
        },
      ),
      new Headers(),
    )
  }
  // A provider-override credential is a single fixed value — only a generic
  // OPENAI_API_KEYS/OPENAI_API_KEY pool rotates (routeCredential is a fallback,
  // not a reason to disable the pool).
  const credentialPool =
    providerOverride?.apiKey
      ? null
      : getCredentialPool(apiKeyRaw)
  const singleAuthValue = parseCredentialList(apiKeyRaw)[0] || apiKeyRaw

  const buildHeaders = (
    credentialLease: CredentialLease | null,
  ): Record<string, string> => {
    const headers: Record<string, string> = { ...baseHeaders }
    const authValue = credentialLease?.value || (credentialPool ? '' : singleAuthValue)
    if (authValue) {
      if (shimConfig.defaultAuthHeader?.name) {
        headers[shimConfig.defaultAuthHeader.name] =
          shimConfig.defaultAuthHeader.scheme === 'bearer'
            ? `Bearer ${authValue}`
            : authValue
      } else {
        headers.Authorization = `Bearer ${authValue}`
      }
    }
    return headers
  }

  const requestUrl = `${request.baseUrl.replace(/\/+$/, '')}/chat/completions`

  let didRetryWithoutToolStream = false
  let didRetryWithoutStreamOptions = false
  let serializedBody = serializeBody()
  const refreshSerializedBody = (): void => {
    serializedBody = serializeBody()
  }
  const serializedBodyHasTopLevelField = (field: string): boolean => {
    try {
      const payload = JSON.parse(serializedBody) as Record<string, unknown>
      return Object.prototype.hasOwnProperty.call(payload, field)
    } catch {
      return false
    }
  }
  const bodyContainsImages = (): boolean => {
    try {
      return requestBodyContainsImages(
        JSON.parse(serializedBody) as Record<string, unknown>,
      )
    } catch {
      return false
    }
  }

  const safeDisplay = (text: string, fallback: string): string => {
    const encodedSecretRedacted =
      redactEncodedSecretSubstringsForDisplay(text, requestProcessEnv) ??
      fallback
    const substringRedacted =
      redactSecretSubstringsForDisplay(encodedSecretRedacted, requestProcessEnv) ??
      fallback
    return (
      redactSecretValueForDisplay(substringRedacted, requestProcessEnv) ||
      fallback
    )
  }

  const throwClassifiedTransportError = (
    error: unknown,
    preclassifiedFailure?: ReturnType<typeof classifyOpenAINetworkFailure>,
  ): never => {
    if (options?.signal?.aborted) {
      throw error
    }

    const failure =
      preclassifiedFailure ??
      classifyOpenAINetworkFailure(error, { url: requestUrl })
    const safeMessage = safeDisplay(
      redactUrlsInMessage(failure.message),
      'Request failed',
    )

    logForDebugging(
      `[OpenAIShim] transport failure category=${failure.category} retryable=${failure.retryable} code=${failure.code ?? 'unknown'} method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel} message=${safeMessage}`,
      { level: 'warn' },
    )

    const apiError = APIError.generate(
      0,
      undefined,
      buildOpenAICompatibilityErrorMessage(
        `OpenAI API transport error: ${safeMessage}${failure.code ? ` (code=${failure.code})` : ''}`,
        failure,
      ),
      new Headers(),
    )
    throw failure.retryable
      ? apiError
      : markOpenAIRequestNonReplayable(apiError)
  }

  const throwClassifiedHttpError = (
    status: number,
    errorBody: string,
    parsedBody: object | undefined,
    responseHeaders: Headers,
    failure: ReturnType<typeof classifyOpenAIHttpFailure>,
  ): never => {
    const safeErrorBody = safeDisplay(errorBody, 'unknown error')
    let safeParsedBody = parsedBody
    if (safeErrorBody !== errorBody) {
      try {
        safeParsedBody = JSON.parse(safeErrorBody) as object
      } catch {
        safeParsedBody = undefined
      }
    }

    logForDebugging(
      `[OpenAIShim] request failed category=${failure.category} retryable=${failure.retryable} status=${status} method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
      { level: 'warn' },
    )

    throw APIError.generate(
      status,
      safeParsedBody,
      buildOpenAICompatibilityErrorMessage(
        `OpenAI API error ${status}: ${safeErrorBody}`,
        { ...failure, requestUrl: failure.requestUrl ?? requestUrl },
      ),
      headersWithRequestUrl(responseHeaders, requestUrl),
    )
  }

  const { correlationId, startTime } = logApiCallStart(
    'openrouter',
    request.resolvedModel,
  )
  const credentialPoolAttempts = credentialPool?.size ?? 1
  // One request plus one self-heal retry, plus one attempt per pooled
  // credential; each specific recovery reserves one extra attempt only when
  // it is actually needed.
  let maxAttempts = Math.max(2, credentialPoolAttempts)
  let retryCredentialLease: CredentialLease | null = null
  const CREDENTIAL_POOL_COOLDOWN_MS = 30_000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const credentialLease =
      retryCredentialLease ?? credentialPool?.next() ?? null
    retryCredentialLease = null
    if (credentialPool && !credentialLease) {
      throw APIError.generate(
        401,
        undefined,
        buildOpenAICompatibilityErrorMessage(
          'OpenAI API error 401: credential pool exhausted after authentication failures',
          {
            category: 'auth_invalid',
            requestUrl,
          },
        ),
        new Headers(),
      )
    }
    let response: Response
    try {
      response = await fetchRequest(requestUrl, {
        method: 'POST',
        headers: buildHeaders(credentialLease),
        body: serializedBody,
        signal: options?.signal,
      })
    } catch (error) {
      if (options?.signal?.aborted === true || isAbortLikeError(error)) {
        throw error
      }
      const failure = {
        ...classifyOpenAINetworkFailure(error, { url: requestUrl }),
        ...(error instanceof ResponseHeadersTimeoutError
          ? { retryable: false }
          : {}),
      }
      return throwClassifiedTransportError(error, failure)
    }

    if (response.ok) {
      credentialPool?.reportSuccess(credentialLease)
      let tokensIn = 0
      let tokensOut = 0
      // Skip clone() for streaming responses - it blocks until the full body
      // is received. Usage arrives via stream_options.include_usage instead.
      if (!params.stream) {
        try {
          const bodyText = await response.text()
          // Recreate the response right after reading the body so downstream
          // code can still read it even if JSON.parse below fails.
          const originalUrl = response.url
          response = new Response(bodyText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
          if (originalUrl) {
            try {
              Object.defineProperty(response, 'url', {
                value: originalUrl,
                configurable: true,
              })
            } catch {
              /* some runtimes lock the property */
            }
          }
          const data = JSON.parse(bodyText)
          tokensIn = data.usage?.prompt_tokens ?? 0
          tokensOut = data.usage?.completion_tokens ?? 0
        } catch {
          /* ignore — response is already recreated with the body intact */
        }
      }
      logApiCallEnd(
        correlationId,
        startTime,
        request.resolvedModel,
        'success',
        tokensIn,
        tokensOut,
        false,
      )
      return response
    }

    // Read body exactly once — Response body is a stream.
    let errorBody: string
    try {
      errorBody = await response.text()
    } catch (error) {
      if (options?.signal?.aborted) {
        throw options.signal.reason ?? error
      }
      errorBody = 'unknown error'
    }
    if (options?.signal?.aborted) {
      throw (
        options.signal.reason ??
        new DOMException('The operation was aborted.', 'AbortError')
      )
    }

    const failure = classifyOpenAIHttpFailure({
      status: response.status,
      body: errorBody,
      url: requestUrl,
      hasImages: bodyContainsImages(),
    })

    const credentialFailureKind =
      failure.category === 'auth_invalid' && !failure.retryable
        ? 'auth'
        : response.status === 402 || response.status === 429
          ? 'cooldown'
          : null
    if (credentialPool && credentialPool.size > 1 && credentialFailureKind) {
      credentialPool.reportFailure(
        credentialLease,
        credentialFailureKind,
        CREDENTIAL_POOL_COOLDOWN_MS,
      )
      if (attempt < maxAttempts - 1) {
        logForDebugging(
          `[OpenAIShim] credential pool retry status=${response.status} method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
          { level: 'warn' },
        )
        continue
      }
    }

    // Some strict OpenAI-compatible servers reject the optional usage
    // extension instead of ignoring it. Retry only an exact top-level field
    // rejection, and only when the request actually contained the field.
    if (
      !didRetryWithoutStreamOptions &&
      failure.category === 'stream_options_unsupported' &&
      options?.signal?.aborted !== true &&
      serializedBodyHasTopLevelField('stream_options')
    ) {
      didRetryWithoutStreamOptions = true
      maxAttempts += 1
      delete body.stream_options
      refreshSerializedBody()
      retryCredentialLease = credentialLease
      logForDebugging(
        `[OpenAIShim] self-heal retry reason=stream_options_unsupported method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
        { level: 'warn' },
      )
      continue
    }

    // `tool_stream` self-heal (#1950): drop the Z.AI-proprietary parameter a
    // gateway rejected and retry with tools intact.
    if (
      !didRetryWithoutToolStream &&
      failure.category === 'tool_stream_unsupported' &&
      body.tool_stream === true
    ) {
      didRetryWithoutToolStream = true
      maxAttempts += 1
      delete body.tool_stream
      refreshSerializedBody()
      retryCredentialLease = credentialLease
      logForDebugging(
        `[OpenAIShim] self-heal retry reason=tool_stream_unsupported method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
        { level: 'warn' },
      )
      continue
    }

    let errorResponse: object | undefined
    try {
      errorResponse = JSON.parse(errorBody)
    } catch {
      /* raw text */
    }
    throwClassifiedHttpError(
      response.status,
      errorBody,
      errorResponse,
      response.headers as unknown as Headers,
      failure,
    )
  }

  throw APIError.generate(
    500,
    undefined,
    'OpenAI shim: request loop exited unexpectedly',
    new Headers(),
  )
}
