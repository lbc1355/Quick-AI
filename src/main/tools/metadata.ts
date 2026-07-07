import { ToolDefinition } from './types'

const TOOL_CATEGORIES = ['web', 'file', 'shell', 'memory', 'system'] as const
const TOOL_RISKS = ['low', 'medium', 'high'] as const
const TOOL_SOURCES = ['builtin', 'mcp', 'skill', 'plugin', 'external'] as const

const isOneOf = <T extends readonly string[]>(value: unknown, allowed: T): value is T[number] =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)

const normalizeText = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`Tool definition ${field} must be a string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Tool definition ${field} cannot be empty`)
  }
  return trimmed
}

const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) return []
  const normalized = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return Array.from(new Set(normalized))
}

const normalizeParameters = (
  parameters: ToolDefinition['parameters']
): ToolDefinition['parameters'] => {
  const raw =
    parameters && typeof parameters === 'object' ? (parameters as Record<string, unknown>) : {}
  const rawProperties = raw.properties
  const properties =
    rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties)
      ? (rawProperties as ToolDefinition['parameters']['properties'])
      : {}
  const required = Array.isArray(raw.required)
    ? raw.required.filter((value): value is string => typeof value === 'string')
    : undefined

  return {
    type: 'object',
    properties,
    ...(required && required.length > 0 ? { required } : {})
  }
}

export function normalizeToolDefinition(definition: ToolDefinition): ToolDefinition {
  const name = normalizeText(definition.name, 'name')
  const title = normalizeText(definition.title, 'title')
  const description = normalizeText(definition.description, 'description')

  if (!isOneOf(definition.category, TOOL_CATEGORIES)) {
    throw new Error(
      `Tool definition "${name}" has invalid category: ${String(definition.category)}`
    )
  }
  if (!isOneOf(definition.risk, TOOL_RISKS)) {
    throw new Error(`Tool definition "${name}" has invalid risk: ${String(definition.risk)}`)
  }
  if (definition.source !== undefined && !isOneOf(definition.source, TOOL_SOURCES)) {
    throw new Error(`Tool definition "${name}" has invalid source: ${String(definition.source)}`)
  }
  if (typeof definition.implemented !== 'boolean') {
    throw new Error(`Tool definition "${name}" implemented must be a boolean`)
  }
  if (typeof definition.discoverable !== 'boolean') {
    throw new Error(`Tool definition "${name}" discoverable must be a boolean`)
  }
  if (typeof definition.execute !== 'function') {
    throw new Error(`Tool definition "${name}" execute must be a function`)
  }

  return {
    ...definition,
    name,
    title,
    description,
    tags: normalizeTags(definition.tags),
    source: definition.source || 'builtin',
    parameters: normalizeParameters(definition.parameters)
  }
}
