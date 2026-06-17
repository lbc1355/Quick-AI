import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import { getWorkspaceRoot, isSensitiveFile } from './helpers'

export type FileRootKind = 'workspace' | 'project'
export type FileRootArg = FileRootKind | undefined

export const ROOT_PARAMETER = {
  type: 'string',
  enum: ['workspace', 'project'],
  description:
    'Optional root selector. In project conversations, relative paths default to project; use "workspace" for QuickAI scratch files.'
}

export interface SafePath {
  root: string
  rootKind: FileRootKind
  resolvedPath: string
  realPath: string
  relPath: string
}

export function getRootArg(args: ToolArgs): FileRootArg {
  return args.root === 'workspace' || args.root === 'project' ? args.root : undefined
}

export function getNamedRootArg(args: ToolArgs, key: string): FileRootArg {
  return args[key] === 'workspace' || args[key] === 'project'
    ? (args[key] as FileRootKind)
    : undefined
}

function getProjectRoot(ctx: ToolExecutionContext): string | undefined {
  return ctx.reqId ? getRun(ctx.reqId)?.projectRoot : undefined
}

export function normalizeComparablePath(filePath: string): string {
  const normalized = resolve(filePath).replace(/\\/g, '/')
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

export function isPathInsideRoot(filePath: string, root: string): boolean {
  const target = normalizeComparablePath(filePath)
  const base = normalizeComparablePath(root)
  if (target === base) return true
  const rel = relative(base, target)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

export function chooseBaseRoot(
  inputPath: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): { root: string; rootKind: FileRootKind } {
  const workspaceRoot = getWorkspaceRoot()
  const projectRoot = getProjectRoot(ctx)
  if (requestedRoot === 'project' && !projectRoot) {
    throw new Error('No project root is attached to this conversation.')
  }
  if (requestedRoot === 'workspace') {
    return { root: workspaceRoot, rootKind: 'workspace' }
  }
  if (!isAbsolute(inputPath) && projectRoot) {
    return { root: projectRoot, rootKind: 'project' }
  }
  return { root: workspaceRoot, rootKind: 'workspace' }
}

function getAccessibleRootForResolvedPath(
  resolvedPath: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): { root: string; rootKind: FileRootKind } {
  const workspaceRoot = getWorkspaceRoot()
  const projectRoot = getProjectRoot(ctx)

  if (requestedRoot === 'workspace') {
    if (isPathInsideRoot(resolvedPath, workspaceRoot)) {
      return { root: workspaceRoot, rootKind: 'workspace' }
    }
    throw new Error('Security Violation: Path is outside the global workspace.')
  }

  if (requestedRoot === 'project') {
    if (!projectRoot) throw new Error('No project root is attached to this conversation.')
    if (isPathInsideRoot(resolvedPath, projectRoot)) {
      return { root: projectRoot, rootKind: 'project' }
    }
    throw new Error('Security Violation: Path is outside the current project root.')
  }

  if (projectRoot && isPathInsideRoot(resolvedPath, projectRoot)) {
    return { root: projectRoot, rootKind: 'project' }
  }
  if (isPathInsideRoot(resolvedPath, workspaceRoot)) {
    return { root: workspaceRoot, rootKind: 'workspace' }
  }
  throw new Error(
    'Security Violation: Path is outside the global workspace and current project root.'
  )
}

export async function resolveExistingSafePath(
  inputPath: string,
  ctx: ToolExecutionContext,
  label = 'Path',
  requestedRoot?: FileRootArg
): Promise<SafePath> {
  const base = chooseBaseRoot(inputPath, ctx, requestedRoot)
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base.root, inputPath)
  let rootInfo = getAccessibleRootForResolvedPath(resolvedPath, ctx, requestedRoot)
  let realPath: string
  try {
    realPath = await fs.realpath(resolvedPath)
  } catch {
    throw new Error(`${label} does not exist: ${inputPath}`)
  }

  rootInfo = getAccessibleRootForResolvedPath(realPath, ctx, requestedRoot)

  if (isSensitiveFile(realPath)) {
    throw new Error(`Security Violation: ${label} targets a sensitive file.`)
  }

  return {
    root: rootInfo.root,
    rootKind: rootInfo.rootKind,
    resolvedPath,
    realPath,
    relPath: relative(rootInfo.root, realPath).replace(/\\/g, '/')
  }
}

export async function resolveTargetSafePath(
  inputPath: string,
  ctx: ToolExecutionContext,
  label = 'Path',
  requestedRoot?: FileRootArg
): Promise<SafePath> {
  const base = chooseBaseRoot(inputPath, ctx, requestedRoot)
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base.root, inputPath)

  let realPath = resolvedPath
  try {
    realPath = await fs.realpath(resolvedPath)
  } catch {
    try {
      const parentDir = await fs.realpath(dirname(resolvedPath))
      realPath = join(parentDir, basename(resolvedPath))
    } catch {
      // Parent may not exist yet; containment checks can still use the resolved path.
    }
  }

  const rootInfo = getAccessibleRootForResolvedPath(realPath, ctx, requestedRoot)

  if (isSensitiveFile(realPath)) {
    throw new Error(`Security Violation: ${label} targets a sensitive file.`)
  }

  return {
    root: rootInfo.root,
    rootKind: rootInfo.rootKind,
    resolvedPath,
    realPath,
    relPath: relative(rootInfo.root, realPath).replace(/\\/g, '/')
  }
}

export function assertNotProtectedWorkspacePath(
  root: string,
  realPath: string,
  label: string
): void {
  const relPath = relative(root, realPath).replace(/\\/g, '/')
  if (!relPath || relPath === '.') {
    throw new Error(`${label} cannot be the selected root.`)
  }
  if (relPath === '.git' || relPath.startsWith('.git/')) {
    throw new Error(`${label} cannot target the .git directory.`)
  }
}
