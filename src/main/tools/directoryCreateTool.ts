import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import {
  ROOT_PARAMETER,
  assertNotProtectedWorkspacePath,
  getRootArg,
  resolveTargetSafePath
} from './filePathSafety'
import { ToolDefinition, ToolExecutionContext } from './types'

export const directoryCreateTool: ToolDefinition = {
  name: 'directory_create',
  title: 'Create Directory',
  description:
    'Creates a directory within the workspace. Parent directories are created by default.',
  tags: ['file', 'directory', 'mkdir', 'create', 'folder', 'workspace'],
  category: 'file',
  risk: 'medium',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to create, relative to the workspace or absolute.'
      },
      root: ROOT_PARAMETER,
      recursive: {
        type: 'boolean',
        description: 'Whether to create parent directories as needed. Defaults to true.'
      }
    },
    required: ['path']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const dirPath = args.path
    if (typeof dirPath !== 'string' || !dirPath) {
      throw new Error('Missing or invalid path parameter')
    }

    const recursive = args.recursive !== false
    const target = await resolveTargetSafePath(dirPath, ctx, 'Directory path', getRootArg(args))
    assertNotProtectedWorkspacePath(target.root, target.realPath, 'Directory path')

    try {
      await fs.mkdir(target.realPath, { recursive })
    } catch (err) {
      throw new Error(`Failed to create directory: ${(err as Error).message}`)
    }

    return {
      resultForModel: `Created directory: ${target.relPath}\nPath: ${target.realPath}`,
      resultForUi: {
        title: `Create Directory: ${target.relPath}`,
        url: `file:///${target.realPath.replace(/\\/g, '/')}`,
        summary: `Created directory ${target.relPath}`
      }
    }
  }
}
