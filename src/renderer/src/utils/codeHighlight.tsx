import React from 'react'

export type CodeTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attribute'

export interface CodeToken {
  kind: CodeTokenKind
  text: string
}

const KEYWORDS = new Set([
  'abstract',
  'and',
  'as',
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'def',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'go',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'is',
  'let',
  'match',
  'module',
  'namespace',
  'new',
  'nil',
  'none',
  'not',
  'null',
  'or',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield'
])

const HTML_LANGUAGES = new Set(['html', 'xml', 'svg', 'tsx', 'jsx', 'vue', 'svelte'])

const isIdentifierStart = (char: string): boolean => /[A-Za-z_$]/.test(char)
const isIdentifierPart = (char: string): boolean => /[\w$]/.test(char)
const isShellLike = (language: string): boolean =>
  [
    'bash',
    'sh',
    'shell',
    'zsh',
    'fish',
    'powershell',
    'ps1',
    'python',
    'py',
    'ruby',
    'rb'
  ].includes(language)

const readString = (code: string, start: number): number => {
  const quote = code[start]
  let idx = start + 1

  while (idx < code.length) {
    const char = code[idx]
    if (char === '\\') {
      idx += 2
      continue
    }
    idx += 1
    if (char === quote) break
  }

  return idx
}

const readLineComment = (code: string, start: number): number => {
  const newlineIdx = code.indexOf('\n', start)
  return newlineIdx === -1 ? code.length : newlineIdx
}

const readBlockComment = (code: string, start: number): number => {
  const endIdx = code.indexOf('*/', start + 2)
  return endIdx === -1 ? code.length : endIdx + 2
}

const readHtmlTag = (code: string, start: number): number => {
  const endIdx = code.indexOf('>', start + 1)
  return endIdx === -1 ? code.length : endIdx + 1
}

const isLineStartOrWhitespaceBefore = (code: string, idx: number): boolean => {
  let cursor = idx - 1
  while (cursor >= 0 && code[cursor] !== '\n') {
    if (!/\s/.test(code[cursor])) return false
    cursor -= 1
  }
  return true
}

const pushToken = (tokens: CodeToken[], kind: CodeTokenKind, text: string): void => {
  if (!text) return
  const previous = tokens[tokens.length - 1]
  if (previous?.kind === kind) {
    previous.text += text
    return
  }
  tokens.push({ kind, text })
}

const tokenizeHtmlTag = (tagText: string): CodeToken[] => {
  const tokens: CodeToken[] = []
  let idx = 0

  while (idx < tagText.length) {
    const char = tagText[idx]

    if (char === '"' || char === "'") {
      const end = readString(tagText, idx)
      pushToken(tokens, 'string', tagText.slice(idx, end))
      idx = end
      continue
    }

    if (/[A-Za-z_:.-]/.test(char)) {
      let end = idx + 1
      while (end < tagText.length && /[\w:.-]/.test(tagText[end])) end += 1
      const nextNonSpace = tagText.slice(end).match(/^\s*=/)
      pushToken(tokens, nextNonSpace ? 'attribute' : 'tag', tagText.slice(idx, end))
      idx = end
      continue
    }

    pushToken(tokens, /[<>/]/.test(char) ? 'punctuation' : 'plain', char)
    idx += 1
  }

  return tokens
}

export const tokenizeCode = (code: string, language = ''): CodeToken[] => {
  const normalizedLanguage = language.toLowerCase()
  const tokens: CodeToken[] = []
  let idx = 0

  while (idx < code.length) {
    const char = code[idx]
    const next = code[idx + 1]

    if (
      HTML_LANGUAGES.has(normalizedLanguage) &&
      char === '<' &&
      (/[A-Za-z/!]/.test(next || '') || next === undefined)
    ) {
      const end = readHtmlTag(code, idx)
      tokenizeHtmlTag(code.slice(idx, end)).forEach((token) =>
        pushToken(tokens, token.kind, token.text)
      )
      idx = end
      continue
    }

    if (char === '/' && next === '/') {
      const end = readLineComment(code, idx)
      pushToken(tokens, 'comment', code.slice(idx, end))
      idx = end
      continue
    }

    if (char === '/' && next === '*') {
      const end = readBlockComment(code, idx)
      pushToken(tokens, 'comment', code.slice(idx, end))
      idx = end
      continue
    }

    if (
      char === '#' &&
      isShellLike(normalizedLanguage) &&
      isLineStartOrWhitespaceBefore(code, idx)
    ) {
      const end = readLineComment(code, idx)
      pushToken(tokens, 'comment', code.slice(idx, end))
      idx = end
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      const end = readString(code, idx)
      pushToken(tokens, 'string', code.slice(idx, end))
      idx = end
      continue
    }

    const numberMatch = code.slice(idx).match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?)/i)
    if (numberMatch) {
      pushToken(tokens, 'number', numberMatch[0])
      idx += numberMatch[0].length
      continue
    }

    if (isIdentifierStart(char)) {
      let end = idx + 1
      while (end < code.length && isIdentifierPart(code[end])) end += 1
      const word = code.slice(idx, end)
      const previousNonSpace = code.slice(0, idx).match(/\S(?=\s*$)/)?.[0]
      const nextNonSpace = code.slice(end).match(/^\s*(.)/)?.[1]

      if (KEYWORDS.has(word.toLowerCase())) {
        pushToken(tokens, 'keyword', word)
      } else if (nextNonSpace === '(') {
        pushToken(tokens, 'function', word)
      } else if (previousNonSpace === '.') {
        pushToken(tokens, 'attribute', word)
      } else {
        pushToken(tokens, 'plain', word)
      }
      idx = end
      continue
    }

    if (/[+\-*/%=!<>|&?:~^]+/.test(char)) {
      pushToken(tokens, 'operator', char)
      idx += 1
      continue
    }

    if (/[{}[\]().,;]/.test(char)) {
      pushToken(tokens, 'punctuation', char)
      idx += 1
      continue
    }

    pushToken(tokens, 'plain', char)
    idx += 1
  }

  return tokens
}

const TOKEN_COLORS: Record<Exclude<CodeTokenKind, 'plain'>, string> = {
  comment: 'var(--syntax-comment, #7a8492)',
  string: 'var(--syntax-string, #89ca78)',
  keyword: 'var(--syntax-keyword, #c678dd)',
  number: 'var(--syntax-number, #d19a66)',
  function: 'var(--syntax-function, #61afef)',
  operator: 'var(--syntax-operator, #56b6c2)',
  punctuation: 'var(--syntax-punctuation, #abb2bf)',
  tag: 'var(--syntax-tag, #e06c75)',
  attribute: 'var(--syntax-attribute, #e5c07b)'
}

export const renderHighlightedCode = (code: string, language = ''): React.ReactNode => {
  return tokenizeCode(code, language).map((token, idx) => {
    if (token.kind === 'plain') return token.text

    return (
      <span
        key={`${token.kind}-${idx}`}
        style={{
          color: TOKEN_COLORS[token.kind],
          fontStyle: token.kind === 'comment' ? 'italic' : undefined
        }}
      >
        {token.text}
      </span>
    )
  })
}
