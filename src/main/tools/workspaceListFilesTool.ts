import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { ROOT_PARAMETER, chooseBaseRoot, getRootArg } from './filePathSafety'
import { scanWorkspaceFiles } from './workspaceListScanner'
import { createWorkspaceListResult } from './workspaceListResult'

export const workspaceListFilesTool: ToolDefinition = {
  name: 'workspace_list_files',
  title: 'List Workspace Files',
  description:
    'Lists files matching a glob wildcard pattern within the global workspace or current project root. In project conversations, relative paths default to the project root.',
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

    const rootInfo = chooseBaseRoot('.', ctx, getRootArg(args))
    const root = rootInfo.root
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
