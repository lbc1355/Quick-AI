import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { createWorkspaceSearchResult } from './workspaceSearchResult'
import { scanWorkspaceForText } from './workspaceSearchScanner'
import { ToolDefinition, ToolExecutionContext } from './types'
import {
  ROOT_PARAMETER,
  chooseBaseRoot,
  getRootArg,
  resolveExistingSafePath
} from './filePathSafety'

export const workspaceSearchTool: ToolDefinition = {
  name: 'workspace_search',
  title: 'Workspace Search',
  description:
    'Search for text matches within files in the global workspace, current project root, or an added reference root (skipping build/dependency folders). In project conversations, relative paths default to the project root.',
  tags: ['file', 'search', 'grep', 'local', 'find', 'workspace', 'content'],
  dependencies: ['file_read'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The text query to search for.' },
      path: {
        type: 'string',
        description:
          'Optional directory to search. Absolute paths are allowed when they are inside workspace, project, or a root added with workspace_add_root.'
      },
      root: ROOT_PARAMETER,
      glob: {
        type: 'string',
        description: 'Optional glob pattern to filter files (e.g., "*.ts" or "src/**/*.tsx").'
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive (default: false).'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of match results to return (default: 100).'
      }
    },
    required: ['query']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const query = args.query
    if (typeof query !== 'string' || !query) {
      throw new Error('Missing or invalid query parameter')
    }

    const globPattern = typeof args.glob === 'string' ? args.glob : undefined
    const caseSensitive = typeof args.caseSensitive === 'boolean' ? args.caseSensitive : false
    const maxResults = typeof args.maxResults === 'number' ? Math.max(1, args.maxResults) : 100
    const limit = Math.min(maxResults, 500)

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

    const result = await scanWorkspaceForText({
      root,
      query,
      globPattern,
      caseSensitive,
      limit,
      signal: ctx.signal
    })

    if (ctx.signal.aborted) {
      throw new Error('Agent execution aborted by user.')
    }

    return createWorkspaceSearchResult({
      root,
      rootKind: rootInfo.rootKind,
      query,
      matches: result.matches,
      scanTruncatedReason: result.scanTruncatedReason
    })
  }
}
