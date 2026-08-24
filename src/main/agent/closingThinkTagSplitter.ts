const CLOSING_THINK_TAG = '</think>'

export interface ClosingThinkTagSplit {
  reasoning?: string
  content?: string
}

const matchingDelimiterSuffixLength = (value: string): number => {
  const maxLength = Math.min(value.length, CLOSING_THINK_TAG.length - 1)
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(CLOSING_THINK_TAG.slice(0, length))) return length
  }
  return 0
}

/**
 * Splits gateways that stream reasoning first and only emit a closing `</think>` delimiter before
 * the final answer. A small suffix is buffered so delimiters split across SSE chunks are handled.
 */
export class ClosingThinkTagSplitter {
  private pending = ''
  private reasoningClosed = false

  push(chunk: string): ClosingThinkTagSplit {
    if (!chunk) return {}
    if (this.reasoningClosed) return { content: chunk }

    this.pending += chunk
    const delimiterIndex = this.pending.indexOf(CLOSING_THINK_TAG)
    if (delimiterIndex >= 0) {
      const reasoning = this.pending.slice(0, delimiterIndex)
      const content = this.pending.slice(delimiterIndex + CLOSING_THINK_TAG.length)
      this.pending = ''
      this.reasoningClosed = true
      return {
        ...(reasoning ? { reasoning } : {}),
        ...(content ? { content } : {})
      }
    }

    const suffixLength = matchingDelimiterSuffixLength(this.pending)
    const emitLength = this.pending.length - suffixLength
    if (emitLength === 0) return {}
    const reasoning = this.pending.slice(0, emitLength)
    this.pending = this.pending.slice(emitLength)
    return { reasoning }
  }

  finish(): ClosingThinkTagSplit {
    if (!this.pending) return {}
    const remaining = this.pending
    this.pending = ''
    return this.reasoningClosed ? { content: remaining } : { reasoning: remaining }
  }
}
