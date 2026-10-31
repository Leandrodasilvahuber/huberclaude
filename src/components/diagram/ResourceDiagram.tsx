import * as React from 'react'
import { useState } from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../../ink.js'
import { openFileInExternalEditor } from '../../utils/editor.js'
import { errorMessage } from '../../utils/errors.js'
import { plural } from '../../utils/stringUtils.js'
import { Select } from '../CustomSelect/select.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import TextInput from '../TextInput.js'

export type DiagramItem = {
  key: string
  name: string
  description: string
  /** File opened by "edit". Items without one cannot be edited. */
  path?: string
  /** Read-only items (built-in, plugin, MCP…) cannot be edited or deleted. */
  editable: boolean
  note?: string
}

export type DiagramGroup = {
  key: string
  title: string
  subtitle?: string
  items: DiagramItem[]
}

export type DiagramLocation = {
  value: string
  label: string
  description?: string
}

type Props = {
  title: string
  /** Singular noun used in messages ("skill", "agent"). */
  noun: string
  groups: DiagramGroup[]
  /** Where new items can be created. */
  locations: DiagramLocation[]
  validateName: (name: string) => string | null
  /** Creates the item and returns the file to open in the editor. */
  onCreate: (location: string, name: string, description: string) => Promise<string>
  onDelete: (item: DiagramItem) => Promise<void>
  onReload: () => Promise<void>
  onExit: (changes: string[]) => void
  /** Extra per-item action on a single key (e.g. "a" to activate an agent). */
  extraAction?: {
    input: string
    label: string
    run: (item: DiagramItem) => string
  }
  /** Opens a file for editing; returns false when no editor is available. */
  openInEditor?: (path: string) => boolean
}

type Mode =
  | { kind: 'browse' }
  | { kind: 'confirm-delete'; item: DiagramItem }
  | { kind: 'create-location' }
  | { kind: 'create-name'; location: string }
  | { kind: 'create-description'; location: string; name: string }

type Row =
  | { kind: 'group'; group: DiagramGroup; last: boolean }
  | { kind: 'item'; item: DiagramItem; lastGroup: boolean; last: boolean }
  | { kind: 'empty'; lastGroup: boolean }

// Rows besides the tree: title, subtitle, details, status and input guide.
const DIALOG_CHROME_ROWS = 14

export function buildDiagramRows(groups: DiagramGroup[]): Row[] {
  const rows: Row[] = []
  groups.forEach((group, gi) => {
    const lastGroup = gi === groups.length - 1
    rows.push({ kind: 'group', group, last: lastGroup })
    if (group.items.length === 0) {
      rows.push({ kind: 'empty', lastGroup })
    }
    group.items.forEach((item, ii) => {
      rows.push({ kind: 'item', item, lastGroup, last: ii === group.items.length - 1 })
    })
  })
  return rows
}

function truncate(text: string, width: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (width <= 1) return ''
  return oneLine.length > width ? `${oneLine.slice(0, width - 1)}…` : oneLine
}

