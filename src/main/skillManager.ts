import {
  FSWatcher,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  watch
} from 'fs'
import { dirname, join, normalize, relative } from 'path'
import { homedir } from 'os'
import { getQuickAiRoot, getSkillRoot, getWorkspaceRoot } from './paths'
import { parseSkillMarkdown, serializeSkillToMarkdown } from '../shared/skillParser'
import { Skill, SkillInterfaceMetadata, SkillPackageFile } from '../shared/types'
import { logger } from './logger'

const WATCH_IGNORED_DIRS = new Set(['node_modules', 'build', 'dist', 'out'])
const SKILL_INTERFACE_FILES = ['agents/quickai.yaml', 'agents/openai.yaml']
const SYSTEM_SKILL_DIR = '.system'

const SYSTEM_SKILLS: Array<{
  dir: string
  skillMarkdown: string
  interface?: SkillInterfaceMetadata
}> = [
  {
    dir: 'skill-creator',
    skillMarkdown: `---
name: skill-creator
trigger: skill-creator
description: Create or update QuickAI skills as folder packages with concise SKILL.md instructions, optional references, scripts, assets, and agents/quickai.yaml UI metadata. Use when the user asks to create a skill, improve a skill, design reusable agent workflows, or explain QuickAI skill structure.
kind: agent
---

# QuickAI Skill Creator

Create or update QuickAI skills.

## Folder Shape

Use a folder package when possible:

\`\`\`
skill-name/
  SKILL.md
  agents/quickai.yaml
  references/
  scripts/
  assets/
\`\`\`

\`SKILL.md\` is the only required file. Keep it concise and procedural. Put long docs in \`references/\`, deterministic helpers in \`scripts/\`, and files intended for final outputs in \`assets/\`.

## Progressive Loading

QuickAI keeps only skill summaries in the agent system prompt. When a skill is selected or matched, call \`load_skill\` to load \`SKILL.md\` and the auxiliary file list. Read auxiliary files only when needed with \`read_skill_resource\`.

## Metadata

Use \`agents/quickai.yaml\` for UI metadata:

\`\`\`yaml
interface:
  display_name: "Skill Creator"
  short_description: "Create or update QuickAI skills"
  default_prompt: "Use @skill-creator to create a reusable skill."
\`\`\`

## Creation Workflow

1. Identify concrete examples of when the skill should trigger.
2. Write a strong frontmatter \`description\` covering when to use and when not to use the skill.
3. Keep \`SKILL.md\` focused on core workflow and decision rules.
4. Move variants, schemas, examples, and long policies into \`references/\`.
5. Add scripts when the same fragile code would otherwise be rewritten repeatedly.
6. Validate by loading the skill and checking that the agent can find the right references without reading the whole package.
`,
    interface: {
      displayName: 'Skill Creator',
      shortDescription: 'Create or update QuickAI skills',
      defaultPrompt: 'Use @skill-creator to create a reusable QuickAI skill.'
    }
  },
  {
    dir: 'skill-installer',
    skillMarkdown: `---
name: skill-installer
trigger: skill-installer
description: Install, import, or inspect QuickAI skills from local folders, markdown files, or repository paths. Use when the user asks to install a skill, list installable skill packages, copy a Codex-style skill into QuickAI, or troubleshoot skill package layout.
kind: agent
---

# QuickAI Skill Installer

Install or import QuickAI skills while preserving folder-package structure.

## Supported Inputs

- A local folder containing \`SKILL.md\`.
- A single markdown skill file.
- A repository path or downloaded folder that contains one or more skill packages.
- A Codex-style skill folder with \`agents/openai.yaml\`; QuickAI also accepts \`agents/quickai.yaml\`.

## Install Target

Install user skills under the active QuickAI skill root:

\`\`\`
~/.quickai/skill/<skill-name>/
\`\`\`

System skills live under:

\`\`\`
~/.quickai/skill/.system/<skill-name>/
\`\`\`

Do not install ordinary user skills into \`.system\` unless the user explicitly asks for a system-level skill.

## Workflow

1. Inspect the source layout before copying.
2. Prefer preserving folder packages over flattening files.
3. Refuse to overwrite an existing destination unless the user explicitly asks.
4. Ensure the destination has \`SKILL.md\`.
5. Preserve \`references/\`, \`scripts/\`, \`assets/\`, and \`agents/\`.
6. If only \`agents/openai.yaml\` exists, leave it in place; QuickAI can read it as UI metadata.
7. After installation, call \`list_skills\` to verify the live catalog. QuickAI refreshes dynamically, so no restart is required.

## Validation Checklist

- The skill appears in \`list_skills\`.
- \`load_skill\` returns \`SKILL.md\` and a resource list.
- Large auxiliary files remain unloaded until \`read_skill_resource\` is called.
- The \`@trigger\` shown in UI matches the expected trigger.
`,
    interface: {
      displayName: 'Skill Installer',
      shortDescription: 'Install or import QuickAI skills',
      defaultPrompt: 'Use @skill-installer to install or inspect a QuickAI skill package.'
    }
  },
  {
    dir: 'quickai-agent',
    skillMarkdown: `---
name: quickai-agent
trigger: quickai-agent
aliases: [quickai]
description: Explain, inspect, or improve QuickAI agent behavior, including @skill selection, load_skill, read_skill_resource, dynamic skill refresh, permissions, memory, and tool discovery. Use when the user asks how QuickAI agent internals work or wants to change them.
kind: agent
---

# QuickAI Agent

Work on QuickAI agent internals and explain current behavior from code.

## Core Concepts

- \`@\` mentions select a skill by trigger. The agent then decides when to call \`load_skill\`.
- \`load_skill\` loads \`SKILL.md\` plus auxiliary file paths.
- \`read_skill_resource\` loads a specific auxiliary file only when needed.
- Skill folders are scanned from workspace and global QuickAI skill roots.
- System skills are seeded under \`.quickai/skill/.system/\` and should not overwrite user edits.
- The renderer receives skill refresh events from the main process watcher.

## Workflow

1. Read the relevant QuickAI code before answering implementation questions.
2. Use \`list_skills\` when diagnosing live installed skills.
3. Use \`load_skill\` to inspect a specific skill's instructions.
4. Use \`read_skill_resource\` for package files listed by \`load_skill\`.
5. Keep changes scoped to agent, skill, tool, or UI boundaries implied by the request.
6. Run node/web typechecks and targeted tests after behavior changes.

## Common Files

- \`src/main/skillManager.ts\`: skill scanning, persistence, watcher, and system skill seed.
- \`src/main/tools/system.ts\`: \`load_skill\`, \`read_skill_resource\`, \`list_skills\`.
- \`src/main/agent/messageBuilder.ts\`: agent system prompt and skill catalog injection.
- \`src/renderer/src/hooks/useAutocomplete.ts\`: \`@\` autocomplete.
- \`src/renderer/src/hooks/useSkills.ts\`: renderer skill state refresh.
`,
    interface: {
      displayName: 'QuickAI Agent',
      shortDescription: 'Inspect and improve QuickAI agent behavior',
      defaultPrompt: 'Use @quickai-agent to inspect or improve QuickAI agent internals.'
    }
  }
]

function isSkillInterfaceFilePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return SKILL_INTERFACE_FILES.includes(normalized)
}

function addUniqueDir(dirs: string[], seen: Set<string>, dir: string): void {
  const canonical = normalize(dir)
  if (seen.has(canonical)) return
  seen.add(canonical)
  dirs.push(dir)
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function toCamelInterfaceKey(key: string): keyof SkillInterfaceMetadata | undefined {
  switch (key.trim().toLowerCase()) {
    case 'display_name':
    case 'displayname':
      return 'displayName'
    case 'short_description':
    case 'shortdescription':
      return 'shortDescription'
    case 'icon_small':
    case 'iconsmall':
      return 'iconSmall'
    case 'icon_large':
    case 'iconlarge':
      return 'iconLarge'
    case 'default_prompt':
    case 'defaultprompt':
      return 'defaultPrompt'
    default:
      return undefined
  }
}

function parseSkillInterfaceYaml(content: string): SkillInterfaceMetadata | undefined {
  const metadata: SkillInterfaceMetadata = {}
  let inInterface = false

  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '')
    if (!line.trim()) continue

    if (/^interface\s*:\s*$/.test(line.trim())) {
      inInterface = true
      continue
    }

    if (inInterface && /^\S/.test(line)) {
      break
    }

    if (!inInterface) continue

    const match = line.match(/^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!match) continue

    const key = toCamelInterfaceKey(match[1])
    if (!key) continue

    const value = stripYamlQuotes(match[2]).trim()
    if (value) metadata[key] = value
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function readSkillInterfaceMetadata(skillDir: string): SkillInterfaceMetadata | undefined {
  for (const relPath of SKILL_INTERFACE_FILES) {
    const fullPath = join(skillDir, relPath)
    if (!existsSync(fullPath)) continue
    try {
      return parseSkillInterfaceYaml(readFileSync(fullPath, 'utf-8'))
    } catch (err) {
      logger.warn(
        'SkillManager',
        `Failed to read skill interface metadata ${fullPath}: ${(err as Error).message}`
      )
    }
  }
  return undefined
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}

function serializeSkillInterfaceMetadata(metadata: SkillInterfaceMetadata): string {
  const lines = ['interface:']
  if (metadata.displayName) lines.push(`  display_name: ${quoteYamlString(metadata.displayName)}`)
  if (metadata.shortDescription) {
    lines.push(`  short_description: ${quoteYamlString(metadata.shortDescription)}`)
  }
  if (metadata.iconSmall) lines.push(`  icon_small: ${quoteYamlString(metadata.iconSmall)}`)
  if (metadata.iconLarge) lines.push(`  icon_large: ${quoteYamlString(metadata.iconLarge)}`)
  if (metadata.defaultPrompt) {
    lines.push(`  default_prompt: ${quoteYamlString(metadata.defaultPrompt)}`)
  }
  return `${lines.join('\n')}\n`
}

export function ensureSystemSkills(): void {
  const systemRoot = join(getSkillRoot(), SYSTEM_SKILL_DIR)
  if (!existsSync(systemRoot)) {
    mkdirSync(systemRoot, { recursive: true })
  }

  for (const seed of SYSTEM_SKILLS) {
    try {
      const skillDir = join(systemRoot, seed.dir)
      const skillPath = join(skillDir, 'SKILL.md')
      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true })
      }
      if (!existsSync(skillPath)) {
        writeFileSync(skillPath, seed.skillMarkdown, 'utf-8')
      }
      if (seed.interface) {
        const agentsDir = join(skillDir, 'agents')
        const interfacePath = join(agentsDir, 'quickai.yaml')
        if (!existsSync(agentsDir)) {
          mkdirSync(agentsDir, { recursive: true })
        }
        if (!existsSync(interfacePath)) {
          writeFileSync(interfacePath, serializeSkillInterfaceMetadata(seed.interface), 'utf-8')
        }
      }
    } catch (err) {
      logger.warn(
        'SkillManager',
        `Failed to initialize system skill ${seed.dir}: ${(err as Error).message}`
      )
    }
  }
}

