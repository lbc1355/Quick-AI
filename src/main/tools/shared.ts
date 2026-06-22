import { fetchUrl, renderWithLineNumbers } from '../webTools'
import { SessionResource } from '../../shared/types'
import { ToolExecutionContext, ToolExecutionResult } from './types'
import { saveResourceChunk, getResourceId } from '../resourceCache'
import { createToolResult } from './result'

// ---- fetch + cache helpers shared by web tools ----

export async function fetchCacheAndFormat(
  url: string,
  ctx: ToolExecutionContext,
  opts: { offset?: number; maxChars?: number; render?: boolean }
): Promise<ToolExecutionResult> {
  const result = await fetchUrl(url, ctx.signal, opts)
  const resourceId = getResourceId(result.finalUrl)

  let sessionResource: SessionResource | undefined

  if (result.text.length > 0 && result.endOffset > result.offset) {
    const chunkId = `chunk-${result.offset}-${result.endOffset}`
    const chunk = {
      id: chunkId,
      offset: result.offset,
      endOffset: result.endOffset,
      text: result.text,
      summary: result.text.slice(0, 160) + (result.text.length > 160 ? '...' : ''),
      createdAt: Date.now()
    }

    sessionResource = await saveResourceChunk(
      resourceId,
      'web',
      result.finalUrl,
      result.title || undefined,
      result.totalChars,
      result.nextOffset,
      chunk,
      result.links
    )

    const event = {
      type: 'resource_update' as const,
      resource: sessionResource
    }
    if (ctx.emitEvent) {
      ctx.emitEvent(event)
    } else if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('chat-chunk', {
        reqId: ctx.reqId,
        event
      })
    }
  }

  const links = result.links
    .slice(0, 25)
    .map((link) => `[${link.id}] ${link.text} - ${link.href}`)
    .join('\n')

  const cacheCoverage = sessionResource
    ? [
        `Cached coverage status: ${sessionResource.status}`,
        sessionResource.fetchedRanges && sessionResource.fetchedRanges.length > 0
          ? `Cached read ranges: ${sessionResource.fetchedRanges.map((range) => `${range.start}-${range.end}`).join(', ')}`
          : '',
        sessionResource.nextOffset !== undefined
          ? `Next unread offset: ${sessionResource.nextOffset}`
          : '',
        sessionResource.status !== 'complete'
          ? 'Coverage warning: this cached resource is incomplete. Do not claim the full resource has been read.'
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const numberedText = renderWithLineNumbers(result.text, 1)

  const body = [
    `URL: ${result.finalUrl}`,
    `Resource ID: ${resourceId}`,
    result.title ? `Title: ${result.title}` : '',
    result.rendered ? 'Rendered: page content was produced via headless JS rendering.' : '',
    `Content window: characters ${result.offset}-${result.endOffset} of ${result.totalChars}`,
    cacheCoverage,
    result.responseTruncated
      ? 'Warning: network response hit the fetch byte limit; later content may be unavailable.'
      : '',
    result.nextOffset !== undefined
      ? `More content available. To continue, call fetch_url with {"url":"${result.finalUrl}","offset":${result.nextOffset}}.`
      : 'End of fetched text.',
    links
      ? `Links (inlined in text as [N]; click with click_link {"resourceId":"${resourceId}","linkId":N}):\n${links}`
      : '',
    `Tip: search this page with find_in_page {"resourceId":"${resourceId}","query":"..."}.`,
    `Text (line-numbered):\n${numberedText}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const resultForModel =
    body.length > 20000
      ? `${body.slice(0, 20000)}\n\n[Tool result truncated after 20000 characters. Continue with nextOffset if more content is needed.]`
      : body

  return createToolResult({
    resultForModel,
    title: result.title || undefined,
    url: result.finalUrl || undefined,
    summary: result.text
      ? `Read characters ${result.offset}-${result.endOffset} of ${result.totalChars}. ${result.text.slice(0, 160)}${result.text.length > 160 ? '...' : ''}`
      : `Read characters ${result.offset}-${result.endOffset} of ${result.totalChars}.`
  })
}
