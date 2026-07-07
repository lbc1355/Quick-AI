import { promises as fs } from 'fs'
import { extname } from 'path'
import { PDFParse } from 'pdf-parse'
import { ToolArgs, SessionResource } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { getResourceId, saveResourceChunk } from '../resourceCache'
import { fetchWithCheckedRedirects } from '../webTools'
import { ROOT_PARAMETER, getRootArg, resolveExistingSafePath, SafePath } from './filePathSafety'
import { createToolResult } from './result'
import { ToolDefinition, ToolExecutionContext } from './types'

const MAX_PDF_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_CHARS = 16_000
const MIN_MAX_CHARS = 1_000
const MAX_MAX_CHARS = 50_000
const PDF_DOWNLOAD_TIMEOUT_MS = 30_000
const HTML_DISCOVERY_MAX_BYTES = 1024 * 1024

interface PdfSource {
  kind: 'file' | 'url'
  input: string
  sourceUrl: string
  title: string
  rootInfo?: string
  target?: SafePath
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const normalizeOffset = (value: unknown, totalChars: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(Math.max(0, Math.floor(value)), totalChars)
}

const normalizeMaxChars = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_CHARS
  return Math.min(Math.max(MIN_MAX_CHARS, Math.floor(value)), MAX_MAX_CHARS)
}

const normalizePdfText = (text: string): string =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

const createPdfSourceUrl = (target: SafePath): string =>
  `file:///${target.realPath.replace(/\\/g, '/')}`

const normalizeArxivPdfUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl)
  const hostname = parsed.hostname.toLowerCase()
  const isArxiv = hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org')
  if (!isArxiv) return rawUrl

  const match = parsed.pathname.match(/^\/(abs|pdf)\/([^/?#]+)(?:\.pdf)?$/)
  if (!match) return rawUrl

  const id = match[2]
  return `https://arxiv.org/pdf/${id}.pdf`
}

const createDownloadSignal = (
  externalSignal: AbortSignal
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PDF_DOWNLOAD_TIMEOUT_MS)
  const onAbort = (): void => controller.abort(externalSignal.reason)

  if (externalSignal.aborted) {
    onAbort()
  } else {
    externalSignal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      externalSignal.removeEventListener('abort', onAbort)
    }
  }
}

const emitResourceUpdate = (
  ctx: ToolExecutionContext,
  sessionResource: SessionResource | undefined
): void => {
  if (!sessionResource) return
  ctx.emitEvent?.({
    type: 'resource_update' as const,
    resource: sessionResource
  })
}

async function extractPdfText(
  buffer: Buffer
): Promise<{ text: string; pages: number | undefined }> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return {
      text: normalizePdfText(result.text || ''),
      pages: result.total
    }
  } finally {
    await parser.destroy()
  }
}

async function loadLocalPdf(
  args: ToolArgs,
  ctx: ToolExecutionContext
): Promise<{ source: PdfSource; buffer: Buffer; size: number }> {
  const pdfPath = args.path
  if (typeof pdfPath !== 'string' || !pdfPath) {
    throw new Error('Missing or invalid path parameter')
  }

  const target = await resolveExistingSafePath(pdfPath, ctx, 'Path', getRootArg(args))
  const extension = extname(target.realPath).toLowerCase()
  if (extension !== '.pdf') {
    throw new Error(
      `Unsupported file type "${extension || '(none)'}". Use pdf_read for .pdf files.`
    )
  }

  const stats = await fs.stat(target.realPath)
  if (stats.isDirectory()) {
    throw new Error('Path is a directory, not a PDF file.')
  }
  if (stats.size > MAX_PDF_BYTES) {
    throw new Error(
      `PDF is too large (${formatBytes(stats.size)}). Max supported size is ${formatBytes(MAX_PDF_BYTES)}.`
    )
  }

  const buffer = await fs.readFile(target.realPath)
  return {
    source: {
      kind: 'file',
      input: target.relPath,
      sourceUrl: createPdfSourceUrl(target),
      title: target.relPath,
      rootInfo: `Root (${target.rootKind}): ${target.root}`,
      target
    },
    buffer,
    size: stats.size
  }
}

