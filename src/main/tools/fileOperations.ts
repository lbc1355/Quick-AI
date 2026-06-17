import { dirname } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import {
  ROOT_PARAMETER,
  assertNotProtectedWorkspacePath,
  getNamedRootArg,
  getRootArg,
  normalizeComparablePath,
  resolveExistingSafePath,
  resolveTargetSafePath
} from './filePathSafety'

export const fileOperationTools: Record<string, ToolDefinition> = {
  directory_create: {
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
  },
  file_copy: {
    name: 'file_copy',
    title: 'Copy File',
    description:
      'Copies a file within the workspace. Directory copying is not supported; use this for individual files.',
    tags: ['file', 'copy', 'duplicate', 'workspace'],
    category: 'file',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Source file path, relative to the workspace or absolute.'
        },
        sourceRoot: ROOT_PARAMETER,
        destinationPath: {
          type: 'string',
          description: 'Destination file path, relative to the workspace or absolute.'
        },
        destinationRoot: ROOT_PARAMETER,
        root: ROOT_PARAMETER,
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite an existing destination file. Defaults to false.'
        },
        createDirs: {
          type: 'boolean',
          description: 'Whether to create destination parent directories. Defaults to true.'
        }
      },
      required: ['sourcePath', 'destinationPath']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const sourcePath = args.sourcePath
      const destinationPath = args.destinationPath
      if (typeof sourcePath !== 'string' || !sourcePath) {
        throw new Error('Missing or invalid sourcePath parameter')
      }
      if (typeof destinationPath !== 'string' || !destinationPath) {
        throw new Error('Missing or invalid destinationPath parameter')
      }

      const overwrite = args.overwrite === true
      const createDirs = args.createDirs !== false
      const source = await resolveExistingSafePath(
        sourcePath,
        ctx,
        'Source path',
        getNamedRootArg(args, 'sourceRoot') || getRootArg(args)
      )
      const destination = await resolveTargetSafePath(
        destinationPath,
        ctx,
        'Destination path',
        getNamedRootArg(args, 'destinationRoot') || getRootArg(args)
      )
      assertNotProtectedWorkspacePath(source.root, source.realPath, 'Source path')
      assertNotProtectedWorkspacePath(destination.root, destination.realPath, 'Destination path')

      const sourceStats = await fs.stat(source.realPath)
      if (sourceStats.isDirectory()) {
        throw new Error('Source path is a directory. file_copy supports files only.')
      }

      try {
        const destinationStats = await fs.stat(destination.realPath)
        if (destinationStats.isDirectory()) {
          throw new Error('Destination path is an existing directory.')
        }
        if (!overwrite) {
          throw new Error('Destination file already exists. Set overwrite=true to replace it.')
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw err
      }

      try {
        if (createDirs) {
          await fs.mkdir(dirname(destination.realPath), { recursive: true })
        }
        await fs.copyFile(source.realPath, destination.realPath)
      } catch (err) {
        throw new Error(`Failed to copy file: ${(err as Error).message}`)
      }

      return {
        resultForModel: `Copied file:\nFrom: ${source.relPath}\nTo: ${destination.relPath}`,
        resultForUi: {
          title: `Copy File: ${source.relPath}`,
          url: `file:///${destination.realPath.replace(/\\/g, '/')}`,
          summary: `Copied ${source.relPath} to ${destination.relPath}`
        }
      }
    }
  },
  file_move: {
    name: 'file_move',
    title: 'Move File or Directory',
    description:
      'Moves or renames a file or directory within the workspace. Refuses to overwrite unless overwrite=true.',
    tags: ['file', 'move', 'rename', 'directory', 'workspace'],
    category: 'file',
    risk: 'high',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Source path to move, relative to the workspace or absolute.'
        },
        sourceRoot: ROOT_PARAMETER,
        destinationPath: {
          type: 'string',
          description: 'Destination path, relative to the workspace or absolute.'
        },
        destinationRoot: ROOT_PARAMETER,
        root: ROOT_PARAMETER,
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite an existing destination file. Defaults to false.'
        },
        createDirs: {
          type: 'boolean',
          description: 'Whether to create destination parent directories. Defaults to true.'
        }
      },
      required: ['sourcePath', 'destinationPath']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const sourcePath = args.sourcePath
      const destinationPath = args.destinationPath
      if (typeof sourcePath !== 'string' || !sourcePath) {
        throw new Error('Missing or invalid sourcePath parameter')
      }
      if (typeof destinationPath !== 'string' || !destinationPath) {
        throw new Error('Missing or invalid destinationPath parameter')
      }

      const overwrite = args.overwrite === true
      const createDirs = args.createDirs !== false
      const source = await resolveExistingSafePath(
        sourcePath,
        ctx,
        'Source path',
        getNamedRootArg(args, 'sourceRoot') || getRootArg(args)
      )
      const destination = await resolveTargetSafePath(
        destinationPath,
        ctx,
        'Destination path',
        getNamedRootArg(args, 'destinationRoot') || getRootArg(args)
      )
      assertNotProtectedWorkspacePath(source.root, source.realPath, 'Source path')
      assertNotProtectedWorkspacePath(destination.root, destination.realPath, 'Destination path')

      const sourceComparable = normalizeComparablePath(source.realPath)
      const destinationComparable = normalizeComparablePath(destination.realPath)
      if (sourceComparable === destinationComparable) {
        throw new Error('Source and destination are the same path.')
      }
      if (destinationComparable.startsWith(`${sourceComparable}/`)) {
        throw new Error('Destination cannot be inside the source path.')
      }

      try {
        const destinationStats = await fs.stat(destination.realPath)
        if (destinationStats.isDirectory()) {
          throw new Error('Destination path is an existing directory.')
        }
        if (!overwrite) {
          throw new Error(
            'Destination path already exists. Set overwrite=true to replace an existing file.'
          )
        }
        await fs.rm(destination.realPath, { force: false })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw err
      }

      try {
        if (createDirs) {
          await fs.mkdir(dirname(destination.realPath), { recursive: true })
        }
        await fs.rename(source.realPath, destination.realPath)
      } catch (err) {
        throw new Error(`Failed to move path: ${(err as Error).message}`)
      }

      return {
        resultForModel: `Moved path:\nFrom: ${source.relPath}\nTo: ${destination.relPath}`,
        resultForUi: {
          title: `Move Path: ${source.relPath}`,
          url: `file:///${destination.realPath.replace(/\\/g, '/')}`,
          summary: `Moved ${source.relPath} to ${destination.relPath}`
        }
      }
    }
  },
  file_delete: {
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

      return {
        resultForModel: `Deleted path: ${target.relPath}`,
        resultForUi: {
          title: `Delete Path: ${target.relPath}`,
          summary: `Deleted ${target.relPath}`
        }
      }
    }
  }
}
