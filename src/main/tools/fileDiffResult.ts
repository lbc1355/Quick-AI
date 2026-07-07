import { SafePath } from './filePathSafety'
import { createToolResult } from './result'
import { ToolExecutionResult } from './types'

export function createFileDiffResult(
  pathA: SafePath,
  pathB: SafePath,
  diffResult: string
): ToolExecutionResult {
  const resultForModel = `File A (${pathA.rootKind}): ${pathA.relPath}\nFile B (${pathB.rootKind}): ${pathB.relPath}\n\nDiff:\n${diffResult}`

  return createToolResult({
    resultForModel,
    title: `Compare Files: ${pathA.relPath} vs ${pathB.relPath}`,
    summary:
      diffResult === 'Files are identical.'
        ? 'Files are identical'
        : 'Generated file differences diff'
  })
}
