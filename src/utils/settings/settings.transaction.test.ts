import { spawn, type ChildProcessByStdio } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { expect, spyOn, test } from 'bun:test'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import {
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../envUtils.js'
import {
  getFsImplementation,
  setFsImplementation,
} from '../fsOperations.js'
import * as gitignore from '../git/gitignore.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from './settings.js'
import {
  clearInternalWrites,
  consumeInternalWrite,
} from './internalWrites.js'
import { resetSettingsCache } from './settingsCache.js'
import type { SettingsJson } from './types.js'

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

async function markerAppearsWithin(
  marker: string,
  child: CapturedChild,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  while (!existsSync(marker)) {
    if (
      child.process.exitCode !== null ||
      child.process.signalCode !== null ||
      performance.now() >= deadline
    ) {
      return existsSync(marker)
    }
    await delay(10)
  }
  return true
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

async function runConcurrentWriters(
  markerRoot: string,
  configDirA: string,
  configDirB: string,
  settingsPath: string,
): Promise<{
  resultA: { ok: boolean; error?: string }
  resultB: { ok: boolean; error?: string }
  finalSettings: { env?: Record<string, string> }
}> {
  const writerAEntered = join(markerRoot, 'writer-a-entered')
  const writerACompleted = join(markerRoot, 'writer-a-completed')
  const writerARead = join(markerRoot, 'writer-a-read')
  const releaseWriterA = join(markerRoot, 'release-writer-a')
  const writerBEntered = join(markerRoot, 'writer-b-entered')
  const writerBCompleted = join(markerRoot, 'writer-b-completed')
  const children: CapturedChild[] = []

  try {
    const writerA = startWriter([
      'pause-after-read',
      configDirA,
      'WRITER_A',
      'a',
      writerAEntered,
      writerACompleted,
      writerARead,
      releaseWriterA,
    ])
    children.push(writerA)
    await waitForMarker(writerARead, writerA, 'writer A')

    const writerB = startWriter([
      'normal',
      configDirB,
      'WRITER_B',
      'b',
      writerBEntered,
      writerBCompleted,
    ])
    children.push(writerB)
    await waitForMarker(writerBEntered, writerB, 'writer B')

    // On unfixed main, B completes against the same old document. With the
    // transaction lock, B remains pending behind A. Either observation is
    // enough to release A without building a barrier that deadlocks the fix.
    await markerAppearsWithin(writerBCompleted, writerB, 500)
    writeFileSync(releaseWriterA, '')

    const [resultA, resultB] = await Promise.all([
      finishWriter(writerA, 'writer A'),
      finishWriter(writerB, 'writer B'),
    ])
    return {
      resultA,
      resultB,
      finalSettings: JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        env?: Record<string, string>
      },
    }
  } finally {
    await Promise.all(children.map(terminateChild))
  }
}

async function withIsolatedUserSettings(
  run: (root: string, settingsPath: string) => void | Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-unit-'))
  const previousOverride = getClaudeConfigHomeDirOverrideForTesting()
  setClaudeConfigHomeDirForTesting(root)
  resetSettingsCache()
  try {
    await run(root, join(root, 'settings.json'))
  } finally {
    setClaudeConfigHomeDirForTesting(previousOverride)
    resetSettingsCache()
    rmSync(root, { recursive: true, force: true })
  }
}

test('reads the merge base from disk after ownership, not from warm caches', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ env: { CACHED: 'yes' } }, null, 2)}\n`,
    )
    expect(getSettingsForSource('userSettings')?.env).toEqual({
      CACHED: 'yes',
    })

    writeFileSync(
      settingsPath,
      `${JSON.stringify({ env: { CACHED: 'yes', EXTERNAL: 'yes' } }, null, 2)}\n`,
    )
    expect(
      updateSettingsForSource('userSettings', {
        env: { LOCAL: 'yes' },
      }),
    ).toEqual({ error: null })

    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env).toEqual({
      CACHED: 'yes',
      EXTERNAL: 'yes',
      LOCAL: 'yes',
    })
  })
})

test('creates a missing settings file without weakening the synchronous result', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    expect(existsSync(settingsPath)).toBe(false)
    expect(
      updateSettingsForSource('userSettings', { env: { CREATED: 'yes' } }),
    ).toEqual({ error: null })
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env).toEqual({
      CREATED: 'yes',
    })
    expect(existsSync(`${settingsPath}.lock`)).toBe(false)
  })
})

test('preserves deletion, array replacement, and ordinary success semantics', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          env: { KEEP: 'yes', REMOVE: 'yes' },
          permissions: { allow: ['Bash(one)'] },
        },
        null,
        2,
      )}\n`,
    )
    const patch = {
      env: { REMOVE: undefined },
      permissions: { allow: ['Bash(two)'] },
    } as unknown as SettingsJson
    expect(updateSettingsForSource('userSettings', patch)).toEqual({
      error: null,
    })

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toMatchObject({
      env: { KEEP: 'yes' },
      permissions: { allow: ['Bash(two)'] },
    })
  })
})

