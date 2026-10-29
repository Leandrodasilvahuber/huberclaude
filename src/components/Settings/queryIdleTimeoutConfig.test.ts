

import { afterAll, describe, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { DEFAULT_GLOBAL_CONFIG, type GlobalConfig } from '../../utils/config.js'
import { createQueryIdleTimeoutSetting } from './queryIdleTimeoutSetting.js'

await acquireSharedMutationLock(
  'components/Settings/queryIdleTimeoutConfig.test.ts',
)

afterAll(() => {
  releaseSharedMutationLock()
})

describe('/config query idle timeout', () => {

  test('selects, persists, and displays the interactive setting', () => {
    let persistedConfig: GlobalConfig = {
      ...DEFAULT_GLOBAL_CONFIG,
      queryIdleTimeoutMs: 5 * 60 * 1000,
    }
    let displayedConfig = persistedConfig
    const loggedValues: number[] = []
    const dependencies = {
      saveGlobalConfig(updater: (current: GlobalConfig) => GlobalConfig) {
        persistedConfig = updater(persistedConfig)
      },
      getGlobalConfig: () => persistedConfig,
      setGlobalConfig(config: GlobalConfig) {
        displayedConfig = config
      },
      logChange(timeoutMs: number) {
        loggedValues.push(timeoutMs)
      },
    }

    const initialSetting = createQueryIdleTimeoutSetting(
      displayedConfig,
      dependencies,
    )
    expect(initialSetting.label).toBe('Query idle timeout')
    expect(initialSetting.value).toBe('5 min')
    expect(initialSetting.options).toContain('15 min')

    initialSetting.onChange('15 min')

    expect(persistedConfig.queryIdleTimeoutMs).toBe(15 * 60 * 1000)
    expect(displayedConfig.queryIdleTimeoutMs).toBe(15 * 60 * 1000)
    expect(loggedValues).toEqual([15 * 60 * 1000])
    expect(
      createQueryIdleTimeoutSetting(displayedConfig, dependencies).value,
    ).toBe('15 min')
  })
})
