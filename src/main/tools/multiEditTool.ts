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

export const multiEditTool: ToolDefinition = {
  name: 'multi_edit',
  title: 'Multi-Edit File',
  description:
    'Applies a sequence of exact string replacements to a single file in one atomic operation. Edits are applied in order, each operating on the result of the previous one. If ANY edit fails (old_string not found, or matches multiple locations without replace_all), NO changes are written and the file is left untouched. Prefer this over multiple file_edit calls when changing several places in the same file. The file must have been read earlier in this run. Each edit takes { old_string, new_string, replace_all? }; old_string must be unique unless replace_all is true, and must differ from new_string.',
  tags: [
    'file',
    'edit',
    'multi',
    'batch',
    'replace',
    'patch',
    'atomic',
    '文件',
    '编辑',
    '批量',
    '替换',
    '修改',
    '更新'
  ],
  dependencies: ['file_read'],
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
      edits: {
        type: 'array',
        description:
          'Ordered list of edits to apply. Each item is an object with "old_string" (exact text to find), "new_string" (replacement), and optional "replace_all" (boolean). Edits apply sequentially; each sees the result of the previous one.',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string', description: 'Exact text to replace.' },
            new_string: { type: 'string', description: 'Replacement text.' },
            replace_all: {
              type: 'boolean',
              description: 'Replace all occurrences of old_string (default false).'
            }
          },
          required: ['old_string', 'new_string']
        }
      }
    },
    required: ['path', 'edits']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const filePath = args.path
    const rawEdits = args.edits

    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Missing or invalid path parameter')
    }
    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      throw new Error('edits must be a non-empty array')
    }

    interface EditOp {
      oldString: string
      newString: string
      replaceAll: boolean
    }
    const edits: EditOp[] = rawEdits.map((raw, i) => {
      const e = raw as Record<string, unknown>
      const oldString = e.old_string
      const newString = e.new_string
      const replaceAll = e.replace_all === true
      if (typeof oldString !== 'string' || !oldString) {
        throw new Error(`edits[${i}]: old_string must be a non-empty string`)
      }
      if (typeof newString !== 'string') {
        throw new Error(`edits[${i}]: new_string must be a string`)
      }
      if (oldString === newString) {
        throw new Error(`edits[${i}]: old_string and new_string must be different`)
      }
      return { oldString, newString, replaceAll }
    })

    const target = await resolveExistingSafePath(filePath, ctx, 'Path', getRootArg(args))

    const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
    if (runCtx && !runCtx.hasSeenFile(target.realPath)) {
      throw new Error(
        'You must read this file before editing it. Call file_read on this path first so the edits are based on its current content, then retry multi_edit.'
      )
    }

    let content: string
    try {
      content = await fs.readFile(target.realPath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read file: ${(err as Error).message}`)
    }

    // Apply all edits in memory first. Only write if every edit succeeds (atomic).
    let working = content
    let totalReplacements = 0
    for (let i = 0; i < edits.length; i++) {
      const { oldString, newString, replaceAll } = edits[i]

      const occurrences: number[] = []
      let searchFrom = 0
      while (searchFrom < working.length) {
        const idx = working.indexOf(oldString, searchFrom)
        if (idx === -1) break
        occurrences.push(idx)
        searchFrom = idx + 1
      }

      if (occurrences.length === 0) {
        throw new Error(
          `edits[${i}]: old_string not found. No changes were written.\n${formatEditLookupFailure(working, oldString)}\nTip: a previous edit in this batch may have already changed the surrounding text. Each old_string must match the file state after earlier edits.`
        )
      }
      if (!replaceAll && occurrences.length > 1) {
        throw new Error(
          `edits[${i}]: old_string matched ${occurrences.length} locations. No changes were written. Add more surrounding context to make it unique, or set replace_all=true.\nMatch locations:\n${formatOccurrenceContexts(working, oldString, occurrences)}`
        )
      }

      working = replaceAll
        ? working.split(oldString).join(newString)
        : working.slice(0, occurrences[0]) +
          newString +
          working.slice(occurrences[0] + oldString.length)
      totalReplacements += replaceAll ? occurrences.length : 1
    }

    const newBuffer = Buffer.from(working, 'utf-8')
    const MAX_BYTES = 2 * 1024 * 1024
    if (newBuffer.length > MAX_BYTES) {
      throw new Error(
        `Resulting file is too large (${(newBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB. No changes were written.`
      )
    }

    try {
      await fs.writeFile(target.realPath, working, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to write file: ${(err as Error).message}`)
    }

    runCtx?.markFileSeen(target.realPath)
    const diff = buildShortUnifiedDiff(content, working)

    return {
      resultForModel: `Successfully applied ${edits.length} edit(s) to ${target.relPath}: ${totalReplacements} total replacement(s).\nRoot (${target.rootKind}): ${target.root}\n\nDiff:\n${diff}`,
      resultForUi: {
        title: `Multi-Edit File: ${target.relPath}`,
        summary: `Applied ${edits.length} edit(s) (${totalReplacements} replacement(s)) in ${target.relPath}`
      }
    }
  }
}
