import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { app } from 'electron'
import { lstat, mkdir, readdir, realpath, rm, rmdir, stat, unlink } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type {
  AgentFileChange,
  AgentFileChangeKind,
  AgentFileRevertPreview,
  RevertAgentFileChangesInput,
  RevertAgentFileChangesResult,
  SessionFileTransitionDirection,
  SessionFileTransitionInput,
  SessionFileTransitionPreview,
  SessionFileTransitionResult
} from '../../shared/types'
import { getWorkspaceRoot } from '../paths'
import { listSessionFileRestorePoints } from '../database/sessionStore'
import {
  listRunManifests,
  loadRunManifest,
  updateRunManifest,
  type AgentRunManifest
} from './runManifest'

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_PREVIEW_CHARS = 200_000
const CHECKOUT_BATCH_SIZE = 100
const MAX_SNAPSHOT_FILE_BYTES = 2 * 1024 * 1024
const SNAPSHOT_REF_ROOT = 'refs/quickai'
const SNAPSHOT_PRUNE_AGE = '7.days.ago'
const PENDING_REF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface SnapshotLocation {
  projectRoot: string
  repositoryDir: string
}

interface TreeEntry {
  mode: string
  object: string
}

export interface CompletedAgentFileSnapshot {
  projectRoot: string
  startTree: string
  endTree: string
  files: AgentFileChange[]
  completedAt: number
}

export interface AgentFileSnapshotHandle {
  finish: () => Promise<CompletedAgentFileSnapshot | undefined>
}

let snapshotQueue: Promise<void> = Promise.resolve()

const serializeSnapshotOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  const result = snapshotQueue.then(operation, operation)
  snapshotQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

const runGit = (args: string[], cwd?: string, stdin?: string): Promise<string> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(String(stderr || error.message).trim()))
          return
        }
        resolvePromise(stdout)
      }
    )
    if (stdin !== undefined) child.stdin?.end(stdin)
  })

const normalizeProjectRoot = async (projectRoot: string): Promise<string> => {
  const normalized = await realpath(resolve(projectRoot))
  const info = await stat(normalized)
  if (!info.isDirectory()) throw new Error('Project root is not a directory')
  return normalized
}

const getRepositoryDir = (projectRoot: string): string => {
  const identity = process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot
  const key = createHash('sha256').update(identity).digest('hex')
  return join(app.getPath('userData'), 'agent_file_snapshots', 'repositories', `${key}.git`)
}

const getRepositoriesRoot = (): string =>
  join(app.getPath('userData'), 'agent_file_snapshots', 'repositories')

const snapshotRefHash = (...values: string[]): string =>
  createHash('sha256').update(values.join('\0')).digest('hex').slice(0, 16)

const getRunSnapshotRefBase = (sessionId: string, runId: string): string =>
  `${SNAPSHOT_REF_ROOT}/runs/${snapshotRefHash(sessionId, runId)}`

const getSessionRestoreRef = (sessionId: string): string =>
  `${SNAPSHOT_REF_ROOT}/restores/${snapshotRefHash(sessionId)}`

const setSnapshotRef = async (
  location: Pick<SnapshotLocation, 'repositoryDir'>,
  ref: string,
  tree: string
): Promise<void> => {
  if (!/^[a-f0-9]{40,64}$/i.test(tree)) throw new Error(`Invalid snapshot tree: ${tree}`)
  await runGit([`--git-dir=${location.repositoryDir}`, 'update-ref', ref, tree])
}

const deleteSnapshotRef = async (
  location: Pick<SnapshotLocation, 'repositoryDir'>,
  ref: string
): Promise<void> => {
  try {
    await runGit([`--git-dir=${location.repositoryDir}`, 'update-ref', '-d', ref])
  } catch {
    // Missing refs are already released.
  }
}

const gitContextArgs = (location: SnapshotLocation): string[] => [
  `--git-dir=${location.repositoryDir}`,
  `--work-tree=${location.projectRoot}`,
  '-c',
  'core.bare=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.safecrlf=false'
]

const ensureSnapshotRepository = async (location: SnapshotLocation): Promise<void> => {
  let repositoryValid = false
  try {
    const head = await stat(join(location.repositoryDir, 'HEAD'))
    if (head.isFile()) {
      repositoryValid =
        (
          await runGit([`--git-dir=${location.repositoryDir}`, 'rev-parse', '--is-bare-repository'])
        ).trim() === 'true'
    }
  } catch {
    // Initialize below.
  }
  if (repositoryValid) return

  await rm(location.repositoryDir, { recursive: true, force: true })
  await mkdir(dirname(location.repositoryDir), { recursive: true })
  await runGit(['init', '--bare', location.repositoryDir])
  await runGit([`--git-dir=${location.repositoryDir}`, 'config', 'core.autocrlf', 'false'])
  await runGit([`--git-dir=${location.repositoryDir}`, 'config', 'core.filemode', 'false'])
}