test('a malformed document is untouched and does not strand the lock', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    const malformed = '{"env":'
    writeFileSync(settingsPath, malformed)
    const failed = updateSettingsForSource('userSettings', {
      env: { FIRST: 'no' },
    })
    expect(failed.error?.message).toBe(
      `Invalid JSON syntax in settings file at ${settingsPath}`,
    )
    expect(readFileSync(settingsPath, 'utf8')).toBe(malformed)
    expect(existsSync(`${settingsPath}.lock`)).toBe(false)

    writeFileSync(settingsPath, '{}\n')
    expect(
      updateSettingsForSource('userSettings', { env: { SECOND: 'yes' } }),
    ).toEqual({ error: null })
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env).toEqual({
      SECOND: 'yes',
    })
  })
})

test('an array document is rejected without dropping the requested update', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    const invalidSettings = '[]\n'
    writeFileSync(settingsPath, invalidSettings)

    const result = updateSettingsForSource('userSettings', {
      env: { NEVER_WRITTEN: 'yes' },
    })

    expect(result.error?.message).toBe(
      `Invalid settings document at ${settingsPath}: expected a JSON object`,
    )
    expect(readFileSync(settingsPath, 'utf8')).toBe(invalidSettings)
    expect(existsSync(`${settingsPath}.lock`)).toBe(false)
  })
})

test('JSON null is reported as an invalid settings document', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    const invalidSettings = 'null\n'
    writeFileSync(settingsPath, invalidSettings)

    const result = updateSettingsForSource('userSettings', {
      env: { NEVER_WRITTEN: 'yes' },
    })

    expect(result.error?.message).toBe(
      `Invalid settings document at ${settingsPath}: expected a JSON object`,
    )
    expect(readFileSync(settingsPath, 'utf8')).toBe(invalidSettings)
    expect(existsSync(`${settingsPath}.lock`)).toBe(false)
  })
})

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

test('does not require hard-link support from the settings filesystem', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    const originalFs = getFsImplementation()
    setFsImplementation({
      ...originalFs,
      linkSync() {
        throw Object.assign(new Error('Hard links are unavailable'), {
          code: 'ENOTSUP',
        })
      },
    })
    try {
      expect(
        updateSettingsForSource('userSettings', {
          env: { NO_HARD_LINK: 'yes' },
        }),
      ).toEqual({ error: null })
      expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env).toEqual({
        NO_HARD_LINK: 'yes',
      })
    } finally {
      setFsImplementation(originalFs)
    }
  })
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

test('reports transaction failures with operation-neutral context', async () => {
  await withIsolatedUserSettings((_root, settingsPath) => {
    mkdirSync(settingsPath)
    const result = updateSettingsForSource('userSettings', {
      env: { NEVER_WRITTEN: 'yes' },
    })
    expect(result.error?.message).toContain(
      `Failed to update settings at ${settingsPath}:`,
    )
    expect(existsSync(`${settingsPath}.lock`)).toBe(false)
  })
})

test(
  'retries when the owner releases after a pending publish loses its race',
  async () => {
    await withIsolatedUserSettings(async (root, settingsPath) => {
      const holderEntered = join(root, 'holder-entered')
      const holderCompleted = join(root, 'holder-completed')
      const releaseHolder = join(root, 'release-holder')
      const originalFs = getFsImplementation()
      const children: CapturedChild[] = []
      let removedContendedLock = false
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

        setFsImplementation({
          ...originalFs,
          lstatSync(path) {
            if (
              !removedContendedLock &&
              resolve(path) === resolve(`${settingsPath}.lock`)
            ) {
              removedContendedLock = true
              holder.process.kill('SIGKILL')
              rmSync(`${settingsPath}.lock`, {
                recursive: true,
                force: true,
              })
            }
            return originalFs.lstatSync(path)
          },
        })

        expect(
          updateSettingsForSource('userSettings', {
            env: { RETRIED_AFTER_RELEASE: 'yes' },
          }),
        ).toEqual({ error: null })
        expect(removedContendedLock).toBe(true)
        expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env).toEqual({
          RETRIED_AFTER_RELEASE: 'yes',
        })
        expect(existsSync(`${settingsPath}.lock`)).toBe(false)
      } finally {
        setFsImplementation(originalFs)
        await Promise.all(children.map(terminateChild))
      }
    })
  },
  TEST_TIMEOUT_MS,
)

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

