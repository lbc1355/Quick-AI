import { PreparedToolCall } from './toolCallPlanning'

const compactText = (text: string): string => text.replace(/\s+/g, ' ').trim()

const stripMarkdownMarkers = (text: string): string =>
  text
    .replace(/[`*_#[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const truncate = (text: string, maxLength: number): string => {
  const clean = compactText(text)
  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 1))}…` : clean
}

const buildToolNamesSummary = (calls: PreparedToolCall[]): string => {
  const names = Array.from(new Set(calls.map((call) => call.toolName).filter(Boolean)))
  if (names.length === 0) return '工具'
  if (names.length <= 3) return names.join('、')
  return `${names.slice(0, 3).join('、')} 等 ${names.length} 类工具`
}

export const buildAgentStepPresentation = (
  assistantText: string,
  calls: PreparedToolCall[]
): { title: string; message: string } => {
  const visibleMessage = compactText(assistantText)
  const purposes = calls
    .map((call) => (typeof call.purpose === 'string' ? compactText(call.purpose) : ''))
    .filter(Boolean)

  let message = visibleMessage
  if (!message && purposes.length === 1) {
    message = purposes[0]
  } else if (!message && purposes.length > 1) {
    message = `准备执行 ${calls.length} 个工具：${purposes.slice(0, 2).join('；')}${
      purposes.length > 2 ? '…' : ''
    }`
  } else if (!message) {
    message = `准备调用 ${calls.length} 个工具：${buildToolNamesSummary(calls)}。`
  }

  const firstSentence =
    stripMarkdownMarkers(message)
      .split(/[。.!?\n]/)
      .map((part) => part.trim())
      .find(Boolean) || `调用 ${buildToolNamesSummary(calls)}`

  return {
    title: truncate(firstSentence, 42),
    message
  }
}
