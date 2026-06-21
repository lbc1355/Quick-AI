import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import {
  ROOT_PARAMETER,
  assertNotProtectedWorkspacePath,
  getRootArg,
  resolveExistingSafePath
} from './filePathSafety'
import { createFileDeleteResult } from './fileOperationResult'
import { ToolDefinition, ToolExecutionContext } from './types'

export const fileDeleteTool: ToolDefinition = {
  name: 'file_delete',
  title: 'Delete File or Directory',
  description:
    'Deletes a file or, when recursive=true, a directory within the workspace. Refuses to delete the workspace root or .git directory.',
  tags: ['file', 'delete', 'remove', 'rm', 'directory', 'workspace'],
  category: 'file',
  risk: 'high',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to delete, relative to the workspace or absolute.'
      },
      root: ROOT_PARAMETER,
      recursive: {
        type: 'boolean',
        description: 'Required to delete directories. Defaults to false.'
      }
    },
    required: ['path']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const targetPath = args.path
    if (typeof targetPath !== 'string' || !targetPath) {
      throw new Error('Missing or invalid path parameter')
    }

    const recursive = args.recursive === true
    const target = await resolveExistingSafePath(targetPath, ctx, 'Delete path', getRootArg(args))
    assertNotProtectedWorkspacePath(target.root, target.realPath, 'Delete path')

    const stats = await fs.stat(target.realPath)
    if (stats.isDirectory() && !recursive) {
      throw new Error('Delete path is a directory. Set recursive=true to delete directories.')
    }

    try {
      await fs.rm(target.realPath, { recursive, force: false })
    } catch (err) {
      throw new Error(`Failed to delete path: ${(err as Error).message}`)
    }

    return createFileDeleteResult(target)
  }
}