// Recursively find text files in a directory, ignoring hidden dirs, node_modules, etc.
function findFilesRecursive(dir: string, baseDir: string): SkillPackageFile[] {
  const files: SkillPackageFile[] = []
  if (!existsSync(dir)) return files

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')

      // Ignore common noise folders
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === 'build' ||
        entry === 'dist' ||
        entry === 'out'
      ) {
        continue
      }

      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        if (entry === 'agents') continue
        files.push(...findFilesRecursive(fullPath, baseDir))
      } else if (stat.isFile()) {
        // Skip main SKILL.md since it is loaded separately
        if (entry.toLowerCase() === 'skill.md') {
          continue
        }
        try {
          // Only read text files under 256KB
          if (stat.size <= 256 * 1024) {
            const content = readFileSync(fullPath, 'utf-8')
            files.push({
              path: relPath,
              content,
              size: stat.size
            })
          }
        } catch (err) {
          logger.warn('SkillManager', `Failed to read file ${fullPath}: ${(err as Error).message}`)
        }
      }
    }
  } catch (err) {
    logger.warn('SkillManager', `Failed to scan directory ${dir}: ${(err as Error).message}`)
  }
  return files
}

export function getSkillCandidateDirectories(): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()

  // 1. Workspace-local directories (precedence order)
  try {
    const ws = getWorkspaceRoot()
    if (ws && existsSync(ws)) {
      addUniqueDir(dirs, seen, join(ws, 'skills'))
      addUniqueDir(dirs, seen, join(ws, '.quickai', 'skills'))
    }
  } catch (err) {
    // Ignore context errors in path resolution
  }

  // 2. Global user home directories
  const home = process.env.QUICKAI_HOME || homedir()
  addUniqueDir(dirs, seen, getSkillRoot()) // ~/.quickai/skill
  if (home) {
    addUniqueDir(dirs, seen, join(home, '.quickai', 'skills'))
  }

  return dirs
}

export function getSkillDirectories(): string[] {
  // Deduplicate and filter to directories that exist on disk
  const seen = new Set<string>()
  const result: string[] = []
  for (const d of getSkillCandidateDirectories()) {
    if (existsSync(d)) {
      try {
        const stat = statSync(d)
        if (stat.isDirectory()) {
          const canonical = join(d)
          if (!seen.has(canonical)) {
            seen.add(canonical)
            result.push(d)
          }
        }
      } catch {
        // Skip unreadable paths
      }
    }
  }
  return result
}

