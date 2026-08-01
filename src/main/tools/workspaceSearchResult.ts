import { createToolResult } from './result'
import { ToolExecutionResult } from './types'
import { toFileUrl } from './fileOperationResult'
import { WorkspaceSearchMatch } from './workspaceSearchScanner'

export interface CreateWorkspaceSearchResultOptions {
  root: string
  rootKind: string
  query: string
  matches: WorkspaceSearchMatch[]
  scanTruncatedReason?: string
}

const MAX_RESULT_LEN = 25000

function formatModelMatch(match: WorkspaceSearchMatch): string {
  const contextStr = [
    ...match.contextBefore.map((line) => `  [${match.lineNumber - 1}] ${line}`),
    `* [${match.lineNumber}] ${match.lineContent}`,
    ...match.contextAfter.map((line) => `  [${match.lineNumber + 1}] ${line}`)
  ].join('\n')
  return `File: ${match.relativePath} (Line ${match.lineNumber})\nContext:\n${contextStr}`
}

function formatUiItem(match: WorkspaceSearchMatch): {
  title: string
  url: string
  snippet: string
  source: string
} {
  const fileUrl = toFileUrl(match.absolutePath)
  const contextStr = [
    ...match.contextBefore.map((line) => `[${match.lineNumber - 1}] ${line}`),
    `[${match.lineNumber}] ${match.lineContent}`,
    ...match.contextAfter.map((line) => `[${match.lineNumber + 1}] ${line}`)
  ].join('\n')

  return {
    title: `${match.relativePath} Line ${match.lineNumber}`,
    url: fileUrl,
    snippet: contextStr,
    source: 'Workspace'
  }
}

export function createWorkspaceSearchResult(
  options: CreateWorkspaceSearchResultOptions
): ToolExecutionResult {
  let resultForModel = [
    `Root (${options.rootKind}): ${options.root}`,
    options.matches.length > 0
      ? options.matches.map(formatModelMatch).join('\n\n')
      : `No matches found in workspace for query: "${options.query}"`
  ].join('\n\n')

  if (options.scanTruncatedReason) {
    resultForModel += `\n\n[Warning: Search scan was truncated. Reason: ${options.scanTruncatedReason}]`
  }

  if (resultForModel.length > MAX_RESULT_LEN) {
    resultForModel =
      resultForModel.slice(0, MAX_RESULT_LEN) +
      '\n\n[Results truncated. Refine your query or use glob to narrow the search.]'
  }

  const summaryText =
    `Found ${options.matches.length} matches in ${options.root}` +
    (options.scanTruncatedReason ? ` (Scan truncated: ${options.scanTruncatedReason})` : '')

  return createToolResult({
    resultForModel,
    title: `Workspace Search: "${options.query}"`,
    summary: summaryText,
    items: options.matches.map(formatUiItem)
  })
}
