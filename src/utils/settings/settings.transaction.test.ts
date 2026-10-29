import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { expect, test } from 'bun:test'
import {
  getFsImplementation,
  setFsImplementation,
} from '../fsOperations.js'

const fixturePath = resolve(
  import.meta.dir,
  '../../test/fixtures/settingsTransactionWriter.fixture.ts',
)
const CHILD_TIMEOUT_MS = 20_000
const TEST_TIMEOUT_MS = CHILD_TIMEOUT_MS + 10_000

type CapturedChild = {
  process: ChildProcessByStdio<null, Readable, Readable>
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  output: () => { stdout: string; stderr: string }
}

function startWriter(args: string[]): CapturedChild {
  const child = spawn(process.execPath, [fixturePath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  return {
    process: child,
    exited: new Promise(resolveExit => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    }),
    output: () => ({ stdout, stderr }),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

async function waitForMarker(
  marker: string,
  child: CapturedChild,
  label: string,
): Promise<void> {
  const deadline = performance.now() + CHILD_TIMEOUT_MS
  while (!existsSync(marker)) {
    if (
      child.process.exitCode !== null ||
      child.process.signalCode !== null
    ) {
      const { stdout, stderr } = child.output()
      throw new Error(
        `${label} exited before creating its marker\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      )
    }
    if (performance.now() >= deadline) {
      const { stdout, stderr } = child.output()
      throw new Error(
        `${label} timed out before creating its marker\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      )
    }
    await delay(10)
  }
}

async function finishWriter(
  child: CapturedChild,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  const outcome = await Promise.race([
    child.exited,
    delay(CHILD_TIMEOUT_MS).then(() => {
      throw new Error(`${label} did not exit within ${CHILD_TIMEOUT_MS}ms`)
    }),
  ])
  const { stdout, stderr } = child.output()
  if (outcome.code !== 0) {
    throw new Error(
      `${label} exited with code ${outcome.code ?? 'null'} and signal ${outcome.signal ?? 'none'}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }
  const lastLine = stdout.trim().split(/\r?\n/).at(-1)
  if (!lastLine) {
    throw new Error(`${label} emitted no JSON\nstderr:\n${stderr}`)
  }
  try {
    return JSON.parse(lastLine) as { ok: boolean; error?: string }
  } catch (error) {
    throw new Error(
      `${label} emitted invalid JSON: ${error}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }
}

async function terminateChild(child: CapturedChild): Promise<void> {
  if (
    child.process.exitCode !== null ||
    child.process.signalCode !== null
  ) {
    return
  }
  child.process.kill('SIGTERM')
  await Promise.race([child.exited, delay(500)])
  if (
    child.process.exitCode === null &&
    child.process.signalCode === null
  ) {
    child.process.kill('SIGKILL')
    await child.exited
  }
}

test('does not retry unrelated filesystem errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-fs-error-'))
  const nonDirectory = join(root, 'not-a-directory')
  writeFileSync(nonDirectory, '')
  try {
    const { withSettingsFileTransactionSync } = await import(
      './settingsFileTransaction.js'
    )
    const startedAt = performance.now()
    expect(() =>
      withSettingsFileTransactionSync(
        join(nonDirectory, 'settings.json'),
        () => undefined,
      ),
    ).toThrow()
    expect(performance.now() - startedAt).toBeLessThan(500)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test.each([
  [
    'an invalid hold-lock argument count',
    (root: string, entered: string, completed: string) => [
      'hold-lock',
      root,
      'unused',
      'unused',
      entered,
      completed,
    ],
    'Invalid argument count for hold-lock',
  ],
  [
    'a missing hold-lock release marker',
    (root: string, entered: string, completed: string) => [
      'hold-lock',
      root,
      'unused',
      'unused',
      entered,
      completed,
      'unused',
      '',
    ],
    'Hold-lock fixture requires a release marker',
  ],
  [
    'a missing pause-after-read marker',
    (root: string, entered: string, completed: string) => [
      'pause-after-read',
      root,
      'unused',
      'unused',
      entered,
      completed,
      '',
      'unused',
    ],
    'Pause-after-read fixture requires read and release markers',
  ],
] as const)(
  'fixture rejects %s before acquiring',
  async (_label, buildArgs, expectedError) => {
    const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-fixture-args-'))
    const entered = join(root, 'entered')
    const completed = join(root, 'completed')
    const child = startWriter(buildArgs(root, entered, completed))
    try {
      const outcome = await child.exited
      const { stderr } = child.output()
      expect(outcome.code).not.toBe(0)
      expect(stderr).toContain(expectedError)
      expect(existsSync(entered)).toBe(false)
      expect(existsSync(join(root, 'settings.json.lock'))).toBe(false)
    } finally {
      await terminateChild(child)
      rmSync(root, { recursive: true, force: true })
    }
  },
  TEST_TIMEOUT_MS,
)

test('keeps an operation error primary when lock release also fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-release-error-'))
  const settingsPath = join(root, 'settings.json')
  const originalFs = getFsImplementation()
  let releaseOwnerRead = false
  try {
    const { withSettingsFileTransactionSync } = await import(
      './settingsFileTransaction.js'
    )
    expect(() =>
      withSettingsFileTransactionSync(settingsPath, targetPath => {
        const lockPath = `${targetPath}.lock`
        rmSync(lockPath, { recursive: true, force: true })
        mkdirSync(lockPath)
        const ownerPath = join(lockPath, 'owner.json')
        setFsImplementation({
          ...originalFs,
          readFileSync(path, options) {
            if (resolve(path) === resolve(ownerPath)) releaseOwnerRead = true
            return originalFs.readFileSync(path, options)
          },
        })
        throw new Error('primary operation failure')
      }),
    ).toThrow('primary operation failure')
    expect(releaseOwnerRead).toBe(true)
  } finally {
    setFsImplementation(originalFs)
    rmSync(root, { recursive: true, force: true })
  }
})

test('propagates a release error after the operation succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-release-error-'))
  const settingsPath = join(root, 'settings.json')
  try {
    const { withSettingsFileTransactionSync } = await import(
      './settingsFileTransaction.js'
    )
    expect(() =>
      withSettingsFileTransactionSync(settingsPath, targetPath => {
        const lockPath = `${targetPath}.lock`
        rmSync(lockPath, { recursive: true, force: true })
        mkdirSync(lockPath)
        return 'operation result'
      }),
    ).toThrow('Settings file lock ownership changed before release')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test(
  'persists process incarnation identity for real lock owners',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-owner-id-'))
    const settingsPath = join(root, 'settings.json')
    const holderEntered = join(root, 'holder-entered')
    const holderCompleted = join(root, 'holder-completed')
    const releaseHolder = join(root, 'release-holder')
    const children: CapturedChild[] = []
    try {
      writeFileSync(settingsPath, '{}\n')
      const holder = startWriter([
        'hold-lock',
        root,
        'unused',
        'unused',
        holderEntered,
        holderCompleted,
        'unused',
        releaseHolder,
      ])
      children.push(holder)
      await waitForMarker(holderEntered, holder, 'holder')

      const owner = JSON.parse(
        readFileSync(join(`${settingsPath}.lock`, 'owner.json'), 'utf8'),
      ) as Record<string, unknown>
      expect(owner.version).toBe(2)
      expect(owner.pid).toBe(holder.process.pid)
      expect(owner.processStartId).toBeString()
      expect(owner.processStartId).toMatch(/^(linux|posix|windows):/)

      writeFileSync(releaseHolder, '')
      expect(await finishWriter(holder, 'holder')).toEqual({ ok: true })
    } finally {
      await Promise.all(children.map(terminateChild))
      rmSync(root, { recursive: true, force: true })
    }
  },
  TEST_TIMEOUT_MS,
)
