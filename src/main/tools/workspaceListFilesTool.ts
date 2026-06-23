import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import {
  ROOT_PARAMETER,
  chooseBaseRoot,
  getRootArg,
  resolveExistingSafePath
} from './filePathSafety'
import { scanWorkspaceFiles } from './workspaceListScanner'
import { createWorkspaceListResult } from './workspaceListResult'

export const workspaceListFilesTool: ToolDefinition = {
  name: 'workspace_list_files',
  title: 'List Workspace Files',
  description:
    'Lists files matching a glob wildcard pattern within the global workspace, current project root, or an added reference root. In project conversations, relative paths default to the project root.',
  tags: [
    'file',
    'list',
    'glob',
    'find',
    'local',
    'workspace',
    'markdown',
    'md',
    'batch',
    'translate',
    'path'
  ],
  dependencies: ['file_read', 'file_write'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      glob: {
        type: 'string',
        description: 'The glob pattern to filter files (e.g., "**/*.md" or "src/**/*.ts").'
      },
      path: {
        type: 'string',
        description:
          'Optional directory to scan. Absolute paths are allowed when they are inside workspace, project, or a root added with workspace_add_root.'
      },
      root: ROOT_PARAMETER,
      maxResults: {
        type: 'number',
        description: 'Maximum number of file paths to return (default: 100).'
      }
    },
    required: ['glob']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const globPattern = args.glob
    if (typeof globPattern !== 'string' || !globPattern) {
      throw new Error('Missing or invalid glob parameter')
    }

    const maxResults = typeof args.maxResults === 'number' ? Math.max(1, args.maxResults) : 100
    const limit = Math.min(maxResults, 1000)

    const requestedRoot = getRootArg(args)
    const requestedPath = typeof args.path === 'string' && args.path.trim() ? args.path : ''
    let rootInfo = chooseBaseRoot('.', ctx, requestedRoot)
    let root = rootInfo.root
    if (requestedPath) {
      const target = await resolveExistingSafePath(
        requestedPath,
        ctx,
        'Directory path',
        requestedRoot
      )
      const stats = await fs.stat(target.realPath)
      if (!stats.isDirectory()) throw new Error('Directory path is not a directory.')
      rootInfo = { root: target.realPath, rootKind: target.rootKind }
      root = target.realPath
    }
    console.log(`[workspace_list_files] List root is: ${root}`)

    const scanResult = await scanWorkspaceFiles({
      root,
      globPattern,
      limit,
      signal: ctx.signal
    })

    if (ctx.signal.aborted) {
      throw new Error('Agent execution aborted by user.')
    }

    return createWorkspaceListResult({
      root,
      rootKind: rootInfo.rootKind,
      globPattern,
      matches: scanResult.matches,
      scanTruncatedReason: scanResult.scanTruncatedReason
    })
  }
}