export function ResourceDiagram({
  title,
  noun,
  groups,
  locations,
  validateName,
  onCreate,
  onDelete,
  onReload,
  onExit,
  openInEditor = openFileInExternalEditor,
  extraAction,
}: Props): React.ReactNode {
  const { columns, rows: terminalRows } = useTerminalSize()
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [selectedKey, setSelectedKey] = useState<string | undefined>()
  const [status, setStatus] = useState<{ text: string; error?: boolean } | undefined>()
  const [changes, setChanges] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)

  const rows = buildDiagramRows(groups)
  const items = rows.flatMap(row => (row.kind === 'item' ? [row.item] : []))
  const total = items.length
  const selectedIndex = Math.max(0, items.findIndex(item => item.key === selectedKey))
  const selected = items[selectedIndex]

  const record = (change: string) => setChanges(prev => [...prev, change])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      setStatus({ text: errorMessage(error), error: true })
    } finally {
      setBusy(false)
    }
  }

  const edit = (item: DiagramItem) => {
    if (!item.editable || !item.path) {
      setStatus({ text: `${item.name} is read-only`, error: true })
      return
    }
    if (!openInEditor(item.path)) {
      setStatus({ text: `No editor found ($VISUAL/$EDITOR). Edit it at ${item.path}`, error: true })
      return
    }
    record(`Edited ${noun}: ${item.name}`)
    setStatus({ text: `Opened ${item.path}` })
    void run(onReload)
  }

  const startText = (next: Mode) => {
    setText('')
    setCursorOffset(0)
    setStatus(undefined)
    setMode(next)
  }

  const startCreate = () => {
    if (locations.length === 1) {
      startText({ kind: 'create-name', location: locations[0]!.value })
    } else {
      setStatus(undefined)
      setMode({ kind: 'create-location' })
    }
  }

  const submitName = (value: string) => {
    if (mode.kind !== 'create-name') return
    const name = value.trim()
    const problem = validateName(name)
    if (problem) {
      setStatus({ text: problem, error: true })
      return
    }
    startText({ kind: 'create-description', location: mode.location, name })
  }

  const submitDescription = (value: string) => {
    if (mode.kind !== 'create-description') return
    const description = value.trim()
    if (!description) {
      setStatus({ text: 'Description cannot be empty', error: true })
      return
    }
    const { location, name } = mode
    setMode({ kind: 'browse' })
    void run(async () => {
      const path = await onCreate(location, name, description)
      record(`Created ${noun}: ${name}`)
      await onReload()
      setSelectedKey(undefined)
      const opened = openInEditor(path)
      setStatus({ text: opened ? `Created ${path}` : `Created ${path} (set $EDITOR to open it from here)` })
      if (opened) await onReload()
    })
  }

  const confirmDelete = (item: DiagramItem) => {
    setMode({ kind: 'browse' })
    void run(async () => {
      await onDelete(item)
      record(`Deleted ${noun}: ${item.name}`)
      setStatus({ text: `Deleted ${item.name}` })
      setSelectedKey(items[selectedIndex + 1]?.key ?? items[selectedIndex - 1]?.key)
      await onReload()
    })
  }

  useInput(
    (input, key) => {
      if (busy) return
      if (key.upArrow || key.downArrow) {
        if (total === 0) return
        const step = key.upArrow ? -1 : 1
        // Functional update: several arrow presses can arrive before a re-render.
        setSelectedKey(prev => {
          const current = Math.max(0, items.findIndex(i => i.key === prev))
          return items[(current + step + total) % total]!.key
        })
        setStatus(undefined)
        return
      }
      if (input === 'c') {
        startCreate()
        return
      }
      if (input === 'r') {
        void run(async () => {
          await onReload()
          setStatus({ text: 'Reloaded' })
        })
        return
      }
      if (!selected) return
      if (extraAction && input === extraAction.input) {
        const result = extraAction.run(selected)
        record(result)
        setStatus({ text: result })
        return
      }
      if (key.return || input === 'e') {
        edit(selected)
      } else if (input === 'd') {
        if (!selected.editable) {
          setStatus({ text: `${selected.name} is read-only`, error: true })
        } else {
          setStatus(undefined)
          setMode({ kind: 'confirm-delete', item: selected })
        }
      }
    },
    { isActive: mode.kind === 'browse' },
  )

  useInput(
    (input, key) => {
      if (mode.kind !== 'confirm-delete') return
      if (input === 'y' || input === 's') {
        confirmDelete(mode.item)
      } else if (input === 'n' || key.escape) {
        setMode({ kind: 'browse' })
      }
    },
    { isActive: mode.kind === 'confirm-delete' },
  )

  useInput(
    (_input, key, event) => {
      if (key.escape) {
        event.stopImmediatePropagation()
        setStatus(undefined)
        setMode({ kind: 'browse' })
      }
    },
    { isActive: mode.kind === 'create-name' || mode.kind === 'create-description' },
  )

  // Keep the selected row visible when the tree is taller than the terminal.
  const maxRows = Math.max(5, terminalRows - DIALOG_CHROME_ROWS)
  const selectedRow = rows.findIndex(row => row.kind === 'item' && row.item.key === selected?.key)
  let start = 0
  if (rows.length > maxRows) {
    start = Math.min(Math.max(0, selectedRow - Math.floor(maxRows / 2)), rows.length - maxRows)
  }
  const visibleRows = rows.slice(start, start + maxRows)

  const renderRow = (row: Row, index: number) => {
    if (row.kind === 'group') {
      const branch = row.last ? '└─┬ ' : '├─┬ '
      return (
        <Text key={`g-${row.group.key}`}>
          <Text dimColor>{branch}</Text>
          <Text bold>{row.group.title}</Text>
          <Text dimColor>
            {' '}
            ({row.group.items.length}){row.group.subtitle ? ` ${row.group.subtitle}` : ''}
          </Text>
        </Text>
      )
    }
    const trunk = row.lastGroup ? '  ' : '│ '
    if (row.kind === 'empty') {
      return (
        <Text key={`e-${index}`} dimColor>
          {trunk}└── (empty)
        </Text>
      )
    }
    const isSelected = row.item.key === selected?.key
    const branch = row.last ? '└── ' : '├── '
    const prefix = `${trunk}${branch}${isSelected ? '▸ ' : '  '}`
    const lock = row.item.editable ? '' : ' 🔒'
    const nameWidth = row.item.name.length + lock.length
    const descWidth = columns - prefix.length - nameWidth - 10
    return (
      <Text key={`i-${row.item.key}`}>
        <Text dimColor>{prefix}</Text>
        <Text bold={isSelected} color={isSelected ? 'suggestion' : undefined}>
          {row.item.name}
        </Text>
        <Text dimColor>{lock}</Text>
        {descWidth > 10 && <Text dimColor> · {truncate(row.item.description, descWidth)}</Text>}
      </Text>
    )
  }

  const subtitle = `${total} ${plural(total, noun)}`
  const isTextMode = mode.kind === 'create-name' || mode.kind === 'create-description'

  const inputGuide = () => {
    if (mode.kind === 'confirm-delete') {
      return (
        <Byline>
          <KeyboardShortcutHint shortcut="y" action="delete" />
          <KeyboardShortcutHint shortcut="n/Esc" action="keep" />
        </Byline>
      )
    }
    if (isTextMode) {
      return (
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="next" />
          <KeyboardShortcutHint shortcut="Esc" action="back" />
        </Byline>
      )
    }
    if (mode.kind === 'create-location') {
      return (
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="select" />
          <KeyboardShortcutHint shortcut="Esc" action="back" />
        </Byline>
      )
    }
    return (
      <Byline>
        <KeyboardShortcutHint shortcut="↑/↓" action="navigate" />
        <KeyboardShortcutHint shortcut="Enter/e" action="edit" />
        <KeyboardShortcutHint shortcut="c" action="create" />
        <KeyboardShortcutHint shortcut="d" action="delete" />
        {extraAction && <KeyboardShortcutHint shortcut={extraAction.input} action={extraAction.label} />}
        <KeyboardShortcutHint shortcut="r" action="reload" />
        <KeyboardShortcutHint shortcut="Esc" action="close" />
      </Byline>
    )
  }

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onCancel={() => onExit(changes)}
      inputGuide={inputGuide}
      isCancelActive={mode.kind === 'browse' && !busy}
    >
      <Box flexDirection="column">
        <Text bold color="suggestion">
          ◆ {title}
        </Text>
        {start > 0 && <Text dimColor>  ↑ {start} more</Text>}
        {visibleRows.map((row, i) => renderRow(row, start + i))}
        {start + maxRows < rows.length && <Text dimColor>  ↓ {rows.length - start - maxRows} more</Text>}
      </Box>

      {mode.kind === 'browse' && selected && (
        <Box flexDirection="column">
          <Text>
            <Text bold>{selected.name}</Text>
            {selected.note && <Text dimColor> · {selected.note}</Text>}
          </Text>
          <Text dimColor wrap="truncate-end">
            {truncate(selected.description, columns * 2 - 8)}
          </Text>
          {selected.path && <Text dimColor wrap="truncate-start">{selected.path}</Text>}
        </Box>
      )}

      {mode.kind === 'confirm-delete' && (
        <Text color="error">
          Delete {noun} <Text bold>{mode.item.name}</Text>
          {mode.item.path ? ` (${mode.item.path})` : ''}? This cannot be undone.
        </Text>
      )}

      {mode.kind === 'create-location' && (
        <Box flexDirection="column">
          <Text>Where should the new {noun} live?</Text>
          <Select
            options={locations.map(location => ({
              label: location.label,
              value: location.value,
              description: location.description,
            }))}
            onChange={value => startText({ kind: 'create-name', location: value })}
            onCancel={() => setMode({ kind: 'browse' })}
          />
        </Box>
      )}

      {isTextMode && (
        <Box flexDirection="column">
          <Text>
            {mode.kind === 'create-name'
              ? `Name of the new ${noun} (lowercase letters, numbers and hyphens):`
              : `Description: when should it be used?`}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Text>&gt;</Text>
            <TextInput
              value={text}
              onChange={setText}
              onSubmit={mode.kind === 'create-name' ? submitName : submitDescription}
              onExit={() => setMode({ kind: 'browse' })}
              disableEscapeDoublePress
              focus
              showCursor
              columns={columns - 6}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
          </Box>
        </Box>
      )}

      {busy && <Text dimColor>Working…</Text>}
      {status && !busy && <Text color={status.error ? 'error' : 'success'}>{status.text}</Text>}
    </Dialog>
  )
}
