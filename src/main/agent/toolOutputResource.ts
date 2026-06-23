import { AgentEvent, SessionResource, SessionResourceChunk } from '../../shared/types'
import { getResourceId, saveResourceChunk } from '../resourceCache'

export const TOOL_OUTPUT_RESOURCE_CHUNK_CHARS = 16000

export interface PersistToolOutputResourceOptions {
  reqId: string
  callId: string
  toolName: string
  content: string
  previewChars: number
  emitEvent?: (event: AgentEvent) => void
}

export interface ToolOutputResourceProjection {
  resourceId: string
  contentForModel: string
  previewEndOffset: number
  nextOffset?: number
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
  preview: string
  previewEndOffset: number
  nextOffset?: number
}): string => {
  const lines = [
    'Tool output exceeded the model-visible limit and was saved to the resource cache.',
    `Tool: ${options.toolName}`,
    `Resource ID: ${options.resourceId}`,
    `Total chars: ${options.totalChars}`,
    `Returned offset: 0-${options.previewEndOffset}`,
    options.nextOffset !== undefined ? `Next offset: ${options.nextOffset}` : 'End of output.',
    options.nextOffset !== undefined
      ? `To continue reading, call read_cached_resource with {"resourceId":"${options.resourceId}","offset":${options.nextOffset}}.`
      : '',
    `To search this output, call search_cached_resource with {"resourceId":"${options.resourceId}","query":"..."}.`,
    '',
    'Head preview:',
    options.preview
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
  const previewEndOffset = Math.min(totalChars, Math.max(0, Math.floor(options.previewChars)))
  const firstEndOffset =
    previewEndOffset > 0 ? previewEndOffset : Math.min(totalChars, TOOL_OUTPUT_RESOURCE_CHUNK_CHARS)
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

  const preview = options.content.slice(0, previewEndOffset)
  const nextOffset = previewEndOffset < totalChars ? previewEndOffset : undefined

  return {
    resourceId,
    previewEndOffset,
    nextOffset,
    contentForModel: buildProjectionContent({
      toolName: options.toolName,
      resourceId,
      totalChars,
      preview,
      previewEndOffset,
      nextOffset
    })
  }
}
