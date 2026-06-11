import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { homedir } from 'os'
import { getSkillRoot, getWorkspaceRoot } from './paths'
import { parseSkillMarkdown, serializeSkillToMarkdown } from '../shared/skillParser'
import { Skill, SkillPackageFile } from '../shared/types'
import { logger } from './logger'

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

export function getSkillDirectories(): string[] {
  const dirs: string[] = []

  // 1. Workspace-local directories (precedence order)
  try {
    const ws = getWorkspaceRoot()
    if (ws && existsSync(ws)) {
      dirs.push(join(ws, 'skills'))
      dirs.push(join(ws, '.quickai', 'skills'))
    }
  } catch (err) {
    // Ignore context errors in path resolution
  }

  // 2. Global user home directories
  const home = process.env.QUICKAI_HOME || homedir()
  dirs.push(getSkillRoot()) // ~/.quickai/skill
  if (home) {
    dirs.push(join(home, '.quickai', 'skills'))
  }

  // Deduplicate and filter to directories that exist on disk
  const seen = new Set<string>()
  const result: string[] = []
  for (const d of dirs) {
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
          // Look for SKILL.md
          const skillMdPath = join(fullPath, 'SKILL.md')
          const skillMdLowerPath = join(fullPath, 'skill.md')
          let entryPath: string | undefined
          let markdownContent = ''

          if (existsSync(skillMdPath)) {
            entryPath = 'SKILL.md'
            markdownContent = readFileSync(skillMdPath, 'utf-8')
          } else if (existsSync(skillMdLowerPath)) {
            entryPath = 'skill.md'
            markdownContent = readFileSync(skillMdLowerPath, 'utf-8')
          }

          if (entryPath && markdownContent) {
            try {
              const packageFiles = findFilesRecursive(fullPath, fullPath)
              const skill = parseSkillMarkdown(markdownContent, entry, {
                source: 'folder',
                entryPath,
                packageRoot: entry,
                packageFiles: packageFiles.length > 0 ? packageFiles : undefined
              })

              skill.filePath = join(fullPath, entryPath)
              skill.dirPath = fullPath

              if (!loadedIds.has(skill.id)) {
                loadedIds.add(skill.id)
                skills.push(skill)
              }
            } catch (err) {
              logger.warn('SkillManager', `Failed to parse folder skill ${entry}: ${(err as Error).message}`)
            }
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
            logger.warn('SkillManager', `Failed to parse flat skill file ${entry}: ${(err as Error).message}`)
          }
        }
      }
    } catch (err) {
      logger.warn('SkillManager', `Failed to read skills directory ${dir}: ${(err as Error).message}`)
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
          const filePath = join(skillDir, file.path)
          const fileDir = join(filePath, '..')
          if (!existsSync(fileDir)) {
            mkdirSync(fileDir, { recursive: true })
          }
          writeFileSync(filePath, file.content, 'utf-8')
        }
      }
      logger.info('SkillManager', `Saved skill ${skill.name} to ${skillDir}`)
    } catch (err) {
      logger.error('SkillManager', `Failed to save skill ${skill.name}: ${(err as Error).message}`)
    }
  }
}

export function migrateDbSkillsToFolders(): void {
  try {
    const globalRoot = getSkillRoot()
    if (!existsSync(globalRoot)) {
      mkdirSync(globalRoot, { recursive: true })
    }

    const entries = readdirSync(globalRoot)
    const folderSkillsExist = entries.some((entry) => {
      const fullPath = join(globalRoot, entry)
      return statSync(fullPath).isDirectory() && entry.startsWith('skill-')
    })

    if (!folderSkillsExist) {
      // Lazy load SQLite loader to migrate skills if folders are empty
      const { loadSkills } = require('./database')
      const dbSkills = loadSkills() as Skill[]
      if (dbSkills.length > 0) {
        logger.info('SkillManager', `Migrating ${dbSkills.length} skills from SQLite to folders...`)
        saveSkillsToFolders(dbSkills)
      }
    }
  } catch (err) {
    logger.warn('SkillManager', `Migration from database to folders failed: ${(err as Error).message}`)
  }
}
