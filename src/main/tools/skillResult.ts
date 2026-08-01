import { pathToFileURL } from 'url'
import { ToolResultUi } from '../../shared/types'
import { createToolResult } from './result'
import { ToolExecutionResult } from './types'

export interface CreateSkillResultOptions {
  resultForModel: string
  title: string
  summary: string
  filePath?: string
  items?: ToolResultUi['items']
}

export function pathToFileUrl(path: string): string {
  return pathToFileURL(path).href
}

export function createSkillResult(options: CreateSkillResultOptions): ToolExecutionResult {
  return createToolResult({
    resultForModel: options.resultForModel,
    title: options.title,
    summary: options.summary,
    url: options.filePath ? pathToFileUrl(options.filePath) : undefined,
    items: options.items
  })
}
