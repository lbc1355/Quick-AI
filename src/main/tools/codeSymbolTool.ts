import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import { ROOT_PARAMETER, getRootArg, resolveExistingSafePath } from './filePathSafety'
import { toFileUrl } from './fileOperationResult'
import { createToolResult } from './result'
import { formatSelectionReason, rankSymbolCandidates } from './codeSymbolSelection'
import { findSymbolMatchesInContent } from './codeSymbolPatterns'
import { buildBoundedSymbolBlock, inferSymbolBlockRange } from './codeSymbolBlock'
import { scanWorkspaceForSymbol } from './codeSymbolScanner'
import type { SymbolMatch } from './codeSymbolTypes'

function normalizeLineNumberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback
}

export const codeSymbolTool: ToolDefinition = {
  name: 'code_symbol_read',
  title: 'Read Code Symbol',
  description:
    'Locate a function, class, method, type, interface, or enum by symbol name and return the surrounding code block with file and line metadata. If path is omitted, searches the current project/global workspace.',
  tags: [
    'code',
    'symbol',
    'definition',
    'function',
    'class',
    'method',
    'jump',
    '定位',
    '函数',
    '类',
    '代码块'
  ],
  dependencies: ['file_read', 'workspace_search'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to locate, such as a function, class, method, type, or enum.'
      },
      path: {
        type: 'string',
        description:
          'Optional file path to search first. If omitted, the tool searches the current project/global workspace.'
      },
      root: ROOT_PARAMETER,
      contextLines: {
        type: 'number',
        description: 'Extra lines before and after the symbol block (default: 2).'
      },
      maxLines: {
        type: 'number',
        description: 'Maximum lines to return for the symbol block (default: 240, max: 500).'
      }
    },
    required: ['symbol']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : ''
    if (!symbol) throw new Error('Missing or invalid symbol parameter')

    const contextLines = Math.min(normalizeLineNumberArg(args.contextLines, 2), 20)
    const maxLines = Math.min(normalizeLineNumberArg(args.maxLines, 240), 500)
    const requestedRoot = getRootArg(args)
    const requestedPath = typeof args.path === 'string' && args.path.trim() ? args.path : ''

    let matches: SymbolMatch[] = []
    let truncatedReason: string | undefined

    if (requestedPath) {
      const target = await resolveExistingSafePath(requestedPath, ctx, 'Path', requestedRoot)
      const stats = await fs.stat(target.realPath)
      if (stats.isDirectory()) throw new Error('Path is a directory, not a file.')
      if (stats.size > 2 * 1024 * 1024) {
        throw new Error(
          `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`
        )
      }
      const content = await fs.readFile(target.realPath, 'utf-8')
      matches = findSymbolMatchesInContent(content, symbol, {
        realPath: target.realPath,
        relPath: target.relPath,
        root: target.root,
        rootKind: target.rootKind
      })
    } else {
      const scanResult = await scanWorkspaceForSymbol(symbol, ctx, requestedRoot)
      matches = scanResult.matches
      truncatedReason = scanResult.truncatedReason
    }

    if (matches.length === 0) {
      const resultForModel =
        `No definition-like symbol match found for "${symbol}".` +
        (requestedPath
          ? ' Try workspace_search for text references or verify the file path.'
          : ' Try workspace_search with the symbol text or provide a path.')

      return createToolResult({
        resultForModel,
        title: `Code Symbol: ${symbol}`,
        summary: 'No definition-like symbol match found'
      })
    }

    const rankedCandidates = rankSymbolCandidates(symbol, matches)
    const bestRanked = rankedCandidates[0]
    const best = bestRanked.match
    const content = await fs.readFile(best.realPath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const range = inferSymbolBlockRange(lines, best.lineIndex, maxLines, contextLines)
    const blockResult = buildBoundedSymbolBlock(lines.slice(range.startIndex, range.endIndex + 1))
    const candidateLines = rankedCandidates.slice(0, 10).map((candidate, index) => {
      const match = candidate.match
      const selected = match === best ? ' selected' : ''
      return `${index + 1}. ${match.relPath}:${match.lineNumber} (${match.kind}, score ${candidate.score})${selected} - ${match.lineText.slice(0, 140)}`
    })
    const candidateItems = rankedCandidates.slice(0, 20).map((candidate) => {
      const match = candidate.match
      return {
        title: `${match.relPath}:${match.lineNumber} (${match.kind})`,
        url: toFileUrl(match.realPath),
        snippet: `${match.lineText}\nScore: ${candidate.score}. ${candidate.reasons.join(', ')}`,
        source: 'code_symbol_read'
      }
    })
    const selectionReason = formatSelectionReason(bestRanked, matches.length)

    if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(best.realPath)

    const resultForModel = [
      `Root (${best.rootKind}): ${best.root}`,
      `Symbol: ${symbol}`,
      `Kind: ${best.kind}`,
      `File: ${best.relPath}`,
      `Definition Line: ${best.lineNumber} of ${lines.length}`,
      `Block Lines: ${range.startIndex + 1}-${range.endIndex + 1} of ${lines.length}`,
      `Selection Reason: ${selectionReason}`,
      matches.length > 1 ? `Candidates:\n${candidateLines.join('\n')}` : '',
      truncatedReason ? `Warning: Symbol search was truncated. Reason: ${truncatedReason}` : '',
      range.truncated ? 'Warning: Symbol block was truncated by maxLines.' : '',
      blockResult.truncated
        ? `Warning: Symbol block output was truncated to keep the UI responsive.`
        : '',
      `Content:\n${blockResult.block}`
    ]
      .filter(Boolean)
      .join('\n\n')

    return createToolResult({
      resultForModel,
      title: `Code Symbol: ${symbol}`,
      url: toFileUrl(best.realPath),
      summary:
        `${best.relPath}:${best.lineNumber} (${best.kind}), lines ${range.startIndex + 1}-${range.endIndex + 1}` +
        (matches.length > 1 ? `, ${matches.length} candidates` : ''),
      items: candidateItems
    })
  }
}
