import { AgentEvent, SessionResource, SessionResourceChunk } from '../../shared/types'
import { getResourceId, saveResourceChunk } from '../resourceCache'

export const TOOL_OUTPUT_RESOURCE_CHUNK_CHARS = 16000
export type ToolOutputProjectionMode = 'head' | 'head_tail'

export const getToolOutputProjectionMode = (toolName: string): ToolOutputProjectionMode =>
  toolName === 'shell' || toolName.startsWith('shell_background_') ? 'head_tail' : 'head'

export interface PersistToolOutputResourceOptions {
  reqId: string
  callId: string
  toolName: string
  content: string
  previewChars: number
  projectionMode?: ToolOutputProjectionMode
  emitEvent?: (event: AgentEvent) => void
}

export interface ToolOutputResourceProjection {
  resourceId: string
  resource?: SessionResource
  contentForModel: string
  previewEndOffset: number
  tailStartOffset?: number
  nextOffset?: number
}

export interface ToolOutputHeadTailPreview {
  mode: ToolOutputProjectionMode
  head: string
  tail: string
  headEndOffset: number
  tailStartOffset: number
  visibleChars: number
  totalLines: number
}

export function projectToolOutputHeadTail(
  content: string,
  previewChars: number
): ToolOutputHeadTailPreview {
  const budget = Math.max(2, Math.floor(previewChars))
  const headChars = Math.ceil(budget / 2)
  const tailChars = Math.floor(budget / 2)
  const headEndOffset = Math.min(content.length, headChars)
  const tailStartOffset = Math.max(headEndOffset, content.length - tailChars)
  return {
    mode: 'head_tail',
    head: content.slice(0, headEndOffset),
    tail: content.slice(tailStartOffset),
    headEndOffset,
    tailStartOffset,
    visibleChars: headEndOffset + Math.max(0, content.length - tailStartOffset),
    totalLines: content ? content.split(/\r?\n/).length : 0
  }
}

export function projectToolOutputHead(
  content: string,
  previewChars: number
): ToolOutputHeadTailPreview {
  const headEndOffset = Math.min(content.length, Math.max(1, Math.floor(previewChars)))
  return {
    mode: 'head',
    head: content.slice(0, headEndOffset),
    tail: '',
    headEndOffset,
    tailStartOffset: content.length,
    visibleChars: headEndOffset,
    totalLines: content ? content.split(/\r?\n/).length : 0
  }
}

const createChunk = (
  callId: string,
  text: string,
  offset: number,
  endOffset: number,
  now: number
): SessionResourceChunk => ({
  id: `tool-output-${callId}-${offset}-${endOffset}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
  offset,
  endOffset,
  text,
  summary: text.slice(0, 160) + (text.length > 160 ? '...' : ''),
  createdAt: now
})

const buildProjectionContent = (options: {
  toolName: string
  resourceId: string
  totalChars: number
  preview: ToolOutputHeadTailPreview
  nextOffset?: number
}): string => {
  const lines = [
    'Tool output exceeded the model-visible limit and was saved to the resource cache.',
    `Tool: ${options.toolName}`,
    `Resource ID: ${options.resourceId}`,
    `Total chars: ${options.totalChars}`,
    `Total lines: ${options.preview.totalLines}`,
    `Model-visible chars: ${options.preview.visibleChars}`,
    `Head offset: 0-${options.preview.headEndOffset}`,
    options.preview.mode === 'head_tail'
      ? `Tail offset: ${options.preview.tailStartOffset}-${options.totalChars}`
      : '',
    options.nextOffset !== undefined ? `Next offset: ${options.nextOffset}` : 'End of output.',
    options.nextOffset !== undefined
      ? `To continue reading, call read_cached_resource with {"resourceId":"${options.resourceId}","offset":${options.nextOffset},"maxChars":8000}.`
      : '',
    `To search this output, call search_cached_resource with {"resourceId":"${options.resourceId}","query":"..."}.`,
    `To read specific lines, call read_cached_resource with {"resourceId":"${options.resourceId}","lineStart":1,"lineEnd":200}.`,
    options.preview.mode === 'head_tail'
      ? `To read the last lines, call read_cached_resource with {"resourceId":"${options.resourceId}","tailLines":100}.`
      : '',
    '',
    'Head preview:',
    options.preview.head,
    options.preview.mode === 'head_tail' ? 'Tail preview:' : '',
    options.preview.mode === 'head_tail' ? options.preview.tail : ''
  ]

  return lines.filter(Boolean).join('\n')
}

export async function persistToolOutputResource(
  options: PersistToolOutputResourceOptions
): Promise<ToolOutputResourceProjection | undefined> {
  const totalChars = options.content.length
  if (totalChars <= options.previewChars) return undefined

  const source = `tool-output://${options.reqId}/${options.callId}/${options.toolName}`
  const resourceId = getResourceId(source)
  const now = Date.now()
  const projectionMode = options.projectionMode || 'head'
  const preview =
    projectionMode === 'head_tail'
      ? projectToolOutputHeadTail(options.content, options.previewChars)
      : projectToolOutputHead(options.content, options.previewChars)
  const previewEndOffset = preview.headEndOffset
  const firstEndOffset = Math.min(totalChars, TOOL_OUTPUT_RESOURCE_CHUNK_CHARS)
  let lastResource: SessionResource | undefined

  for (let offset = 0; offset < totalChars; ) {
    const endOffset =
      offset === 0
        ? firstEndOffset
        : Math.min(totalChars, offset + TOOL_OUTPUT_RESOURCE_CHUNK_CHARS)
    const text = options.content.slice(offset, endOffset)
    const chunk = createChunk(options.callId, text, offset, endOffset, now)
    lastResource = await saveResourceChunk(
      resourceId,
      'terminal',
      source,
      `Tool output: ${options.toolName}`,
      totalChars,
      endOffset < totalChars ? endOffset : undefined,
      chunk
    )
    offset = endOffset
  }

  if (lastResource) {
    options.emitEvent?.({
      type: 'resource_update',
      resource: lastResource
    })
  }

  const nextOffset = previewEndOffset < totalChars ? previewEndOffset : undefined

  return {
    resourceId,
    ...(lastResource ? { resource: lastResource } : {}),
    previewEndOffset,
    ...(projectionMode === 'head_tail' ? { tailStartOffset: preview.tailStartOffset } : {}),
    nextOffset,
    contentForModel: buildProjectionContent({
      toolName: options.toolName,
      resourceId,
      totalChars,
      preview,
      nextOffset
    })
  }
}
