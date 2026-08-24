import { describe, expect, it } from 'vitest'
import {
  getToolOutputProjectionMode,
  projectToolOutputHead,
  projectToolOutputHeadTail
} from './toolOutputResource'

describe('tool output resource projection', () => {
  it('keeps a bounded head and tail preview with line statistics', () => {
    const content = 'head-1\nhead-2\nmiddle\ntail-1\ntail-2'
    const preview = projectToolOutputHeadTail(content, 16)

    expect(preview.head).toBe(content.slice(0, 8))
    expect(preview.tail).toBe(content.slice(-8))
    expect(preview.visibleBytes).toBe(16)
    expect(preview.totalLines).toBe(5)
    expect(preview.headEndOffset).toBeLessThan(preview.tailStartOffset)
  })

  it('keeps head-only as the default projection for non-shell tools', () => {
    const preview = projectToolOutputHead('head-middle-tail', 4)

    expect(preview).toMatchObject({ mode: 'head', head: 'head', tail: '', visibleBytes: 4 })
    expect(getToolOutputProjectionMode('file_read')).toBe('head')
    expect(getToolOutputProjectionMode('shell')).toBe('head_tail')
    expect(getToolOutputProjectionMode('shell_background_read')).toBe('head_tail')
  })

  it('applies preview budgets to UTF-8 bytes without splitting CJK or emoji', () => {
    const head = projectToolOutputHead('a中🙂tail', 4)
    expect(head).toMatchObject({ head: 'a中', headEndOffset: 2, visibleBytes: 4 })

    const headTail = projectToolOutputHeadTail('a中-middle-🙂b', 10)
    expect(headTail.head).toBe('a中-')
    expect(headTail.tail).toBe('🙂b')
    expect(headTail.visibleBytes).toBe(10)
  })
})
