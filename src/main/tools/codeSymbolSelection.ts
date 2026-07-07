export interface SymbolCandidateForRanking {
  relPath: string
  lineNumber: number
  lineText: string
  kind: string
}

export interface RankedSymbolCandidate<T extends SymbolCandidateForRanking> {
  match: T
  score: number
  reasons: string[]
}

const SOURCE_PATH_SEGMENTS = new Set(['src', 'source', 'lib', 'app', 'packages'])
const LOW_SIGNAL_PATH_SEGMENTS = new Set([
  '__tests__',
  'test',
  'tests',
  'spec',
  'fixtures',
  'fixture',
  'examples',
  'example',
  'demo',
  'demos'
])

const LOW_SIGNAL_FILE_PATTERN = /\.(?:test|spec|fixture|mock|stories)\.[^./\\]+$/i

const KIND_SCORES: Record<string, number> = {
  class: 36,
  interface: 34,
  type: 34,
  enum: 34,
  function: 32,
  python_class: 32,
  python_function: 30,
  go_function: 30,
  rust_function: 30,
  method: 18,
  c_like_function: 12
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/')
}

function getPathSegments(relPath: string): string[] {
  return normalizeRelPath(relPath)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
}

function isLowSignalPath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath).toLowerCase()
  if (LOW_SIGNAL_FILE_PATTERN.test(normalized)) return true
  return getPathSegments(normalized).some((segment) => LOW_SIGNAL_PATH_SEGMENTS.has(segment))
}

function hasSourcePathSignal(relPath: string): boolean {
  return getPathSegments(relPath).some((segment) => SOURCE_PATH_SEGMENTS.has(segment))
}

function basenameWithoutExtension(relPath: string): string {
  const filename = normalizeRelPath(relPath).split('/').pop() || relPath
  return filename.replace(/\.[^.]+$/, '').toLowerCase()
}

function isExportedDefinition(lineText: string): boolean {
  return /^\s*export\s+/.test(lineText) || /^\s*pub\s+/.test(lineText)
}

function scoreSymbolCandidate(
  symbol: string,
  candidate: SymbolCandidateForRanking
): { score: number; reasons: string[] } {
  let score = KIND_SCORES[candidate.kind] ?? 8
  const reasons = [`${candidate.kind} definition`]

  if (isExportedDefinition(candidate.lineText)) {
    score += 24
    reasons.push('exported definition')
  }

  if (hasSourcePathSignal(candidate.relPath)) {
    score += 20
    reasons.push('source path')
  }

  const basename = basenameWithoutExtension(candidate.relPath)
  const normalizedSymbol = symbol.toLowerCase()
  if (basename === normalizedSymbol || basename.includes(normalizedSymbol)) {
    score += 8
    reasons.push('filename matches symbol')
  }

  if (candidate.lineNumber <= 80) {
    score += 4
    reasons.push('early file definition')
  }

  if (isLowSignalPath(candidate.relPath)) {
    score -= 55
    reasons.push('test/example path deprioritized')
  }

  return { score, reasons }
}

export function rankSymbolCandidates<T extends SymbolCandidateForRanking>(
  symbol: string,
  matches: T[]
): RankedSymbolCandidate<T>[] {
  return matches
    .map((match) => {
      const ranking = scoreSymbolCandidate(symbol, match)
      return {
        match,
        score: ranking.score,
        reasons: ranking.reasons
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const pathOrder = normalizeRelPath(a.match.relPath).localeCompare(
        normalizeRelPath(b.match.relPath)
      )
      if (pathOrder !== 0) return pathOrder
      return a.match.lineNumber - b.match.lineNumber
    })
}

export function formatSelectionReason<T extends SymbolCandidateForRanking>(
  selected: RankedSymbolCandidate<T>,
  totalCandidates: number
): string {
  const reasonText = selected.reasons.join(', ') || 'stable file order'
  if (totalCandidates <= 1) return `Only candidate matched. Signals: ${reasonText}.`
  return `Selected highest-ranked candidate out of ${totalCandidates}. Signals: ${reasonText}.`
}
