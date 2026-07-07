import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { getMemoriesRoot } from '../paths'
import { ensureRepo, commit } from './memoryGit'

/**
 * Markdown memory library backed by files under `~/.quickai/memories`.
 *
 *   always.md            constant injection, read every run
 *   memory_summary.md    on-demand index (task-group catalogue)
 *   MEMORY.md            compressed on-demand knowledge, organized by Task Group
 *   raw_memories.md      raw sediment, append-only, for rebuild/audit
 *   rollout_summaries/   per-task provenance summaries
 *   extensions/ad_hoc/instructions.md   human-authored notes
 *   .git/                version / diff / rollback
 */

export interface TaskGroup {
  /** Group name from the `# Task Group: <name>` header. */
  name: string
  /** The full Markdown block for this group, including its header. */
  raw: string
  /** First non-empty value of a `scope:` line, if present. */
  scope?: string
}

const ALWAYS_FILE = 'always.md'
const SUMMARY_FILE = 'memory_summary.md'
const MEMORY_FILE = 'MEMORY.md'
const RAW_FILE = 'raw_memories.md'
const ROLLOUT_DIR = 'rollout_summaries'
const ADHOC_FILE = join('extensions', 'ad_hoc', 'instructions.md')

const ALWAYS_SEED = `# Always (Constant Memory)

> 每轮任务都会注入。只放长期稳定、值得每次影响行为的内容：语言偏好、工作方式、稳定禁忌、常用路径、全局安全边界。保持简短（建议 2-5KB 封顶）。
`

const SUMMARY_SEED = `# What's in Memory (On-Demand Index)

> 这是按需记忆的目录。任务开始时先看这里，判断是否需要用 \`read_memory\` 读取某个 Task Group 的详情。

<!-- 自动从 MEMORY.md 的 Task Group 生成。可手工补充说明。 -->
`

const MEMORY_SEED = `<!-- 按需知识库。按 Task Group 组织，使用 write_memory(target="task_group") 写入。 -->
`

const RAW_SEED = `# Raw Memories

> 原始沉淀材料，append-only，供重建/审计。未压缩、未验证的内容先进这里。
`

const ADHOC_SEED = `# Ad-hoc Instructions

> 人工补充的记忆说明。
`

export function getMemoryFilePaths(): {
  root: string
  always: string
  summary: string
  memory: string
  raw: string
  rolloutDir: string
  adhoc: string
} {
  const root = getMemoriesRoot()
  return {
    root,
    always: join(root, ALWAYS_FILE),
    summary: join(root, SUMMARY_FILE),
    memory: join(root, MEMORY_FILE),
    raw: join(root, RAW_FILE),
    rolloutDir: join(root, ROLLOUT_DIR),
    adhoc: join(root, ADHOC_FILE)
  }
}

function writeIfMissing(path: string, seed: string): void {
  if (!existsSync(path)) writeFileSync(path, seed, 'utf8')
}

/** Create the directory skeleton and seed files, and init the git repo. Idempotent. */
export async function ensureMemoryLibrary(): Promise<void> {
  const p = getMemoryFilePaths()
  mkdirSync(p.rolloutDir, { recursive: true })
  mkdirSync(join(p.root, 'extensions', 'ad_hoc'), { recursive: true })
  writeIfMissing(p.always, ALWAYS_SEED)
  writeIfMissing(p.summary, SUMMARY_SEED)
  writeIfMissing(p.memory, MEMORY_SEED)
  writeIfMissing(p.raw, RAW_SEED)
  writeIfMissing(p.adhoc, ADHOC_SEED)
  await ensureRepo(p.root)
}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function readAlways(): string {
  return read(getMemoryFilePaths().always)
}

export function readSummaryIndex(): string {
  return read(getMemoryFilePaths().summary)
}

export function readMemoryFile(): string {
  return read(getMemoryFilePaths().memory)
}

export function readRaw(): string {
  return read(getMemoryFilePaths().raw)
}

