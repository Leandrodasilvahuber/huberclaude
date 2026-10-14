/**
 * --provider / --model CLI flag support.
 *
 * HuberClaude only talks to OpenRouter, so `--provider` accepts a single
 * value and `--model` always targets the OpenAI-compatible model variable.
 *
 * Usage:
 *   huberclaude --provider openrouter --model qwen/qwen3-coder
 *   huberclaude --model anthropic/claude-sonnet-4.5
 */

import { parseModelFlagValue } from './cliArgs.js'
import {
  argsBeforeModelOwningSubcommand,
  parseRootOptionValue,
} from './printFlag.js'

export const VALID_PROVIDERS = ['openrouter']

export type ProviderFlagName = string

/**
 * Extract the value of --provider from argv.
 * Returns null if the flag is absent or has no value.
 */
export function parseProviderFlag(args: string[]): string | null {
  return parseRootOptionValue(args, '--provider') ?? null
}

/**
 * Extract the value of --model from argv.
 * Returns null if absent.
 */
export function parseModelFlag(args: string[]): string | null {
  return parseModelFlagValue(args) ?? null
}

/**
 * Apply `--provider` from argv. Returns undefined when the flag is absent.
 */
export function applyProviderFlagFromArgs(
  args: string[],
): { error?: string } | undefined {
  const provider = parseProviderFlag(args)
  if (!provider) return undefined
  return applyProviderFlag(provider, args)
}

/** Kept for settings.env re-application; OpenRouter needs no remembered state. */
export function reapplyRememberedProviderFlag(): undefined {
  return undefined
}

/**
 * --model alone: point the OpenAI-compatible model variable at the value so
 * the highest-precedence CLI override replaces stale persisted model state.
 */
export function applyModelFlagFromArgs(
  args: string[],
): { error?: string } | undefined {
  if (parseProviderFlag(args)) return
  const model = parseModelFlag(args)
  if (!model) return

  process.env.OPENAI_MODEL = model
  return {}
}

/**
 * Validate the provider name and apply an optional `--model`.
 * Returns { error } if the provider is not "openrouter".
 */
export function applyProviderFlag(
  provider: string,
  args: string[],
): { error?: string } {
  if (provider !== 'openrouter') {
    return {
      error: `Unknown provider "${provider}". HuberClaude only supports: ${VALID_PROVIDERS.join(', ')}`,
    }
  }

  const model = parseModelFlag(argsBeforeModelOwningSubcommand(args))
  if (model) {
    process.env.OPENAI_MODEL = model
  }
  return {}
}
