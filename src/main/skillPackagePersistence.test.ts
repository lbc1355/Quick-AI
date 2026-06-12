import { it, expect, beforeEach, afterEach, describe } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync, writeFileSync, mkdirSync } from 'fs'
import {
  ensureSystemSkills,
  getSkillWatchDirectories,
  loadSkillsFromFolders,
  saveSkillsToFolders
} from './skillManager'
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
        packageFiles: [{ path: 'scripts/helper.py', content: 'print("helper")', size: 15 }]
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

  it('loads quickai interface metadata without treating agents yaml as a resource', () => {
    const skillRoot = getSkillRoot()
    const skillDir = join(skillRoot, 'skill-interface-test')
    mkdirSync(join(skillDir, 'agents'), { recursive: true })
    mkdirSync(join(skillDir, 'references'), { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: Internal Skill\ntrigger: iface\ndescription: Internal description\n---\nInterface instructions.',
      'utf-8'
    )
    writeFileSync(
      join(skillDir, 'agents', 'quickai.yaml'),
      'interface:\n  display_name: "Display Skill"\n  short_description: "Shown in menus"\n  icon_small: "./assets/small.svg"\n  default_prompt: "Use @iface"\n',
      'utf-8'
    )
    writeFileSync(join(skillDir, 'references', 'notes.md'), 'Reference notes', 'utf-8')

    const loaded = loadSkillsFromFolders()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].interface).toMatchObject({
      displayName: 'Display Skill',
      shortDescription: 'Shown in menus',
      iconSmall: './assets/small.svg',
      defaultPrompt: 'Use @iface'
    })
    expect(loaded[0].packageFiles?.map((file) => file.path)).toEqual(['references/notes.md'])
  })

  it('creates missing system skills and loads them from .system', () => {
    const skillRoot = getSkillRoot()
    const systemSkillDir = join(skillRoot, '.system', 'skill-creator')

    expect(existsSync(systemSkillDir)).toBe(false)

    ensureSystemSkills()

    expect(existsSync(join(systemSkillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(systemSkillDir, 'agents', 'quickai.yaml'))).toBe(true)

    const loaded = loadSkillsFromFolders()
    const skillCreator = loaded.find((skill) => skill.id === 'skill-skill-creator')
    const skillInstaller = loaded.find((skill) => skill.id === 'skill-skill-installer')
    const openaiDocs = loaded.find((skill) => skill.id === 'skill-openai-docs')
    const quickAiAgent = loaded.find((skill) => skill.id === 'skill-quickai-agent')

    expect(skillCreator).toBeDefined()
    expect(skillCreator?.trigger).toBe('skill-creator')
    expect(skillCreator?.interface?.displayName).toBe('Skill Creator')
    expect(skillCreator?.filePath?.replace(/\\/g, '/')).toContain(
      '/skill/.system/skill-creator/SKILL.md'
    )
    expect(skillInstaller?.interface?.displayName).toBe('Skill Installer')
    expect(openaiDocs?.triggers).toContain('docs')
    expect(quickAiAgent?.triggers).toContain('quickai')
  })

  it('includes skill roots and package subdirectories in watch directories', () => {
    const skillRoot = getSkillRoot()
    const skillDir = join(skillRoot, 'skill-watch-test')
    const refsDir = join(skillDir, 'references')
    mkdirSync(refsDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Watch Test\n\nWatch instructions.', 'utf-8')
    writeFileSync(join(refsDir, 'notes.md'), 'Reference notes', 'utf-8')

    const watched = getSkillWatchDirectories().map((dir) => dir.replace(/\\/g, '/'))

    expect(watched).toContain(skillRoot.replace(/\\/g, '/'))
    expect(watched).toContain(skillDir.replace(/\\/g, '/'))
    expect(watched).toContain(refsDir.replace(/\\/g, '/'))
  })
})
