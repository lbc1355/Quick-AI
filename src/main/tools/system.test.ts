import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { systemTools } from './system'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'

const testDir = join(__dirname, '../../../temp-system-tools-test')

describe('systemTools.list_skills', () => {
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

  it('lists skills correctly when directory is populated', async () => {
    const skillRoot = join(testDir, 'skill')
    await fs.mkdir(skillRoot, { recursive: true })

    // Create a flat md skill
    await fs.writeFile(
      join(skillRoot, 'test-skill.md'),
      '---\nname: Test Skill\ntrigger: test\n---\nPrompt instructions',
      'utf-8'
    )

    const listSkillsTool = systemTools.list_skills
    expect(listSkillsTool).toBeDefined()

    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const result = await listSkillsTool.execute({}, executionContext)
    expect(result.resultForModel).toContain('Test Skill')
    expect(result.resultForModel).toContain('test')
    expect(result.resultForModel).toContain('Installed Skills:')
    expect(result.resultForUi.summary).toContain('Found 1 skills')
  })

  it('retrieves full details for a specific skill when skillId is provided', async () => {
    const skillRoot = join(testDir, 'skill')
    await fs.mkdir(skillRoot, { recursive: true })

    await fs.writeFile(
      join(skillRoot, 'test-skill.md'),
      '---\nname: Test Skill\ntrigger: test\n---\nPrompt instructions',
      'utf-8'
    )

    const listSkillsTool = systemTools.list_skills
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const result = await listSkillsTool.execute({ skillId: 'skill-test' }, executionContext)
    expect(result.resultForModel).toContain('Skill ID: skill-test')
    expect(result.resultForModel).toContain('--- SKILL.md Prompt Instructions ---')
    expect(result.resultForModel).toContain('Prompt instructions')
    expect(result.resultForModel).toContain('File Path:')
    expect(result.resultForUi.title).toBe('Skill Details: Test Skill')
  })

  it('returns appropriate message when no skills exist', async () => {
    const listSkillsTool = systemTools.list_skills
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const result = await listSkillsTool.execute({}, executionContext)
    expect(result.resultForModel).toContain('No custom skills installed.')
    expect(result.resultForUi.summary).toContain('0 skills installed')
  })
})
