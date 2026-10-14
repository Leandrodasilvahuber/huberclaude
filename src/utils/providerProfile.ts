import { parseCredentialList } from '../services/api/credentialPool.js'

export type { SecretValueSource } from './providerSecrets.js'

export {
  maskSecretForDisplay,
  redactSecretValueForDisplay,
  sanitizeApiKey,
  sanitizeProviderConfigValue,
} from './providerSecrets.js'

export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'
export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
export const DEFAULT_MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'
export const DEFAULT_MISTRAL_MODEL = 'mistral-vibe-cli-latest'

type OpenAICredentialPool =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'usable' }

function resolveOpenAICredentialPool(
  value: string | null | undefined,
): OpenAICredentialPool {
  const credentials = parseCredentialList(value ?? undefined)
  if (credentials.length === 0) {
    return { kind: 'empty' }
  }
  if (credentials.some(credential => credential === 'SUA_CHAVE')) {
    return { kind: 'invalid' }
  }
  return { kind: 'usable' }
}

export function resolveOpenAICredentialEnvState(
  env: Record<string, string | undefined>,
): {
  configured: boolean
  invalid: boolean
  envVar?: 'OPENAI_API_KEYS' | 'OPENAI_API_KEY'
} {
  const plural = resolveOpenAICredentialPool(env.OPENAI_API_KEYS)
  if (plural.kind === 'usable') {
    return { configured: true, invalid: false, envVar: 'OPENAI_API_KEYS' }
  }
  if (plural.kind === 'invalid') {
    return { configured: false, invalid: true, envVar: 'OPENAI_API_KEYS' }
  }

  const singular = resolveOpenAICredentialPool(env.OPENAI_API_KEY)
  if (singular.kind === 'usable') {
    return { configured: true, invalid: false, envVar: 'OPENAI_API_KEY' }
  }
  if (singular.kind === 'invalid') {
    return { configured: false, invalid: true, envVar: 'OPENAI_API_KEY' }
  }

  return { configured: false, invalid: false }
}
