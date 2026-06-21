import { createToolResult } from './result'
import { ToolExecutionResult } from './types'
import { WorkspaceFileMatch } from './workspaceListScanner'

export interface CreateWorkspaceListResultOptions {
  root: string
  rootKind: string
  globPattern: string
  matches: WorkspaceFileMatch[]
  scanTruncatedReason?: string
}

function formatModelFile(match: WorkspaceFileMatch): string {
  return `File: ${match.relativePath}\nSize: ${match.size} bytes\nModified: ${match.modifiedTime}`
}

function formatUiItem(match: WorkspaceFileMatch): {
  title: string
  url: string
  snippet: string
  source: string
} {
  const fileUrl = `file:///${match.absolutePath.replace(/\\/g, '/')}`
  return {
    title: match.relativePath,
    url: fileUrl,
    snippet: `Size: ${match.size} bytes, Modified: ${match.modifiedTime}`,
    source: 'Workspace'
  }
}

export function createWorkspaceListResult(
  options: CreateWorkspaceListResultOptions
): ToolExecutionResult {
  let resultForModel = [
    `Root (${options.rootKind}): ${options.root}`,
    options.matches.length > 0
      ? options.matches.map(formatModelFile).join('\n\n')
      : `No files found matching glob: "${options.globPattern}"`
  ].join('\n\n')

  if (options.scanTruncatedReason) {
    resultForModel += `\n\n[Warning: Scan was truncated. Reason: ${options.scanTruncatedReason}]`
  }

  const summaryText =
    `Found ${options.matches.length} files in ${options.root}` +
    (options.scanTruncatedReason ? ` (Scan truncated: ${options.scanTruncatedReason})` : '')

  return createToolResult({
    resultForModel,
    title: `List Files: "${options.globPattern}"`,
    summary: summaryText,
    items: options.matches.map(formatUiItem)
  })
}
