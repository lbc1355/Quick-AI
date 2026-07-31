import { SafePath } from './filePathSafety'
import { createToolResult } from './result'
import { ToolExecutionResult } from './types'

export function toFileUrl(realPath: string): string {
  const normalized = realPath.replace(/\\/g, '/')
  // Percent-encode characters that would break the URL (spaces, "#", "?", unicode) while keeping
  // "/" and the Windows drive-colon literal, so file:///C:/foo%20bar.png stays valid.
  const encoded = normalized.replace(/[^a-zA-Z0-9\-._~:/]/g, (char) => encodeURIComponent(char))
  return `file:///${encoded}`
}

export function createFileWriteResult(
  target: SafePath,
  sizeBytes: number,
  existed: boolean,
  addedLines?: number,
  removedLines?: number
): ToolExecutionResult {
  const resultForModel = `Successfully wrote file: ${target.relPath}\nRoot (${target.rootKind}): ${target.root}\nSize: ${sizeBytes} bytes\nPath: ${target.realPath}`

  return createToolResult({
    resultForModel,
    title: `Write File: ${target.relPath}`,
    url: toFileUrl(target.realPath),
    summary: `Wrote ${sizeBytes} bytes to ${target.relPath} (${existed ? 'overwrote' : 'created'}) in ${target.rootKind} ${target.root}`,
    addedLines,
    removedLines
  })
}

export function createFileCopyResult(source: SafePath, destination: SafePath): ToolExecutionResult {
  return createToolResult({
    resultForModel: `Copied file:\nFrom: ${source.relPath}\nTo: ${destination.relPath}`,
    title: `Copy File: ${source.relPath}`,
    url: toFileUrl(destination.realPath),
    summary: `Copied ${source.relPath} to ${destination.relPath}`
  })
}

export function createFileMoveResult(source: SafePath, destination: SafePath): ToolExecutionResult {
  return createToolResult({
    resultForModel: `Moved path:\nFrom: ${source.relPath}\nTo: ${destination.relPath}`,
    title: `Move Path: ${source.relPath}`,
    url: toFileUrl(destination.realPath),
    summary: `Moved ${source.relPath} to ${destination.relPath}`
  })
}

export function createFileDeleteResult(target: SafePath): ToolExecutionResult {
  return createToolResult({
    resultForModel: `Deleted path: ${target.relPath}`,
    title: `Delete Path: ${target.relPath}`,
    summary: `Deleted ${target.relPath}`
  })
}
