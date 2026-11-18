import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applySessionFileTransition,
  beginAgentFileSnapshot,
  previewAgentFileRevert,
  previewSessionFileTransition,
  revertAgentFileChanges,
  runAgentFileSnapshotMaintenance
} from './agentFileSnapshot'
import { createRunManifest, loadRunManifest } from './runManifest'

let testRoot: string
let projectRoot: string

vi.mock('electron', () => ({
  app: {
    getPath: () => testRoot
  }
}))

const createManifest = (runId: string): void => {
  createRunManifest({ runId, sessionId: 'session-1' })
}

const getSnapshotRepository = async (): Promise<string> => {
  const repositoriesRoot = join(testRoot, 'agent_file_snapshots', 'repositories')
  const [repositoryName] = await readdir(repositoriesRoot)
  return join(repositoriesRoot, repositoryName)
}

const listSnapshotRefs = (repositoryDir: string): string[] =>
  execFileSync(
    'git',
    [`--git-dir=${repositoryDir}`, 'for-each-ref', '--format=%(refname)', 'refs/quickai'],
    { encoding: 'utf8', windowsHide: true }
  )
    .split(/\r?\n/)
    .filter(Boolean)

describe('agentFileSnapshot', () => {
  beforeEach(async () => {
    // Leave room for the repository hash and Git's internal paths on Windows.
    testRoot = await mkdtemp(join(tmpdir(), 'qa-snap-'))
    projectRoot = join(testRoot, 'project')
    await mkdir(projectRoot)
    await writeFile(join(projectRoot, '.gitignore'), 'ignored.txt\n', 'utf8')
  })

  afterEach(async () => {
    if (testRoot) await rm(testRoot, { recursive: true, force: true })
  })

  it('captures and restores modified, added, and deleted project files', async () => {
    await writeFile(join(projectRoot, 'modified.txt'), 'before\n', 'utf8')
    await writeFile(join(projectRoot, 'deleted.txt'), 'restore me\n', 'utf8')
    await writeFile(join(projectRoot, 'ignored.txt'), 'secret before\n', 'utf8')
    createManifest('run-1')

    const onTiming = vi.fn()
    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'run-1',
      projectRoot,
      onTiming
    })
    expect(handle).toBeDefined()
    expect(onTiming.mock.calls.map(([phase]) => phase)).toEqual([
      'snapshot_queue',
      'snapshot_capture'
    ])
    expect(onTiming.mock.calls.every(([, elapsed]) => elapsed >= 0)).toBe(true)

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

  it('can finalize from the latest tool checkpoint without rescanning the worktree', async () => {
    createManifest('checkpoint-run')
    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'checkpoint-run',
      projectRoot
    })
    expect(handle).toBeDefined()

    await writeFile(join(projectRoot, 'tool-change.txt'), 'captured after tool execution\n', 'utf8')
    await expect(handle?.checkpoint()).resolves.toBe(true)

    // Simulate unrelated work arriving after the last Agent side-effect boundary. A terminal
    // text-only turn must reuse the checkpoint instead of attributing this later edit to the run.
    await writeFile(join(projectRoot, 'later-change.txt'), 'must not be captured\n', 'utf8')
    const snapshot = await handle?.finish({ captureLatest: false })

    expect(snapshot?.files).toEqual([{ path: 'tool-change.txt', kind: 'added' }])
    expect(loadRunManifest('session-1', 'checkpoint-run')?.fileSnapshot?.files).toEqual(
      snapshot?.files
    )
  }, 20_000)

  it('reuses a source Git index while keeping snapshot changes isolated', async () => {
    const sourceProjectRoot = join(testRoot, 'source-git-project')
    await mkdir(sourceProjectRoot, { recursive: true })
    execFileSync('git', ['init', '--quiet'], { cwd: sourceProjectRoot, windowsHide: true })
    await writeFile(join(sourceProjectRoot, 'tracked.txt'), 'source state\n', 'utf8')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: sourceProjectRoot, windowsHide: true })
    createManifest('source-index-run')

    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'source-index-run',
      projectRoot: sourceProjectRoot
    })
    expect(handle).toBeDefined()

    await writeFile(join(sourceProjectRoot, 'tracked.txt'), 'Agent state\n', 'utf8')
    await writeFile(join(sourceProjectRoot, 'created.txt'), 'created\n', 'utf8')
    await expect(handle?.checkpoint()).resolves.toBe(true)
    await expect(handle?.finish({ captureLatest: false })).resolves.toMatchObject({
      files: [
        { path: 'created.txt', kind: 'added' },
        { path: 'tracked.txt', kind: 'modified' }
      ]
    })

    const repositoryDir = await getSnapshotRepository()
    expect(
      execFileSync('git', [`--git-dir=${repositoryDir}`, 'config', '--get', 'index.version'], {
        encoding: 'utf8',
        windowsHide: true
      }).trim()
    ).toBe('4')
  }, 20_000)

  it('captures and reverts files in the global workspace without a project root', async () => {
    const workspaceRoot = join(testRoot, 'workspace')
    const originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_WORKSPACE_ROOT = workspaceRoot

    try {
      await mkdir(workspaceRoot, { recursive: true })
      createManifest('workspace-run')

      const handle = await beginAgentFileSnapshot({
        sessionId: 'session-1',
        runId: 'workspace-run'
      })
      expect(handle).toBeDefined()

      const createdFile = join(workspaceRoot, 'created.ts')
      await writeFile(createdFile, 'export const value = 1\n', 'utf8')
      const snapshot = await handle?.finish()

      expect(snapshot).toMatchObject({
        projectRoot: await realpath(workspaceRoot),
        files: [{ path: 'created.ts', kind: 'added' }]
      })

      const result = await revertAgentFileChanges({
        sessionId: 'session-1',
        runId: 'workspace-run'
      })
      expect(result).toMatchObject({ ok: true, restoredFiles: ['created.ts'] })
      expect(existsSync(createdFile)).toBe(false)
    } finally {
      if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
      else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot
    }
  }, 20_000)

  it('reinitializes an incomplete snapshot repository instead of disabling snapshots', async () => {
    createManifest('initial-run')
    const initialHandle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'initial-run',
      projectRoot
    })
    await initialHandle?.finish()

    const repositoriesRoot = join(testRoot, 'agent_file_snapshots', 'repositories')
    const [repositoryName] = await readdir(repositoriesRoot)
    await rm(join(repositoriesRoot, repositoryName, 'objects'), { recursive: true, force: true })

    createManifest('recovered-run')
    const recoveredHandle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'recovered-run',
      projectRoot
    })
    expect(recoveredHandle).toBeDefined()

    await writeFile(join(projectRoot, 'after-recovery.txt'), 'recovered\n', 'utf8')
    await expect(recoveredHandle?.finish()).resolves.toMatchObject({
      files: [{ path: 'after-recovery.txt', kind: 'added' }]
    })
  }, 20_000)

  it('does not snapshot newly generated files larger than the safety limit', async () => {
    createManifest('large-file-run')
    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'large-file-run',
      projectRoot
    })

    const largeFile = join(projectRoot, 'generated.bin')
    await writeFile(largeFile, Buffer.alloc(2 * 1024 * 1024 + 1, 1))
    await expect(handle?.finish()).resolves.toMatchObject({ files: [] })
    expect(existsSync(largeFile)).toBe(true)
  }, 20_000)

  it('protects live run trees and removes stale managed refs during maintenance', async () => {
    createManifest('maintained-run')
    const handle = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'maintained-run',
      projectRoot
    })
    await writeFile(join(projectRoot, 'maintained.txt'), 'kept\n', 'utf8')
    const snapshot = await handle?.finish()
    expect(snapshot).toBeDefined()

    const repositoryDir = await getSnapshotRepository()
    execFileSync(
      'git',
      [
        `--git-dir=${repositoryDir}`,
        'update-ref',
        'refs/quickai/runs/orphan/end',
        snapshot!.endTree
      ],
      { windowsHide: true }
    )
    execFileSync(
      'git',
      [
        `--git-dir=${repositoryDir}`,
        'update-ref',
        'refs/quickai/pending/1-orphan',
        snapshot!.startTree
      ],
      { windowsHide: true }
    )

    const result = await runAgentFileSnapshotMaintenance({
      restorePoints: [],
      now: Date.now(),
      pruneAge: '30.days.ago'
    })
    expect(result).toMatchObject({
      repositories: 1,
      protectedRefs: 2,
      deletedRefs: 2,
      expiredPendingRefs: 1,
      errors: 0
    })
    const refs = listSnapshotRefs(repositoryDir)
    expect(refs.filter((ref) => ref.includes('/runs/'))).toHaveLength(2)
    expect(refs).not.toContain('refs/quickai/runs/orphan/end')
    expect(refs).not.toContain('refs/quickai/pending/1-orphan')

    // Repair a missing protection ref while leaving the other, already-correct ref intact.
    const startRef = refs.find((ref) => ref.endsWith('/start'))!
    execFileSync('git', [`--git-dir=${repositoryDir}`, 'update-ref', '-d', startRef], {
      windowsHide: true
    })
    const repaired = await runAgentFileSnapshotMaintenance({ restorePoints: [] })
    expect(repaired).toMatchObject({ protectedRefs: 2, deletedRefs: 0, errors: 0 })
    expect(listSnapshotRefs(repositoryDir).sort()).toEqual(refs.sort())
    expect(
      execFileSync('git', [`--git-dir=${repositoryDir}`, 'rev-parse', startRef], {
        encoding: 'utf8',
        windowsHide: true
      }).trim()
    ).toBe(snapshot!.startTree)
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

  it('reverts and restores several Agent runs as one session transaction', async () => {
    await writeFile(join(projectRoot, 'file.txt'), 'before\n', 'utf8')

    createManifest('run-a')
    const first = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'run-a',
      projectRoot
    })
    await writeFile(join(projectRoot, 'file.txt'), 'after a\n', 'utf8')
    await writeFile(join(projectRoot, 'a.txt'), 'a\n', 'utf8')
    await first?.finish()

    createManifest('run-b')
    const second = await beginAgentFileSnapshot({
      sessionId: 'session-1',
      runId: 'run-b',
      projectRoot
    })
    await writeFile(join(projectRoot, 'file.txt'), 'after b\n', 'utf8')
    await writeFile(join(projectRoot, 'b.txt'), 'b\n', 'utf8')
    await second?.finish()
    await writeFile(join(projectRoot, 'file.txt'), 'user state before rollback\n', 'utf8')

    const revertPreview = await previewSessionFileTransition({
      sessionId: 'session-1',
      runIds: ['run-a', 'run-b'],
      direction: 'revert'
    })
    expect(revertPreview).toMatchObject({
      available: true,
      conflicts: ['file.txt'],
      alreadyApplied: false
    })
    expect(revertPreview.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt', 'file.txt'])

    await expect(
      applySessionFileTransition({
        sessionId: 'session-1',
        runIds: ['run-a', 'run-b'],
        direction: 'revert'
      })
    ).resolves.toMatchObject({ ok: false, conflicts: ['file.txt'] })
    expect(
      listSnapshotRefs(await getSnapshotRepository()).filter((ref) => ref.includes('/restores/'))
    ).toHaveLength(0)
    const revertResult = await applySessionFileTransition({
      sessionId: 'session-1',
      runIds: ['run-a', 'run-b'],
      direction: 'revert',
      force: true
    })
    expect(revertResult).toMatchObject({ ok: true, conflicts: ['file.txt'] })
    expect(revertResult.restorePoint).toBeDefined()
    expect(
      listSnapshotRefs(await getSnapshotRepository()).filter((ref) => ref.includes('/restores/'))
    ).toHaveLength(1)
    expect(await readFile(join(projectRoot, 'file.txt'), 'utf8')).toBe('before\n')
    expect(existsSync(join(projectRoot, 'a.txt'))).toBe(false)
    expect(existsSync(join(projectRoot, 'b.txt'))).toBe(false)

    await writeFile(join(projectRoot, 'file.txt'), 'user edit after rollback\n', 'utf8')

    const restorePreview = await previewSessionFileTransition({
      sessionId: 'session-1',
      runIds: ['run-a', 'run-b'],
      direction: 'restore',
      restorePoint: revertResult.restorePoint
    })
    expect(restorePreview).toMatchObject({ conflicts: ['file.txt'], alreadyApplied: false })
    await expect(
      applySessionFileTransition({
        sessionId: 'session-1',
        runIds: ['run-a', 'run-b'],
        direction: 'restore',
        restorePoint: revertResult.restorePoint
      })
    ).resolves.toMatchObject({ ok: false, conflicts: ['file.txt'] })
    expect(await readFile(join(projectRoot, 'file.txt'), 'utf8')).toBe('user edit after rollback\n')
    await expect(
      applySessionFileTransition({
        sessionId: 'session-1',
        runIds: ['run-a', 'run-b'],
        direction: 'restore',
        restorePoint: revertResult.restorePoint,
        force: true
      })
    ).resolves.toMatchObject({ ok: true, conflicts: ['file.txt'] })
    expect(
      listSnapshotRefs(await getSnapshotRepository()).filter((ref) => ref.includes('/restores/'))
    ).toHaveLength(0)
    expect(await readFile(join(projectRoot, 'file.txt'), 'utf8')).toBe(
      'user state before rollback\n'
    )
    expect(await readFile(join(projectRoot, 'a.txt'), 'utf8')).toBe('a\n')
    expect(await readFile(join(projectRoot, 'b.txt'), 'utf8')).toBe('b\n')
    expect(loadRunManifest('session-1', 'run-a')?.fileSnapshot?.revertedAt).toBeUndefined()
  }, 20_000)
})
