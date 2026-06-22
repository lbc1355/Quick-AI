import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { generateUnifiedDiff } from './fileDiffAlgorithm'
import { createFileDiffResult } from './fileDiffResult'
import {
  ROOT_PARAMETER,
  getNamedRootArg,
  getRootArg,
  resolveExistingSafePath
} from './filePathSafety'

export { generateUnifiedDiff } from './fileDiffAlgorithm'

export const fileDiffTool: ToolDefinition = {
  name: 'file_diff',
  title: 'Compare Files',
  description:
    'Compares two files and returns a unified line-by-line diff. Files within the workspace are read directly, while files outside the workspace require user approval.',
  tags: ['file', 'diff', 'compare', 'difference', '文件', '对比', '差异'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path_a: {
        type: 'string',
        description: 'The relative or absolute path to the first file.'
      },
      root_a: ROOT_PARAMETER,
      path_b: {
        type: 'string',
        description: 'The relative or absolute path to the second file.'
      },
      root_b: ROOT_PARAMETER,
      root: ROOT_PARAMETER
    },
    required: ['path_a', 'path_b']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const filePathA = args.path_a
    const filePathB = args.path_b

    if (typeof filePathA !== 'string' || !filePathA) {
      throw new Error('Missing or invalid path_a parameter')
    }
    if (typeof filePathB !== 'string' || !filePathB) {
      throw new Error('Missing or invalid path_b parameter')
    }

    const pathA = await resolveExistingSafePath(
      filePathA,
      ctx,
      'Path_A',
      getNamedRootArg(args, 'root_a') || getRootArg(args)
    )
    const pathB = await resolveExistingSafePath(
      filePathB,
      ctx,
      'Path_B',
      getNamedRootArg(args, 'root_b') || getRootArg(args)
    )

    let contentA: string
    let contentB: string
    try {
      contentA = await fs.readFile(pathA.realPath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read file A: ${(err as Error).message}`)
    }
    try {
      contentB = await fs.readFile(pathB.realPath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read file B: ${(err as Error).message}`)
    }

    const diffResult = generateUnifiedDiff(contentA.split(/\r?\n/), contentB.split(/\r?\n/))

    return createFileDiffResult(pathA, pathB, diffResult)
  }
}
