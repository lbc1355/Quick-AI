import { createToolResult } from './result'
import { ToolExecutionResult } from './types'
import { toFileUrl } from './fileOperationResult'
import { WorkspaceFileMatch } from './workspaceListScanner'

export interface CreateWorkspaceListResultOptions {
  root: string
  rootKind: string
  globPattern: string
  matches: WorkspaceFileMatch[]
  scanTruncatedReason?: string
  ignoredDirectories?: string[]
  skippedIgnoredDirectories?: string[]
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
  const fileUrl = toFileUrl(match.absolutePath)
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
  const ignoreNotice = options.ignoredDirectories?.length
    ? `Default ignored directories: ${options.ignoredDirectories.join(', ')}. Set includeIgnoredDirectories=true only when the user explicitly needs those folders.`
    : ''

  let resultForModel = [
    `Root (${options.rootKind}): ${options.root}`,
    ignoreNotice,
    options.matches.length > 0
      ? options.matches.map(formatModelFile).join('\n\n')
      : `No files found matching glob: "${options.globPattern}"`
  ]
    .filter(Boolean)
    .join('\n\n')

  if (options.scanTruncatedReason) {
    resultForModel += `\n\n[Warning: Scan was truncated. Reason: ${options.scanTruncatedReason}]`
  }
  if (options.skippedIgnoredDirectories?.length) {
    resultForModel += `\n\n[Info: Skipped ignored directories during this scan: ${options.skippedIgnoredDirectories.join(', ')}]`
  }

  const summaryText =
    `Found ${options.matches.length} files in ${options.root}` +
    (options.skippedIgnoredDirectories?.length
      ? ` (Skipped ignored dirs: ${options.skippedIgnoredDirectories.join(', ')})`
      : '') +
    (options.scanTruncatedReason ? ` (Scan truncated: ${options.scanTruncatedReason})` : '')

  return createToolResult({
    resultForModel,
    title: `List Files: "${options.globPattern}"`,
    summary: summaryText,
    items: options.matches.map(formatUiItem)
  })
}