interface RemotePdfDownload {
  finalUrl: string
  contentType: string
  buffer: Buffer
  size: number
}

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

const getLeadingText = (buffer: Buffer): string =>
  buffer.subarray(0, 256).toString('utf-8').trimStart().toLowerCase()

const isHtmlLikeBuffer = (buffer: Buffer, contentType: string): boolean => {
  const lead = getLeadingText(buffer)
  return (
    contentType.includes('html') ||
    contentType.includes('text/') ||
    lead.startsWith('<!doctype html') ||
    lead.startsWith('<html')
  )
}

const isPdfLikeResponse = (buffer: Buffer, contentType: string): boolean => {
  const looksLikePdf = buffer.subarray(0, 5).toString('utf-8') === '%PDF-'
  if (looksLikePdf) return true
  if (contentType.includes('pdf')) return true
  if (contentType.includes('octet-stream') || !contentType) {
    return !isHtmlLikeBuffer(buffer, contentType)
  }
  return false
}

const isLikelyPdfCandidate = (value: string, label = ''): boolean => {
  const haystack = `${value} ${label}`.toLowerCase()
  return (
    /\.pdf(?:[?#]|$)/i.test(haystack) ||
    /\/pdf(?:[/?#]|$)/i.test(haystack) ||
    haystack.includes('citation_pdf_url') ||
    haystack.includes('format=pdf') ||
    /\bpdf\b/i.test(label)
  )
}

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, ' ')

const resolvePdfCandidate = (candidate: string, baseUrl: string): string | undefined => {
  const decoded = decodeHtmlAttribute(candidate.trim())
  if (!decoded || decoded.startsWith('#') || decoded.toLowerCase().startsWith('javascript:')) {
    return undefined
  }
  try {
    const resolved = new URL(decoded, baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined
    return resolved.toString()
  } catch {
    return undefined
  }
}

const discoverPdfUrlFromHtml = (html: string, baseUrl: string): string | undefined => {
  const candidates: string[] = []
  const add = (candidate: string | undefined, label = ''): void => {
    if (!candidate || !isLikelyPdfCandidate(candidate, label)) return
    const resolved = resolvePdfCandidate(candidate, baseUrl)
    if (resolved && !candidates.includes(resolved)) candidates.push(resolved)
  }

  const metaWithContentAfter =
    /<meta\b[^>]*(?:name|property)\s*=\s*["'](?:citation_pdf_url|og:pdf|pdf)["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi
  const metaWithContentBefore =
    /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*(?:name|property)\s*=\s*["'](?:citation_pdf_url|og:pdf|pdf)["'][^>]*>/gi
  for (const match of html.matchAll(metaWithContentAfter)) add(match[1], 'citation_pdf_url')
  for (const match of html.matchAll(metaWithContentBefore)) add(match[1], 'citation_pdf_url')

  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi
  for (const match of html.matchAll(anchorRegex)) {
    add(match[1], stripHtml(match[2] || ''))
  }

  const attrRegex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi
  for (const match of html.matchAll(attrRegex)) add(match[1])

  return candidates[0]
}

const discoverPdfUrlFromResponse = (download: RemotePdfDownload): string | undefined => {
  if (!isHtmlLikeBuffer(download.buffer, download.contentType)) return undefined
  const html = download.buffer.subarray(0, HTML_DISCOVERY_MAX_BYTES).toString('utf-8')
  return discoverPdfUrlFromHtml(html, download.finalUrl)
}

async function downloadRemotePdfUrl(
  url: string,
  ctx: ToolExecutionContext
): Promise<RemotePdfDownload> {
  const { signal, cleanup } = createDownloadSignal(ctx.signal)
  try {
    const response = await fetchWithCheckedRedirects(url, signal, 0, {
      Accept: 'application/pdf,text/html;q=0.8,application/octet-stream;q=0.7,*/*;q=0.1'
    })

    if (!response.ok) {
      throw new Error(`Failed to download PDF: HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = Number(response.headers.get('content-length') || '')
    if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
      throw new Error(
        `PDF is too large (${formatBytes(contentLength)}). Max supported size is ${formatBytes(MAX_PDF_BYTES)}.`
      )
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length > MAX_PDF_BYTES) {
      throw new Error(
        `PDF is too large (${formatBytes(buffer.length)}). Max supported size is ${formatBytes(MAX_PDF_BYTES)}.`
      )
    }

    return {
      finalUrl: response.url || url,
      contentType,
      buffer,
      size: buffer.length
    }
  } finally {
    cleanup()
  }
}

async function loadRemotePdf(
  rawUrl: string,
  ctx: ToolExecutionContext
): Promise<{ source: PdfSource; buffer: Buffer; size: number }> {
  let initialUrl: string
  try {
    initialUrl = normalizeArxivPdfUrl(rawUrl)
  } catch {
    throw new Error('Invalid url parameter')
  }

  const firstDownload = await downloadRemotePdfUrl(initialUrl, ctx)
  let pdfDownload = firstDownload

  if (!isPdfLikeResponse(firstDownload.buffer, firstDownload.contentType)) {
    const discoveredPdfUrl = discoverPdfUrlFromResponse(firstDownload)
    if (!discoveredPdfUrl) {
      throw new Error(
        `Downloaded content does not look like a PDF (${firstDownload.contentType || 'unknown content type'}), and no PDF link was found on the page.`
      )
    }

    pdfDownload = await downloadRemotePdfUrl(discoveredPdfUrl, ctx)
    if (!isPdfLikeResponse(pdfDownload.buffer, pdfDownload.contentType)) {
      throw new Error(
        `Discovered PDF link did not return PDF content (${pdfDownload.contentType || 'unknown content type'}): ${discoveredPdfUrl}`
      )
    }
  }

  return {
    source: {
      kind: 'url',
      input: rawUrl,
      sourceUrl: pdfDownload.finalUrl,
      title: pdfDownload.finalUrl
    },
    buffer: pdfDownload.buffer,
    size: pdfDownload.size
  }
}
export const pdfReadTool: ToolDefinition = {
  name: 'pdf_read',
  title: 'Read PDF',
  description:
    'Extracts text from a local PDF, public PDF URL, or public HTML landing page with a discoverable PDF link. For arXiv abstract URLs, pass the /abs/ URL and the tool will read the corresponding PDF. Supports character offset paging for long PDFs.',
  tags: ['file', 'read', 'pdf', 'document', 'local', 'arxiv', 'url', '文件', '读取', 'PDF', '文档'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative or absolute path to a local PDF file. Use either path or url.'
      },
      url: {
        type: 'string',
        description:
          'Public HTTP/HTTPS PDF URL, public HTML landing page with a PDF link, or an arXiv abstract URL such as https://arxiv.org/abs/2601.10710. Use either path or url.'
      },
      root: ROOT_PARAMETER,
      offset: {
        type: 'number',
        description:
          'The 0-indexed character offset to start reading extracted text from. Default 0.'
      },
      maxChars: {
        type: 'number',
        description: `Maximum extracted text characters to return. Default ${DEFAULT_MAX_CHARS}, max ${MAX_MAX_CHARS}.`
      }
    }
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const hasPath = typeof args.path === 'string' && args.path.trim().length > 0
    const hasUrl = typeof args.url === 'string' && args.url.trim().length > 0
    if (hasPath === hasUrl) {
      throw new Error('Provide exactly one of path or url.')
    }

    const loaded = hasUrl
      ? await loadRemotePdf(String(args.url), ctx)
      : await loadLocalPdf(args, ctx)

    if (ctx.signal.aborted) {
      throw new Error('PDF read was aborted.')
    }

    let extracted: { text: string; pages: number | undefined }
    try {
      extracted = await extractPdfText(loaded.buffer)
    } catch (err) {
      const error = err as Error
      throw new Error(`Failed to extract PDF text: ${error.message}`)
    }

    const source = loaded.source
    const totalChars = extracted.text.length
    if (totalChars === 0) {
      const resultForModel = [
        source.rootInfo,
        source.kind === 'url' ? `URL: ${source.input}` : `PDF: ${source.title}`,
        source.kind === 'url' && source.sourceUrl !== source.input
          ? `PDF URL: ${source.sourceUrl}`
          : '',
        extracted.pages !== undefined ? `Pages: ${extracted.pages}` : '',
        `Size: ${formatBytes(loaded.size)}`,
        'No extractable text was found. The PDF may be scanned or image-only; OCR is not currently available in pdf_read.'
      ]
        .filter(Boolean)
        .join('\n\n')

      return createToolResult({
        resultForModel,
        title: `Read PDF: ${source.title}`,
        url: source.sourceUrl,
        summary: `No extractable text found in ${source.title}`
      })
    }

    const offset = normalizeOffset(args.offset, totalChars)
    const maxChars = normalizeMaxChars(args.maxChars)
    const endOffset = Math.min(offset + maxChars, totalChars)
    const textWindow = extracted.text.slice(offset, endOffset)
    const nextOffset = endOffset < totalChars ? endOffset : undefined
    const resourceId = getResourceId(source.sourceUrl)

    const chunk = {
      id: `pdf-${offset}-${endOffset}`,
      offset,
      endOffset,
      text: textWindow,
      summary: textWindow.slice(0, 160) + (textWindow.length > 160 ? '...' : ''),
      createdAt: Date.now()
    }

    const sessionResource = await saveResourceChunk(
      resourceId,
      'doc',
      source.sourceUrl,
      source.title,
      totalChars,
      nextOffset,
      chunk
    )
    emitResourceUpdate(ctx, sessionResource)

    if (ctx.reqId && source.target) getRun(ctx.reqId)?.markFileSeen(source.target.realPath)

    const cacheCoverage = [
      `Cached coverage status: ${sessionResource.status}`,
      sessionResource.fetchedRanges && sessionResource.fetchedRanges.length > 0
        ? `Cached read ranges: ${sessionResource.fetchedRanges.map((range) => `${range.start}-${range.end}`).join(', ')}`
        : '',
      sessionResource.nextOffset !== undefined
        ? `Next unread offset: ${sessionResource.nextOffset}`
        : '',
      sessionResource.status !== 'complete'
        ? 'Coverage warning: this cached PDF text is incomplete. Do not claim the full PDF has been read.'
        : ''
    ]
      .filter(Boolean)
      .join('\n')

    const continuationTarget =
      source.kind === 'url' ? `"url":"${source.input}"` : `"path":"${source.input}"`
    const resultForModel = [
      source.rootInfo,
      source.kind === 'url' ? `URL: ${source.input}` : `PDF: ${source.title}`,
      source.kind === 'url' && source.sourceUrl !== source.input
        ? `PDF URL: ${source.sourceUrl}`
        : '',
      `Resource ID: ${resourceId}`,
      extracted.pages !== undefined ? `Pages: ${extracted.pages}` : '',
      `Size: ${formatBytes(loaded.size)}`,
      `Text window: characters ${offset}-${endOffset} of ${totalChars}`,
      cacheCoverage,
      nextOffset !== undefined
        ? `More text available. To continue, call pdf_read with {${continuationTarget},"offset":${nextOffset},"maxChars":${maxChars}}. Already cached ranges can also be reopened with read_cached_resource using resourceId "${resourceId}".`
        : 'End of extracted PDF text.',
      `Content:\n${textWindow}`
    ]
      .filter(Boolean)
      .join('\n\n')

    return createToolResult({
      resultForModel,
      title: `Read PDF: ${source.title}`,
      url: source.sourceUrl,
      summary: `Read PDF characters ${offset}-${endOffset} of ${totalChars} from ${source.title}`
    })
  }
}
