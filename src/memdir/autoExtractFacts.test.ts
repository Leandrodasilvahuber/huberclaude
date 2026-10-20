import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractFactsIntoMemdir } from './autoExtractFacts.js'
import { setGovernancePolicySettingsForSourceForTesting } from '../utils/governancePolicy.js'

describe('autoExtractFacts', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'auto-extract-facts-test-'))
    // Extraction respects the memory-write approval policy; tests opt in so
    // facts are actually persisted.
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    delete process.env.CLAUDE_CODE_SIMPLE
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
  })

  afterEach(() => {
    setGovernancePolicySettingsForSourceForTesting(null)
    rmSync(memDir, { recursive: true, force: true })
  })

  function factsDir(): string {
    return join(memDir, '.facts')
  }

  function countFactFiles(): number {
    const dir = factsDir()
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter(f => f.endsWith('.md')).length
  }

  it('does not extract JWT bearer values', async () => {
    await extractFactsIntoMemdir(
      'authorization: Bearer `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`',
      memDir,
    )
    const files = existsSync(factsDir()) ? readdirSync(factsDir()) : []
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    expect(conceptFacts.some(f => f.includes('eyJ'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('JWT') || f.includes('jwt'))).toBe(false)
  })

  it('handles empty content gracefully', async () => {
    await extractFactsIntoMemdir('', memDir)
    expect(countFactFiles()).toBe(0)
  })

  it('does not persist token-like hyphenated terms as concepts (P1#3)', async () => {
    await extractFactsIntoMemdir('the value is super-secret-access-token here', memDir)
    const dir = factsDir()
    const files = existsSync(dir) ? readdirSync(dir).map(f => f.toLowerCase()) : []
    expect(files.some(f => f.includes('super-secret-access-token'))).toBe(false)
  })

  it('regression: does not extract moderate length secret-shaped tokens', async () => {
    // Test access-token-2024, prod-db-pass-2024, TOKENABC123, Tr0ub4dour1 in backticks and rule sentences
    await extractFactsIntoMemdir(
      'Always use `access-token-2024` for credentials. Never share `TOKENABC123` or `Tr0ub4dour1`. Also prod-db-pass-2024 is secret.',
      memDir,
    )
    const dir = factsDir()
    const files = existsSync(dir) ? readdirSync(dir).map(f => f.toLowerCase()) : []

    // They should not show up as concepts, rules, or anything else
    expect(files.some(f => f.includes('access-token-2024'))).toBe(false)
    expect(files.some(f => f.includes('prod-db-pass-2024'))).toBe(false)
    expect(files.some(f => f.includes('tokenabc123'))).toBe(false)
    expect(files.some(f => f.includes('tr0ub4dour1'))).toBe(false)

    // No rules containing these secrets should have been created
    const ruleFiles = files.filter(f => f.includes('rule'))
    expect(ruleFiles.length).toBe(0)
  })

})

describe('autoExtractFacts governance gate (P1#1, P2#6)', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'auto-extract-gate-test-'))
    setGovernancePolicySettingsForSourceForTesting(null)
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  })

  afterEach(() => {
    setGovernancePolicySettingsForSourceForTesting(null)
    rmSync(memDir, { recursive: true, force: true })
  })

  it('does not write facts when memory-write approval is required', async () => {
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: true },
    }))
    const result = await extractFactsIntoMemdir('DATABASE_HOST=prod-db-1.internal', memDir)
    expect(result).toBe(false)
    expect(factCount()).toBe(0)
  })

  it('does not write facts when auto-memory is disabled', async () => {
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    const result = await extractFactsIntoMemdir('we use React with Redux', memDir)
    expect(result).toBe(false)
    expect(factCount()).toBe(0)
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  })

  it('degrades non-fatally when the facts directory cannot be created (P2#6)', async () => {
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
    // Pass a path that is an existing *file* so the .facts subdirectory cannot
    // be created; the extractor must not throw (it would otherwise crash the
    // turn before the model request) and must return false.
    const fileDir = join(memDir, 'not-a-dir')
    writeFileSync(fileDir, 'x')
    const result = await extractFactsIntoMemdir('we use React with Redux', fileDir)
    expect(result).toBe(false)
  })

  function factCount(): number {
    const dir = join(memDir, '.facts')
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter(f => f.endsWith('.md')).length
  }
})
