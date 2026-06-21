import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { ROOT_PARAMETER, getRootArg, resolveExistingSafePath } from './filePathSafety'
import {
  buildShortUnifiedDiff,
  formatEditLookupFailure,
  formatOccurrenceContexts
} from './fileMutationResult'
import { ToolDefinition, ToolExecutionContext } from './types'

export const fileEditTool: ToolDefinition = {
  name: 'file_edit',
  title: 'Edit File',
  description:
    'Performs exact string replacement in a file. Files inside the workspace are edited directly, while files outside the workspace require user approval. Provide the exact text to replace (old_string) and the new text (new_string). By default, old_string must match exactly one location - if it matches multiple locations the edit is rejected with a list of matching lines so you can add more surrounding context to make it unique. Use replace_all=true to replace every occurrence.',
  tags: [
    'file',
    'edit',
    'replace',
    'patch',
    'modify',
    'update',
    '文件',
    '编辑',
    '替换',
    '修改',
    '更新'
  ],
  category: 'file',
  risk: 'medium',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative or absolute path to the file to edit.'
      },
      root: ROOT_PARAMETER,
      old_string: {
        type: 'string',
        description:
          'The exact text to replace. Must match exactly (whitespace, indentation, newlines all count). If multiple matches exist, the edit is rejected unless replace_all is true.'
      },
      new_string: {
        type: 'string',
        description: 'The replacement text (must be different from old_string).'
      },
      replace_all: {
        type: 'boolean',
        description:
          'Replace all occurrences of old_string (default false). When false, old_string must match exactly one location.'
      }
    },
    required: ['path', 'old_string', 'new_string']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const filePath = args.path
    const oldString = args.old_string
    const newString = args.new_string
    const replaceAll = args.replace_all === true

    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Missing or invalid path parameter')
    }
    if (typeof oldString !== 'string') {
      throw new Error('Missing or invalid old_string parameter')
    }
    if (typeof newString !== 'string') {
      throw new Error('Missing or invalid new_string parameter')
    }
    if (oldString === newString) {
      throw new Error('old_string and new_string must be different')
    }
    if (!oldString) {
      throw new Error('old_string must not be empty')
    }

    const target = await resolveExistingSafePath(filePath, ctx, 'Path', getRootArg(args))

    const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
    if (runCtx && !runCtx.hasSeenFile(target.realPath)) {
      throw new Error(
        'You must read this file before editing it. Call file_read on this path first so the edit is based on its current content, then retry file_edit.'
      )
    }

    let content: string
    try {
      content = await fs.readFile(target.realPath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read file: ${(err as Error).message}`)
    }

    const occurrences: number[] = []
    let searchFrom = 0
    while (searchFrom < content.length) {
      const idx = content.indexOf(oldString, searchFrom)
      if (idx === -1) break
      occurrences.push(idx)
      searchFrom = idx + 1
    }

    if (occurrences.length === 0) {
      throw new Error(
        `old_string not found in file.\n${formatEditLookupFailure(content, oldString)}`
      )
    }

    if (!replaceAll && occurrences.length > 1) {
      throw new Error(
        `old_string matched ${occurrences.length} locations. Add more surrounding context to make it unique, or set replace_all=true.\nMatch locations:\n${formatOccurrenceContexts(content, oldString, occurrences)}`
      )
    }

    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.slice(0, occurrences[0]) +
        newString +
        content.slice(occurrences[0] + oldString.length)

    const newBuffer = Buffer.from(newContent, 'utf-8')
    const MAX_BYTES = 2 * 1024 * 1024
    if (newBuffer.length > MAX_BYTES) {
      throw new Error(
        `Resulting file is too large (${(newBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`
      )
    }

    try {
      await fs.writeFile(target.realPath, newContent, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to write file: ${(err as Error).message}`)
    }

    // Content is now known after the edit; keep the file marked as seen for follow-up edits.
    runCtx?.markFileSeen(target.realPath)

    const count = replaceAll ? occurrences.length : 1
    const diff = buildShortUnifiedDiff(content, newContent)

    return {
      resultForModel: `Successfully edited ${target.relPath}: replaced ${count} occurrence(s).\nRoot (${target.rootKind}): ${target.root}\n\nDiff:\n${diff}`,
      resultForUi: {
        title: `Edit File: ${target.relPath}`,
        summary: `Replaced ${count} occurrence(s) in ${target.relPath}`
      }
    }
  }
}