const snapshotScopePathspecs = [
  '.',
  ':(exclude).git',
  ':(exclude).git/**',
  ':(exclude,glob)**/.git/**'
]

const listSnapshotCandidates = async (location: SnapshotLocation): Promise<string[]> => {
  const output = await runGit([
    ...gitContextArgs(location),
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--no-renames',
    '-z',
    '--',
    ...snapshotScopePathspecs
  ])
  return Array.from(
    new Set(
      output
        .split('\0')
        .filter((record) => record.length > 3)
        .map((record) => record.slice(3))
    )
  )
}

const filterSnapshotCandidates = async (
  location: SnapshotLocation,
  candidates: string[]
): Promise<string[]> => {
  const allowed: string[] = []
  const batchSize = 64
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize)
    const decisions = await Promise.all(
      batch.map(async (path) => {
        try {
          const info = await lstat(join(location.projectRoot, ...path.split('/')))
          return !info.isFile() || info.size <= MAX_SNAPSHOT_FILE_BYTES
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === 'ENOENT'
        }
      })
    )
    for (let index = 0; index < batch.length; index++) {
      if (decisions[index]) allowed.push(batch[index])
    }
  }
  return allowed
}

const stageSnapshotCandidates = async (
  location: SnapshotLocation,
  candidates: string[]
): Promise<void> => {
  if (candidates.length === 0) return
  const input = `${candidates.map((path) => `:(top,literal)${path}`).join('\0')}\0`
  await runGit(
    [...gitContextArgs(location), 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'],
    undefined,
    input
  )
}

const captureTreeUnlocked = async (
  projectRoot: string
): Promise<{
  location: SnapshotLocation
  tree: string
}> => {
  const normalizedRoot = await normalizeProjectRoot(projectRoot)
  const location = {
    projectRoot: normalizedRoot,
    repositoryDir: getRepositoryDir(normalizedRoot)
  }
  await ensureSnapshotRepository(location)
  const candidates = await listSnapshotCandidates(location)
  await stageSnapshotCandidates(location, await filterSnapshotCandidates(location, candidates))
  const tree = (await runGit([...gitContextArgs(location), 'write-tree'])).trim()
  if (!/^[a-f0-9]{40,64}$/i.test(tree)) throw new Error('Git did not return a valid tree id')
  return { location, tree }
}

const captureTree = (projectRoot: string): Promise<{ location: SnapshotLocation; tree: string }> =>
  serializeSnapshotOperation(() => captureTreeUnlocked(projectRoot))

const protectRunSnapshot = async (
  location: SnapshotLocation,
  sessionId: string,
  runId: string,
  snapshot: Pick<CompletedAgentFileSnapshot, 'startTree' | 'endTree'> & {
    restoredTree?: string
  }
): Promise<void> => {
  const base = getRunSnapshotRefBase(sessionId, runId)
  await setSnapshotRef(location, `${base}/start`, snapshot.startTree)
  await setSnapshotRef(location, `${base}/end`, snapshot.endTree)
  if (snapshot.restoredTree) {
    await setSnapshotRef(location, `${base}/restored`, snapshot.restoredTree)
  }
}

const protectSessionRestorePoint = async (
  location: SnapshotLocation,
  sessionId: string,
  tree: string
): Promise<void> => setSnapshotRef(location, getSessionRestoreRef(sessionId), tree)

const releaseSessionRestorePoint = async (
  location: SnapshotLocation,
  sessionId: string
): Promise<void> => deleteSnapshotRef(location, getSessionRestoreRef(sessionId))

const createPendingSnapshotRef = async (
  location: SnapshotLocation,
  sessionId: string,
  runId: string,
  tree: string
): Promise<string> => {
  const ref = `${SNAPSHOT_REF_ROOT}/pending/${Date.now()}-${snapshotRefHash(sessionId, runId)}`
  await setSnapshotRef(location, ref, tree)
  return ref
}

const loadTreeEntries = async (
  location: SnapshotLocation,
  tree: string
): Promise<Map<string, TreeEntry>> => {
  const output = await runGit([
    ...gitContextArgs(location),
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    tree
  ])
  const entries = new Map<string, TreeEntry>()
  for (const record of output.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    if (tab < 0) continue
    const metadata = record.slice(0, tab).split(/\s+/)
    const path = record.slice(tab + 1)
    if (metadata.length < 3 || !path) continue
    entries.set(path, { mode: metadata[0], object: metadata[2] })
  }
  return entries
}

const classifyChange = (status: string): AgentFileChangeKind => {
  if (status === 'A') return 'added'
  if (status === 'D') return 'deleted'
  return 'modified'
}

const listChanges = async (
  location: SnapshotLocation,
  startTree: string,
  endTree: string
): Promise<AgentFileChange[]> => {
  const output = await runGit([
    ...gitContextArgs(location),
    'diff',
    '--name-status',
    '--no-renames',
    '-z',
    startTree,
    endTree,
    '--'
  ])
  const fields = output.split('\0').filter(Boolean)
  const changes: AgentFileChange[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    changes.push({ path: fields[index + 1], kind: classifyChange(fields[index][0]) })
  }
  return changes
}

const sameEntry = (left: TreeEntry | undefined, right: TreeEntry | undefined): boolean =>
  left?.mode === right?.mode && left?.object === right?.object

const buildUnavailablePreview = (
  sessionId: string,
  runId: string,
  reason: string
): AgentFileRevertPreview => ({
  available: false,
  reason,
  sessionId,
  runId,
  files: [],
  conflicts: [],
  diff: '',
  alreadyReverted: false
})

const getPreviewUnlocked = async (
  sessionId: string,
  runId: string
): Promise<AgentFileRevertPreview> => {
  const manifest = loadRunManifest(sessionId, runId)
  const snapshot = manifest?.fileSnapshot
  if (!snapshot || snapshot.files.length === 0) {
    return buildUnavailablePreview(sessionId, runId, '该次运行没有可撤销的项目文件修改。')
  }

  const current = await captureTreeUnlocked(snapshot.projectRoot)
  const [startEntries, endEntries, currentEntries] = await Promise.all([
    loadTreeEntries(current.location, snapshot.startTree),
    loadTreeEntries(current.location, snapshot.endTree),
    loadTreeEntries(current.location, current.tree)
  ])
  const conflicts = snapshot.files
    .filter(({ path }) => {
      const currentEntry = currentEntries.get(path)
      return (
        !sameEntry(currentEntry, endEntries.get(path)) &&
        !sameEntry(currentEntry, startEntries.get(path))
      )
    })
    .map(({ path }) => path)
  const conflictSet = new Set(conflicts)
  const alreadyReverted = snapshot.files.every(({ path }) =>
    sameEntry(currentEntries.get(path), startEntries.get(path))
  )
  const rawDiff = await runGit([
    ...gitContextArgs(current.location),
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--no-renames',
    snapshot.endTree,
    snapshot.startTree,
    '--'
  ])
  const diff =
    rawDiff.length > MAX_PREVIEW_CHARS
      ? `${rawDiff.slice(0, MAX_PREVIEW_CHARS)}\n\n[Diff preview truncated]`
      : rawDiff

  return {
    available: true,
    sessionId,
    runId,
    projectRoot: snapshot.projectRoot,
    files: snapshot.files.map((file) => ({ ...file, conflict: conflictSet.has(file.path) })),
    conflicts,
    diff,
    alreadyReverted,
    revertedAt: snapshot.revertedAt
  }
}

export const previewAgentFileRevert = async (
  sessionId: string,
  runId: string
): Promise<AgentFileRevertPreview> => {
  const normalizedSessionId = String(sessionId || '').trim()
  const normalizedRunId = String(runId || '').trim()
  if (!normalizedSessionId || !normalizedRunId) {
    return buildUnavailablePreview(normalizedSessionId, normalizedRunId, '会话或运行标识无效。')
  }
  try {
    return await serializeSnapshotOperation(() =>
      getPreviewUnlocked(normalizedSessionId, normalizedRunId)
    )
  } catch (error) {
    return buildUnavailablePreview(
      normalizedSessionId,
      normalizedRunId,
      `无法读取文件快照：${(error as Error).message}`
    )
  }
}

const safeProjectPath = (projectRoot: string, gitPath: string): string => {
  const target = resolve(projectRoot, ...gitPath.split('/'))
  const child = relative(projectRoot, target)
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error(`Snapshot path escapes the project: ${gitPath}`)
  }
  return target
}

