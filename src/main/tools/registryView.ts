import { ToolDefinition } from './types'

export interface ToolRegistryView {
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
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
