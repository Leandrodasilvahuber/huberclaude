export function filterAnthropicHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {}

  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith('x-anthropic') ||
      lower.startsWith('anthropic-') ||
      lower.startsWith('x-claude') ||
      lower === 'x-app' ||
      lower === 'x-client-app' ||
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'api-key'
    ) {
      continue
    }
    filtered[key] = value
  }

  return filtered
}

export function isGeminiModelName(model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase()
  return (
    normalized?.startsWith('google/gemini-') === true ||
    normalized?.startsWith('gemini-') === true
  )
}

export function shouldPreserveGeminiThoughtSignature(
  model: string | undefined,
): boolean {
  return isGeminiModelName(model)
}

export function geminiThoughtSignatureFromExtraContent(
  extraContent: unknown,
): string | undefined {
  if (!extraContent || typeof extraContent !== 'object') return undefined
  const google = (extraContent as Record<string, unknown>).google
  if (!google || typeof google !== 'object') return undefined
  const signature = (google as Record<string, unknown>).thought_signature
  return typeof signature === 'string' && signature.length > 0 ? signature : undefined
}

export function mergeGeminiThoughtSignature(
  extraContent: Record<string, unknown> | undefined,
  signature: string | undefined,
): Record<string, unknown> | undefined {
  if (!signature) return extraContent
  const existingGoogle =
    extraContent?.google && typeof extraContent.google === 'object'
      ? extraContent.google as Record<string, unknown>
      : {}
  return {
    ...extraContent,
    google: { ...existingGoogle, thought_signature: signature },
  }
}