const removeEmptyParents = async (projectRoot: string, filePath: string): Promise<void> => {
  let current = dirname(filePath)
  while (current !== projectRoot) {
    const child = relative(projectRoot, current)
    if (!child || child.startsWith('..') || isAbsolute(child)) return
    try {
      await rmdir(current)
    } catch {
      return
    }
    current = dirname(current)
  }
}

const applyTreeToPaths = async (
  location: SnapshotLocation,
  tree: string,
  paths: string[]
): Promise<void> => {
  const entries = await loadTreeEntries(location, tree)
  const checkoutPaths = paths.filter((path) => entries.has(path))
  const deletePaths = paths.filter((path) => !entries.has(path))

  for (let offset = 0; offset < checkoutPaths.length; offset += CHECKOUT_BATCH_SIZE) {
    const batch = checkoutPaths.slice(offset, offset + CHECKOUT_BATCH_SIZE)
    await runGit([...gitContextArgs(location), 'checkout', tree, '--', ...batch])
  }

  for (const path of deletePaths) {
    const target = safeProjectPath(location.projectRoot, path)
    try {
      const info = await lstat(target)
      if (info.isDirectory() && !info.isSymbolicLink()) {
        throw new Error(`Refusing to remove a directory while restoring file path: ${path}`)
      }
      await unlink(target)
      await removeEmptyParents(location.projectRoot, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
}

export const revertAgentFileChanges = async (
  input: RevertAgentFileChangesInput
): Promise<RevertAgentFileChangesResult> => {
  const sessionId = String(input.sessionId || '').trim()
  const runId = String(input.runId || '').trim()
  if (!sessionId || !runId) {
    return { ok: false, restoredFiles: [], conflicts: [], error: '会话或运行标识无效。' }
  }

  return serializeSnapshotOperation(async () => {
    try {
      const manifest = loadRunManifest(sessionId, runId)
      const snapshot = manifest?.fileSnapshot
      if (!snapshot || snapshot.files.length === 0) {
        return {
          ok: false,
          restoredFiles: [],
          conflicts: [],
          error: '该次运行没有可撤销的项目文件修改。'
        }
      }

      const preview = await getPreviewUnlocked(sessionId, runId)
      if (preview.alreadyReverted) {
        return {
          ok: true,
          restoredFiles: [],
          conflicts: [],
          alreadyReverted: true,
          revertedAt: snapshot.revertedAt
        }
      }
      if (preview.conflicts.length > 0 && input.force !== true) {
        return {
          ok: false,
          restoredFiles: [],
          conflicts: preview.conflicts,
          error: '部分文件在 Agent 运行后又被修改，请确认是否强制覆盖。'
        }
      }

      const current = await captureTreeUnlocked(snapshot.projectRoot)
      const paths = snapshot.files.map(({ path }) => path)
      try {
        await applyTreeToPaths(current.location, snapshot.startTree, paths)
      } catch (error) {
        try {
          await applyTreeToPaths(current.location, current.tree, paths)
        } catch (rollbackError) {
          console.warn('Failed to roll back an incomplete file restore:', rollbackError)
        }
        throw error
      }

      const restored = await captureTreeUnlocked(snapshot.projectRoot)
      const revertedAt = Date.now()
      updateRunManifest(sessionId, runId, (currentManifest) => ({
        ...currentManifest,
        fileSnapshot: currentManifest.fileSnapshot
          ? {
              ...currentManifest.fileSnapshot,
              revertedAt,
              restoredTree: restored.tree
            }
          : undefined
      }))
      return {
        ok: true,
        restoredFiles: paths,
        conflicts: preview.conflicts,
        revertedAt
      }
    } catch (error) {
      return {
        ok: false,
        restoredFiles: [],
        conflicts: [],
        error: `撤销文件修改失败：${(error as Error).message}`
      }
    }
  })
}

interface SessionTransitionPathPlan {
  path: string
  firstTree: string
  lastTree: string
  knownTrees: Set<string>
}

interface SessionFileTransitionContext {
  preview: SessionFileTransitionPreview
  location?: SnapshotLocation
  currentTree?: string
  targetGroups: Map<string, string[]>
  paths: string[]
}

const normalizeRunIds = (runIds: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(runIds) ? runIds : [])
        .filter((runId): runId is string => typeof runId === 'string')
        .map((runId) => runId.trim())
        .filter(Boolean)
    )
  )

const buildUnavailableSessionTransition = (
  sessionId: string,
  runIds: string[],
  direction: SessionFileTransitionDirection,
  reason: string
): SessionFileTransitionPreview => ({
  available: false,
  reason,
  sessionId,
  runIds,
  direction,
  files: [],
  conflicts: [],
  diff: '',
  alreadyApplied: false
})

const buildSessionFileTransitionUnlocked = async (
  sessionId: string,
  runIds: string[],
  direction: SessionFileTransitionDirection,
  restorePoint?: SessionFileTransitionInput['restorePoint']
): Promise<SessionFileTransitionContext> => {
  const snapshots = runIds
    .map((runId) => ({ runId, snapshot: loadRunManifest(sessionId, runId)?.fileSnapshot }))
    .filter(
      (
        entry
      ): entry is {
        runId: string
        snapshot: NonNullable<AgentRunManifest['fileSnapshot']>
      } => !!entry.snapshot && entry.snapshot.files.length > 0
    )

  if (snapshots.length === 0) {
    return {
      preview: {
        available: true,
        sessionId,
        runIds,
        direction,
        files: [],
        conflicts: [],
        diff: '',
        alreadyApplied: true
      },
      targetGroups: new Map(),
      paths: []
    }
  }

  const roots = new Map<string, string>()
  for (const { snapshot } of snapshots) {
    const identity =
      process.platform === 'win32' ? snapshot.projectRoot.toLowerCase() : snapshot.projectRoot
    roots.set(identity, snapshot.projectRoot)
  }
  if (roots.size !== 1) {
    return {
      preview: buildUnavailableSessionTransition(
        sessionId,
        runIds,
        direction,
        '该段会话涉及多个项目目录，暂时无法作为一个事务回退。'
      ),
      targetGroups: new Map(),
      paths: []
    }
  }

  const projectRoot = Array.from(roots.values())[0]
  if (direction === 'restore' && restorePoint) {
    const left = process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot
    const right =
      process.platform === 'win32'
        ? restorePoint.projectRoot.toLowerCase()
        : restorePoint.projectRoot
    if (left !== right || !/^[a-f0-9]{40,64}$/i.test(restorePoint.tree)) {
      return {
        preview: buildUnavailableSessionTransition(
          sessionId,
          runIds,
          direction,
          '会话文件恢复点无效或不属于当前项目。'
        ),
        targetGroups: new Map(),
        paths: []
      }
    }
  }
  const current = await captureTreeUnlocked(projectRoot)
  const pathPlans = new Map<string, SessionTransitionPathPlan>()
  for (const { snapshot } of snapshots) {
    for (const file of snapshot.files) {
      const existing = pathPlans.get(file.path)
      if (existing) {
        existing.lastTree = snapshot.endTree
        existing.knownTrees.add(snapshot.startTree)
        existing.knownTrees.add(snapshot.endTree)
      } else {
        pathPlans.set(file.path, {
          path: file.path,
          firstTree: snapshot.startTree,
          lastTree: snapshot.endTree,
          knownTrees: new Set([snapshot.startTree, snapshot.endTree])
        })
      }
    }
  }

  const treeIds = new Set<string>([current.tree])
  if (direction === 'restore' && restorePoint) treeIds.add(restorePoint.tree)
  for (const plan of pathPlans.values()) {
    for (const tree of plan.knownTrees) treeIds.add(tree)
  }
  const treeEntryPairs = await Promise.all(
    Array.from(treeIds).map(
      async (tree) => [tree, await loadTreeEntries(current.location, tree)] as const
    )
  )
  const entriesByTree = new Map(treeEntryPairs)
  const currentEntries = entriesByTree.get(current.tree) || new Map<string, TreeEntry>()
  const targetGroups = new Map<string, string[]>()
  const conflicts: string[] = []
  const files: SessionFileTransitionPreview['files'] = []

  for (const plan of Array.from(pathPlans.values()).sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    const targetTree = direction === 'revert' ? plan.firstTree : restorePoint?.tree || plan.lastTree
    const targetEntry = entriesByTree.get(targetTree)?.get(plan.path)
    const currentEntry = currentEntries.get(plan.path)
    const startEntry = entriesByTree.get(plan.firstTree)?.get(plan.path)
    const endEntry = entriesByTree.get(plan.lastTree)?.get(plan.path)
    if (sameEntry(startEntry, endEntry)) continue
    const knownTrees =
      direction === 'restore' && restorePoint
        ? new Set([...plan.knownTrees, restorePoint.tree])
        : plan.knownTrees
    const conflict = !Array.from(knownTrees).some((tree) =>
      sameEntry(currentEntry, entriesByTree.get(tree)?.get(plan.path))
    )
    if (conflict) conflicts.push(plan.path)
    const kind: AgentFileChangeKind =
      !startEntry && endEntry ? 'added' : startEntry && !endEntry ? 'deleted' : 'modified'
    files.push({ path: plan.path, kind, conflict })
    if (!sameEntry(currentEntry, targetEntry)) {
      const paths = targetGroups.get(targetTree)
      if (paths) paths.push(plan.path)
      else targetGroups.set(targetTree, [plan.path])
    }
  }

  const diffParts: string[] = []
  let diffChars = 0
  for (const [targetTree, paths] of targetGroups) {
    for (
      let offset = 0;
      offset < paths.length && diffChars <= MAX_PREVIEW_CHARS;
      offset += CHECKOUT_BATCH_SIZE
    ) {
      const batch = paths.slice(offset, offset + CHECKOUT_BATCH_SIZE)
      const part = await runGit([
        ...gitContextArgs(current.location),
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--no-renames',
        current.tree,
        targetTree,
        '--',
        ...batch
      ])
      diffParts.push(part)
      diffChars += part.length
    }
  }
  const rawDiff = diffParts.join('')
  const diff =
    rawDiff.length > MAX_PREVIEW_CHARS
      ? `${rawDiff.slice(0, MAX_PREVIEW_CHARS)}\n\n[Diff preview truncated]`
      : rawDiff

  return {
    preview: {
      available: true,
      sessionId,
      runIds,
      direction,
      projectRoot: current.location.projectRoot,
      files,
      conflicts,
      diff,
      alreadyApplied: targetGroups.size === 0
    },
    location: current.location,
    currentTree: current.tree,
    targetGroups,
    paths: files.map((file) => file.path)
  }
}

export const previewSessionFileTransition = async (
  input: SessionFileTransitionInput
): Promise<SessionFileTransitionPreview> => {
  const sessionId = String(input.sessionId || '').trim()
  const runIds = normalizeRunIds(input.runIds)
  const direction = input.direction
  if (!sessionId || (direction !== 'revert' && direction !== 'restore')) {
    return buildUnavailableSessionTransition(
      sessionId,
      runIds,
      direction === 'restore' ? 'restore' : 'revert',
      '会话或文件转换方向无效。'
    )
  }
  try {
    const context = await serializeSnapshotOperation(() =>
      buildSessionFileTransitionUnlocked(sessionId, runIds, direction, input.restorePoint)
    )
    return context.preview
  } catch (error) {
    return buildUnavailableSessionTransition(
      sessionId,
      runIds,
      direction,
      `无法读取会话文件快照：${(error as Error).message}`
    )
  }
}

export const applySessionFileTransition = async (
  input: SessionFileTransitionInput
): Promise<SessionFileTransitionResult> => {
  const sessionId = String(input.sessionId || '').trim()
  const runIds = normalizeRunIds(input.runIds)
  const direction = input.direction
  if (!sessionId || (direction !== 'revert' && direction !== 'restore')) {
    return { ok: false, changedFiles: [], conflicts: [], error: '会话或文件转换方向无效。' }
  }

  return serializeSnapshotOperation(async () => {
    try {
      const context = await buildSessionFileTransitionUnlocked(
        sessionId,
        runIds,
        direction,
        input.restorePoint
      )
      const { preview } = context
      if (!preview.available) {
        return { ok: false, changedFiles: [], conflicts: [], error: preview.reason }
      }
      const restorePoint =
        direction === 'revert' && context.location && context.currentTree
          ? {
              projectRoot: context.location.projectRoot,
              tree: context.currentTree,
              paths: context.paths
            }
          : undefined
      const persistTransitionState = (tree: string | undefined, appliedAt: number): void => {
        for (const runId of runIds) {
          updateRunManifest(sessionId, runId, (manifest) => ({
            ...manifest,
            fileSnapshot: manifest.fileSnapshot
              ? {
                  ...manifest.fileSnapshot,
                  revertedAt: direction === 'revert' ? appliedAt : undefined,
                  restoredTree: direction === 'revert' ? tree : undefined
                }
              : undefined
          }))
        }
      }
      if (preview.conflicts.length > 0 && input.force !== true) {
        return {
          ok: false,
          changedFiles: [],
          conflicts: preview.conflicts,
          error: '部分文件在目标会话之后又被修改，请确认是否覆盖这些后续修改。'
        }
      }
      if (direction === 'revert' && context.location && context.currentTree) {
        await protectSessionRestorePoint(context.location, sessionId, context.currentTree)
      }
      if (preview.alreadyApplied) {
        const appliedAt = Date.now()
        persistTransitionState(context.currentTree, appliedAt)
        if (direction === 'restore' && context.location) {
          await releaseSessionRestorePoint(context.location, sessionId)
        }
        return {
          ok: true,
          changedFiles: [],
          conflicts: [],
          alreadyApplied: true,
          appliedAt,
          restorePoint
        }
      }
      if (!context.location || !context.currentTree) {
        return { ok: true, changedFiles: [], conflicts: [], alreadyApplied: true }
      }

      const changedFiles = Array.from(context.targetGroups.values()).flat()
      try {
        for (const [tree, paths] of context.targetGroups) {
          await applyTreeToPaths(context.location, tree, paths)
        }
      } catch (error) {
        try {
          await applyTreeToPaths(context.location, context.currentTree, changedFiles)
        } catch (rollbackError) {
          console.warn('Failed to roll back an incomplete session file transition:', rollbackError)
        }
        throw error
      }

      const applied = await captureTreeUnlocked(context.location.projectRoot)
      const appliedAt = Date.now()
      persistTransitionState(applied.tree, appliedAt)
      if (direction === 'restore') {
        await releaseSessionRestorePoint(context.location, sessionId)
      }
      return {
        ok: true,
        changedFiles,
        conflicts: preview.conflicts,
        appliedAt,
        restorePoint
      }
    } catch (error) {
      return {
        ok: false,
        changedFiles: [],
        conflicts: [],
        error: `会话文件${direction === 'revert' ? '回退' : '恢复'}失败：${(error as Error).message}`
      }
    }
  })
}

export interface AgentFileSnapshotMaintenanceResult {
  repositories: number
  protectedRefs: number
  deletedRefs: number
  expiredPendingRefs: number
  errors: number
}

export interface AgentFileSnapshotMaintenanceOptions {
  manifests?: AgentRunManifest[]
  restorePoints?: Array<{
    sessionId: string
    restorePoint: { projectRoot: string; tree: string }
  }>
  now?: number
  pruneAge?: string
}

const repositoryIdentity = (repositoryDir: string): string =>
  process.platform === 'win32' ? resolve(repositoryDir).toLowerCase() : resolve(repositoryDir)

const addDesiredSnapshotRef = (
  desired: Map<string, Map<string, string>>,
  repositoryDir: string,
  ref: string,
  tree: string
): void => {
  if (!/^[a-f0-9]{40,64}$/i.test(tree)) return
  const key = repositoryIdentity(repositoryDir)
  const refs = desired.get(key) || new Map<string, string>()
  refs.set(ref, tree)
  desired.set(key, refs)
}

const listManagedSnapshotRefs = async (repositoryDir: string): Promise<string[]> => {
  const output = await runGit([
    `--git-dir=${repositoryDir}`,
    'for-each-ref',
    '--format=%(refname)',
    SNAPSHOT_REF_ROOT
  ])
  return output.split(/\r?\n/).filter(Boolean)
}

const pendingRefCreatedAt = (ref: string): number | undefined => {
  const match = ref.match(/^refs\/quickai\/pending\/(\d+)-/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

export const runAgentFileSnapshotMaintenance = async (
  options: AgentFileSnapshotMaintenanceOptions = {}
): Promise<AgentFileSnapshotMaintenanceResult> =>
  serializeSnapshotOperation(async () => {
    const result: AgentFileSnapshotMaintenanceResult = {
      repositories: 0,
      protectedRefs: 0,
      deletedRefs: 0,
      expiredPendingRefs: 0,
      errors: 0
    }
    const manifests = options.manifests || (await listRunManifests())
    let restoreInventoryAvailable = true
    let restorePoints = options.restorePoints
    if (!restorePoints) {
      try {
        restorePoints = listSessionFileRestorePoints()
      } catch (error) {
        restoreInventoryAvailable = false
        restorePoints = []
        console.warn(
          'Snapshot maintenance could not read staged session restores:',
          (error as Error).message
        )
      }
    }

    const desired = new Map<string, Map<string, string>>()
    for (const manifest of manifests) {
      const snapshot = manifest.fileSnapshot
      if (!snapshot?.projectRoot || snapshot.files.length === 0) continue
      const repositoryDir = getRepositoryDir(snapshot.projectRoot)
      const base = getRunSnapshotRefBase(manifest.sessionId, manifest.runId)
      addDesiredSnapshotRef(desired, repositoryDir, `${base}/start`, snapshot.startTree)
      addDesiredSnapshotRef(desired, repositoryDir, `${base}/end`, snapshot.endTree)
      if (snapshot.restoredTree) {
        addDesiredSnapshotRef(desired, repositoryDir, `${base}/restored`, snapshot.restoredTree)
      }
    }
    for (const entry of restorePoints) {
      addDesiredSnapshotRef(
        desired,
        getRepositoryDir(entry.restorePoint.projectRoot),
        getSessionRestoreRef(entry.sessionId),
        entry.restorePoint.tree
      )
    }

    let repositories: import('fs').Dirent[]
    try {
      repositories = await readdir(getRepositoriesRoot(), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
      throw error
    }

    const now = options.now ?? Date.now()
    for (const repository of repositories) {
      if (!repository.isDirectory() || !repository.name.endsWith('.git')) continue
      result.repositories += 1
      const repositoryDir = join(getRepositoriesRoot(), repository.name)
      const location = { repositoryDir }
      const protectedRefs = desired.get(repositoryIdentity(repositoryDir)) || new Map()
      try {
        const valid = (
          await runGit([`--git-dir=${repositoryDir}`, 'rev-parse', '--is-bare-repository'])
        ).trim()
        if (valid !== 'true') throw new Error('Snapshot repository is not bare')

        for (const [ref, tree] of protectedRefs) {
          try {
            await setSnapshotRef(location, ref, tree)
            result.protectedRefs += 1
          } catch (error) {
            result.errors += 1
            console.warn(`Failed to protect snapshot ref ${ref}:`, (error as Error).message)
          }
        }

        for (const ref of await listManagedSnapshotRefs(repositoryDir)) {
          if (protectedRefs.has(ref)) continue
          if (!restoreInventoryAvailable && ref.startsWith(`${SNAPSHOT_REF_ROOT}/restores/`)) {
            continue
          }
          const pendingAt = pendingRefCreatedAt(ref)
          if (pendingAt !== undefined && now - pendingAt <= PENDING_REF_MAX_AGE_MS) continue
          await deleteSnapshotRef(location, ref)
          result.deletedRefs += 1
          if (pendingAt !== undefined) result.expiredPendingRefs += 1
        }

        await runGit([`--git-dir=${repositoryDir}`, 'reflog', 'expire', '--expire=now', '--all'])
        await runGit([
          `--git-dir=${repositoryDir}`,
          'gc',
          '--quiet',
          `--prune=${options.pruneAge || SNAPSHOT_PRUNE_AGE}`
        ])
      } catch (error) {
        result.errors += 1
        console.warn(
          `Agent file snapshot maintenance failed for ${repositoryDir}:`,
          (error as Error).message
        )
      }
    }
    return result
  })

export const beginAgentFileSnapshot = async (input: {
  sessionId: string
  runId: string
  projectRoot?: string
}): Promise<AgentFileSnapshotHandle | undefined> => {
  try {
    const start = await captureTree(input.projectRoot || getWorkspaceRoot())
    const pendingRef = await createPendingSnapshotRef(
      start.location,
      input.sessionId,
      input.runId,
      start.tree
    )
    let finishPromise: Promise<CompletedAgentFileSnapshot | undefined> | undefined
    return {
      finish: () => {
        if (finishPromise) return finishPromise
        finishPromise = serializeSnapshotOperation(async () => {
          try {
            const end = await captureTreeUnlocked(start.location.projectRoot)
            const files = await listChanges(start.location, start.tree, end.tree)
            const completedAt = Date.now()
            const snapshot = {
              projectRoot: start.location.projectRoot,
              startTree: start.tree,
              endTree: end.tree,
              files,
              completedAt
            }
            if (files.length > 0) {
              await protectRunSnapshot(start.location, input.sessionId, input.runId, snapshot)
            }
            updateRunManifest(input.sessionId, input.runId, (manifest) => ({
              ...manifest,
              fileSnapshot: snapshot
            }))
            return snapshot
          } catch (error) {
            console.warn('Failed to finalize Agent file snapshot:', (error as Error).message)
            return undefined
          } finally {
            await deleteSnapshotRef(start.location, pendingRef)
          }
        })
        return finishPromise
      }
    }
  } catch (error) {
    console.warn('Agent file snapshots are unavailable for this run:', (error as Error).message)
    return undefined
  }
}
