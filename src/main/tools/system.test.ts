import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { systemTools } from './system'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { createRun, destroyRun } from '../agent/AgentRunContext'
import { ActionLog } from '../agent/actionLog'

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

  it('loads full skill instructions and package files by @trigger', async () => {
    const skillRoot = join(testDir, 'skill')
    const skillDir = join(skillRoot, 'rich-skill')
    await fs.mkdir(skillDir, { recursive: true })

    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: Rich Skill\ntrigger: rich\ndescription: Use rich workflow\n---\nFollow the rich workflow.',
      'utf-8'
    )
    await fs.mkdir(join(skillDir, 'references'), { recursive: true })
    await fs.writeFile(join(skillDir, 'references', 'notes.md'), 'Reference details', 'utf-8')

    const loadSkillTool = systemTools.load_skill
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const result = await loadSkillTool.execute({ name: '@rich' }, executionContext)
    expect(result.resultForModel).toContain('Loaded QuickAI Skill')
    expect(result.resultForModel).toContain('Rich Skill')
    expect(result.resultForModel).toContain('Follow the rich workflow.')
    expect(result.resultForModel).toContain('--- Skill Package Files ---')
    expect(result.resultForModel).toContain('Path: references/notes.md')
    expect(result.resultForModel).toContain('Reference details')
    expect(result.resultForUi.title).toBe('Load Skill: Rich Skill')
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

describe('systemTools.task', () => {
  const executionContext = (reqId: string) => ({
    reqId,
    signal: new AbortController().signal,
    mainWindow: null as any
  })

  afterEach(() => {
    destroyRun('task-text-req')
    destroyRun('task-title-req')
  })

  it('accepts a plain text task title', async () => {
    const reqId = 'task-text-req'
    createRun(reqId, ['task'], 'all', new ActionLog())

    const result = await systemTools.task.execute(
      '创建示例skill以展示skill创建过程' as any,
      executionContext(reqId)
    )

    expect(result.resultForModel).toContain('创建示例skill以展示skill创建过程')
    expect(result.resultForModel).toContain('[in_progress]')
    expect(result.resultForUi.summary).toBe('0/1 done')
  })

  it('accepts a single top-level task object', async () => {
    const reqId = 'task-title-req'
    createRun(reqId, ['task'], 'all', new ActionLog())

    const result = await systemTools.task.execute(
      { title: 'Create sample skill', status: 'pending' },
      executionContext(reqId)
    )

    expect(result.resultForModel).toContain('Create sample skill')
    expect(result.resultForModel).toContain('[pending]')
    expect(result.resultForUi.summary).toBe('0/1 done')
  })
})
