import { dirname } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { generateUnifiedDiff } from './fileDiff'
import {
  ROOT_PARAMETER,
  getRootArg,
  resolveExistingSafePath,
  resolveTargetSafePath
} from './filePathSafety'
import { ToolDefinition, ToolExecutionContext } from './types'
function getLineNumberAtPosition(text: string, position: number): number {
  return text.slice(0, Math.max(0, position)).split(/\r?\n/).length
}

function getLineEndForNeedle(startLine: number, needle: string): number {
  return startLine + needle.split(/\r?\n/).length - 1
}

function formatLineContext(lines: string[], centerLine: number, radius = 2): string {
  const start = Math.max(1, centerLine - radius)
  const end = Math.min(lines.length, centerLine + radius)
  const width = String(end).length
  const formatted: string[] = []

  for (let lineNumber = start; lineNumber <= end; lineNumber++) {
    const marker = lineNumber === centerLine ? '>' : ' '
    formatted.push(
      `${marker} ${String(lineNumber).padStart(width, ' ')} | ${lines[lineNumber - 1] ?? ''}`
    )
  }

  return formatted.join('\n')
}

function formatOccurrenceContexts(content: string, needle: string, occurrences: number[]): string {
  const lines = content.split(/\r?\n/)
  return occurrences
    .slice(0, 8)
    .map((position, index) => {
      const startLine = getLineNumberAtPosition(content, position)
      const endLine = getLineEndForNeedle(startLine, needle)
      return [
        `Match ${index + 1}: lines ${startLine}-${endLine}`,
        formatLineContext(lines, startLine, 2)
      ].join('\n')
    })
    .join('\n\n')
}

function getNeedlePreviewLine(needle: string): string {
  const lines = needle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return (lines[0] || needle.trim()).slice(0, 80)
}

function formatClosestLineContexts(content: string, needle: string): string {
  const lines = content.split(/\r?\n/)
  const preview = getNeedlePreviewLine(needle)
  const probe = preview.slice(0, 30)
  if (!probe) return ''

  const contexts: string[] = []
  for (let i = 0; i < lines.length && contexts.length < 5; i++) {
    if (lines[i].includes(probe) || lines[i].trim().includes(probe.trim())) {
      contexts.push(
        `Candidate ${contexts.length + 1}: around line ${i + 1}\n${formatLineContext(lines, i + 1, 2)}`
      )
    }
  }

  return contexts.join('\n\n')
}

function formatEditLookupFailure(content: string, oldString: string): string {
  const lines = content.split(/\r?\n/)
  const oldLines = oldString.split(/\r?\n/).length
  const preview = getNeedlePreviewLine(oldString)
  const closest = formatClosestLineContexts(content, oldString)

  const details = [
    `Target preview: ${preview || '(empty after trimming)'}`,
    `Target length: ${oldString.length} chars across ${oldLines} line(s).`,
    `File length: ${lines.length} line(s).`,
    closest ? `Closest candidate contexts:\n${closest}` : '',
    'Tip: call file_read with around/lineNumbers near a candidate line, then retry with exact whitespace and surrounding context.'
  ]

  return details.filter(Boolean).join('\n')
}

function buildShortUnifiedDiff(before: string, after: string, maxChars = 12000): string {
  const diff = generateUnifiedDiff(before.split(/\r?\n/), after.split(/\r?\n/), 2)
  if (diff.length <= maxChars) return diff
  return `${diff.slice(0, maxChars)}\n\n[Diff truncated. Use file_diff or file_read around changed lines for more context.]`
}

export const fileMutationTools: Record<string, ToolDefinition> = {
  file_write: {
    name: 'file_write',
    title: 'Write File',
    description:
      'Writes content to a local file. Files inside the workspace are written directly, while files outside the workspace require user approval.',
    tags: [
      'file',
      'write',
      'local',
      'save',
      '文件',
      '写入',
      '保存',
      '修改',
      '编辑',
      '创建',
      '翻译'
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
      try {
        const stats = await fs.stat(target.realPath)
        exists = true
        if (stats.isDirectory()) {
          throw new Error('Target path is a directory, not a file.')
        }
      } catch {
        // If file doesn't exist, stat throws ENOENT, which is expected
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

      const fileUrl = `file:///${target.realPath.replace(/\\/g, '/')}`

      // Writing establishes known content, so subsequent surgical edits in this run are allowed.
      if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(target.realPath)

      const resultForModel = `Successfully wrote file: ${target.relPath}\nRoot (${target.rootKind}): ${target.root}\nSize: ${contentBuffer.length} bytes\nPath: ${target.realPath}`

      return {
        resultForModel,
        resultForUi: {
          title: `Write File: ${target.relPath}`,
          url: fileUrl,
          summary: `Wrote ${contentBuffer.length} bytes to ${target.relPath} (${exists ? 'overwrote' : 'created'}) in ${target.rootKind} ${target.root}`
        }
      }
    }
  },
  file_edit: {
    name: 'file_edit',
    title: 'Edit File',
    description:
      'Performs exact string replacement in a file. Files inside the workspace are edited directly, while files outside the workspace require user approval. Provide the exact text to replace (old_string) and the new text (new_string). By default, old_string must match exactly one location — if it matches multiple locations the edit is rejected with a list of matching lines so you can add more surrounding context to make it unique. Use replace_all=true to replace every occurrence.',
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

      // Count occurrences
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
  },
  multi_edit: {
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
}
