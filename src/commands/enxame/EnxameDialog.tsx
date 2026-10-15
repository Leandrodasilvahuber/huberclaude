import * as React from 'react'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import TextInput from '../../components/TextInput.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../../ink.js'
import {
  DEFAULT_ZAI_FALLBACK_MODEL,
  DEFAULT_ZAI_MODEL,
  type EnxameAccount,
  type EnxameTestResult,
  getEnxameAccount,
  removeEnxameAccount,
  saveEnxameAccount,
  setEnxameEnabled,
  testEnxameAccount,
} from '../../utils/enxameConfig.js'
import { maskSecretForDisplay, sanitizeApiKey } from '../../utils/providerSecrets.js'

/** Pure view of the registered account, exported for tests. */
export function EnxameBody({
  account,
  testResult,
  testing,
  onSelect,
  onCancel,
}: {
  account: EnxameAccount
  testResult: EnxameTestResult | undefined
  testing: boolean
  onSelect: (value: 'toggle' | 'test' | 'replace' | 'remove') => void
  onCancel: () => void
}): React.ReactNode {
  return (
    <Dialog
      title="Enxame"
      subtitle={`${maskSecretForDisplay(account.apiKey) ?? 'no key'} · ${account.model}${
        account.fallbackModel ? ` → ${account.fallbackModel}` : ''
      }`}
      onCancel={onCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Text color={account.enabled ? 'success' : 'warning'}>
          {account.enabled ? '● Enabled' : '○ Disabled'}
        </Text>
        <Text dimColor>{account.baseUrl}</Text>
        {testing ? <Text dimColor>Testing…</Text> : null}
        {testResult ? (
          <Text color={testResult.ok ? 'success' : 'error'}>
            {testResult.ok ? '✓' : '✗'} {testResult.message}
          </Text>
        ) : null}
        <Select
          options={[
            { label: account.enabled ? 'Disable swarm' : 'Enable swarm', value: 'toggle' },
            { label: 'Test connection', value: 'test' },
            { label: 'Replace account', value: 'replace' },
            { label: 'Remove account', value: 'remove' },
          ]}
          onChange={onSelect}
          onCancel={onCancel}
        />
      </Box>
    </Dialog>
  )
}

function KeyForm({
  onSave,
  onCancel,
}: {
  onSave: (apiKey: string) => void
  onCancel: () => void
}): React.ReactNode {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const [error, setError] = React.useState<string | undefined>()
  const { columns } = useTerminalSize()

  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  const submit = (raw: string): void => {
    const apiKey = sanitizeApiKey(raw)
    if (apiKey) onSave(apiKey)
    else setError('z.ai API key is required')
  }

  return (
    <Dialog title="z.ai account" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text bold>z.ai API key</Text>
        <Text dimColor>
          Hidden as you type. Models: {DEFAULT_ZAI_MODEL}, falling back to {DEFAULT_ZAI_FALLBACK_MODEL}.
        </Text>
        <Box flexDirection="row" gap={1}>
          <Text>›</Text>
          <TextInput
            value={value}
            onChange={setValue}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            columns={Math.max(20, columns - 8)}
            mask="*"
            onSubmit={submit}
          />
        </Box>
        {error ? <Text color="error">{error}</Text> : null}
        <Text dimColor>enter to save · esc to cancel</Text>
      </Box>
    </Dialog>
  )
}

export function EnxameDialog({ onClose }: { onClose: () => void }): React.ReactNode {
  const [account, setAccount] = React.useState<EnxameAccount | undefined>(() =>
    getEnxameAccount(),
  )
  const [editing, setEditing] = React.useState(() => !getEnxameAccount())
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<EnxameTestResult | undefined>()

  if (editing || !account) {
    return (
      <KeyForm
        onCancel={account ? () => setEditing(false) : onClose}
        onSave={apiKey => {
          saveEnxameAccount(apiKey)
          setAccount(getEnxameAccount())
          setTestResult(undefined)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <EnxameBody
      account={account}
      testResult={testResult}
      testing={testing}
      onCancel={onClose}
      onSelect={action => {
        if (testing) return
        if (action === 'toggle') {
          setEnxameEnabled(!account.enabled)
          setAccount(getEnxameAccount())
        } else if (action === 'replace') {
          setEditing(true)
        } else if (action === 'remove') {
          removeEnxameAccount()
          setAccount(undefined)
          setTestResult(undefined)
        } else {
          setTesting(true)
          setTestResult(undefined)
          void testEnxameAccount(account).then(result => {
            setTestResult(result)
            setTesting(false)
          })
        }
      }}
    />
  )
}
