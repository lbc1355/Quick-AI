import { SafePath } from './filePathSafety'
import { createToolResult } from './result'
import { ToolExecutionResult } from './types'
import { FileReadWindow } from './fileReadWindow'

export interface CreateFileReadResultOptions {
  target: SafePath
  window: FileReadWindow
  totalLines: number
  includeLineNumbers: boolean
  resultText: string
}

export function createFileReadResult(options: CreateFileReadResultOptions): ToolExecutionResult {
  const { target, window, totalLines, includeLineNumbers, resultText } = options
  const isTruncated = window.startLine > 1 || window.endLine < totalLines
  const resultForModel = [
    `Root (${target.rootKind}): ${target.root}`,
    `File: ${target.relPath}`,
    `Lines: ${window.startLine} to ${window.endLine} of ${totalLines}`,
    `Read Mode: ${window.mode}`,
    includeLineNumbers ? 'Line Numbers: included in content.' : '',
    window.note ? `Note: ${window.note}` : '',
    isTruncated ? 'Note: file content was truncated.' : '',
    `Content:\n${resultText}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const fileUrl = `file:///${target.realPath.replace(/\\/g, '/')}`

  return createToolResult({
    resultForModel,
    title: `Read File: ${target.relPath}`,
    url: fileUrl,
    summary: `Read lines ${window.startLine}-${window.endLine} of ${totalLines} in ${target.rootKind} ${target.root}`,
    readStartLine: window.startLine,
    readEndLine: window.endLine
  })
}
