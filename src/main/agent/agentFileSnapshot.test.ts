import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  beginAgentFileSnapshot,
  previewAgentFileRevert,
  revertAgentFileChanges
} from './agentFileSnapshot'
import { createRunManifest, loadRunManifest } from './runManifest'

const testRoot = join(__dirname, '../../../temp-agent-file-snapshot-test')
const projectRoot = join(testRoot, 'project')

vi.mock('electron', () => ({
  app: {
    getPath: () => testRoot
  }
}))

const createManifest = (runId: string): void => {
  createRunManifest({ runId, sessionId: 'session-1' })
}

describe('agentFileSnapshot', () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, '.gitignore'), 'ignored.txt\n', 'utf8')
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('captures and restores modified, added, and deleted project files', async () => {
    await writeFile(join(projectRoot, 'modified.txt'), 'before\n', 'utf8')
    await writeFile(join(projectRoot, 'deleted.txt'), 'restore me\n', 'utf8')
    await writeFile(join(projectRoot, 'ignored.txt'), 'secret before\n', 'utf8')
    createManifest('run-1')

    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'run-1',
      projectRoot
    })
    expect(handle).toBeDefined()

    await writeFile(join(projectRoot, 'modified.txt'), 'after\n', 'utf8')
    await writeFile(join(projectRoot, 'added.txt'), 'new file\n', 'utf8')
    await rm(join(projectRoot, 'deleted.txt'))
    await writeFile(join(projectRoot, 'ignored.txt'), 'secret after\n', 'utf8')

    const snapshot = await handle?.finish()
    expect(snapshot?.files).toEqual([
      { path: 'added.txt', kind: 'added' },
      { path: 'deleted.txt', kind: 'deleted' },
      { path: 'modified.txt', kind: 'modified' }
    ])
    expect(loadRunManifest('session-1', 'run-1')?.fileSnapshot?.files).toEqual(snapshot?.files)

    const preview = await previewAgentFileRevert('session-1', 'run-1')
    expect(preview).toMatchObject({
      available: true,
      conflicts: [],
      alreadyReverted: false
    })
    expect(preview.diff).toContain('before')

    const result = await revertAgentFileChanges({ sessionId: 'session-1', runId: 'run-1' })
    expect(result).toMatchObject({ ok: true, conflicts: [] })
    expect(await readFile(join(projectRoot, 'modified.txt'), 'utf8')).toBe('before\n')
    expect(await readFile(join(projectRoot, 'deleted.txt'), 'utf8')).toBe('restore me\n')
    expect(existsSync(join(projectRoot, 'added.txt'))).toBe(false)
    expect(await readFile(join(projectRoot, 'ignored.txt'), 'utf8')).toBe('secret after\n')
    await expect(previewAgentFileRevert('session-1', 'run-1')).resolves.toMatchObject({
      alreadyReverted: true
    })
  }, 20_000)

  it('blocks later edits unless the user explicitly forces the restore', async () => {
    await writeFile(join(projectRoot, 'file.txt'), 'before\n', 'utf8')
    createManifest('run-conflict')
    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'run-conflict',
      projectRoot
    })
    await writeFile(join(projectRoot, 'file.txt'), 'agent change\n', 'utf8')
    await handle?.finish()
    await writeFile(join(projectRoot, 'file.txt'), 'later user change\n', 'utf8')

    const preview = await previewAgentFileRevert('session-1', 'run-conflict')
    expect(preview.conflicts).toEqual(['file.txt'])
    await expect(
      revertAgentFileChanges({ sessionId: 'session-1', runId: 'run-conflict' })
    ).resolves.toMatchObject({ ok: false, conflicts: ['file.txt'] })
    expect(await readFile(join(projectRoot, 'file.txt'), 'utf8')).toBe('later user change\n')

    await expect(
      revertAgentFileChanges({
        sessionId: 'session-1',
        runId: 'run-conflict',
        force: true
      })
    ).resolves.toMatchObject({ ok: true, conflicts: ['file.txt'] })
    expect(await readFile(join(projectRoot, 'file.txt'), 'utf8')).toBe('before\n')
  }, 20_000)
})
