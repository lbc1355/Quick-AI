import { Skill } from '../../shared/types'
import { getDb } from './connection'

export function loadSkills(): Skill[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM skills').all() as Array<{
    id: string
    name: string
    trigger: string
    prompt: string
    description: string
    triggers: string
    mode: string
    kind: string
    tools: string
    maxSteps: number
    rawMarkdown: string | null
    source: string
    entryPath: string | null
    packageRoot: string | null
    packageFiles: string | null
    installedAt: number | null
    updatedAt: number | null
    toolDiscovery: string
  }>

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    prompt: r.prompt,
    description: r.description || undefined,
    triggers: JSON.parse(r.triggers || '[]'),
    mode: r.mode as Skill['mode'],
    kind: r.kind as Skill['kind'],
    tools: JSON.parse(r.tools || '[]'),
    maxSteps: r.maxSteps ?? undefined,
    rawMarkdown: r.rawMarkdown || undefined,
    source: r.source as Skill['source'],
    entryPath: r.entryPath || undefined,
    packageRoot: r.packageRoot || undefined,
    packageFiles: parseSkillPackageFiles(r.packageFiles),
    installedAt: r.installedAt ?? undefined,
    updatedAt: r.updatedAt ?? undefined,
    toolDiscovery: r.toolDiscovery as Skill['toolDiscovery']
  }))
}

function parseSkillPackageFiles(value: string | null): Skill['packageFiles'] {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined

    const files = parsed
      .map((file) => {
        if (!file || typeof file !== 'object') return undefined
        const candidate = file as { path?: unknown; content?: unknown; size?: unknown }
        if (typeof candidate.path !== 'string' || typeof candidate.content !== 'string') {
          return undefined
        }
        return {
          path: candidate.path,
          content: candidate.content,
          size: typeof candidate.size === 'number' ? candidate.size : candidate.content.length
        }
      })
      .filter((file): file is NonNullable<Skill['packageFiles']>[number] => !!file)

    return files.length > 0 ? files : undefined
  } catch {
    return undefined
  }
}

export function saveSkills(skills: Skill[]): void {
  const database = getDb()
  const deleteSkills = database.prepare('DELETE FROM skills')
  const insert = database.prepare(
    `INSERT OR REPLACE INTO skills
     (id, name, trigger, prompt, description, triggers, mode, kind, tools, maxSteps, rawMarkdown, source, entryPath, packageRoot, packageFiles, installedAt, updatedAt, toolDiscovery)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const persist = database.transaction((skillList: Skill[]) => {
    deleteSkills.run()
    for (const s of skillList) {
      insert.run(
        s.id,
        s.name,
        s.trigger,
        s.prompt,
        s.description || '',
        JSON.stringify(s.triggers || []),
        s.mode || 'insert',
        s.kind || 'prompt',
        JSON.stringify(s.tools || []),
        s.maxSteps ?? 30,
        s.rawMarkdown || null,
        s.source || 'manual',
        s.entryPath || null,
        s.packageRoot || null,
        JSON.stringify(s.packageFiles || []),
        s.installedAt || null,
        s.updatedAt || null,
        s.toolDiscovery || 'static'
      )
    }
  })
  persist(skills)
}
