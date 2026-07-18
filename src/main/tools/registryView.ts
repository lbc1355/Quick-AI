import { ToolDefinition } from './types'

export interface ToolRegistryView {
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
}

export type MaterializedToolResolution =
  | { status: 'current'; tool: ToolDefinition }
  | { status: 'stale' }
  | { status: 'unknown' }

/** Immutable registry view captured before a model turn. */
export interface MaterializedToolRegistryView extends ToolRegistryView {
  readonly revision: number
  resolve(name: string): MaterializedToolResolution
}

export type ToolRegistrySource = ToolRegistryView | Record<string, ToolDefinition | undefined>

const isRegistryView = (source: ToolRegistrySource): source is ToolRegistryView =>
  typeof (source as ToolRegistryView).get === 'function' &&
  typeof (source as ToolRegistryView).list === 'function'

export function toToolRegistryView(source: ToolRegistrySource): ToolRegistryView {
  if (isRegistryView(source)) {
    return source
  }

  return {
    get: (name) => source[name],
    list: () =>
      Object.keys(source)
        .map((name) => source[name])
        .filter((tool): tool is ToolDefinition => !!tool)
  }
}

let fallbackMaterializationRevision = 0

export function materializeToolRegistry(source: ToolRegistryView): MaterializedToolRegistryView {
  const materializable = source as ToolRegistryView & {
    materialize?: () => MaterializedToolRegistryView
  }
  if (typeof materializable.materialize === 'function') {
    return materializable.materialize()
  }

  const tools = new Map(source.list().map((tool) => [tool.name, tool]))
  fallbackMaterializationRevision += 1
  return {
    revision: fallbackMaterializationRevision,
    get: (name) => tools.get(name),
    list: () => Array.from(tools.values()),
    resolve: (name) => {
      const captured = tools.get(name)
      if (!captured) return { status: 'unknown' }
      return source.get(name) === captured
        ? { status: 'current', tool: captured }
        : { status: 'stale' }
    }
  }
}

export function resolveMaterializedTool(
  source: ToolRegistryView,
  name: string
): MaterializedToolResolution {
  const materialized = source as Partial<MaterializedToolRegistryView>
  if (typeof materialized.resolve === 'function') {
    return materialized.resolve(name)
  }
  const tool = source.get(name)
  return tool ? { status: 'current', tool } : { status: 'unknown' }
}
