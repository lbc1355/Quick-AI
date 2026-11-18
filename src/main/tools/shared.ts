import { fetchUrl, renderWithLineNumbers, type FetchUrlResult } from '../webTools'
import { SessionResource } from '../../shared/types'
import { sliceUnicode } from '../../shared/unicodeText'
import { ToolExecutionContext, ToolExecutionResult } from './types'
import { saveResourceChunk, getResourceId } from '../resourceCache'
import { createToolResult } from './result'

// ---- fetch + cache helpers shared by web tools ----

const FETCH_URL_MODEL_RESULT_MAX_CHARS = 20000
const FETCH_URL_CACHED_CONTINUE_MAX_CHARS = 8000

interface FetchUrlModelResultOptions {
  result: FetchUrlResult
  resourceId: string
  cacheCoverage: string
  links: string
}

const buildFetchUrlBody = (
  options: FetchUrlModelResultOptions,
  visibleText: string,
  visibleEndOffset: number
): string => {
  const { result, resourceId, cacheCoverage, links } = options
  const wasDisplayWindowTrimmed = visibleEndOffset < result.endOffset
  const continueOffset =
    visibleEndOffset < result.totalChars
      ? visibleEndOffset
      : result.nextOffset !== undefined
        ? result.nextOffset
        : undefined
  const numberedText = renderWithLineNumbers(visibleText, 1)

  return [
    `URL: ${result.finalUrl}`,
    `Resource ID: ${resourceId}`,
    result.title ? `Title: ${result.title}` : '',
    result.rendered ? 'Rendered: page content was produced via headless JS rendering.' : '',
    `Content window: characters ${result.offset}-${result.endOffset} of ${result.totalChars}`,
    wasDisplayWindowTrimmed
      ? `Model-visible text: characters ${result.offset}-${visibleEndOffset} of ${result.totalChars}. The full fetched window was cached; read_cached_resource can reopen it.`
      : '',
    cacheCoverage,
    result.responseTruncated
      ? 'Warning: network response hit the fetch byte limit; later content may be unavailable.'
      : '',
    continueOffset !== undefined
      ? `More content available. To continue, call fetch_url with {"url":"${result.finalUrl}","offset":${continueOffset}}. If you need the already cached tail of this fetched window, call read_cached_resource with {"resourceId":"${resourceId}","offset":${continueOffset},"maxChars":${FETCH_URL_CACHED_CONTINUE_MAX_CHARS}}.`
      : 'End of fetched text.',
    links
      ? `Links (inlined in text as [N]; click with click_link {"resourceId":"${resourceId}","linkId":N}):\n${links}`
      : '',
    `Tip: search this page with find_in_page {"resourceId":"${resourceId}","query":"..."}.`,
    `Text (line-numbered):\n${numberedText}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildFetchUrlModelResult(options: FetchUrlModelResultOptions): string {
  const fullBody = buildFetchUrlBody(options, options.result.text, options.result.endOffset)
  if (fullBody.length <= FETCH_URL_MODEL_RESULT_MAX_CHARS) return fullBody

  let low = 0
  let high = options.result.text.length
  let best = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const visibleText = sliceUnicode(options.result.text, 0, mid)
    const visibleEndOffset = options.result.offset + visibleText.length
    const body = buildFetchUrlBody(options, visibleText, visibleEndOffset)
    if (body.length <= FETCH_URL_MODEL_RESULT_MAX_CHARS) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const visibleText = sliceUnicode(options.result.text, 0, best)
  return buildFetchUrlBody(options, visibleText, options.result.offset + visibleText.length)
}

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

    ctx.emitEvent?.({
      type: 'resource_update' as const,
      resource: sessionResource
    })
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

  const resultForModel = buildFetchUrlModelResult({
    result,
    resourceId,
    cacheCoverage,
    links
  })

  return createToolResult({
    resultForModel,
    title: result.title || undefined,
    url: result.finalUrl || undefined,
    summary: result.text
      ? `Read characters ${result.offset}-${result.endOffset} of ${result.totalChars}. ${result.text.slice(0, 160)}${result.text.length > 160 ? '...' : ''}`
      : `Read characters ${result.offset}-${result.endOffset} of ${result.totalChars}.`
  })
}
