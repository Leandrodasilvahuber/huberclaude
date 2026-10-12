import * as React from 'react'
import { useState } from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import TextInput from '../../components/TextInput.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  applyOpenRouterConfigToEnv,
  DEFAULT_OPENROUTER_BASE_URL,
  getOpenRouterConfig,
  saveOpenRouterConfig,
} from '../../utils/openclaudeConfig.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return (
    <Login
      onDone={success => {
        if (success) {
          context.onChangeAPIKey()
        }
        onDone(
          success
            ? 'OpenRouter configuration saved'
            : 'OpenRouter configuration cancelled',
          { display: 'system' },
        )
      }}
    />
  )
}

/**
 * OpenRouter setup: API key, then base URL. Saves to ~/.openclaude/config.json
 * and points the running session at OpenRouter.
 */
export function Login(props: {
  startingMessage?: string
  onDone: (success: boolean) => void
}): React.ReactNode {
  const saved = getOpenRouterConfig()
  const [step, setStep] = useState<'apikey' | 'baseurl'>('apikey')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(
    saved.baseUrl || DEFAULT_OPENROUTER_BASE_URL,
  )
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  function submitApiKey(): void {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      if (saved.apiKey) {
        // Empty input keeps the saved key.
        setApiKey(saved.apiKey)
      } else {
        setError('API key is required')
        return
      }
    }
    setError(null)
    setCursorOffset(baseUrl.length)
    setStep('baseurl')
  }

  function submitBaseUrl(): void {
    const url = baseUrl.trim() || DEFAULT_OPENROUTER_BASE_URL
    if (!/^https?:\/\//.test(url)) {
      setError('Base URL must start with http:// or https://')
      return
    }
    try {
      saveOpenRouterConfig({
        apiKey: apiKey.trim() || saved.apiKey,
        baseUrl: url.replace(/\/+$/, ''),
      })
    } catch (err) {
      setError(`Failed to save configuration: ${(err as Error).message}`)
      return
    }
    applyOpenRouterConfigToEnv()
    props.onDone(true)
  }

  return (
    <Dialog
      title="OpenRouter configuration"
      onCancel={() => props.onDone(false)}
      color="permission"
    >
      <Box flexDirection="column" gap={1}>
        {props.startingMessage ? (
          <Text dimColor>{props.startingMessage}</Text>
        ) : null}
        {step === 'apikey' ? (
          <>
            <Text>
              OpenRouter API key
              {saved.apiKey ? ' (Enter keeps the saved key)' : ''}:
            </Text>
            <Box flexDirection="row" gap={1}>
              <Text>›</Text>
              <TextInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={submitApiKey}
                focus
                showCursor
                mask="*"
                placeholder="sk-or-v1-…"
                columns={80}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
              />
            </Box>
            <Text dimColor>Get a key at https://openrouter.ai/settings/keys</Text>
          </>
        ) : (
          <>
            <Text>OpenRouter base URL:</Text>
            <Box flexDirection="row" gap={1}>
              <Text>›</Text>
              <TextInput
                value={baseUrl}
                onChange={setBaseUrl}
                onSubmit={submitBaseUrl}
                focus
                showCursor
                placeholder={DEFAULT_OPENROUTER_BASE_URL}
                columns={80}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
              />
            </Box>
          </>
        )}
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    </Dialog>
  )
}
