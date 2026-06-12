import { Skill, SkillInterfaceMetadata, SkillKind, SkillMode, SkillPackageFile } from './types'

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
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .trim()
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
  const normalized = value.toLowerCase()
  if (normalized === 'send') return 'send'
  if (normalized === 'run') return 'run'
  return 'insert'
}

const readKind = (value: string, mode: SkillMode, body: string, tools: string[]): SkillKind => {
  const normalized = value.toLowerCase()
  if (normalized === 'agent') return 'agent'
  if (normalized === 'prompt') return 'prompt'
  if (mode === 'run' || tools.length > 0) return 'agent'
  if (/https?:\/\//i.test(body) && /\{keyword\}/i.test(body)) return 'agent'
  return 'prompt'
}

const readMaxSteps = (value: string): number | undefined => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.floor(parsed)
}

const fallbackNameFromFile = (fallbackName: string): string => {
  const withoutExtension = fallbackName.replace(/\.(md|markdown)$/i, '')
  return withoutExtension.replace(/[-_]+/g, ' ').trim() || 'Untitled Skill'
}

const readTitleFromMarkdown = (body: string): string => {
  const titleMatch = body.match(/^#\s+(.+)$/m)
  return titleMatch ? titleMatch[1].trim() : ''
}

export interface ParseSkillMarkdownOptions {
  source?: Skill['source']
  entryPath?: string
  packageRoot?: string
  packageFiles?: SkillPackageFile[]
  interface?: SkillInterfaceMetadata
}

export const parseSkillMarkdown = (
  markdown: string,
  fallbackFileName: string,
  options: ParseSkillMarkdownOptions = {}
): Skill => {
  const { frontmatter, body } = splitMarkdown(markdown)
  if (!body.trim()) {
    throw new Error('Skill Markdown 需要在正文里写入 prompt')
  }

  const fallbackName = fallbackNameFromFile(fallbackFileName)
  const titleFromMarkdown = readTitleFromMarkdown(body)
  const name = asString(frontmatter.name) || titleFromMarkdown || fallbackName

  // If the title was read from the top of the body, we can strip it from the body/prompt
  let prompt = body
  if (titleFromMarkdown) {
    const headerPrefixMatch = body.match(/^#\s+/)
    if (headerPrefixMatch) {
      const prefix = headerPrefixMatch[0]
      if (body.startsWith(prefix + titleFromMarkdown)) {
        prompt = body.slice((prefix + titleFromMarkdown).length).replace(/^\s*\n*/, '')
      }
    }
  }

  const triggers = normalizeTriggers(frontmatter, name)
  if (triggers.length === 0) {
    throw new Error('Skill Markdown 需要提供有效 trigger')
  }

  const idSource = asString(frontmatter.id) || triggers[0]
  const id = `skill-${slugify(idSource, triggers[0])}`
  const description = asString(frontmatter.description)
  const mode = readMode(asString(frontmatter.mode))
  const declaredTools = asStringList(frontmatter.tools)
    .map((tool) => tool.trim())
    .filter(Boolean)
  const kind = readKind(asString(frontmatter.kind), mode, body, declaredTools)
  const tools =
    kind === 'agent' ? Array.from(new Set([...declaredTools, 'fetch_url'])) : declaredTools

  return {
    id,
    name,
    trigger: triggers[0],
    triggers,
    prompt,
    description: description || undefined,
    interface: options.interface,
    mode: kind === 'agent' && mode === 'insert' ? 'run' : mode,
    kind,
    tools,
    maxSteps: readMaxSteps(asString(frontmatter.max_steps) || asString(frontmatter.maxsteps)),
    rawMarkdown: markdown,
    source: options.source || 'markdown',
    entryPath: options.entryPath,
    packageRoot: options.packageRoot,
    packageFiles: options.packageFiles
  }
}

export const serializeSkillToMarkdown = (skill: Skill): string => {
  const frontmatterLines: string[] = []

  // Always write name
  frontmatterLines.push(`name: ${JSON.stringify(skill.name)}`)

  // Write trigger / triggers
  if (skill.triggers && skill.triggers.length > 0) {
    frontmatterLines.push(`triggers: [${skill.triggers.map((t) => JSON.stringify(t)).join(', ')}]`)
  } else if (skill.trigger) {
    frontmatterLines.push(`trigger: ${JSON.stringify(skill.trigger)}`)
  }

  if (skill.description) {
    frontmatterLines.push(`description: ${JSON.stringify(skill.description)}`)
  }

  if (skill.mode) {
    frontmatterLines.push(`mode: ${skill.mode}`)
  }

  if (skill.kind) {
    frontmatterLines.push(`kind: ${skill.kind}`)
  }

  if (skill.tools && skill.tools.length > 0) {
    const filteredTools = skill.tools.filter((t) => t !== 'fetch_url')
    if (filteredTools.length > 0) {
      frontmatterLines.push(`tools: [${filteredTools.map((t) => JSON.stringify(t)).join(', ')}]`)
    }
  }

  if (skill.maxSteps !== undefined) {
    frontmatterLines.push(`max_steps: ${skill.maxSteps}`)
  }

  const frontmatter = `---\n${frontmatterLines.join('\n')}\n---`
  const startsWithHeader = skill.prompt.trimStart().startsWith('# ')
  const body = startsWithHeader ? skill.prompt : `# ${skill.name}\n\n${skill.prompt}`
  return `${frontmatter}\n\n${body}`
}