function addExistingDirectory(dirs: string[], seen: Set<string>, dir: string): void {
  if (!existsSync(dir)) return
  try {
    if (statSync(dir).isDirectory()) {
      addUniqueDir(dirs, seen, dir)
    }
  } catch {
    // Skip unreadable paths
  }
}

function addSubdirectories(dir: string, dirs: string[], seen: Set<string>): void {
  if (!existsSync(dir)) return

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if ((entry.startsWith('.') && entry !== SYSTEM_SKILL_DIR) || WATCH_IGNORED_DIRS.has(entry)) {
        continue
      }
      const fullPath = join(dir, entry)
      try {
        if (!statSync(fullPath).isDirectory()) continue
        addUniqueDir(dirs, seen, fullPath)
        addSubdirectories(fullPath, dirs, seen)
      } catch {
        // Skip unreadable paths
      }
    }
  } catch {
    // Skip unreadable paths
  }
}

export function getSkillWatchDirectories(): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()

  addExistingDirectory(dirs, seen, getQuickAiRoot())
  addExistingDirectory(dirs, seen, getWorkspaceRoot())

  for (const candidate of getSkillCandidateDirectories()) {
    addExistingDirectory(dirs, seen, dirname(candidate))
    addExistingDirectory(dirs, seen, candidate)
    addSubdirectories(candidate, dirs, seen)
  }

  return dirs
}

export function watchSkillFolders(onChange: (skills: Skill[]) => void): () => void {
  const watchers = new Map<string, FSWatcher>()
  let stopped = false
  let refreshTimer: NodeJS.Timeout | undefined
  let emitTimer: NodeJS.Timeout | undefined

  const emitChange = (): void => {
    if (stopped) return
    try {
      onChange(loadSkillsFromFolders())
    } catch (err) {
      logger.warn('SkillManager', `Failed to broadcast skill changes: ${(err as Error).message}`)
    }
  }

  const scheduleEmit = (): void => {
    if (emitTimer) clearTimeout(emitTimer)
    emitTimer = setTimeout(emitChange, 200)
  }

  const refreshWatchers = (): void => {
    if (stopped) return
    const nextDirs = new Set(getSkillWatchDirectories())

    for (const [dir, watcher] of watchers) {
      if (!nextDirs.has(dir)) {
        watcher.close()
        watchers.delete(dir)
      }
    }

    for (const dir of nextDirs) {
      if (watchers.has(dir)) continue
      try {
        const watcher = watch(dir, { persistent: false }, () => {
          scheduleRefresh()
          scheduleEmit()
        })
        watcher.on('error', (err) => {
          logger.warn('SkillManager', `Skill watcher failed for ${dir}: ${err.message}`)
          watchers.delete(dir)
          watcher.close()
          scheduleRefresh()
        })
        watchers.set(dir, watcher)
      } catch (err) {
        logger.warn('SkillManager', `Failed to watch ${dir}: ${(err as Error).message}`)
      }
    }
  }

  const scheduleRefresh = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refreshWatchers, 200)
  }

  refreshWatchers()

  return () => {
    stopped = true
    if (refreshTimer) clearTimeout(refreshTimer)
    if (emitTimer) clearTimeout(emitTimer)
    for (const watcher of watchers.values()) {
      watcher.close()
    }
    watchers.clear()
  }
}

function loadFolderSkill(
  skillDir: string,
  fallbackName: string,
  loadedIds: Set<string>,
  skills: Skill[]
): void {
  const skillMdPath = join(skillDir, 'SKILL.md')
  const skillMdLowerPath = join(skillDir, 'skill.md')
  let entryPath: string | undefined
  let markdownContent = ''

  if (existsSync(skillMdPath)) {
    entryPath = 'SKILL.md'
    markdownContent = readFileSync(skillMdPath, 'utf-8')
  } else if (existsSync(skillMdLowerPath)) {
    entryPath = 'skill.md'
    markdownContent = readFileSync(skillMdLowerPath, 'utf-8')
  }

  if (!entryPath || !markdownContent) return

  try {
    const packageFiles = findFilesRecursive(skillDir, skillDir)
    const skill = parseSkillMarkdown(markdownContent, fallbackName, {
      source: 'folder',
      entryPath,
      packageRoot: fallbackName,
      packageFiles: packageFiles.length > 0 ? packageFiles : undefined,
      interface: readSkillInterfaceMetadata(skillDir)
    })

    skill.filePath = join(skillDir, entryPath)
    skill.dirPath = skillDir

    if (!loadedIds.has(skill.id)) {
      loadedIds.add(skill.id)
      skills.push(skill)
    }
  } catch (err) {
    logger.warn(
      'SkillManager',
      `Failed to parse folder skill ${fallbackName}: ${(err as Error).message}`
    )
  }
}

