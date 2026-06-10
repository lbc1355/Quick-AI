import { fetchUrl, renderWithLineNumbers } from '../webTools'
import {
  ToolArgs,
  MemoryDoc,
  MemoryDocKind,
  MemoryDocScope,
  SessionResource
} from '../../shared/types'
import { ToolExecutionContext } from './types'
import { saveResourceChunk, getResourceId } from '../resourceCache'

// ---- fetch + cache helpers shared by web tools ----

export async function fetchCacheAndFormat(
  url: string,
  ctx: ToolExecutionContext,
  opts: { offset?: number; maxChars?: number }
): Promise<{
  resultForModel: string
  resultForUi: { title?: string; url?: string; summary: string }
}> {
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

    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('chat-chunk', {
        reqId: ctx.reqId,
        event: {
          type: 'resource_update',
          resource: sessionResource
        }
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

  return {
    resultForModel,
    resultForUi: {
      title: result.title || undefined,
      url: result.finalUrl || undefined,
      summary: result.text
        ? `Read characters ${result.offset}-${result.endOffset} of ${result.totalChars}. ${result.text.slice(0, 160)}${result.text.length > 160 ? '...' : ''}`
        : `Read characters ${result.offset}-${result.endOffset} of ${result.totalChars}.`
    }
  }
}

// ---- memory doc helpers shared by memory tools ----

export const DEFAULT_MEMORY_DOC_KEY = 'default'
export const DEFAULT_MEMORY_DOC_TITLE = 'QuickAI Memory'

export function normalizeDocKind(value: unknown): MemoryDocKind {
  return value === 'soul' ? 'soul' : 'memory'
}

export function normalizeDocScope(value: unknown): MemoryDocScope {
  return value === 'global' ? 'global' : 'session'
}

export function normalizeDocKey(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, 120) : DEFAULT_MEMORY_DOC_KEY
}

export function getMemoryDocIdentity(
  args: ToolArgs,
  sessionId?: string
): { kind: MemoryDocKind; scope: MemoryDocScope; sessionId?: string; key: string } {
  let scope = normalizeDocScope(args.scope)
  if (scope === 'session' && !sessionId) scope = 'global'
  return {
    kind: normalizeDocKind(args.kind),
    scope,
    sessionId: scope === 'session' ? sessionId : undefined,
    key: normalizeDocKey(args.key)
  }
}

export function formatMemoryDocHeader(doc: MemoryDoc): string {
  const scope = doc.scope === 'session' ? `session:${doc.sessionId || 'unknown'}` : 'global'
  return `[${doc.kind}/${scope}/${doc.key} v${doc.version}] ${doc.title}`
}

export function appendMemoryDocContent(current: MemoryDoc | undefined, content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const base = current?.content.trim()
  const nextLine = `- ${normalized}`
  if (!base) return nextLine
  if (base.split(/\r?\n/).some((line) => line.trim() === nextLine)) return base
  return `${base}\n${nextLine}`
}
