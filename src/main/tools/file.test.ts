import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { fileTools } from './file'

const pdfParseMocks = vi.hoisted(() => ({
  getText: vi.fn(),
  destroy: vi.fn(),
  PDFParse: vi.fn()
}))

const webToolsMocks = vi.hoisted(() => ({
  fetchWithCheckedRedirects: vi.fn()
}))

vi.mock('pdf-parse', () => ({
  PDFParse: pdfParseMocks.PDFParse
}))

vi.mock('../webTools', () => ({
  fetchWithCheckedRedirects: webToolsMocks.fetchWithCheckedRedirects
}))

vi.mock('../resourceCache', () => ({
  getResourceId: () => '11111111111111111111111111111111',
  saveResourceChunk: async (
    resourceId: string,
    kind: string,
    source: string,
    title: string | undefined,
    totalChars: number | undefined,
    nextOffset: number | undefined,
    chunk: { id: string; offset?: number; endOffset?: number; createdAt: number }
  ) => ({
    id: resourceId,
    kind,
    source,
    title,
    totalChars,
    fetchedRanges: [{ start: chunk.offset ?? 0, end: chunk.endOffset ?? 0 }],
    nextOffset,
    status: nextOffset === undefined ? 'complete' : 'partial',
    chunks: [
      {
        id: chunk.id,
        offset: chunk.offset,
        endOffset: chunk.endOffset,
        createdAt: chunk.createdAt
      }
    ],
    createdAt: 1,
    updatedAt: 1
  })
}))
const createPdfResponse = (
  body = '%PDF-1.7 mock',
  url = 'https://example.test/paper.pdf'
): Response => {
  const response = new Response(Buffer.from(body), {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(Buffer.byteLength(body))
    }
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

const createHtmlResponse = (html: string, url = 'https://publisher.test/article/123'): Response => {
  const response = new Response(html, {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(html))
    }
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

const testDir = join(__dirname, '../../../temp-file-tools-test')

vi.mock('electron', () => ({
  Notification: {
    isSupported: () => false
  },
  app: {
    getPath: () => testDir
  }
}))

const executionContext = {
  reqId: 'file-tool-test',
  signal: new AbortController().signal
}

describe('fileTools', () => {
  let originalQuickAiHome: string | undefined
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalQuickAiHome = process.env.QUICKAI_HOME
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_HOME = testDir
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(join(testDir, 'workspace', 'src'), { recursive: true })
    pdfParseMocks.getText.mockResolvedValue({ text: 'PDF text', total: 1 })
    pdfParseMocks.destroy.mockResolvedValue(undefined)
    pdfParseMocks.PDFParse.mockImplementation(function () {
      return {
        getText: pdfParseMocks.getText,
        destroy: pdfParseMocks.destroy
      }
    })
    webToolsMocks.fetchWithCheckedRedirects.mockResolvedValue(createPdfResponse())
  })

  afterEach(async () => {
    if (originalQuickAiHome === undefined) delete process.env.QUICKAI_HOME
    else process.env.QUICKAI_HOME = originalQuickAiHome
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot
    pdfParseMocks.getText.mockReset()
    pdfParseMocks.destroy.mockReset()
    pdfParseMocks.PDFParse.mockReset()
    webToolsMocks.fetchWithCheckedRedirects.mockReset()
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })
  it('reports the total file line count in read metadata', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'src', 'sample.ts'), 'one\ntwo\nthree', 'utf-8')

    const result = await fileTools.file_read.execute(
      { path: 'src/sample.ts', root: 'workspace', offset: 2, limit: 1 },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 2 to 2 of 3')
    expect(result.resultForModel).toContain('Read Mode: offset')
    expect(result.resultForModel).toContain('Content:\ntwo')
  })

  it('loads local images as multimodal model attachments', async () => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lM2o3wAAAABJRU5ErkJggg==',
      'base64'
    )
    await fs.writeFile(join(testDir, 'workspace', 'src', 'pixel.png'), pngBytes)

    const result = await fileTools.image_read.execute(
      { path: 'src/pixel.png', root: 'workspace' },
      executionContext
    )

    expect(result.resultForModel).toContain('Image loaded for multimodal context.')
    expect(result.resultForModel).toContain('MIME: image/png')
    expect(result.modelAttachments).toHaveLength(1)
    expect(result.modelAttachments?.[0]).toMatchObject({
      type: 'image_url',
      image_url: {
        url: expect.stringContaining('data:image/png;base64,')
      }
    })
  })

  it('points image files from file_read to image_read', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'src', 'photo.jpg'), Buffer.from([0xff, 0xd8]))

    await expect(
      fileTools.file_read.execute({ path: 'src/photo.jpg', root: 'workspace' }, executionContext)
    ).rejects.toThrow('Use image_read')
  })

  it('points PDF files from file_read to pdf_read', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'src', 'paper.pdf'), Buffer.from('%PDF-1.7'))

    await expect(
      fileTools.file_read.execute({ path: 'src/paper.pdf', root: 'workspace' }, executionContext)
    ).rejects.toThrow('Use pdf_read')
  })

  it('extracts local PDF text and stores the visible window as a cached resource', async () => {
    const pdfText = `Intro line
${'A'.repeat(2200)}`
    pdfParseMocks.getText.mockResolvedValueOnce({ text: pdfText, total: 2 })
    await fs.writeFile(join(testDir, 'workspace', 'src', 'paper.pdf'), Buffer.from('%PDF-1.7'))

    const result = await fileTools.pdf_read.execute(
      { path: 'src/paper.pdf', root: 'workspace', maxChars: 1200 },
      executionContext
    )

    expect(pdfParseMocks.PDFParse).toHaveBeenCalled()
    expect(result.resultForModel).toContain('PDF: src/paper.pdf')
    expect(result.resultForModel).toContain('Resource ID:')
    expect(result.resultForModel).toContain('Pages: 2')
    expect(result.resultForModel).toContain('Text window: characters 0-1200 of 2211')
    expect(result.resultForModel).toContain('More text available')
    expect(result.resultForModel).toContain('Intro line')
    expect(result.resultForUi.summary).toContain('Read PDF characters 0-1200')
  })

  it('supports PDF character offsets', async () => {
    const pdfText = `${'A'.repeat(2000)}TARGET${'B'.repeat(2000)}`
    pdfParseMocks.getText.mockResolvedValueOnce({ text: pdfText, total: 3 })
    await fs.writeFile(join(testDir, 'workspace', 'src', 'offset.pdf'), Buffer.from('%PDF-1.7'))

    const result = await fileTools.pdf_read.execute(
      { path: 'src/offset.pdf', root: 'workspace', offset: 2000, maxChars: 1000 },
      executionContext
    )

    expect(result.resultForModel).toContain('Text window: characters 2000-3000 of 4006')
    expect(result.resultForModel).toContain('TARGET')
  })

  it('downloads arXiv abstract URLs as PDF text', async () => {
    const pdfText = `Arxiv paper text ${'C'.repeat(1200)}`
    pdfParseMocks.getText.mockResolvedValueOnce({ text: pdfText, total: 12 })
    webToolsMocks.fetchWithCheckedRedirects.mockResolvedValueOnce(
      createPdfResponse('%PDF-1.7 arxiv', 'https://arxiv.org/pdf/2601.10710.pdf')
    )

    const result = await fileTools.pdf_read.execute(
      { url: 'https://arxiv.org/abs/2601.10710', maxChars: 1000 },
      executionContext
    )

    const [downloadUrl, _signal, _redirects, headers] =
      webToolsMocks.fetchWithCheckedRedirects.mock.calls[0]
    expect(downloadUrl).toBe('https://arxiv.org/pdf/2601.10710.pdf')
    expect(headers.Accept).toContain('application/pdf')
    expect(result.resultForModel).toContain('URL: https://arxiv.org/abs/2601.10710')
    expect(result.resultForModel).toContain('PDF URL: https://arxiv.org/pdf/2601.10710.pdf')
    expect(result.resultForModel).toContain('Text window: characters 0-1000 of 1217')
    expect(result.resultForModel).toContain('Arxiv paper text')
  })

  it('discovers PDF links from non-arXiv HTML landing pages', async () => {
    const pdfText = `Publisher paper text ${'D'.repeat(1200)}`
    pdfParseMocks.getText.mockResolvedValueOnce({ text: pdfText, total: 9 })
    webToolsMocks.fetchWithCheckedRedirects
      .mockResolvedValueOnce(
        createHtmlResponse('<html><body><a href="/downloads/paper.pdf">PDF</a></body></html>')
      )
      .mockResolvedValueOnce(
        createPdfResponse('%PDF-1.7 publisher', 'https://publisher.test/downloads/paper.pdf')
      )

    const result = await fileTools.pdf_read.execute(
      { url: 'https://publisher.test/article/123', maxChars: 1000 },
      executionContext
    )

    expect(webToolsMocks.fetchWithCheckedRedirects.mock.calls[0][0]).toBe(
      'https://publisher.test/article/123'
    )
    expect(webToolsMocks.fetchWithCheckedRedirects.mock.calls[1][0]).toBe(
      'https://publisher.test/downloads/paper.pdf'
    )
    expect(result.resultForModel).toContain('URL: https://publisher.test/article/123')
    expect(result.resultForModel).toContain('PDF URL: https://publisher.test/downloads/paper.pdf')
    expect(result.resultForModel).toContain('Publisher paper text')
  })

  it('supports tail reads', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'tail.ts'),
      ['one', 'two', 'three', 'four'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.file_read.execute(
      { path: 'src/tail.ts', root: 'workspace', tail: 2 },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 3 to 4 of 4')
    expect(result.resultForModel).toContain('Read Mode: tail')
    expect(result.resultForModel).toContain('Content:\nthree\nfour')
  })

  it('supports negative offsets from the end of the file', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'negative.ts'),
      ['one', 'two', 'three', 'four'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.file_read.execute(
      { path: 'src/negative.ts', root: 'workspace', offset: -2, limit: 2 },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 3 to 4 of 4')
    expect(result.resultForModel).toContain('Read Mode: negative_offset')
    expect(result.resultForModel).toContain('Content:\nthree\nfour')
  })

  it('supports around reads with context and optional line numbers', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'around.ts'),
      ['one', 'two', 'three', 'four', 'five'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.file_read.execute(
      { path: 'src/around.ts', root: 'workspace', around: 3, context: 1, lineNumbers: true },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 2 to 4 of 5')
    expect(result.resultForModel).toContain('Read Mode: around')
    expect(result.resultForModel).toContain('Line Numbers: included in content.')
    expect(result.resultForModel).toContain('2 | two')
    expect(result.resultForModel).toContain('3 | three')
    expect(result.resultForModel).toContain('4 | four')
  })

  it('locates a symbol in a provided file and returns its code block', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'logic.ts'),
      [
        'export function helper() {',
        '  return "helper"',
        '}',
        '',
        'export function targetFunction(value: number) {',
        '  const doubled = value * 2',
        '  return doubled',
        '}'
      ].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { path: 'src/logic.ts', root: 'workspace', symbol: 'targetFunction', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('Symbol: targetFunction')
    expect(result.resultForModel).toContain('File: src/logic.ts')
    expect(result.resultForModel).toContain('Definition Line: 5 of 8')
    expect(result.resultForModel).toContain('export function targetFunction(value: number) {')
    expect(result.resultForModel).toContain('return doubled')
    expect(result.resultForModel).not.toContain('return "helper"')
  })

  it('does not run expensive symbol regexes on long non-definition lines', async () => {
    const longLine = `const noisy = "${'targetFunction '.repeat(500)}"`
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'long-lines.ts'),
      [longLine, 'export function targetFunction() {', '  return 1', '}'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { path: 'src/long-lines.ts', root: 'workspace', symbol: 'targetFunction', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('Definition Line: 2 of 4')
    expect(result.resultForModel).toContain('export function targetFunction()')
  })

  it('truncates very long symbol block output', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'long-block.ts'),
      [
        'export function targetFunction() {',
        `  const payload = "${'x'.repeat(8000)}"`,
        '  return payload',
        '}'
      ].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { path: 'src/long-block.ts', root: 'workspace', symbol: 'targetFunction', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('Symbol block output was truncated')
    expect(result.resultForModel).toContain('[line truncated]')
    expect(result.resultForModel.length).toBeLessThan(70000)
  })

  it('locates a symbol by scanning the workspace when no path is provided', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'service.py'),
      ['class Service:', '    def run(self):', '        return True'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { root: 'workspace', symbol: 'run', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('File: src/service.py')
    expect(result.resultForModel).toContain('Kind: python_function')
    expect(result.resultForModel).toContain('def run(self):')
    expect(result.resultForModel).toContain('return True')
  })

  it('skips dependency directories during symbol scans', async () => {
    await fs.mkdir(join(testDir, 'workspace', 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(
      join(testDir, 'workspace', 'node_modules', 'pkg', 'ignored.ts'),
      ['export function ignoredOnly() {', '  return true', '}'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { root: 'workspace', symbol: 'ignoredOnly', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('No definition-like symbol match found')
    expect(result.resultForModel).not.toContain('node_modules/pkg/ignored.ts')
  })

  it('returns a short diff after file_edit succeeds', async () => {
    const filePath = join(testDir, 'workspace', 'src', 'edit.ts')
    await fs.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8')

    await fileTools.file_read.execute({ path: 'src/edit.ts', root: 'workspace' }, executionContext)
    const result = await fileTools.file_edit.execute(
      { path: 'src/edit.ts', root: 'workspace', old_string: 'two', new_string: 'TWO' },
      executionContext
    )

    expect(result.resultForModel).toContain('Successfully edited src/edit.ts')
    expect(result.resultForModel).toContain('Diff:')
    expect(result.resultForModel).toContain('- two')
    expect(result.resultForModel).toContain('+ TWO')
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toContain('TWO')
  })

  it('adds location details when file_edit cannot find old_string', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'missing.ts'),
      ['function target() {', '  return 42', '}'].join('\n'),
      'utf-8'
    )

    await fileTools.file_read.execute(
      { path: 'src/missing.ts', root: 'workspace' },
      executionContext
    )
    await expect(
      fileTools.file_edit.execute(
        {
          path: 'src/missing.ts',
          root: 'workspace',
          old_string: 'return fortyTwo',
          new_string: 'return 43'
        },
        executionContext
      )
    ).rejects.toThrow(/Target preview: return fortyTwo[\s\S]*File length: 3 line\(s\)/)
  })

  it('adds match contexts when multi_edit old_string is ambiguous', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'ambiguous.ts'),
      ['const value = 1', 'same', 'const value = 2', 'same'].join('\n'),
      'utf-8'
    )

    await fileTools.file_read.execute(
      { path: 'src/ambiguous.ts', root: 'workspace' },
      executionContext
    )
    await expect(
      fileTools.multi_edit.execute(
        {
          path: 'src/ambiguous.ts',
          root: 'workspace',
          edits: [{ old_string: 'same', new_string: 'changed' }]
        },
        executionContext
      )
    ).rejects.toThrow(/Match 1: lines 2-2[\s\S]*> 2 \| same[\s\S]*Match 2: lines 4-4/)
  })
})
