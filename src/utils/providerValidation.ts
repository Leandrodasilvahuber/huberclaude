import { resolveOpenRouterApiKey } from './openclaudeConfig.js'
import { hasPrintFlag } from './printFlag.js'

const MISSING_KEY_MESSAGE =
  'Error: No OpenRouter API key configured. Run huberclaude once interactively to configure it, or set HUBERCLAUDE_OPENROUTER_API_KEY.'

/**
 * HuberClaude only talks to OpenRouter, so the only startup requirement is a
 * saved (or HUBERCLAUDE_OPENROUTER_API_KEY) key.
 */
export function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveOpenRouterApiKey(env) ? null : MISSING_KEY_MESSAGE
}

/**
 * Non-interactive runs cannot prompt for a key; interactive runs show the
 * setup form from showSetupScreens instead.
 */
export function shouldExitForStartupProviderValidationError(options: {
  args?: string[]
  stdoutIsTTY?: boolean
} = {}): boolean {
  const args = options.args ?? process.argv.slice(2)
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY

  if (!stdoutIsTTY) {
    return true
  }

  return (
    hasPrintFlag(args) ||
    args.includes('--init-only') ||
    args.some(arg => arg.startsWith('--sdk-url'))
  )
}

export async function validateProviderEnvForStartupOrExit(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    args?: string[]
    stdoutIsTTY?: boolean
  },
): Promise<void> {
  const error = getProviderValidationError(env)
  if (error && shouldExitForStartupProviderValidationError(options)) {
    console.error(error)
    process.exit(1)
  }
}
