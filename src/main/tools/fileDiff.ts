import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'

interface SafeFilePath {
  rootKind: string
  realPath: string
  relPath: string
}

type FileRootArg = 'workspace' | 'project' | undefined

interface FileDiffToolDeps {
  rootParameter: ToolDefinition['parameters']['properties'][string]
  getRootArg: (args: ToolArgs) => FileRootArg
  getNamedRootArg: (args: ToolArgs, key: string) => FileRootArg
  resolveExistingSafePath: (
    inputPath: string,
    ctx: ToolExecutionContext,
    label?: string,
    requestedRoot?: FileRootArg
  ) => Promise<SafeFilePath>
}

interface DiffChange {
  type: 'added' | 'removed' | 'unchanged'
  value: string
  lineA?: number
  lineB?: number
}

export function generateUnifiedDiff(a: string[], b: string[], contextSize = 3): string {
  const maxLines = 2000
  const linesA = a.slice(0, maxLines)
  const linesB = b.slice(0, maxLines)

  const m = linesA.length
  const n = linesB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const changes: DiffChange[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      changes.unshift({ type: 'unchanged', value: linesA[i - 1], lineA: i, lineB: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'added', value: linesB[j - 1], lineB: j })
      j--
    } else {
      changes.unshift({ type: 'removed', value: linesA[i - 1], lineA: i })
      i--
    }
  }

  const outputLines: string[] = []
  let hunk: DiffChange[] = []
  let contextBefore: DiffChange[] = []
  let contextAfterCount = 0
  let inHunk = false

  const flushHunk = (): void => {
    if (hunk.length === 0) return
    const firstChange = hunk.find((c) => c.type !== 'unchanged') || hunk[0]
    const startA = firstChange.lineA ?? hunk[0].lineA ?? 1
    const startB = firstChange.lineB ?? hunk[0].lineB ?? 1
    const countA = hunk.filter((c) => c.type !== 'added').length
    const countB = hunk.filter((c) => c.type !== 'removed').length

    outputLines.push(`@@ -${startA},${countA} +${startB},${countB} @@`)
    for (const c of hunk) {
      if (c.type === 'added') outputLines.push(`+ ${c.value}`)
      else if (c.type === 'removed') outputLines.push(`- ${c.value}`)
      else outputLines.push(`  ${c.value}`)
    }
    hunk = []
  }

  for (const c of changes) {
    if (c.type === 'unchanged') {
      if (inHunk) {
        hunk.push(c)
        contextAfterCount++
        if (contextAfterCount >= contextSize) {
          flushHunk()
          inHunk = false
        }
      } else {
        contextBefore.push(c)
        if (contextBefore.length > contextSize) {
          contextBefore.shift()
        }
      }
    } else {
      if (!inHunk) {
        hunk.push(...contextBefore)
        contextBefore = []
        inHunk = true
      }
      hunk.push(c)
      contextAfterCount = 0
    }
  }

  if (inHunk) {
    flushHunk()
  }

  if (a.length > maxLines || b.length > maxLines) {
    outputLines.push(`\n[Warning: Files were truncated to ${maxLines} lines for diff comparison]`)
  }

  return outputLines.length > 0 ? outputLines.join('\n') : 'Files are identical.'
}

export function createFileDiffTool(deps: FileDiffToolDeps): ToolDefinition {
  return {
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
        root_a: deps.rootParameter,
        path_b: {
          type: 'string',
          description: 'The relative or absolute path to the second file.'
        },
        root_b: deps.rootParameter,
        root: deps.rootParameter
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

      const pathA = await deps.resolveExistingSafePath(
        filePathA,
        ctx,
        'Path_A',
        deps.getNamedRootArg(args, 'root_a') || deps.getRootArg(args)
      )
      const pathB = await deps.resolveExistingSafePath(
        filePathB,
        ctx,
        'Path_B',
        deps.getNamedRootArg(args, 'root_b') || deps.getRootArg(args)
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

      return {
        resultForModel: `File A (${pathA.rootKind}): ${pathA.relPath}\nFile B (${pathB.rootKind}): ${pathB.relPath}\n\nDiff:\n${diffResult}`,
        resultForUi: {
          title: `Compare Files: ${pathA.relPath} vs ${pathB.relPath}`,
          summary:
            diffResult === 'Files are identical.'
              ? 'Files are identical'
              : 'Generated file differences diff'
        }
      }
    }
  }
}
