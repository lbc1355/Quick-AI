import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { systemTools } from './system'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { createRun, destroyRun } from '../agent/AgentRunContext'
import { ActionLog } from '../agent/actionLog'
import { getSkillRoot, getWorkspaceRoot } from '../paths'

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

  it('loads skill instructions and resource list by @trigger', async () => {
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
    expect(result.resultForModel).toContain('Packaged Auxiliary Files:')
    expect(result.resultForModel).toContain('Path: references/notes.md')
    expect(result.resultForModel).toContain('read_skill_resource')
    expect(result.resultForModel).not.toContain('Reference details')
    expect(result.resultForUi.title).toBe('Load Skill: Rich Skill')
  })

  it('reads an auxiliary skill resource on demand', async () => {
    const skillRoot = join(testDir, 'skill')
    const skillDir = join(skillRoot, 'rich-skill')
    await fs.mkdir(join(skillDir, 'references'), { recursive: true })

    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: Rich Skill\ntrigger: rich\ndescription: Use rich workflow\n---\nFollow the rich workflow.',
      'utf-8'
    )
    await fs.writeFile(join(skillDir, 'references', 'notes.md'), 'Reference details', 'utf-8')

    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const result = await systemTools.read_skill_resource.execute(
      { name: '@rich', path: 'references/notes.md' },
      executionContext
    )
    expect(result.resultForModel).toContain('Skill Resource: skill-rich')
    expect(result.resultForModel).toContain('Path: references/notes.md')
    expect(result.resultForModel).toContain('Reference details')
    expect(result.resultForUi.title).toBe('Skill Resource: references/notes.md')
  })

  it('creates, validates, and loads a folder skill', async () => {
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const createResult = await systemTools.create_skill.execute(
      {
        name: 'Example Skill',
        trigger: '@example-skill',
        description: 'Use for testing the example skill lifecycle.',
        shortDescription: 'Example skill lifecycle',
        instructions: 'Follow the example workflow.'
      },
      executionContext
    )
    expect(createResult.resultForModel).toContain('Created QuickAI skill')

    const skillDir = join(getSkillRoot(), 'skill-example-skill')
    expect(await fs.readFile(join(skillDir, 'SKILL.md'), 'utf-8')).toContain(
      'Follow the example workflow.'
    )

    const validateResult = await systemTools.validate_skill.execute(
      { name: '@example-skill' },
      executionContext
    )
    expect(validateResult.resultForModel).toContain('skill-example-skill (@example-skill): OK')

    const loadResult = await systemTools.load_skill.execute(
      { name: '@example-skill' },
      executionContext
    )
    expect(loadResult.resultForModel).toContain('Loaded QuickAI Skill')
    expect(loadResult.resultForModel).toContain('Follow the example workflow.')
  })

  it('installs a folder skill and preserves auxiliary resources', async () => {
    const sourceDir = join(getWorkspaceRoot(), 'install-source-skill')
    await fs.mkdir(join(sourceDir, 'references'), { recursive: true })
    await fs.writeFile(
      join(sourceDir, 'SKILL.md'),
      '---\nname: Installed Skill\ntrigger: installed\ndescription: Use installed skill.\n---\nRun installed workflow.',
      'utf-8'
    )
    await fs.writeFile(join(sourceDir, 'references', 'notes.md'), 'Installed reference', 'utf-8')

    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    const installResult = await systemTools.install_skill.execute(
      { path: sourceDir },
      executionContext
    )
    expect(installResult.resultForModel).toContain('Installed QuickAI skill')

    const installedDir = join(getSkillRoot(), 'skill-installed')
    expect(await fs.readFile(join(installedDir, 'references', 'notes.md'), 'utf-8')).toBe(
      'Installed reference'
    )

    const loadResult = await systemTools.load_skill.execute(
      { name: '@installed' },
      executionContext
    )
    expect(loadResult.resultForModel).toContain('Path: references/notes.md')

    const resourceResult = await systemTools.read_skill_resource.execute(
      { name: '@installed', path: 'references/notes.md' },
      executionContext
    )
    expect(resourceResult.resultForModel).toContain('Installed reference')
  })

  it('removes a folder skill', async () => {
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }
    await systemTools.create_skill.execute(
      {
        name: 'Remove Me',
        trigger: 'remove-me',
        description: 'Use for remove tests.',
        instructions: 'Remove this workflow.'
      },
      executionContext
    )

    const skillDir = join(getSkillRoot(), 'skill-remove-me')
    const removeResult = await systemTools.remove_skill.execute(
      { name: '@remove-me' },
      executionContext
    )
    expect(removeResult.resultForModel).toContain('Removed QuickAI skill')
    await expect(fs.stat(skillDir)).rejects.toThrow()
  })

  it('removes a flat markdown skill without deleting the skill root', async () => {
    const skillRoot = getSkillRoot()
    const flatSkillPath = join(skillRoot, 'flat-skill.md')
    const sentinelPath = join(skillRoot, 'keep.txt')
    await fs.writeFile(
      flatSkillPath,
      '---\nname: Flat Skill\ntrigger: flat-skill\ndescription: Use flat skill.\n---\nFlat workflow.',
      'utf-8'
    )
    await fs.writeFile(sentinelPath, 'keep me', 'utf-8')

    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    await systemTools.remove_skill.execute({ name: '@flat-skill' }, executionContext)

    await expect(fs.stat(flatSkillPath)).rejects.toThrow()
    expect((await fs.stat(skillRoot)).isDirectory()).toBe(true)
    expect(await fs.readFile(sentinelPath, 'utf-8')).toBe('keep me')
  })

  it('protects system skills from removal by default', async () => {
    const systemSkillDir = join(getSkillRoot(), '.system', 'system-demo')
    await fs.mkdir(systemSkillDir, { recursive: true })
    await fs.writeFile(
      join(systemSkillDir, 'SKILL.md'),
      '---\nname: System Demo\ntrigger: system-demo\ndescription: Use system demo.\n---\nSystem workflow.',
      'utf-8'
    )

    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }

    await expect(
      systemTools.remove_skill.execute({ name: '@system-demo' }, executionContext)
    ).rejects.toThrow('Refusing to remove a system skill')
    expect((await fs.stat(systemSkillDir)).isDirectory()).toBe(true)
  })

  it('rejects duplicate skill IDs before creating another skill', async () => {
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      mainWindow: null as any
    }
    await systemTools.create_skill.execute(
      {
        name: 'Duplicate Skill',
        trigger: 'duplicate-skill',
        description: 'Use duplicate skill.',
        instructions: 'First duplicate workflow.'
      },
      executionContext
    )

    await expect(
      systemTools.create_skill.execute(
        {
          name: 'Duplicate Skill Copy',
          trigger: 'duplicate-skill',
          description: 'Use duplicate skill copy.',
          instructions: 'Second duplicate workflow.'
        },
        executionContext
      )
    ).rejects.toThrow('Skill already installed')
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
    destroyRun('task-json-string-req')
    destroyRun('task-bad-json-req')
    destroyRun('task-code-title-req')
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

  it('parses a JSON task list string instead of creating a raw JSON task title', async () => {
    const reqId = 'task-json-string-req'
    createRun(reqId, ['task'], 'all', new ActionLog())

    const result = await systemTools.task.execute(
      {
        task: JSON.stringify([
          { id: '1', title: 'Initialize project environment', status: 'completed' },
          { id: '2', title: 'Write sample code', status: 'pending' }
        ])
      },
      executionContext(reqId)
    )

    expect(result.resultForModel).toContain('Initialize project environment [completed]')
    expect(result.resultForModel).toContain('Write sample code [pending]')
    expect(result.resultForModel).not.toContain('[{')
    expect(result.resultForUi.summary).toBe('1/2 done')
  })

  it('rejects malformed JSON-like task strings', async () => {
    const reqId = 'task-bad-json-req'
    createRun(reqId, ['task'], 'all', new ActionLog())

    await expect(
      systemTools.task.execute(
        { task: '[{"id":"1","title":"Broken task","status":"completed"' },
        executionContext(reqId)
      )
    ).rejects.toThrow('No valid task items found')
  })

  it('rejects code-like task titles', async () => {
    const reqId = 'task-code-title-req'
    createRun(reqId, ['task'], 'all', new ActionLog())

    await expect(
      systemTools.task.execute(
        { task: 'task(tasks=[{"id":"1","title":"Fake completion","status":"completed"}])' },
        executionContext(reqId)
      )
    ).rejects.toThrow('No valid task items found')
  })
})
