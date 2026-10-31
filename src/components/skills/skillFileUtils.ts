import { mkdir, rm, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve, sep } from 'path'
import type { CommandBase, PromptCommand } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getSkillsPath } from '../../skills/loadSkillsDir.js'

export type SkillLocation = 'userSettings' | 'projectSettings'

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MAX_SKILL_NAME_LENGTH = 64

export function validateSkillName(name: string): string | null {
  if (!name) return 'Name cannot be empty'
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    return `Name must be at most ${MAX_SKILL_NAME_LENGTH} characters`
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    return 'Use only lowercase letters, numbers and hyphens (e.g. review-pr)'
  }
  return null
}

export function getSkillsDir(location: SkillLocation, cwd = getCwd()): string {
  return resolve(cwd, getSkillsPath(location, 'skills'))
}

export function formatSkillTemplate(name: string, description: string): string {
  // Same YAML escaping as agent files: keep the description on one line.
  const escaped = description
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
  return `---
name: ${name}
description: "${escaped}"
---

# ${name}

Describe here, step by step, what the model should do when this skill is used.
`
}

/** Creates <skills dir>/<name>/SKILL.md and returns its path. */
export async function createSkillFile(
  location: SkillLocation,
  name: string,
  description: string,
  cwd = getCwd(),
): Promise<string> {
  const problem = validateSkillName(name)
  if (problem) throw new Error(problem)
  const dir = join(getSkillsDir(location, cwd), name)
  const filePath = join(dir, 'SKILL.md')
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(filePath, formatSkillTemplate(name, description), {
      encoding: 'utf-8',
      flag: 'wx',
    })
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'EEXIST') {
      throw new Error(`Skill already exists: ${filePath}`)
    }
    throw e
  }
  return filePath
}

/**
 * Deletes a disk-backed skill. A skills/<name>/SKILL.md skill takes its whole
 * folder (scripts and references live there too); a legacy commands/*.md
 * entry only its file. Refuses anything that does not look like one of those,
 * so a bad path can never take a parent directory with it.
 */
export async function deleteSkillFiles(
  skill: Pick<CommandBase & PromptCommand, 'skillFilePath' | 'skillRoot' | 'loadedFrom'>,
): Promise<void> {
  const filePath = skill.skillFilePath
  if (!filePath) throw new Error('This skill has no file on disk')

  if (skill.loadedFrom === 'skills') {
    const dir = dirname(resolve(filePath))
    if (!/^skill\.md$/i.test(basename(filePath)) || dirname(dir) === dir) {
      throw new Error(`Refusing to delete unexpected skill path: ${filePath}`)
    }
    if (skill.skillRoot && resolve(skill.skillRoot) !== dir) {
      throw new Error(`Refusing to delete unexpected skill path: ${filePath}`)
    }
    if (!dir.split(sep).includes('skills')) {
      throw new Error(`Refusing to delete outside a skills folder: ${dir}`)
    }
    await rm(dir, { recursive: true, force: true })
    return
  }

  try {
    await unlink(filePath)
  } catch (e: unknown) {
    if (getErrnoCode(e) !== 'ENOENT') throw e
  }
}
