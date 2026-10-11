import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../commands.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text, Box } from '../../ink.js'
// Ajuste o caminho conforme o local real do seu gerenciador de configuração do OpenClaude
import { saveOpenRouterConfig, getOpenRouterConfig } from '../../utils/openclaudeConfig.js'

type LoginCompletion =
  | { type: 'success'; apiKey: string; baseUrl: string }
  | { type: 'cancel' }

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  const existingConfig = getOpenRouterConfig()

  return (
    <Login
      existingApiKey={existingConfig?.apiKey}
      existingBaseUrl={existingConfig?.baseUrl}
      onDone={async result => {
        if (result.type === 'cancel') {
          onDone('Configuração cancelada')
          return
        }

        if (result.type === 'success') {
          // Salva a API Key e a URL do OpenRouter nas configurações
          saveOpenRouterConfig({
            apiKey: result.apiKey,
            baseUrl: result.baseUrl,
          })

          context.onChangeAPIKey()
          
          context.setAppState(prev => ({
            ...prev,
            authVersion: prev.authVersion + 1,
          }))

          onDone('Configuração do OpenRouter salva com sucesso!')
        }
      }}
    />
  )
}

export function Login(props: {
  existingApiKey?: string
  existingBaseUrl?: string
  onDone: (result: LoginCompletion) => void
}): React.ReactNode {
  const [apiKey] = useState(props.existingApiKey || '')
  const [baseUrl] = useState(props.existingBaseUrl || 'https://openrouter.ai/api/v1')
  const [step] = useState<'apikey' | 'baseurl'>('apikey')

  return (
    <Dialog
      title="OpenRouter Configuration"
      onCancel={() => props.onDone({ type: 'cancel' })}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="cancel"
          />
        )
      }
    >
      <Box flexDirection="column" padding={1}>
        <Text dimColor>
          {step === 'apikey'
            ? 'Insira sua API Key do OpenRouter:'
            : 'Insira a Base URL do OpenRouter (padrão: https://openrouter.ai/api/v1):'}
        </Text>
        <Text color="cyan">
          {step === 'apikey' ? (apiKey ? '••••••••••••••••' : '(vazio)') : baseUrl}
        </Text>
      </Box>
    </Dialog>
  )
}