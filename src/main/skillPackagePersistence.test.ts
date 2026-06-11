import { it, expect, beforeEach, afterEach, describe } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync, writeFileSync, mkdirSync } from 'fs'
import { loadSkillsFromFolders, saveSkillsToFolders } from './skillManager'
import { Skill } from '../shared/types'
import { getSkillRoot } from './paths'

const testDir = join(__dirname, '../../temp-skill-package-test')

describe('folder-based skill package persistence', () => {
  let originalQuickAiHome: string | undefined

  beforeEach(async () => {
    originalQuickAiHome = process.env.QUICKAI_HOME
    process.env.QUICKAI_HOME = testDir

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    process.env.QUICKAI_HOME = originalQuickAiHome
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('round-trips folder skill package metadata and text files to disk', () => {
    const skills: Skill[] = [
      {
        id: 'skill-folder-test',
        name: 'Folder Skill Test',
        trigger: 'folder-test',
        prompt: 'Use bundled files instructions.',
        rawMarkdown: '# Folder Skill Test\n\nUse bundled files instructions.',
        source: 'folder',
        entryPath: 'SKILL.md',
        packageRoot: 'folder-skill-test',
        packageFiles: [
          { path: 'scripts/helper.py', content: 'print("helper")', size: 15 }
        ]
      }
    ]

    // Save to folder
    saveSkillsToFolders(skills)

    const skillRoot = getSkillRoot()
    const skillFolder = join(skillRoot, 'skill-folder-test')
    expect(existsSync(skillFolder)).toBe(true)
    expect(existsSync(join(skillFolder, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillFolder, 'scripts/helper.py'))).toBe(true)

    // Load from folder
    const loaded = loadSkillsFromFolders()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      id: 'skill-folder-test',
      name: 'Folder Skill Test',
      trigger: 'folder-test',
      prompt: 'Use bundled files instructions.',
      source: 'folder',
      entryPath: 'SKILL.md',
      packageRoot: 'skill-folder-test'
    })
    
    expect(loaded[0].packageFiles).toBeDefined()
    expect(loaded[0].packageFiles?.[0].path).toBe('scripts/helper.py')
    expect(loaded[0].packageFiles?.[0].content).toBe('print("helper")')
  })

  it('cleans up deleted skill folders', () => {
    const skillRoot = getSkillRoot()
    const folderA = join(skillRoot, 'skill-a')
    const folderB = join(skillRoot, 'skill-b')

    mkdirSync(folderA, { recursive: true })
    mkdirSync(folderB, { recursive: true })
    writeFileSync(join(folderA, 'SKILL.md'), '# Skill A\n\nPrompt A', 'utf-8')
    writeFileSync(join(folderB, 'SKILL.md'), '# Skill B\n\nPrompt B', 'utf-8')

    expect(existsSync(folderA)).toBe(true)
    expect(existsSync(folderB)).toBe(true)

    // Save list containing only skill-a (skill-b is deleted)
    const activeSkills: Skill[] = [
      {
        id: 'skill-a',
        name: 'Skill A',
        trigger: 'a',
        prompt: 'Prompt A',
        rawMarkdown: '# Skill A\n\nPrompt A'
      }
    ]

    saveSkillsToFolders(activeSkills)

    expect(existsSync(folderA)).toBe(true)
    expect(existsSync(folderB)).toBe(false) // Cleaned up!
  })

  it('supports loading flat .md skill files directly from directory', () => {
    const skillRoot = getSkillRoot()
    writeFileSync(join(skillRoot, 'flat-skill.md'), '# Flat Skill\n\nFlat instructions.', 'utf-8')

    const loaded = loadSkillsFromFolders()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      id: 'skill-flat-skill',
      name: 'Flat Skill',
      trigger: 'flat-skill',
      prompt: 'Flat instructions.',
      source: 'markdown'
    })
  })
})
