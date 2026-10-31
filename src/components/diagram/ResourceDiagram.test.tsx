import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../../ink.js'
import { AppStateProvider } from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { buildDiagramRows, type DiagramGroup, type DiagramItem, ResourceDiagram } from './ResourceDiagram.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'
const DOWN = '\x1B[B'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }

  return lastFrame ?? output
}

function createTestStreams() {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: () => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  ;(stdout as unknown as { rows: number }).rows = 40
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return { stdout, stdin, getOutput: () => output }
}

async function waitForOutput(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 2500) {
    const frame = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }

  throw new Error(`Timed out waiting for diagram output:\n${stripAnsi(extractLastFrame(getOutput()))}`)
}

const item = (name: string, editable = true): DiagramItem => ({
  key: name,
  name,
  description: `Use ${name}`,
  path: editable ? `/tmp/${name}.md` : undefined,
  editable,
})

const GROUPS: DiagramGroup[] = [
  { key: 'user', title: 'User', items: [item('alpha'), item('beta')] },
  { key: 'project', title: 'Project', items: [] },
  { key: 'builtin', title: 'Built-in', items: [item('core', false)] },
]

beforeEach(async () => {
  await acquireSharedMutationLock('components/diagram/ResourceDiagram.test.tsx')
})

afterEach(() => {
  releaseSharedMutationLock()
})

async function renderDiagram(overrides: Partial<React.ComponentProps<typeof ResourceDiagram>> = {}) {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(
    <AppStateProvider>
    <ResourceDiagram
      title="Skills"
      noun="skill"
      groups={GROUPS}
      locations={[{ value: 'userSettings', label: 'User' }]}
      validateName={name => (/^[a-z-]+$/.test(name) ? null : 'bad name')}
      onCreate={async () => '/tmp/new.md'}
      onDelete={async () => {}}
      onReload={async () => {}}
      onExit={() => {}}
      openInEditor={() => true}
      {...overrides}
    />
    </AppStateProvider>,
  )
  const cleanup = () => {
    root.unmount()
    stdin.end()
    stdout.end()
  }
  return { stdin, getOutput, cleanup }
}

test('builds one row per group, item and empty group', () => {
  const rows = buildDiagramRows(GROUPS)
  expect(rows.map(r => r.kind)).toEqual(['group', 'item', 'item', 'group', 'empty', 'group', 'item'])
})

test('draws the groups and items as a tree', async () => {
  const { getOutput, cleanup } = await renderDiagram()
  try {
    const frame = await waitForOutput(getOutput, f => f.includes('core'))
    expect(frame).toContain('◆ Skills')
    expect(frame).toContain('├─┬ User')
    expect(frame).toContain('▸ alpha')
    expect(frame).toContain('└── (empty)')
    expect(frame).toContain('└─┬ Built-in')
    expect(frame).toContain('core 🔒')
    expect(frame).toContain('3 skills')
  } finally {
    cleanup()
  }
})

test('deletes the selected item after confirmation', async () => {
  const deleted: string[] = []
  const { stdin, getOutput, cleanup } = await renderDiagram({
    onDelete: async target => {
      deleted.push(target.name)
    },
  })
  try {
    await waitForOutput(getOutput, f => f.includes('▸ alpha'))
    stdin.write(DOWN)
    await waitForOutput(getOutput, f => f.includes('▸ beta'))
    stdin.write('d')
    await waitForOutput(getOutput, f => f.includes('Delete skill beta'))
    stdin.write('y')
    await waitForOutput(getOutput, f => f.includes('Deleted beta'))
    expect(deleted).toEqual(['beta'])
  } finally {
    cleanup()
  }
})

test('does not delete read-only items', async () => {
  const deleted: string[] = []
  const { stdin, getOutput, cleanup } = await renderDiagram({
    onDelete: async target => {
      deleted.push(target.name)
    },
  })
  try {
    await waitForOutput(getOutput, f => f.includes('▸ alpha'))
    stdin.write(DOWN)
    stdin.write(DOWN)
    await waitForOutput(getOutput, f => f.includes('▸ core'))
    stdin.write('d')
    await waitForOutput(getOutput, f => f.includes('core is read-only'))
    expect(deleted).toEqual([])
  } finally {
    cleanup()
  }
})

test('opens the selected item in the editor', async () => {
  const opened: string[] = []
  const { stdin, getOutput, cleanup } = await renderDiagram({
    openInEditor: path => {
      opened.push(path)
      return true
    },
  })
  try {
    await waitForOutput(getOutput, f => f.includes('▸ alpha'))
    stdin.write('e')
    await waitForOutput(getOutput, f => f.includes('Opened /tmp/alpha.md'))
    expect(opened).toEqual(['/tmp/alpha.md'])
  } finally {
    cleanup()
  }
})

test('creates an item from name and description, then opens it', async () => {
  const created: string[][] = []
  const opened: string[] = []
  const { stdin, getOutput, cleanup } = await renderDiagram({
    onCreate: async (location, name, description) => {
      created.push([location, name, description])
      return '/tmp/new.md'
    },
    openInEditor: path => {
      opened.push(path)
      return true
    },
  })
  try {
    await waitForOutput(getOutput, f => f.includes('▸ alpha'))
    stdin.write('c')
    await waitForOutput(getOutput, f => f.includes('Name of the new skill'))
    stdin.write('Bad Name')
    await Bun.sleep(30)
    stdin.write('\r')
    await waitForOutput(getOutput, f => f.includes('bad name'))
    for (let i = 0; i < 'Bad Name'.length; i++) stdin.write('\x7F')
    await Bun.sleep(30)
    stdin.write('my-skill')
    await Bun.sleep(30)
    stdin.write('\r')
    await waitForOutput(getOutput, f => f.includes('Description'))
    stdin.write('Reviews pull requests')
    await Bun.sleep(30)
    stdin.write('\r')
    await waitForOutput(getOutput, f => f.includes('Created /tmp/new.md'))
    expect(created).toEqual([['userSettings', 'my-skill', 'Reviews pull requests']])
    expect(opened).toEqual(['/tmp/new.md'])
  } finally {
    cleanup()
  }
})
