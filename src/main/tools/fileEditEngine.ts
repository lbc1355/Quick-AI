export interface ExactStringEdit {
  oldString: string
  newString: string
  replaceAll: boolean
}

export interface StringEditResult {
  content: string
  replacements: number
}

const MAX_MUTATED_FILE_BYTES = 2 * 1024 * 1024

export function findStringOccurrences(content: string, needle: string): number[] {
  const occurrences: number[] = []
  let searchFrom = 0
  while (searchFrom < content.length) {
    const idx = content.indexOf(needle, searchFrom)
    if (idx === -1) break
    occurrences.push(idx)
    searchFrom = idx + 1
  }
  return occurrences
}

export function applyStringEdit(
  content: string,
  edit: ExactStringEdit,
  occurrences: number[]
): StringEditResult {
  if (edit.replaceAll) {
    return {
      content: content.split(edit.oldString).join(edit.newString),
      replacements: occurrences.length
    }
  }

  return {
    content:
      content.slice(0, occurrences[0]) +
      edit.newString +
      content.slice(occurrences[0] + edit.oldString.length),
    replacements: 1
  }
}

export function assertMutationWithinSizeLimit(content: string, messageSuffix = ''): void {
  const newBuffer = Buffer.from(content, 'utf-8')
  if (newBuffer.length > MAX_MUTATED_FILE_BYTES) {
    throw new Error(
      `Resulting file is too large (${(newBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.${messageSuffix}`
    )
  }
}
