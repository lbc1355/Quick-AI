interface DiffChange {
  type: 'added' | 'removed' | 'unchanged'
  value: string
  lineA?: number
  lineB?: number
}

export function generateUnifiedDiff(a: string[], b: string[], contextSize = 3): string {
  const maxLines = 2000
  const linesA = a.slice(0, maxLines)
  const linesB = b.slice(0, maxLines)

  const m = linesA.length
  const n = linesB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const changes: DiffChange[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      changes.unshift({ type: 'unchanged', value: linesA[i - 1], lineA: i, lineB: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'added', value: linesB[j - 1], lineB: j })
      j--
    } else {
      changes.unshift({ type: 'removed', value: linesA[i - 1], lineA: i })
      i--
    }
  }

  const outputLines: string[] = []
  let hunk: DiffChange[] = []
  let contextBefore: DiffChange[] = []
  let contextAfterCount = 0
  let inHunk = false

  const flushHunk = (): void => {
    if (hunk.length === 0) return
    const firstChange = hunk.find((c) => c.type !== 'unchanged') || hunk[0]
    const startA = firstChange.lineA ?? hunk[0].lineA ?? 1
    const startB = firstChange.lineB ?? hunk[0].lineB ?? 1
    const countA = hunk.filter((c) => c.type !== 'added').length
    const countB = hunk.filter((c) => c.type !== 'removed').length

    outputLines.push(`@@ -${startA},${countA} +${startB},${countB} @@`)
    for (const c of hunk) {
      if (c.type === 'added') outputLines.push(`+ ${c.value}`)
      else if (c.type === 'removed') outputLines.push(`- ${c.value}`)
      else outputLines.push(`  ${c.value}`)
    }
    hunk = []
  }

  for (const c of changes) {
    if (c.type === 'unchanged') {
      if (inHunk) {
        hunk.push(c)
        contextAfterCount++
        if (contextAfterCount >= contextSize) {
          flushHunk()
          inHunk = false
        }
      } else {
        contextBefore.push(c)
        if (contextBefore.length > contextSize) {
          contextBefore.shift()
        }
      }
    } else {
      if (!inHunk) {
        hunk.push(...contextBefore)
        contextBefore = []
        inHunk = true
      }
      hunk.push(c)
      contextAfterCount = 0
    }
  }

  if (inHunk) {
    flushHunk()
  }

  if (a.length > maxLines || b.length > maxLines) {
    outputLines.push(`\n[Warning: Files were truncated to ${maxLines} lines for diff comparison]`)
  }

  return outputLines.length > 0 ? outputLines.join('\n') : 'Files are identical.'
}

export function getDiffStats(a: string[], b: string[]): { added: number; removed: number } {
  const maxLines = 2000
  const linesA = a.slice(0, maxLines)
  const linesB = b.slice(0, maxLines)

  const m = linesA.length
  const n = linesB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  let added = 0
  let removed = 0
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      added++
      j--
    } else {
      removed++
      i--
    }
  }

  return { added, removed }
}