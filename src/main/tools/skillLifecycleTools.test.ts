import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { getSkillRoot, getWorkspaceRoot } from '../paths'
import { systemTools } from './system'

const testDir = join(__dirname, '../../../temp-skill-lifecycle-tools-test')

const executionContext = {
  reqId: 'test-req',
  signal: new AbortController().signal
}

describe('skill lifecycle tools', () => {
  let originalQuickAiHome: string | undefined
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalQuickAiHome = process.env.QUICKAI_HOME
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_HOME = testDir
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(getWorkspaceRoot(), { recursive: true })
  })

  afterEach(async () => {
    process.env.QUICKAI_HOME = originalQuickAiHome
    process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('creates and removes a folder skill', async () => {
    const createResult = await systemTools.create_skill.execute(
      {
        name: 'Lifecycle Skill',
        trigger: 'lifecycle-skill',
        description: 'Use lifecycle skill.',
        instructions: 'Follow lifecycle workflow.'
      },
      executionContext
    )

    const skillDir = join(getSkillRoot(), 'skill-lifecycle-skill')
    expect(createResult.resultForModel).toContain('Created QuickAI skill')
    expect(await fs.readFile(join(skillDir, 'SKILL.md'), 'utf-8')).toContain(
      'Follow lifecycle workflow.'
    )

    const removeResult = await systemTools.remove_skill.execute(
      { name: '@lifecycle-skill' },
      executionContext
    )

    expect(removeResult.resultForModel).toContain('Removed QuickAI skill')
    await expect(fs.stat(skillDir)).rejects.toThrow()
  })

  it('installs a folder skill and preserves auxiliary resources', async () => {
    const sourceDir = join(getWorkspaceRoot(), 'source-skill')
    await fs.mkdir(join(sourceDir, 'references'), { recursive: true })
    await fs.writeFile(
      join(sourceDir, 'SKILL.md'),
      '---\nname: Installed Lifecycle\ntrigger: installed-lifecycle\ndescription: Use installed lifecycle.\n---\nRun installed lifecycle.',
      'utf-8'
    )
    await fs.writeFile(join(sourceDir, 'references', 'notes.md'), 'Installed reference', 'utf-8')

    const installResult = await systemTools.install_skill.execute(
      { path: sourceDir },
      executionContext
    )

    const installedDir = join(getSkillRoot(), 'skill-installed-lifecycle')
    expect(installResult.resultForModel).toContain('Installed QuickAI skill')
    expect(await fs.readFile(join(installedDir, 'references', 'notes.md'), 'utf-8')).toBe(
      'Installed reference'
    )

    const loadResult = await systemTools.load_skill.execute(
      { name: '@installed-lifecycle' },
      executionContext
    )
    expect(loadResult.resultForModel).toContain('Run installed lifecycle.')
    expect(loadResult.resultForModel).toContain('Path: references/notes.md')
    expect(loadResult.resultForModel).not.toContain('Installed reference')

    const resourceResult = await systemTools.read_skill_resource.execute(
      { name: '@installed-lifecycle', path: 'references/notes.md' },
      executionContext
    )
    expect(resourceResult.resultForModel).toContain('Installed reference')
    expect(resourceResult.resultForUi.title).toBe('Skill Resource: references/notes.md')
  })
})