export function loadSkillsFromFolders(): Skill[] {
  const skills: Skill[] = []
  const loadedIds = new Set<string>()

  const dirs = getSkillDirectories()
  logger.info('SkillManager', `Scanning skill directories: ${dirs.join(', ')}`)

  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          if (entry === SYSTEM_SKILL_DIR) {
            try {
              for (const systemEntry of readdirSync(fullPath)) {
                const systemSkillPath = join(fullPath, systemEntry)
                if (statSync(systemSkillPath).isDirectory()) {
                  loadFolderSkill(systemSkillPath, systemEntry, loadedIds, skills)
                }
              }
            } catch (err) {
              logger.warn(
                'SkillManager',
                `Failed to read system skills directory ${fullPath}: ${(err as Error).message}`
              )
            }
          } else {
            loadFolderSkill(fullPath, entry, loadedIds, skills)
          }
        } else if (stat.isFile() && (entry.endsWith('.md') || entry.endsWith('.markdown'))) {
          // Flat file skill
          try {
            const markdownContent = readFileSync(fullPath, 'utf-8')
            const skill = parseSkillMarkdown(markdownContent, entry, {
              source: 'markdown'
            })

            skill.filePath = fullPath
            skill.dirPath = dir

            if (!loadedIds.has(skill.id)) {
              loadedIds.add(skill.id)
              skills.push(skill)
            }
          } catch (err) {
            logger.warn(
              'SkillManager',
              `Failed to parse flat skill file ${entry}: ${(err as Error).message}`
            )
          }
        }
      }
    } catch (err) {
      logger.warn(
        'SkillManager',
        `Failed to read skills directory ${dir}: ${(err as Error).message}`
      )
    }
  }

  return skills
}

export function saveSkillsToFolders(skillsList: Skill[]): void {
  const globalRoot = getSkillRoot()
  logger.info('SkillManager', `Saving ${skillsList.length} skills to global folder: ${globalRoot}`)

  if (!existsSync(globalRoot)) {
    mkdirSync(globalRoot, { recursive: true })
  }

  const newSkillIds = new Set(skillsList.map((s) => s.id))

  // 1. Clean up removed skill folders from the global path
  try {
    const entries = readdirSync(globalRoot)
    for (const entry of entries) {
      const fullPath = join(globalRoot, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory() && entry.startsWith('skill-')) {
        if (!newSkillIds.has(entry)) {
          logger.info('SkillManager', `Removing deleted skill folder: ${entry}`)
          rmSync(fullPath, { recursive: true, force: true })
        }
      }
    }
  } catch (err) {
    logger.warn('SkillManager', `Failed to clean up global skill folder: ${(err as Error).message}`)
  }

  // 2. Persist active skills to folders
  for (const skill of skillsList) {
    try {
      const skillDir = join(globalRoot, skill.id)
      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true })
      }

      // Write SKILL.md
      const mdContent = serializeSkillToMarkdown(skill)
      writeFileSync(join(skillDir, 'SKILL.md'), mdContent, 'utf-8')

      // Write auxiliary package files
      if (skill.packageFiles) {
        for (const file of skill.packageFiles) {
          if (isSkillInterfaceFilePath(file.path)) continue
          const filePath = join(skillDir, file.path)
          const fileDir = join(filePath, '..')
          if (!existsSync(fileDir)) {
            mkdirSync(fileDir, { recursive: true })
          }
          writeFileSync(filePath, file.content, 'utf-8')
        }
      }
      if (skill.interface && Object.keys(skill.interface).length > 0) {
        const agentsDir = join(skillDir, 'agents')
        if (!existsSync(agentsDir)) {
          mkdirSync(agentsDir, { recursive: true })
        }
        writeFileSync(
          join(agentsDir, 'quickai.yaml'),
          serializeSkillInterfaceMetadata(skill.interface),
          'utf-8'
        )
      }
      logger.info('SkillManager', `Saved skill ${skill.name} to ${skillDir}`)
    } catch (err) {
      logger.error('SkillManager', `Failed to save skill ${skill.name}: ${(err as Error).message}`)
    }
  }
}
