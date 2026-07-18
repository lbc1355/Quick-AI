import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { app } from 'electron'
import { lstat, mkdir, realpath, rmdir, stat, unlink } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type {
  AgentFileChange,
  AgentFileChangeKind,
  AgentFileRevertPreview,
  RevertAgentFileChangesInput,
  RevertAgentFileChangesResult
} from '../../shared/types'
import { loadRunManifest, updateRunManifest } from './runManifest'

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_PREVIEW_CHARS = 200_000
const CHECKOUT_BATCH_SIZE = 100

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

const runGit = (args: string[], cwd?: string): Promise<string> =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
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
  try {
    const head = await stat(join(location.repositoryDir, 'HEAD'))
    if (head.isFile()) return
  } catch {
    // Initialize below.
  }

  await mkdir(dirname(location.repositoryDir), { recursive: true })
  await runGit(['init', '--bare', location.repositoryDir])
  await runGit([`--git-dir=${location.repositoryDir}`, 'config', 'core.autocrlf', 'false'])
  await runGit([`--git-dir=${location.repositoryDir}`, 'config', 'core.filemode', 'false'])
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
  const context = gitContextArgs(location)
  await runGit([...context, 'add', '-A', '--', '.', ':(exclude).git', ':(exclude).git/**'])
  const tree = (await runGit([...context, 'write-tree'])).trim()
  if (!/^[a-f0-9]{40,64}$/i.test(tree)) throw new Error('Git did not return a valid tree id')
  return { location, tree }
}

const captureTree = (projectRoot: string): Promise<{ location: SnapshotLocation; tree: string }> =>
  serializeSnapshotOperation(() => captureTreeUnlocked(projectRoot))

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

export const beginAgentFileSnapshot = async (input: {
  sessionId: string
  runId: string
  projectRoot?: string
}): Promise<AgentFileSnapshotHandle | undefined> => {
  if (!input.projectRoot) return undefined

  try {
    const start = await captureTree(input.projectRoot)
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
            updateRunManifest(input.sessionId, input.runId, (manifest) => ({
              ...manifest,
              fileSnapshot: snapshot
            }))
            return snapshot
          } catch (error) {
            console.warn('Failed to finalize Agent file snapshot:', (error as Error).message)
            return undefined
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
