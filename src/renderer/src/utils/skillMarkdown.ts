import { Skill, SkillMode } from '../../../shared/types'

type FrontmatterValue = string | string[]
type Frontmatter = Record<string, FrontmatterValue>

interface MarkdownParts {
  frontmatter: Frontmatter
  body: string
}

const stripQuotes = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

const parseInlineList = (value: string): string[] => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return []
  }

  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => stripQuotes(item))
    .filter(Boolean)
}

const parseFrontmatter = (rawFrontmatter: string): Frontmatter => {
  return rawFrontmatter.split('\n').reduce<Frontmatter>((acc, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return acc

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) return acc

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const listValue = parseInlineList(rawValue)
    acc[key] = listValue.length > 0 ? listValue : stripQuotes(rawValue)
    return acc
  }, {})
}

const splitMarkdown = (markdown: string): MarkdownParts => {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimStart()
  const lines = normalized.split('\n')

  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: normalized.trim() }
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    throw new Error('Skill Markdown frontmatter 缺少结束分隔符 ---')
  }

  const rawFrontmatter = lines.slice(1, closingIndex).join('\n')
  const body = lines.slice(closingIndex + 1).join('\n').trim()
  return {
    frontmatter: parseFrontmatter(rawFrontmatter),
    body
  }
}

const asString = (value: FrontmatterValue | undefined): string => {
  return typeof value === 'string' ? value.trim() : ''
}

const asStringList = (value: FrontmatterValue | undefined): string[] => {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const slugify = (value: string, fallback: string): string => {
  const slug = value
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return slug || fallback
}

const normalizeTriggers = (frontmatter: Frontmatter, fallback: string): string[] => {
  const triggerValues = [
    ...asStringList(frontmatter.triggers),
    ...asStringList(frontmatter.trigger),
    ...asStringList(frontmatter.aliases)
  ]
  const rawTriggers = triggerValues.length > 0 ? triggerValues : [fallback]
  const uniqueTriggers = new Set<string>()

  rawTriggers.forEach((trigger) => {
    const normalized = slugify(trigger, '')
    if (normalized) uniqueTriggers.add(normalized)
  })

  return Array.from(uniqueTriggers)
}

const readMode = (value: string): SkillMode => {
  return value.toLowerCase() === 'send' ? 'send' : 'insert'
}

const fallbackNameFromFile = (fallbackName: string): string => {
  const withoutExtension = fallbackName.replace(/\.(md|markdown)$/i, '')
  return withoutExtension.replace(/[-_]+/g, ' ').trim() || 'Untitled Skill'
}

const readTitleFromMarkdown = (body: string): string => {
  const titleMatch = body.match(/^#\s+(.+)$/m)
  return titleMatch ? titleMatch[1].trim() : ''
}

export const parseSkillMarkdown = (markdown: string, fallbackFileName: string): Skill => {
  const { frontmatter, body } = splitMarkdown(markdown)
  if (!body.trim()) {
    throw new Error('Skill Markdown 需要在正文里写入 prompt')
  }

  const fallbackName = fallbackNameFromFile(fallbackFileName)
  const name = asString(frontmatter.name) || readTitleFromMarkdown(body) || fallbackName
  const triggers = normalizeTriggers(frontmatter, name)
  if (triggers.length === 0) {
    throw new Error('Skill Markdown 需要提供有效 trigger')
  }

  const idSource = asString(frontmatter.id) || triggers[0]
  const id = `skill-${slugify(idSource, triggers[0])}`
  const description = asString(frontmatter.description)

  return {
    id,
    name,
    trigger: triggers[0],
    triggers,
    prompt: body,
    description: description || undefined,
    mode: readMode(asString(frontmatter.mode)),
    source: 'markdown'
  }
}
