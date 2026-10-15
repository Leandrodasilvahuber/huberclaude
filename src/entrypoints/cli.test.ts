/**
 * Regression tests for issue #402 — NODE_OPTIONS heap cap
 * Closes: Gitlawb/openclaude#402 — JavaScript heap OOM during large tasks
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from '@commander-js/extra-typings'
import { applyChildProcessHeapOptions } from './applyChildProcessHeapOptions.js'
import {
  BACKGROUND_SESSION_CLEANUP_WORKER_ENV,
  BACKGROUND_SESSION_ID_ENV,
  BACKGROUND_SESSION_LAUNCHER_PID_ENV,
} from '../cli/bgRouting.js'
import type { ProviderOverride } from '../services/api/agentRouting.js'
import {
  applyLoadedEnvFileValues,
  loadEnvFile,
} from '../utils/envFile.js'
import {
  applyModelFlagFromArgs,
  applyProviderFlagFromArgs,
  parseModelFlag,
  parseProviderFlag,
  reapplyRememberedProviderFlag,
} from '../utils/providerFlag.js'

type CliMain = typeof import('./cli.js')['main']

let runCliEntrypoint: CliMain

const mockProfileCheckpoint = mock((_checkpoint: string) => {})
const mockPsHandler = mock(async (_args: string[]) => {})
const mockLogsHandler = mock(async (_args: string[]) => {})
const mockAttachHandler = mock(async (_args: string[]) => {})
const mockKillHandler = mock(
  async (
    _args: string[],
    _options?: { retentionSettingsReady?: boolean },
  ) => {},
)
const mockHandleBgFlag = mock(async (_args: string[]) => {})
const mockPrepareBackgroundSessionFinalizer = mock(async () => 'installed')
const mockRunBackgroundSessionCleanupWorker = mock(async () => {})
const mockLoadEnvFile = mock((_filePath: string) => ({}))
const mockParseProviderEnvFileArgs = mock((_args: string[]) => ({ paths: [] }))
const mockReapplyRememberedEnvFileValues = mock(() => {})
const mockRememberLoadedEnvFileValues = mock(
  (_values: Record<string, string>) => {},
)
const mockEnableConfigs = mock(() => {})
const mockApplySafeConfigEnvironmentVariables = mock(() => {})
const mockApplyStartupEnvFromProfile = mock(
  async (_input: {
    processEnv: NodeJS.ProcessEnv
    modelOverride?: string
    onValidationError: (message: string) => void
  }): Promise<string | null> => null,
)
const mockGetProviderValidationError = mock(
  async (_env: NodeJS.ProcessEnv) => undefined,
)
const mockEagerLoadSettingsFromArgs = mock((_args: string[]) => ({ ok: true }))
const mockResetSettingsCache = mock(() => {})
const mockResolveOutOfProcessTeammateProviderFromCliArgs = mock(
  (_args: string[], _settings: unknown): ProviderOverride | undefined =>
    undefined,
)
const mockApplyAgentProviderOverrideToEnv = mock((_override: unknown) => {})
const mockGetInitialSettings = mock(() => ({}))
const mockRefreshGithubModelsTokenIfNeeded = mock(async () => {})
const mockHydrateGithubModelsTokenFromSecureStorage = mock(() => {})
const mockValidateProviderEnvForStartupOrExit = mock(async () => {})
const mockApplyModelFlagFromArgs = mock(
  (_args: string[]): ReturnType<typeof applyModelFlagFromArgs> => undefined,
)
const mockPrintStartupScreen = mock((_model: string | undefined) => {})
const mockStartCapturingEarlyInput = mock(() => {})
const mockCliMain = mock(async () => {})

const runtimeMocks = [
  mockProfileCheckpoint,
  mockPsHandler,
  mockLogsHandler,
  mockAttachHandler,
  mockKillHandler,
  mockHandleBgFlag,
  mockPrepareBackgroundSessionFinalizer,
  mockRunBackgroundSessionCleanupWorker,
  mockLoadEnvFile,
  mockParseProviderEnvFileArgs,
  mockReapplyRememberedEnvFileValues,
  mockRememberLoadedEnvFileValues,
  mockEnableConfigs,
  mockApplySafeConfigEnvironmentVariables,
  mockApplyStartupEnvFromProfile,
  mockGetProviderValidationError,
  mockEagerLoadSettingsFromArgs,
  mockResetSettingsCache,
  mockResolveOutOfProcessTeammateProviderFromCliArgs,
  mockApplyAgentProviderOverrideToEnv,
  mockGetInitialSettings,
  mockRefreshGithubModelsTokenIfNeeded,
  mockHydrateGithubModelsTokenFromSecureStorage,
  mockValidateProviderEnvForStartupOrExit,
  mockApplyModelFlagFromArgs,
  mockPrintStartupScreen,
  mockStartCapturingEarlyInput,
  mockCliMain,
]

function clearRuntimeMocks() {
  for (const fn of runtimeMocks) {
    fn.mockClear()
  }
}

describe('cli.tsx — NODE_OPTIONS --max-old-space-size (issue #402)', () => {
  const cliSource = readFileSync(new URL('./cli.tsx', import.meta.url), 'utf8')

  it('wires the child-process heap helper from the CLI entrypoint', () => {
    expect(cliSource).toContain(
      "import { applyChildProcessHeapOptions } from './applyChildProcessHeapOptions.js'",
    )
    expect(cliSource).toContain('applyChildProcessHeapOptions(process.env, process.execArgv)')
  })

  it('propagates a numeric process.execArgv heap cap to NODE_OPTIONS for subprocesses', () => {
    const env: NodeJS.ProcessEnv = {}
    applyChildProcessHeapOptions(env, ['--max-old-space-size=4096', '--expose-gc'])
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096')
  })

  it('does not append 8192 when process.execArgv already has a percentage heap flag', () => {
    const env: NodeJS.ProcessEnv = {}
    applyChildProcessHeapOptions(env, ['--max-old-space-size-percentage=50'])
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('sets --max-old-space-size=8192 when NODE_OPTIONS is not set', () => {
    const env: NodeJS.ProcessEnv = {}
    applyChildProcessHeapOptions(env)
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=8192')
  })

  it('does not override existing --max-old-space-size=4096', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: '--max-old-space-size=4096 --experimental-vm-modules',
    }
    applyChildProcessHeapOptions(env)
    expect(env.NODE_OPTIONS).toBe(
      '--max-old-space-size=4096 --experimental-vm-modules',
    )
  })

  it('does not override existing --max-old-space-size=8192', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: '--max-old-space-size=8192',
    }
    applyChildProcessHeapOptions(env)
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=8192')
  })

  it('appends --max-old-space-size when NODE_OPTIONS has other flags', () => {
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: '--inspect=9229' }
    applyChildProcessHeapOptions(env)
    expect(env.NODE_OPTIONS).toBe('--inspect=9229 --max-old-space-size=8192')
  })

  it('does not override existing --max-old-space-size-percentage=50', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: '--max-old-space-size-percentage=50',
    }
    applyChildProcessHeapOptions(env)
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size-percentage=50')
    expect(env.NODE_OPTIONS).not.toMatch(/--max-old-space-size=\d+/)
  })

  it('uses OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB when appending a heap cap', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: '--inspect=9229',
      OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB: '2048',
    }
    applyChildProcessHeapOptions(env)
    expect(env.NODE_OPTIONS).toBe('--inspect=9229 --max-old-space-size=2048')
  })
})

describe('cli.tsx — --provider startup ordering', () => {
  const providerEnvKeys = [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'GEMINI_MODEL',
  ]
  const originalEnv = new Map<string, string | undefined>()
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openclaude-cli-env-file-test-'))
    for (const key of providerEnvKeys) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    for (const key of providerEnvKeys) {
      const originalValue = originalEnv.get(key)
      if (originalValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }
    originalEnv.clear()
  })

  function writeProviderEnvFile(content: string): string {
    const filePath = join(tempDir, '.env')
    writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  it('reapplies remembered --provider after every managed settings env merge', async () => {
    const src = await Bun.file(`${import.meta.dir}/../utils/managedEnv.ts`).text()
    const safeApplyIndex = src.indexOf('export function applySafeConfigEnvironmentVariables')
    const configApplyIndex = src.indexOf('export function applyConfigEnvironmentVariables')
    const safeReapplyIndex = src.indexOf(
      'reapplyRememberedProviderFlag()',
      safeApplyIndex,
    )
    const configReapplyIndex = src.indexOf(
      'reapplyRememberedProviderFlag()',
      configApplyIndex,
    )

    expect(safeReapplyIndex).toBeGreaterThan(safeApplyIndex)
    expect(safeReapplyIndex).toBeLessThan(configApplyIndex)
    expect(configReapplyIndex).toBeGreaterThan(configApplyIndex)
  })

  it('uses the effective early model for system-prompt dumps', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    const dumpPathIndex = src.indexOf("feature('DUMP_SYSTEM_PROMPT')")
    const promptCallIndex = src.indexOf('getSystemPrompt([], model)', dumpPathIndex)
    const dumpPath = src.slice(dumpPathIndex, promptCallIndex)

    expect(dumpPathIndex).toBeGreaterThanOrEqual(0)
    expect(promptCallIndex).toBeGreaterThan(dumpPathIndex)
    expect(dumpPath).toContain('earlyModelFlag ?? getMainLoopModel()')
    expect(dumpPath).not.toContain("args.indexOf('--model')")
  })

  it('remembers provider env-file values so later managed settings env merges can restore them', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    const envFileImportIndex = src.indexOf('rememberLoadedEnvFileValues')
    const rememberLoadedFileIndex = src.indexOf(
      'rememberLoadedEnvFileValues(loadEnvFile(filePath))',
    )

    expect(envFileImportIndex).toBeGreaterThanOrEqual(0)
    expect(rememberLoadedFileIndex).toBeGreaterThan(envFileImportIndex)
  })

})

const mockImporters = {
  startupProfiler: async () => ({
    profileCheckpoint: mockProfileCheckpoint,
  }),
  bg: async () => ({
    psHandler: mockPsHandler,
    logsHandler: mockLogsHandler,
    attachHandler: mockAttachHandler,
    killHandler: mockKillHandler,
    handleBgFlag: mockHandleBgFlag,
  }),
  bgFinalizer: async () => ({
    prepareBackgroundSessionFinalizer: mockPrepareBackgroundSessionFinalizer,
    runBackgroundSessionCleanupWorker: mockRunBackgroundSessionCleanupWorker,
  }),
  envFile: async () => ({
    loadEnvFile: mockLoadEnvFile,
    parseProviderEnvFileArgs: mockParseProviderEnvFileArgs,
    reapplyRememberedEnvFileValues: mockReapplyRememberedEnvFileValues,
    rememberLoadedEnvFileValues: mockRememberLoadedEnvFileValues,
  }),
  config: async () => ({
    enableConfigs: mockEnableConfigs,
  }),
  managedEnv: async () => ({
    applySafeConfigEnvironmentVariables:
      mockApplySafeConfigEnvironmentVariables,
  }),
  providerProfile: async () => ({
    applyStartupEnvFromProfile: mockApplyStartupEnvFromProfile,
  }),
  providerValidation: async () => ({
    getProviderValidationError: mockGetProviderValidationError,
    validateProviderEnvForStartupOrExit:
      mockValidateProviderEnvForStartupOrExit,
  }),
  providerFlag: async () => ({
    applyModelFlagFromArgs: mockApplyModelFlagFromArgs,
    applyProviderFlagFromArgs,
    parseModelFlag,
    parseProviderFlag,
    reapplyRememberedProviderFlag,
  }),
  flagSettings: async () => ({
    eagerLoadSettingsFromArgs: mockEagerLoadSettingsFromArgs,
  }),
  settingsCache: async () => ({
    resetSettingsCache: mockResetSettingsCache,
  }),
  agentRouting: async () => ({
    applyAgentProviderOverrideToEnv: mockApplyAgentProviderOverrideToEnv,
    resolveOutOfProcessTeammateProviderFromCliArgs:
      mockResolveOutOfProcessTeammateProviderFromCliArgs,
  }),
  settings: async () => ({
    getInitialSettings: mockGetInitialSettings,
  }),
  githubModelsCredentials: async () => ({
    hydrateGithubModelsTokenFromSecureStorage:
      mockHydrateGithubModelsTokenFromSecureStorage,
    refreshGithubModelsTokenIfNeeded: mockRefreshGithubModelsTokenIfNeeded,
  }),
  startupScreen: async () => ({
    printStartupScreen: mockPrintStartupScreen,
  }),
  earlyInput: async () => ({
    startCapturingEarlyInput: mockStartCapturingEarlyInput,
  }),
  main: async () => ({
    main: mockCliMain,
  }),
}

describe('cli.tsx — background routing behavior', () => {
  const bgOptions = {
    bgSessionsEnabled: true,
    importers: mockImporters,
  } as unknown as Parameters<CliMain>[1]
  const originalAutoRunGuard =
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
  const savedArgv = [...process.argv]

  beforeAll(async () => {
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN = '1'

    const entrypoint = await import('./cli.js')
    runCliEntrypoint = entrypoint.main
  })

  afterAll(() => {
    if (originalAutoRunGuard === undefined) {
      delete process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    } else {
      process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN =
        originalAutoRunGuard
    }
  })

  beforeEach(() => {
    clearRuntimeMocks()
  })

  afterEach(() => {
    process.argv = [...savedArgv]
  })

  it('dispatches background management commands before startup work', async () => {
    const cases: Array<[string, typeof mockPsHandler, string[]]> = [
      ['ps', mockPsHandler, ['--json']],
      ['logs', mockLogsHandler, ['session-1', '-f']],
      ['attach', mockAttachHandler, ['session-1']],
      ['kill', mockKillHandler, ['session-1']],
    ]

    for (const [command, handler, tail] of cases) {
      clearRuntimeMocks()

      await runCliEntrypoint([command, ...tail], bgOptions)

      if (command === 'kill') {
        expect(mockKillHandler.mock.calls).toEqual([
          [tail, { retentionSettingsReady: true }],
        ])
      } else {
        expect(handler.mock.calls).toEqual([[tail]])
      }
      expect(mockParseProviderEnvFileArgs).not.toHaveBeenCalled()
      expect(mockHandleBgFlag).not.toHaveBeenCalled()
      expect(mockEnableConfigs).toHaveBeenCalledTimes(
        command === 'kill' ? 1 : 0,
      )
      expect(mockEagerLoadSettingsFromArgs).toHaveBeenCalledTimes(
        command === 'kill' ? 1 : 0,
      )
      expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
      expect(mockCliMain).not.toHaveBeenCalled()
    }
  })

  it('keeps kill reachable when retention settings cannot be loaded', async () => {
    mockEagerLoadSettingsFromArgs.mockImplementationOnce(() => ({
      ok: false,
      message: 'missing retention settings',
    }))

    await runCliEntrypoint(
      ['kill', 'session-1', '--settings', 'missing.json'],
      bgOptions,
    )

    expect(mockKillHandler).toHaveBeenCalledWith(
      ['session-1', '--settings', 'missing.json'],
      { retentionSettingsReady: false },
    )
    expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
  })

  it('establishes background finalizer ownership before any command path', async () => {
    process.env[BACKGROUND_SESSION_ID_ENV] = 'bg-entrypoint'
    mockPrepareBackgroundSessionFinalizer.mockImplementationOnce(async () => {
      throw new Error('finalizer ownership not ready')
    })
    try {
      await expect(runCliEntrypoint(['ps'], bgOptions)).rejects.toThrow(
        'finalizer ownership not ready',
      )
    } finally {
      delete process.env[BACKGROUND_SESSION_ID_ENV]
    }

    expect(mockPrepareBackgroundSessionFinalizer).toHaveBeenCalledTimes(1)
    expect(mockPsHandler).not.toHaveBeenCalled()
    expect(mockEnableConfigs).not.toHaveBeenCalled()
  })

  it('runs an internal cleanup worker before any command path', async () => {
    process.env[BACKGROUND_SESSION_CLEANUP_WORKER_ENV] = '1'
    try {
      await runCliEntrypoint(['ps'], bgOptions)
    } finally {
      delete process.env[BACKGROUND_SESSION_CLEANUP_WORKER_ENV]
    }

    expect(mockRunBackgroundSessionCleanupWorker).toHaveBeenCalledTimes(1)
    expect(mockPrepareBackgroundSessionFinalizer).not.toHaveBeenCalled()
    expect(mockPsHandler).not.toHaveBeenCalled()
    expect(mockEnableConfigs).toHaveBeenCalledTimes(1)
    expect(mockResetSettingsCache).toHaveBeenCalledTimes(1)
    expect(mockEagerLoadSettingsFromArgs.mock.calls).toEqual([[['ps']]])
    expect(mockRunBackgroundSessionCleanupWorker).toHaveBeenCalledWith({
      reloadSettings: expect.any(Function),
    })
    const workerOptions = (
      mockRunBackgroundSessionCleanupWorker.mock.calls as unknown as Array<
        [{ reloadSettings?: () => boolean }]
      >
    )[0]?.[0]
    expect(workerOptions?.reloadSettings?.()).toBe(true)
    expect(mockResetSettingsCache).toHaveBeenCalledTimes(2)
    expect(mockEagerLoadSettingsFromArgs.mock.calls).toEqual([
      [['ps']],
      [['ps']],
    ])
  })

  it('routes partial background metadata through the finalizer before dispatch', async () => {
    process.env[BACKGROUND_SESSION_LAUNCHER_PID_ENV] = '123'
    try {
      await runCliEntrypoint(['ps'], bgOptions)
    } finally {
      delete process.env[BACKGROUND_SESSION_LAUNCHER_PID_ENV]
    }

    expect(mockPrepareBackgroundSessionFinalizer).toHaveBeenCalledTimes(1)
    expect(mockPsHandler).toHaveBeenCalledTimes(1)
  })

  it('keeps management commands on the management path even with --bg arguments', async () => {
    const cases: Array<[string, typeof mockPsHandler]> = [
      ['ps', mockPsHandler],
      ['logs', mockLogsHandler],
      ['attach', mockAttachHandler],
      ['kill', mockKillHandler],
    ]

    for (const [command, handler] of cases) {
      clearRuntimeMocks()

      await runCliEntrypoint([command, '--bg', 'session-1'], bgOptions)

      const tail = ['--bg', 'session-1']
      if (command === 'kill') {
        expect(mockKillHandler.mock.calls).toEqual([
          [tail, { retentionSettingsReady: true }],
        ])
      } else {
        expect(handler.mock.calls).toEqual([[tail]])
      }
      expect(mockParseProviderEnvFileArgs).not.toHaveBeenCalled()
      expect(mockHandleBgFlag).not.toHaveBeenCalled()
      expect(mockEnableConfigs).toHaveBeenCalledTimes(
        command === 'kill' ? 1 : 0,
      )
      expect(mockEagerLoadSettingsFromArgs).toHaveBeenCalledTimes(
        command === 'kill' ? 1 : 0,
      )
      expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
      expect(mockCliMain).not.toHaveBeenCalled()
    }
  })

  it('still applies a root model option before a nested model command', async () => {
    const args = [
      '--model=deepseek/deepseek-v4-flash',
      'aimlapi',
      'topup',
      '--model',
      'anthropic/claude-sonnet-4-6',
    ]

    await runCliEntrypoint(args, bgOptions)

    expect(mockApplyModelFlagFromArgs).toHaveBeenCalledWith([
      '--model=deepseek/deepseek-v4-flash',
    ])
  })

  it('does not treat a spaced root model value as a nested command path', async () => {
    const args = ['--model', 'aimlapi', 'topup']

    await runCliEntrypoint(args, bgOptions)

    expect(mockApplyModelFlagFromArgs).toHaveBeenCalledWith(args)
  })

  it('does not treat a required root option value as a nested command path', async () => {
    const args = [
      '--name',
      'aimlapi',
      'topup',
      '--model',
      'deepseek/deepseek-v4-flash',
    ]

    await runCliEntrypoint(args, bgOptions)

    expect(mockApplyModelFlagFromArgs).toHaveBeenCalledWith(args)
  })

  it('does not treat --model after a real end-of-options marker as a root model', async () => {
    const args = [
      '--system-prompt',
      'hello',
      '--',
      '--model',
      'deepseek/deepseek-v4-flash',
    ]

    await runCliEntrypoint(args, bgOptions)

    expect(
      mockApplyStartupEnvFromProfile.mock.calls[0]?.[0].modelOverride,
    ).toBeUndefined()
    expect(mockApplyModelFlagFromArgs).not.toHaveBeenCalled()
  })

  it('preserves a teammate provider override resolved from an inline model alias', async () => {
    const providerOverride = {
      model: 'actual-provider-model',
      baseURL: 'https://provider.example/v1',
      apiKey: 'provider-key',
    }
    mockResolveOutOfProcessTeammateProviderFromCliArgs.mockReturnValueOnce(
      providerOverride,
    )

    await runCliEntrypoint(
      ['--agent-name=worker-a', '--team-name=review', '--model=route-alias'],
      bgOptions,
    )

    expect(mockApplyAgentProviderOverrideToEnv).toHaveBeenCalledWith(
      providerOverride,
    )
    expect(mockApplyModelFlagFromArgs).not.toHaveBeenCalled()
  })

  it('stops before provider validation when a model override is rejected', async () => {
    const originalExit = process.exit
    const originalConsoleError = console.error
    const exitMock = mock((_code?: number | string | null) => undefined as never)
    const consoleErrorMock = mock((_message?: unknown) => {})
    process.exit = exitMock as typeof process.exit
    console.error = consoleErrorMock
    mockApplyModelFlagFromArgs.mockReturnValueOnce({
      error: 'model is incompatible with the selected provider',
    })

    try {
      await runCliEntrypoint(
        ['--model=anthropic/claude-sonnet-4-6'],
        bgOptions,
      )
    } finally {
      process.exit = originalExit
      console.error = originalConsoleError
    }

    expect(consoleErrorMock).toHaveBeenCalledWith(
      'Error: model is incompatible with the selected provider',
    )
    expect(exitMock).toHaveBeenCalledWith(1)
    expect(mockValidateProviderEnvForStartupOrExit).not.toHaveBeenCalled()
    expect(mockCliMain).not.toHaveBeenCalled()
  })

})

describe('Node 24 premature exit regression (issue #1678)', () => {
  it('cli.tsx uses top-level await for main() to prevent premature exit', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    expect(src).toMatch(/await main\(\)/)
    expect(src).not.toMatch(/^\s*void main\(\)/m)
  })
})

describe('cli.tsx — --yolo alias (PR #1939)', () => {
  const options = {
    importers: mockImporters,
  } as unknown as Parameters<CliMain>[1]
  const originalAutoRunGuard =
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
  const savedArgv = [...process.argv]

  beforeAll(async () => {
    process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN = '1'
    const entrypoint = await import('./cli.js')
    runCliEntrypoint = entrypoint.main
  })

  afterAll(() => {
    if (originalAutoRunGuard === undefined) {
      delete process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN
    } else {
      process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN =
        originalAutoRunGuard
    }
  })

  beforeEach(() => {
    clearRuntimeMocks()
  })

  afterEach(() => {
    process.argv = [...savedArgv]
  })

  // Mirrors the registration in main.tsx. commander derives the option's
  // attribute from the LAST long flag, so both spellings set the same
  // dangerouslySkipPermissions key — the whole reason a native alias works.
  const buildProgram = () =>
    new Command()
      .option(
        '--yolo, --dangerously-skip-permissions',
        'bypass',
        () => true,
      )
      .allowExcessArguments()
      .exitOverride()

  it('commander resolves --yolo to dangerouslySkipPermissions', () => {
    expect(
      buildProgram().parse(['node', 'x', '--yolo']).opts()
        .dangerouslySkipPermissions,
    ).toBe(true)
    expect(
      buildProgram().parse(['node', 'x', '--dangerously-skip-permissions']).opts()
        .dangerouslySkipPermissions,
    ).toBe(true)
    expect(
      buildProgram().parse(['node', 'x']).opts().dangerouslySkipPermissions,
    ).toBeUndefined()
  })

  it('passes args through to cliMain verbatim — no per-token --yolo rewrite', async () => {
    // Regression guard for the six correctness bugs the old pre-parse argv
    // rewrite caused: --yolo must reach commander untouched, whatever position
    // it sits in (after a value flag, after `--`, or on a subcommand), so
    // commander — not a hand-rolled scanner — resolves it.
    const cases = [
      ['--yolo', '-p', 'hi'],
      ['--system-prompt', '--yolo'],
      ['-p', '--', '--yolo'],
      ['mcp', 'add', '--yolo', 'srv', 'cmd'],
    ]
    for (const argv of cases) {
      clearRuntimeMocks()
      process.argv = ['node', 'openclaude', ...argv]
      let argvSeenByCliMain: string[] | undefined
      mockCliMain.mockImplementationOnce(async () => {
        argvSeenByCliMain = [...process.argv]
      })

      await runCliEntrypoint(argv, options)

      expect(argvSeenByCliMain).toEqual(['node', 'openclaude', ...argv])
    }
  })

  it('does not mutate the host process.argv (no leak of a caller args array)', async () => {
    // main() must not push an explicit args array into the process-global argv:
    // cliMain reads the real process.argv, and leaking a caller's args (e.g. a
    // bypass flag) into it would corrupt an overlapping call or the host.
    const hostArgv = ['node', 'openclaude', 'host-arg']
    process.argv = [...hostArgv]
    await runCliEntrypoint(['--yolo', '-p', 'hi'], options)
    expect(process.argv).toEqual(hostArgv)
  })

})
