import { promises as fs } from 'fs'
import { dirname } from 'path'
import { ToolArgs } from '../../shared/types'
import {
  ROOT_PARAMETER,
  assertNotProtectedWorkspacePath,
  getNamedRootArg,
  getRootArg,
  resolveExistingSafePath,
  resolveTargetSafePath
} from './filePathSafety'
import { ToolDefinition, ToolExecutionContext } from './types'

export const fileCopyTool: ToolDefinition = {
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
}
