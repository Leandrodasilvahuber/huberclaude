import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSkillFile,
  deleteSkillFiles,
  formatSkillTemplate,
  validateSkillName,
} from './skillFileUtils.js'

describe('validateSkillName', () => {
  test('accepts lowercase names with hyphens', () => {
    expect(validateSkillName('review-pr')).toBeNull()
  })

  test('rejects empty, uppercase, spaces and path tricks', () => {
    expect(validateSkillName('')).not.toBeNull()
    expect(validateSkillName('Review')).not.toBeNull()
    expect(validateSkillName('two words')).not.toBeNull()
    expect(validateSkillName('../etc')).not.toBeNull()
    expect(validateSkillName('-leading')).not.toBeNull()
  })
})

describe('formatSkillTemplate', () => {
  test('escapes quotes and keeps the description on one line', () => {
    const content = formatSkillTemplate('x', 'say "hi"\nnow')
    expect(content).toContain('description: "say \\"hi\\" now"')
    expect(content.startsWith('---\nname: x\n')).toBe(true)
  })
})

describe('createSkillFile / deleteSkillFiles', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'skills-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  test('creates SKILL.md inside the project skills folder', async () => {
    const path = await createSkillFile('projectSettings', 'my-skill', 'Does things', cwd)
    expect(path).toBe(join(cwd, '.openclaude', 'skills', 'my-skill', 'SKILL.md'))
    expect(readFileSync(path, 'utf-8')).toContain('name: my-skill')
  })

  test('refuses to overwrite an existing skill', async () => {
    await createSkillFile('projectSettings', 'dup', 'one', cwd)
    await expect(createSkillFile('projectSettings', 'dup', 'two', cwd)).rejects.toThrow('already exists')
  })

  test('deletes the whole skill folder', async () => {
    const path = await createSkillFile('projectSettings', 'gone', 'bye', cwd)
    const dir = join(cwd, '.openclaude', 'skills', 'gone')
    writeFileSync(join(dir, 'helper.sh'), '')
    await deleteSkillFiles({ skillFilePath: path, skillRoot: dir, loadedFrom: 'skills' })
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(join(cwd, '.openclaude', 'skills'))).toBe(true)
  })

  test('refuses a path that is not a SKILL.md', async () => {
    const dir = join(cwd, '.openclaude', 'skills', 'odd')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'notes.md')
    writeFileSync(file, '')
    await expect(
      deleteSkillFiles({ skillFilePath: file, skillRoot: dir, loadedFrom: 'skills' }),
    ).rejects.toThrow('Refusing')
    expect(existsSync(dir)).toBe(true)
  })

  test('refuses when skillRoot does not match the file folder', async () => {
    const path = await createSkillFile('projectSettings', 'keep', 'x', cwd)
    await expect(
      deleteSkillFiles({ skillFilePath: path, skillRoot: cwd, loadedFrom: 'skills' }),
    ).rejects.toThrow('Refusing')
    expect(existsSync(path)).toBe(true)
  })

  test('deletes only the file for legacy commands/ skills', async () => {
    const dir = join(cwd, '.openclaude', 'commands')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'old.md')
    writeFileSync(file, '')
    await deleteSkillFiles({ skillFilePath: file, loadedFrom: 'commands_DEPRECATED' })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(dir)).toBe(true)
  })
})
