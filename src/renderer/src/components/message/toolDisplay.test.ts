import { describe, expect, it } from 'vitest'
import {
  formatCacheHitRate,
  formatToolArgsSummary,
  formatToolDisplayText,
  getShellCommandArg,
  getToolArgsJson,
  getToolStatusLabel
} from './toolDisplay'

describe('toolDisplay', () => {
  it('shows shell commands as the original command', () => {
    const args = { command: 'ipconfig /all' }

    expect(getShellCommandArg('shell', args)).toBe('ipconfig /all')
    expect(formatToolArgsSummary('shell', args)).toBe('ipconfig /all')
  })

  it('summarizes file paths by the final path segments', () => {
    expect(
      formatToolArgsSummary('file_read', { path: 'D:\\Git\\Quick Ai\\src\\main\\index.ts' })
    ).toBe('.../main/index.ts')
  })

  it('summarizes search queries and URLs', () => {
    expect(formatToolArgsSummary('web_search', { query: 'quick ai github trends' })).toBe(
      '"quick ai github trends"'
    )
    expect(formatToolDisplayText('fetch_url', { url: 'https://www.example.com/path' })).toBe(
      'fetch_url example.com/path'
    )
  })

  it('strips purpose from rendered argument json', () => {
    expect(getToolArgsJson({ purpose: 'read file', path: 'src/main.ts' })).toBe(
      JSON.stringify({ path: 'src/main.ts' }, null, 2)
    )
  })

  it('labels denied and failed tool statuses', () => {
    expect(getToolStatusLabel('denied')).toBe('已拒绝')
    expect(getToolStatusLabel('failed')).toBe('失败')
  })

  it('formats cache hit rate only when stats are present', () => {
    expect(formatCacheHitRate({ hasCacheStats: true, cacheHitTokens: 9, hitRate: 85.2 })).toBe(
      '缓存命中 85.2%'
    )
    expect(formatCacheHitRate(undefined)).toBeNull()
  })
})
