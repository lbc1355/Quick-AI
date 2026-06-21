import { escapeRegExp } from './helpers'
import type { SymbolMatch } from './codeSymbolTypes'

const MAX_SYMBOL_MATCH_LINE_CHARS = 2000

export function buildSymbolDefinitionPatterns(
  symbol: string
): Array<{ kind: string; regex: RegExp }> {
  const s = escapeRegExp(symbol)
  return [
    {
      kind: 'function',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${s}\\s*\\(`)
    },
    {
      kind: 'function',
      regex: new RegExp(
        `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${s}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`
      )
    },
    {
      kind: 'method',
      regex: new RegExp(
        `^\\s*(?:(?:public|private|protected|static|async|override|readonly)\\s+)*${s}\\s*(?:<[^>]+>)?\\s*\\(`
      )
    },
    {
      kind: 'class',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+${s}\\b`)
    },
    { kind: 'interface', regex: new RegExp(`^\\s*(?:export\\s+)?interface\\s+${s}\\b`) },
    { kind: 'type', regex: new RegExp(`^\\s*(?:export\\s+)?type\\s+${s}\\b`) },
    { kind: 'enum', regex: new RegExp(`^\\s*(?:export\\s+)?enum\\s+${s}\\b`) },
    { kind: 'python_function', regex: new RegExp(`^\\s*(?:async\\s+)?def\\s+${s}\\s*\\(`) },
    { kind: 'python_class', regex: new RegExp(`^\\s*class\\s+${s}\\b`) },
    { kind: 'rust_function', regex: new RegExp(`^\\s*(?:pub\\s+)?fn\\s+${s}\\s*\\(`) },
    { kind: 'go_function', regex: new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${s}\\s*\\(`) },
    {
      kind: 'c_like_function',
      regex: new RegExp(
        `^\\s*[\\w:<>,~*&\\[\\]\\s]{1,180}\\b${s}\\s*\\([^;]{0,300}\\)\\s*(?:const\\s*)?(?:\\{|$)`
      )
    }
  ]
}

function lineMayContainSymbol(line: string, symbol: string): boolean {
  const index = line.indexOf(symbol)
  if (index === -1) return false

  const before = index > 0 ? line[index - 1] : ''
  const after = index + symbol.length < line.length ? line[index + symbol.length] : ''
  const isIdentifierChar = (ch: string): boolean => /[\w$]/.test(ch)
  return !isIdentifierChar(before) && !isIdentifierChar(after)
}

export function findSymbolMatchesInContent(
  content: string,
  symbol: string,
  target: Pick<SymbolMatch, 'realPath' | 'relPath' | 'root' | 'rootKind'>,
  patterns = buildSymbolDefinitionPatterns(symbol)
): SymbolMatch[] {
  const lines = content.split(/\r?\n/)
  const matches: SymbolMatch[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > MAX_SYMBOL_MATCH_LINE_CHARS) continue
    if (!lineMayContainSymbol(line, symbol)) continue
    const pattern = patterns.find((p) => p.regex.test(line))
    if (!pattern) continue
    matches.push({
      ...target,
      lineIndex: i,
      lineNumber: i + 1,
      lineText: line.trim(),
      kind: pattern.kind
    })
  }

  return matches
}
