import { promises as fs } from 'fs'
import { extname } from 'path'
import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { ROOT_PARAMETER, getRootArg, resolveExistingSafePath } from './filePathSafety'
import { ToolDefinition, ToolExecutionContext } from './types'
import { calculateReadWindow, buildNumberedLines } from './fileReadWindow'
import { createFileReadResult } from './fileReadResult'
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  title: 'Read File',
  description:
    'Reads the content of a local file inside the global workspace or current project root. In project conversations, relative paths default to the project root.',
  tags: ['file', 'read', 'local', '文件', '读取', '内容', '读文件'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The relative or absolute path to the file.' },
      root: ROOT_PARAMETER,
      offset: {
        type: 'number',
        description:
          'The 1-indexed line number to start reading from (default: 1). Negative values count back from the end: -1 reads from the last line, -100 reads from 100 lines before the end.'
      },
      limit: {
        type: 'number',
        description: 'The maximum number of lines to read (default: 1000).'
      },
      tail: {
        type: 'number',
        description:
          'Read the last N lines of the file. When provided, tail takes precedence over offset/limit.'
      },
      around: {
        type: 'number',
        description:
          'Read around this 1-indexed line number. When provided, returns around-context through around+context.'
      },
      context: {
        type: 'number',
        description:
          'Number of lines before and after around to include (default: 20). Alias contextLines is also accepted.'
      },
      contextLines: {
        type: 'number',
        description: 'Alias for context when using around.'
      },
      lineNumbers: {
        type: 'boolean',
        description:
          'Whether to prefix returned content lines with line numbers. Default false because numbered content is not suitable for exact string replacement.'
      }
    },
    required: ['path']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const filePath = args.path
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Missing or invalid path parameter')
    }

    const target = await resolveExistingSafePath(filePath, ctx, 'Path', getRootArg(args))
    const extension = extname(target.realPath).toLowerCase()
    if (IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(
        `This is an image file (${extension}). Use image_read to attach it to the multimodal model context.`
      )
    }
    if (extension === '.pdf') {
      throw new Error('This is a PDF file. Use pdf_read to extract text content.')
    }

    try {
      const stats = await fs.stat(target.realPath)
      if (stats.isDirectory()) {
        throw new Error('Path is a directory, not a file.')
      }

      const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2MB
      if (stats.size > MAX_FILE_BYTES) {
        throw new Error(
          `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`
        )
      }
    } catch (err) {
      const error = err as Error
      throw new Error(`Failed to read file: ${error.message}`)
    }

    let content = ''
    try {
      content = await fs.readFile(target.realPath, 'utf-8')
    } catch (err) {
      const error = err as Error
      throw new Error(`Failed to read file: ${error.message}`)
    }

    const lines = content.split(/\r?\n/)
    const totalLines = lines.length
    const window = calculateReadWindow(args, totalLines)
    const slicedLines = lines.slice(window.startLine - 1, window.endLine)
    const includeLineNumbers = args.lineNumbers === true
    const resultText = includeLineNumbers
      ? buildNumberedLines(slicedLines, window.startLine)
      : slicedLines.join('\n')

    // Mark the file as observed so surgical edit tools (file_edit, multi_edit) can verify the
    // model has seen the content before mutating it. A partial read still counts as "seen".
    if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(target.realPath)

    return createFileReadResult({
      target,
      window,
      totalLines,
      includeLineNumbers,
      resultText
    })
  }
}
