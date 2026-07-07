import { describe, expect, it } from 'vitest'
import { tokenizeCode } from './codeHighlight'

describe('tokenizeCode', () => {
  it('classifies common TypeScript tokens', () => {
    const tokens = tokenizeCode('const answer = "yes" // note', 'ts')

    expect(tokens).toContainEqual({ kind: 'keyword', text: 'const' })
    expect(tokens).toContainEqual({ kind: 'string', text: '"yes"' })
    expect(tokens).toContainEqual({ kind: 'comment', text: '// note' })
  })

  it('classifies function calls and numbers', () => {
    const tokens = tokenizeCode('print(42)', 'python')

    expect(tokens).toContainEqual({ kind: 'function', text: 'print' })
    expect(tokens).toContainEqual({ kind: 'number', text: '42' })
  })

  it('classifies basic html tags and attributes', () => {
    const tokens = tokenizeCode('<button class="primary">Save</button>', 'html')

    expect(tokens).toContainEqual({ kind: 'tag', text: 'button' })
    expect(tokens).toContainEqual({ kind: 'attribute', text: 'class' })
    expect(tokens).toContainEqual({ kind: 'string', text: '"primary"' })
  })
})
