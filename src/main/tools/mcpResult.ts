import { ToolResultUi } from '../../shared/types'
import { createToolResult, formatRawToolOutput } from './result'
import { ToolExecutionResult } from './types'

interface CreateMcpToolResultOptions {
  serverName: string
  toolName: string
  result: unknown
}

type ToolResultItem = NonNullable<ToolResultUi['items']>[number]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const safeJsonStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue: unknown) => {
        if (typeof nestedValue === 'bigint') return nestedValue.toString()
        if (typeof nestedValue !== 'object' || nestedValue === null) return nestedValue
        if (seen.has(nestedValue)) return '[Circular]'
        seen.add(nestedValue)
        return nestedValue
      },
      2
    )
  } catch {
    return String(value)
  }
}

const getContentParts = (result: unknown): unknown[] => {
  if (!isRecord(result) || !Array.isArray(result.content)) return []
  return result.content
}

const getStructuredContent = (result: unknown): unknown => {
  if (!isRecord(result) || !('structuredContent' in result)) return undefined
  return result.structuredContent
}

const getMetadata = (result: unknown): unknown => {
  if (!isRecord(result) || !('_meta' in result)) return undefined
  return result._meta
}

const hasValue = (value: unknown): boolean => value !== undefined && value !== null

const buildModelParts = (result: unknown): unknown[] => {
  const contentParts = getContentParts(result)
  const structuredContent = getStructuredContent(result)
  const metadata = getMetadata(result)
  const parts = [...contentParts]

  if (hasValue(structuredContent)) {
    parts.push({ type: 'structuredContent', structuredContent })
  }

  if (hasValue(metadata)) {
    parts.push({ type: 'metadata', metadata })
  }

  return parts.length > 0 ? parts : [result]
}

const buildDetails = (result: unknown): string => {
  const contentParts = getContentParts(result)
  const structuredContent = getStructuredContent(result)
  const metadata = getMetadata(result)
  const sections: string[] = []

  const contentDetails = formatRawToolOutput(contentParts)
  if (contentDetails.trim()) sections.push(contentDetails)

  if (hasValue(structuredContent)) {
    sections.push(`Structured content:\n${safeJsonStringify(structuredContent)}`)
  }

  if (hasValue(metadata)) {
    sections.push(`Metadata:\n${safeJsonStringify(metadata)}`)
  }

  if (sections.length > 0) return sections.join('\n\n')
  return formatRawToolOutput(result)
}

const toSnippet = (value: unknown, maxLength = 220): string | undefined => {
  const text = typeof value === 'string' ? value : formatRawToolOutput(value)
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean
}

const buildItems = (result: unknown): ToolResultUi['items'] => {
  const items = getContentParts(result)
    .map((part): ToolResultItem | undefined => {
      if (!isRecord(part) || !isRecord(part.resource)) return undefined
      const uri = part.resource.uri
      if (typeof uri !== 'string' || !uri.trim()) return undefined

      return {
        title: uri,
        url: uri,
        source: typeof part.type === 'string' ? part.type : 'resource',
        snippet: toSnippet(part.resource.text ?? part.resource.blob ?? part.resource)
      }
    })
    .filter((item): item is ToolResultItem => item !== undefined)

  return items.length > 0 ? items : undefined
}

const buildSummary = (result: unknown, toolName: string): string => {
  const contentCount = getContentParts(result).length
  const hasStructuredContent = hasValue(getStructuredContent(result))
  const hasMetadata = hasValue(getMetadata(result))
  const isError = isRecord(result) && result.isError === true

  const parts: string[] = []
  if (contentCount > 0) parts.push(`${contentCount} content item${contentCount === 1 ? '' : 's'}`)
  if (hasStructuredContent) parts.push('structured content')
  if (hasMetadata) parts.push('metadata')

  const suffix = parts.length > 0 ? `Returned ${parts.join(', ')}` : `Executed ${toolName}`
  return isError ? `MCP tool returned an error. ${suffix}` : suffix
}

export function createMcpToolResult(options: CreateMcpToolResultOptions): ToolExecutionResult {
  const modelOutput = formatRawToolOutput(buildModelParts(options.result))
  const details = buildDetails(options.result)

  return createToolResult({
    resultForModel: modelOutput || '(empty MCP result)',
    title: `MCP Tool Call: ${options.serverName} / ${options.toolName}`,
    summary: buildSummary(options.result, options.toolName),
    details: details || '(empty MCP result)',
    items: buildItems(options.result)
  })
}
