import { vi, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { closeDb, loadSkills, saveSkills } from './database'
import { Skill } from '../shared/types'
import { describeWithSqlite } from './testSupport/nativeSqlite'

const testDir = join(__dirname, '../../temp-skill-package-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

describeWithSqlite('skill package persistence', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('round-trips folder skill package metadata and text files', () => {
    const skills: Skill[] = [
      {
        id: 'skill-folder',
        name: 'Folder Skill',
        trigger: 'folder',
        prompt: 'Use bundled files.',
        rawMarkdown: '# Folder Skill\n\nUse bundled files.',
        source: 'folder',
        entryPath: 'SKILL.md',
        packageRoot: 'folder-skill',
        packageFiles: [
          { path: 'SKILL.md', content: '# Folder Skill\n\nUse bundled files.', size: 35 },
          { path: 'scripts/helper.py', content: 'print("helper")', size: 15 }
        ]
      }
    ]

    saveSkills(skills)
    closeDb()

    const loaded = loadSkills()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      id: 'skill-folder',
      source: 'folder',
      entryPath: 'SKILL.md',
      packageRoot: 'folder-skill'
    })
    expect(loaded[0].packageFiles).toEqual(skills[0].packageFiles)
  })
})