test(
  'recovers when a live process has reused the recorded owner PID',
  async () => {
    await withIsolatedUserSettings((_root, settingsPath) => {
      const lockPath = `${settingsPath}.lock`
      const staleToken = '00000000-0000-4000-8000-000000000001'
      mkdirSync(lockPath)
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          version: 2,
          host: hostname(),
          pid: process.pid,
          token: staleToken,
          processStartId: 'test:previous-process-instance',
        }),
      )

      expect(
        updateSettingsForSource('userSettings', {
          env: { RECOVERED_AFTER_PID_REUSE: 'yes' },
        }),
      ).toEqual({ error: null })
      expect(JSON.parse(readFileSync(settingsPath, 'utf8')).env).toEqual({
        RECOVERED_AFTER_PID_REUSE: 'yes',
      })
      expect(existsSync(lockPath)).toBe(false)
      expect(
        existsSync(`${lockPath}.recovered.${process.pid}.${staleToken}`),
      ).toBe(true)
    })
  },
  TEST_TIMEOUT_MS,
)

test(
  'keeps a live legacy owner record protected',
  async () => {
    await withIsolatedUserSettings((_root, settingsPath) => {
      const lockPath = `${settingsPath}.lock`
      mkdirSync(lockPath)
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({
          version: 1,
          host: hostname(),
          pid: process.pid,
          token: '00000000-0000-4000-8000-000000000002',
        }),
      )

      const result = updateSettingsForSource('userSettings', {
        env: { MUST_NOT_RECLAIM_LIVE_V1: 'no' },
      })
      expect(result.error?.message).toContain('Timed out after 2000ms')
      expect(existsSync(lockPath)).toBe(true)
      expect(existsSync(settingsPath)).toBe(false)
    })
  },
  TEST_TIMEOUT_MS,
)

test('marks the requested logical alias after publishing to its physical target', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-mark-'))
  const realConfig = join(root, 'real-config')
  const configAlias = join(root, 'config-alias')
  const logicalSettingsPath = join(configAlias, 'settings.json')
  const previousOverride = getClaudeConfigHomeDirOverrideForTesting()
  try {
    mkdirSync(realConfig)
    try {
      symlinkSync(
        realConfig,
        configAlias,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (
        process.platform === 'win32' &&
        (code === 'EPERM' || code === 'EACCES')
      ) {
        return
      }
      throw error
    }

    setClaudeConfigHomeDirForTesting(configAlias)
    resetSettingsCache()
    clearInternalWrites()
    expect(
      updateSettingsForSource('userSettings', { env: { MARKED: 'yes' } }),
    ).toEqual({ error: null })
    expect(consumeInternalWrite(logicalSettingsPath, 5_000)).toBe(true)
    expect(
      consumeInternalWrite(join(realConfig, 'settings.json'), 5_000),
    ).toBe(false)
  } finally {
    setClaudeConfigHomeDirForTesting(previousOverride)
    resetSettingsCache()
    clearInternalWrites()
    rmSync(root, { recursive: true, force: true })
  }
})

test('repository settings sources arrange their global gitignore rules', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-settings-gitignore-'))
  const project = join(root, 'project')
  const previousOriginalCwd = getOriginalCwd()
  const previousOverride = getClaudeConfigHomeDirOverrideForTesting()
  const addRule = spyOn(
    gitignore,
    'addFileGlobRuleToGitignore',
  ).mockResolvedValue(undefined)
  try {
    mkdirSync(project)
    setOriginalCwd(project)
    setClaudeConfigHomeDirForTesting(join(root, 'config'))
    resetSettingsCache()

    expect(
      updateSettingsForSource('localSettings', {
        env: { LOCAL: 'yes' },
      }),
    ).toEqual({ error: null })
    expect(
      updateSettingsForSource('projectSettings', {
        env: { PROJECT: 'yes' },
      }),
    ).toEqual({ error: null })
    expect(addRule).toHaveBeenCalledWith(
      '.openclaude/settings.local.json',
      project,
    )
    expect(addRule).toHaveBeenCalledWith(
      '.openclaude/settings.local.json.lock*',
      project,
    )
    expect(addRule).toHaveBeenCalledWith(
      '.openclaude/settings.json.lock*',
      project,
    )
  } finally {
    addRule.mockRestore()
    setOriginalCwd(previousOriginalCwd)
    setClaudeConfigHomeDirForTesting(previousOverride)
    resetSettingsCache()
    rmSync(root, { recursive: true, force: true })
  }
})
