import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text, Box } from '../../ink.js'

type LoginCompletion =
  | { type: 'success'; apiKey: string; baseUrl: string }
  | { type: 'cancel' }
  | string

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  return (
    <Login
      onDone={async result => {
        if (result.type === 'cancel') {
          onDone('Configuração cancelada')
          return
        }

        if (result.type === 'success') {
          onDone('Configuração salva com sucesso!')
        }
      }}
    />
  )
}

export function Login(props: {
  onDone: (result: LoginCompletion) => void
}): React.ReactNode {
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
          {step === 'apikey' ? '(vazio)' : 'https://openrouter.ai/api/v1'}
        </Text>
      </Box>
    </Dialog>
  )
}