/** Split MEMORY.md into Task Group blocks. Content before the first header is ignored. */
export function parseTaskGroups(md: string): TaskGroup[] {
  const groups: TaskGroup[] = []
  const headerRe = /^# Task Group:\s*(.+?)\s*$/gm
  const matches = [...md.matchAll(headerRe)]
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? md.length) : md.length
    const raw = md.slice(start, end).trimEnd()
    const name = matches[i][1].trim()
    const scopeMatch = raw.match(/^scope:\s*(.+?)\s*$/m)
    groups.push({ name, raw, scope: scopeMatch?.[1]?.trim() })
  }
  return groups
}

export function listTaskGroups(): TaskGroup[] {
  return parseTaskGroups(readMemoryFile())
}

export function getTaskGroup(name: string): TaskGroup | undefined {
  const target = name.trim().toLowerCase()
  return listTaskGroups().find((g) => g.name.toLowerCase() === target)
}

/** List rollout summary file names (most recent first by name). */
export function listRolloutSummaries(): string[] {
  const { rolloutDir } = getMemoryFilePaths()
  try {
    return readdirSync(rolloutDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

export function readRolloutSummary(fileName: string): string {
  const base = fileName.replace(/[\\/]/g, '')
  return read(join(getMemoryFilePaths().rolloutDir, base))
}

// ---- writes (each commits to git best-effort) ----

async function persist(message: string): Promise<void> {
  await commit(getMemoryFilePaths().root, message)
}

export async function setAlways(content: string): Promise<void> {
  await ensureMemoryLibrary()
  writeFileSync(
    getMemoryFilePaths().always,
    content.endsWith('\n') ? content : content + '\n',
    'utf8'
  )
  await persist('memory: update always.md')
}

/** Insert or replace a whole Task Group block in MEMORY.md, then refresh the index. */
export async function writeTaskGroup(name: string, block: string): Promise<void> {
  await ensureMemoryLibrary()
  const trimmedName = name.trim()
  const groups = listTaskGroups()
  const normalized = block.trim().startsWith('# Task Group:')
    ? block.trim()
    : `# Task Group: ${trimmedName}\n\n${block.trim()}`
  const idx = groups.findIndex((g) => g.name.toLowerCase() === trimmedName.toLowerCase())
  if (idx >= 0) {
    groups[idx] = { name: trimmedName, raw: normalized }
  } else {
    groups.push({ name: trimmedName, raw: normalized })
  }
  const body = groups.map((g) => g.raw.trimEnd()).join('\n\n') + '\n'
  writeFileSync(getMemoryFilePaths().memory, body, 'utf8')
  rebuildSummaryIndex(groups)
  await persist(`memory: write task group "${trimmedName}"`)
}

export async function deleteTaskGroup(name: string): Promise<boolean> {
  await ensureMemoryLibrary()
  const target = name.trim().toLowerCase()
  const groups = listTaskGroups()
  const idx = groups.findIndex((g) => g.name.toLowerCase() === target)
  if (idx < 0) return false

  groups.splice(idx, 1)
  const body =
    groups.length > 0
      ? groups.map((g) => g.raw.trimEnd()).join('\n\n') + '\n'
      : '<!-- 按需知识库。按 Task Group 组织，使用 write_memory(target="task_group") 写入。 -->\n'
  writeFileSync(getMemoryFilePaths().memory, body, 'utf8')
  rebuildSummaryIndex(groups)
  await persist(`memory: delete task group "${name.trim()}"`)
  return true
}

export async function appendRaw(text: string): Promise<void> {
  await ensureMemoryLibrary()
  const { raw } = getMemoryFilePaths()
  const existing = read(raw)
  const stamp = `\n\n---\n${text.trim()}\n`
  writeFileSync(raw, existing.trimEnd() + stamp, 'utf8')
  await persist('memory: append raw memory')
}

export interface RolloutMeta {
  threadId?: string
  updatedAt: string
  cwd?: string
  outcome?: string
  slug: string
}

export async function writeRolloutSummary(meta: RolloutMeta, body: string): Promise<string> {
  await ensureMemoryLibrary()
  const { rolloutDir } = getMemoryFilePaths()
  mkdirSync(rolloutDir, { recursive: true })
  const datePart = meta.updatedAt.slice(0, 10)
  const safeSlug = meta.slug.replace(/[^a-zA-Z0-9一-龥-]+/g, '-').slice(0, 60)
  const fileName = `${datePart}-${safeSlug}.md`
  const header = [
    meta.threadId ? `thread_id: ${meta.threadId}` : '',
    `updated_at: ${meta.updatedAt}`,
    meta.cwd ? `cwd: ${meta.cwd}` : '',
    meta.outcome ? `outcome: ${meta.outcome}` : ''
  ]
    .filter(Boolean)
    .join('\n')
  writeFileSync(join(rolloutDir, fileName), `${header}\n\n${body.trim()}\n`, 'utf8')
  await persist(`memory: rollout summary ${fileName}`)
  return fileName
}

/** Regenerate memory_summary.md from the current task groups. */
function rebuildSummaryIndex(groups: TaskGroup[]): void {
  const lines = [SUMMARY_SEED.trimEnd(), '']
  if (groups.length === 0) {
    lines.push('_（暂无 Task Group）_')
  } else {
    for (const g of groups) {
      lines.push(`- **${g.name}**${g.scope ? ` — ${g.scope}` : ''}`)
    }
  }
  writeFileSync(getMemoryFilePaths().summary, lines.join('\n') + '\n', 'utf8')
}

// ---- file-browser API (used by the renderer's MemoryManager) ----

export interface MemoryEntry {
  /** Stable id: one of always|summary|memory|raw, or `rollout:<filename>`. */
  id: string
  label: string
  kind: 'always' | 'summary' | 'memory' | 'raw' | 'rollout'
}

/** Resolve an entry id to its absolute file path, or undefined if unknown. */
function entryPath(id: string): string | undefined {
  const p = getMemoryFilePaths()
  switch (id) {
    case 'always':
      return p.always
    case 'summary':
      return p.summary
    case 'memory':
      return p.memory
    case 'raw':
      return p.raw
    default:
      if (id.startsWith('rollout:')) {
        const file = id.slice('rollout:'.length).replace(/[\\/]/g, '')
        if (!file.endsWith('.md')) return undefined
        return join(p.rolloutDir, file)
      }
      return undefined
  }
}

export async function listMemoryEntries(): Promise<MemoryEntry[]> {
  await ensureMemoryLibrary()
  const entries: MemoryEntry[] = [
    { id: 'always', label: 'always.md（常态注入）', kind: 'always' },
    { id: 'summary', label: 'memory_summary.md（按需索引）', kind: 'summary' },
    { id: 'memory', label: 'MEMORY.md（按需知识库）', kind: 'memory' },
    { id: 'raw', label: 'raw_memories.md（原始材料）', kind: 'raw' }
  ]
  for (const file of listRolloutSummaries()) {
    entries.push({ id: `rollout:${file}`, label: `rollout_summaries/${file}`, kind: 'rollout' })
  }
  return entries
}

export function readMemoryEntry(id: string): string {
  const path = entryPath(id)
  return path ? read(path) : ''
}

export async function writeMemoryEntry(id: string, content: string): Promise<void> {
  await ensureMemoryLibrary()
  const path = entryPath(id)
  if (!path) throw new Error(`Unknown memory entry: ${id}`)
  writeFileSync(path, content.endsWith('\n') ? content : content + '\n', 'utf8')
  // Editing MEMORY.md by hand refreshes the on-demand index to keep them in sync.
  if (id === 'memory') {
    rebuildSummaryIndex(parseTaskGroups(content))
  }
  await persist(`memory: edit ${id} via manager`)
}
