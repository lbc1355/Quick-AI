import React from 'react'
import { renderHighlightedCode } from './codeHighlight'

export type StreamingMarkdownBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; lang: string; code: string; closed: boolean }
  | { type: 'table'; header: string[]; rows: string[][] }

const splitTableCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

const isTableCandidateLine = (line: string): boolean => {
  const cells = splitTableCells(line)
  return line.includes('|') && cells.length >= 2 && cells.some((cell) => cell.length > 0)
}

const isTableSeparatorLine = (line: string): boolean => {
  const cells = splitTableCells(line)
  return (
    line.includes('|') &&
    cells.length >= 2 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
  )
}

const normalizeRow = (cells: string[], width: number): string[] => {
  if (cells.length === width) return cells
  if (cells.length > width) return cells.slice(0, width)
  return [...cells, ...Array.from({ length: width - cells.length }, () => '')]
}

export const parseStreamingMarkdownBlocks = (text: string): StreamingMarkdownBlock[] => {
  if (!text) return []

  const blocks: StreamingMarkdownBlock[] = []
  const textLines: string[] = []
  const lines = text.split('\n')

  const flushText = (): void => {
    if (textLines.length === 0) return
    const blockText = textLines.join('\n')
    if (blockText) blocks.push({ type: 'text', text: blockText })
    textLines.length = 0
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fenceMatch = line.match(/^```([\w-]*)\s*$/)

    if (fenceMatch) {
      flushText()
      const lang = fenceMatch[1] || ''
      const codeLines: string[] = []
      let closed = false
      i += 1

      for (; i < lines.length; i += 1) {
        if (/^```\s*$/.test(lines[i])) {
          closed = true
          break
        }
        codeLines.push(lines[i])
      }

      blocks.push({
        type: 'code',
        lang,
        code: codeLines.join('\n'),
        closed
      })
      continue
    }

    if (isTableCandidateLine(line) && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      flushText()
      const header = splitTableCells(line)
      const rows: string[][] = []
      i += 2

      for (; i < lines.length; i += 1) {
        const rowLine = lines[i]
        if (!isTableCandidateLine(rowLine) || isTableSeparatorLine(rowLine)) {
          i -= 1
          break
        }
        rows.push(normalizeRow(splitTableCells(rowLine), header.length))
      }

      blocks.push({
        type: 'table',
        header,
        rows
      })
      continue
    }

    textLines.push(line)
  }

  flushText()
  return blocks
}

const renderCodeBlock = (
  block: Extract<StreamingMarkdownBlock, { type: 'code' }>,
  idx: number
): React.ReactNode => {
  const label = block.lang || 'code'

  return (
    <div
      key={`stream-code-${idx}`}
      className="code-block-container streaming-code-block"
      style={{
        margin: '8px 0',
        border: '1px solid var(--color-code-block-border)',
        borderRadius: '8px',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          background: 'var(--color-code-block-header-bg)',
          padding: '6px 12px',
          fontSize: '11.5px',
          borderBottom: '1px solid var(--color-code-block-border)',
          color: 'var(--color-code-block-header-text)',
          display: 'flex',
          justifyContent: 'space-between',
          userSelect: 'none'
        }}
      >
        <span>{label}</span>
        {!block.closed && <span style={{ opacity: 0.65 }}>streaming</span>}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px',
          overflowX: 'auto',
          background: 'var(--color-code-block-bg)',
          color: 'var(--color-code-block-text)',
          fontFamily: 'Consolas, monospace',
          fontSize: '12px'
        }}
      >
        <code>{renderHighlightedCode(block.code, block.lang)}</code>
      </pre>
    </div>
  )
}

const renderTableBlock = (
  block: Extract<StreamingMarkdownBlock, { type: 'table' }>,
  idx: number
): React.ReactNode => {
  return (
    <div key={`stream-table-${idx}`} style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table>
        <thead>
          <tr>
            {block.header.map((cell, cellIdx) => (
              <th key={`h-${cellIdx}`}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIdx) => (
            <tr key={`r-${rowIdx}`}>
              {row.map((cell, cellIdx) => (
                <td key={`c-${cellIdx}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const StreamingMarkdownPreview: React.FC<{ text: string }> = ({ text }) => {
  const blocks = parseStreamingMarkdownBlocks(text)
  if (blocks.length === 0) return null

  return (
    <>
      {blocks.map((block, idx) => {
        if (block.type === 'code') return renderCodeBlock(block, idx)
        if (block.type === 'table') return renderTableBlock(block, idx)

        return (
          <span
            key={`stream-text-${idx}`}
            className="streaming-plain-text"
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere'
            }}
          >
            {block.text}
          </span>
        )
      })}
    </>
  )
}
