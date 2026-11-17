import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { systemTools } from './system'
import { globalUserChoiceManager } from '../agent/userChoiceManager'
import { clearPendingRemindersForTests, setReminderNotificationSenderForTests } from './reminders'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { createRun, destroyRun } from '../agent/AgentRunContext'
import { ActionLog } from '../agent/actionLog'
import { getSkillRoot } from '../paths'
import { ToolExecutionContext } from './types'

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

  it('lists an empty skill directory and discovers a skill added to it', async () => {
    const skillRoot = join(testDir, 'skill')
    await fs.mkdir(skillRoot, { recursive: true })

    const listSkillsTool = systemTools.list_skills
    expect(listSkillsTool).toBeDefined()

    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      host: undefined
    }

    const emptyResult = await listSkillsTool.execute({}, executionContext)
    expect(emptyResult.resultForModel).toBe('No custom skills installed.')
    expect(emptyResult.resultForUi.summary).toBe('0 skills installed')

    await fs.writeFile(
      join(skillRoot, 'test-skill.md'),
      '---\nname: Test Skill\ntrigger: test\n---\nPrompt instructions',
      'utf-8'
    )

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
      host: undefined
    }

    const result = await listSkillsTool.execute({ skillId: 'skill-test' }, executionContext)
    expect(result.resultForModel).toContain('Skill ID: skill-test')
    expect(result.resultForModel).toContain('--- SKILL.md Prompt Instructions ---')
    expect(result.resultForModel).toContain('Prompt instructions')
    expect(result.resultForModel).toContain('File Path:')
    expect(result.resultForUi.title).toBe('Skill Details: Test Skill')
  })

  it('creates, validates, and loads a folder skill', async () => {
    const executionContext = {
      reqId: 'test-req',
      signal: new AbortController().signal,
      host: undefined
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
      host: undefined
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
      host: undefined
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
      host: undefined
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
})

describe('systemTools.task', () => {
  const executionContext = (reqId: string): ToolExecutionContext => ({
    reqId,
    signal: new AbortController().signal,
    host: undefined
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

describe('systemTools.ask_user_choice', () => {
  const reqId = 'choice-req'

  afterEach(() => {
    globalUserChoiceManager.cleanupForRun(reqId)
  })

  it('sends a choice request and returns the selected option to the model', async () => {
    const requestUserChoice = vi.fn()
    const executionContext: ToolExecutionContext = {
      reqId,
      signal: new AbortController().signal,
      host: { requestUserChoice }
    }

    const resultPromise = systemTools.ask_user_choice.execute(
      {
        question: 'Which database should I install?',
        options: [
          { label: 'SQLite', value: 'sqlite', description: 'Single-file local database' },
          { label: 'PostgreSQL', value: 'postgres', description: 'Server database' }
        ]
      },
      executionContext
    )

    await Promise.resolve()

    expect(requestUserChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        reqId,
        question: 'Which database should I install?',
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'option-1', label: 'SQLite', value: 'sqlite' }),
          expect.objectContaining({ id: 'option-2', label: 'PostgreSQL', value: 'postgres' })
        ])
      })
    )

    const request = requestUserChoice.mock.calls[0][0]
    globalUserChoiceManager.resolve(reqId, request.requestId, {
      selectedOptionId: 'option-2',
      selectedLabel: 'PostgreSQL',
      selectedValue: 'postgres'
    })

    const result = await resultPromise
    expect(result.resultForModel).toContain('User made a choice.')
    expect(result.resultForModel).toContain('Selected label: PostgreSQL')
    expect(result.resultForModel).toContain('Selected value: postgres')
    expect(result.resultForUi.summary).toBe('PostgreSQL')
  })

  it('accepts string options and reports cancellation', async () => {
    const requestUserChoice = vi.fn()
    const executionContext: ToolExecutionContext = {
      reqId,
      signal: new AbortController().signal,
      host: { requestUserChoice }
    }

    const resultPromise = systemTools.ask_user_choice.execute(
      {
        question: 'Pick one',
        options: ['A', 'B']
      },
      executionContext
    )

    await Promise.resolve()

    const request = requestUserChoice.mock.calls[0][0]
    expect(request.options[0]).toEqual({ id: 'option-1', label: 'A', value: 'A' })

    globalUserChoiceManager.resolve(reqId, request.requestId, { cancelled: true })
    const result = await resultPromise

    expect(result.resultForModel).toContain('User cancelled')
    expect(result.resultForUi.summary).toBe('Cancelled')
  })
})

describe('systemTools reminders', () => {
  const executionContext = {
    reqId: 'reminder-req',
    signal: new AbortController().signal,
    host: undefined
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    clearPendingRemindersForTests()
  })

  afterEach(() => {
    clearPendingRemindersForTests()
    vi.useRealTimers()
  })

  it('schedules a desktop notification after the requested delay', async () => {
    const notify = vi.fn().mockReturnValue(true)
    setReminderNotificationSenderForTests(notify)

    const result = await systemTools.schedule_reminder.execute(
      { delaySeconds: 600, message: 'Drink water' },
      executionContext
    )

    expect(result.resultForModel).toContain('Reminder scheduled.')
    expect(result.resultForModel).toContain('Message: Drink water')
    expect(result.resultForModel).toContain('Delay: 10 minutes')
    expect(result.resultForUi.summary).toBe('Drink water in 10 minutes')

    const listResult = await systemTools.list_reminders.execute({}, executionContext)
    expect(listResult.resultForModel).toContain('Pending reminders:')
    expect(listResult.resultForModel).toContain('Drink water')

    await vi.advanceTimersByTimeAsync(599_000)
    expect(notify).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(notify).toHaveBeenCalledWith('Reminder', 'Drink water', undefined)

    const emptyListResult = await systemTools.list_reminders.execute({}, executionContext)
    expect(emptyListResult.resultForModel).toBe('No pending reminders.')
  })

  it('cancels a pending reminder before it fires', async () => {
    const notify = vi.fn().mockReturnValue(true)
    setReminderNotificationSenderForTests(notify)

    const scheduleResult = await systemTools.schedule_reminder.execute(
      { delaySeconds: 5, title: 'Hydration', message: 'Drink water' },
      executionContext
    )
    const match = scheduleResult.resultForModel.match(/Reminder ID: (\S+)/)
    expect(match).not.toBeNull()
    const reminderId = match![1]

    const cancelResult = await systemTools.cancel_reminder.execute({ reminderId }, executionContext)
    expect(cancelResult.resultForModel).toContain(`Cancelled reminder ${reminderId}`)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(notify).not.toHaveBeenCalled()

    const listResult = await systemTools.list_reminders.execute({}, executionContext)
    expect(listResult.resultForModel).toBe('No pending reminders.')
  })

  it('rejects invalid reminder delays and empty messages', async () => {
    await expect(
      systemTools.schedule_reminder.execute(
        { delaySeconds: 0, message: 'Too soon' },
        executionContext
      )
    ).rejects.toThrow('delaySeconds must be at least 1')

    await expect(
      systemTools.schedule_reminder.execute({ delaySeconds: 60, message: '   ' }, executionContext)
    ).rejects.toThrow('Missing or invalid message parameter')
  })
})
