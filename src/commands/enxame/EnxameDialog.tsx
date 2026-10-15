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
  type EnxameMode,
  type EnxameTestResult,
  MAX_ENXAME_WORKERS,
  getEnxameAccount,
  removeEnxameAccount,
  saveEnxameAccount,
  setEnxameEnabled,
  setEnxameMode,
  setEnxameWorkers,
  testEnxameAccount,
} from '../../utils/enxameConfig.js'
import { maskSecretForDisplay, sanitizeApiKey } from '../../utils/providerSecrets.js'

export const ENXAME_MODE_LABELS: Record<EnxameMode, string> = {
  tool: 'Ferramenta',
  agent: 'Agente',
  both: 'Ambos',
}

const ENXAME_MODE_DESCRIPTIONS: Record<EnxameMode, string> = {
  tool: 'Prompts stateless em paralelo, retorno JSON curto (mais barato)',
  agent: 'Subagentes enxame-worker com ferramentas rodando no z.ai',
  both: 'O manager escolhe entre ferramenta e agentes',
}

type EnxameAction = 'toggle' | 'mode' | 'workers' | 'test' | 'replace' | 'remove'

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
  onSelect: (value: EnxameAction) => void
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
          {account.enabled ? '● Enabled' : '○ Disabled'} · mode: {ENXAME_MODE_LABELS[account.mode]} ·
          workers: {account.workers}
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
            {
              label: `Mode: ${ENXAME_MODE_LABELS[account.mode]}`,
              value: 'mode',
              description: 'Ferramenta / Agente / Ambos',
            },
            {
              label: `Workers: ${account.workers}`,
              value: 'workers',
              description: `Parallel z.ai instances (1-${MAX_ENXAME_WORKERS})`,
            },
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

function ModePicker({
  current,
  onPick,
  onCancel,
}: {
  current: EnxameMode
  onPick: (mode: EnxameMode) => void
  onCancel: () => void
}): React.ReactNode {
  return (
    <Dialog title="Enxame mode" onCancel={onCancel}>
      <Select
        defaultValue={current}
        options={(['tool', 'agent', 'both'] as const).map(mode => ({
          label: ENXAME_MODE_LABELS[mode],
          value: mode,
          description: ENXAME_MODE_DESCRIPTIONS[mode],
        }))}
        onChange={onPick}
        onCancel={onCancel}
      />
    </Dialog>
  )
}

/** Parses a typed worker count; undefined unless it is a whole number in range. */
export function parseWorkersInput(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const n = Number(trimmed)
  return n >= 1 && n <= MAX_ENXAME_WORKERS ? n : undefined
}

function WorkersForm({
  current,
  onSave,
  onCancel,
}: {
  current: number
  onSave: (workers: number) => void
  onCancel: () => void
}): React.ReactNode {
  const [value, setValue] = React.useState(String(current))
  const [cursorOffset, setCursorOffset] = React.useState(String(current).length)
  const [error, setError] = React.useState<string | undefined>()

  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  const submit = (raw: string): void => {
    const workers = parseWorkersInput(raw)
    if (workers === undefined) setError(`Use um número de 1 a ${MAX_ENXAME_WORKERS}`)
    else onSave(workers)
  }

  return (
    <Dialog title="Enxame workers" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Number of z.ai workers (1-{MAX_ENXAME_WORKERS})</Text>
        <Box flexDirection="row" gap={1}>
          <Text>›</Text>
          <TextInput
            value={value}
            onChange={setValue}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            columns={10}
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
  const [screen, setScreen] = React.useState<'menu' | 'mode' | 'workers'>('menu')
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

  if (screen === 'mode') {
    return (
      <ModePicker
        current={account.mode}
        onCancel={() => setScreen('menu')}
        onPick={mode => {
          setEnxameMode(mode)
          setAccount(getEnxameAccount())
          setScreen('menu')
        }}
      />
    )
  }

  if (screen === 'workers') {
    return (
      <WorkersForm
        current={account.workers}
        onCancel={() => setScreen('menu')}
        onSave={workers => {
          setEnxameWorkers(workers)
          setAccount(getEnxameAccount())
          setScreen('menu')
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
        if (action === 'mode' || action === 'workers') {
          setScreen(action)
        } else if (action === 'toggle') {
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
