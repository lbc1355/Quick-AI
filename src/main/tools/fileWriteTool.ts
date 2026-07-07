import { promises as fs } from 'fs'
import { dirname } from 'path'
import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { ROOT_PARAMETER, getRootArg, resolveTargetSafePath } from './filePathSafety'
import { createFileWriteResult } from './fileOperationResult'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getDiffStats } from './fileDiff'

export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  title: 'Write File',
  description:
    'Writes content to a local file. Files inside the workspace are written directly, while files outside the workspace require user approval.',
  tags: ['file', 'write', 'local', 'save', '文件', '写入', '保存', '修改', '编辑', '创建', '翻译'],
  category: 'file',
  risk: 'medium',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative or absolute path to write the file to.'
      },
      root: ROOT_PARAMETER,
      content: {
        type: 'string',
        description: 'The file content to write.'
      },
      mode: {
        type: 'string',
        description:
          'Whether to fail if file exists ("create") or overwrite ("overwrite"). (default: "create")',
        enum: ['create', 'overwrite']
      },
      createDirs: {
        type: 'boolean',
        description:
          'Whether to automatically create parent directories if they do not exist. (default: true)'
      }
    },
    required: ['path', 'content']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const filePath = args.path
    const content = args.content
    const mode = (args.mode as string) || 'create'
    const createDirs = args.createDirs !== false

    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Missing or invalid path parameter')
    }
    if (typeof content !== 'string') {
      throw new Error('Missing or invalid content parameter')
    }

    const target = await resolveTargetSafePath(filePath, ctx, 'Path', getRootArg(args))
    console.log(`[file_write] ${target.rootKind} root is: ${target.root}`)

    const MAX_WRITE_BYTES = 2 * 1024 * 1024
    const contentBuffer = Buffer.from(content, 'utf-8')
    if (contentBuffer.length > MAX_WRITE_BYTES) {
      throw new Error(
        `File content is too large (${(contentBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported write size is 2 MB.`
      )
    }

    let exists = false
    let oldContent = ''
    try {
      const stats = await fs.stat(target.realPath)
      exists = true
      if (stats.isDirectory()) {
        throw new Error('Target path is a directory, not a file.')
      }
      try {
        oldContent = await fs.readFile(target.realPath, 'utf-8')
      } catch {
        // ignore read error
      }
    } catch {
      // If file doesn't exist, stat throws ENOENT, which is expected.
    }

    if (exists && mode === 'create') {
      throw new Error(
        `File already exists and mode is set to "create". To overwrite, set mode to "overwrite".`
      )
    }

    try {
      if (createDirs) {
        const parent = dirname(target.realPath)
        await fs.mkdir(parent, { recursive: true })
      }
      await fs.writeFile(target.realPath, content, 'utf-8')
    } catch (err) {
      const error = err as Error
      throw new Error(`Failed to write file: ${error.message}`)
    }

    // Writing establishes known content, so subsequent surgical edits in this run are allowed.
    if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(target.realPath)

    const stats = exists
      ? getDiffStats(oldContent.split(/\r?\n/), content.split(/\r?\n/))
      : { added: content.split(/\r?\n/).length, removed: 0 }

    return createFileWriteResult(target, contentBuffer.length, exists, stats.added, stats.removed)
  }
}
