import { Skill } from '../../shared/types'
import { sliceUnicode } from '../../shared/unicodeText'
import { getSkillDisplayName, getSkillShortDescription, getSkillTriggers } from './skillMetadata'
import { normalizeSkillResourcePath } from './skillResourcePath'

const MAX_SKILL_PACKAGE_FILE_CHARS = 6000
const MAX_SKILL_PACKAGE_TOTAL_CHARS = 20000

function formatSkillPackageFiles(skill: Skill, includeContent: boolean): string[] {
  const files = (skill.packageFiles || [])
    .filter((file) => file.content.trim())
    .filter((file) => file.path.toLowerCase() !== (skill.entryPath || 'SKILL.md').toLowerCase())
    .filter((file) => !normalizeSkillResourcePath(file.path).toLowerCase().startsWith('agents/'))
    .sort((a, b) => a.path.localeCompare(b.path))

  if (files.length === 0) return []

  const lines = ['', includeContent ? '--- Skill Package Files ---' : 'Packaged Auxiliary Files:']
  let totalChars = 0

  for (const file of files) {
    if (!includeContent) {
      lines.push(`- Path: ${file.path} (${file.size} bytes)`)
      continue
    }

    if (totalChars >= MAX_SKILL_PACKAGE_TOTAL_CHARS) break
    const remaining = MAX_SKILL_PACKAGE_TOTAL_CHARS - totalChars
    const limit = Math.min(MAX_SKILL_PACKAGE_FILE_CHARS, remaining)
    const content =
      file.content.length > limit
        ? `${sliceUnicode(file.content, 0, Math.max(0, limit - 34))}\n[File truncated for context size]`
        : file.content

    lines.push(`Path: ${file.path} (${file.size} bytes)`)
    lines.push(content)
    lines.push('---')
    totalChars += content.length
  }

  return lines
}

export function formatSkillForModel(skill: Skill, includePackageContent: boolean): string {
  const triggers = getSkillTriggers(skill)
  const shortDescription = getSkillShortDescription(skill)
  const packageLines = formatSkillPackageFiles(skill, includePackageContent)
  const lines = [
    `Skill ID: ${skill.id}`,
    `Name: ${getSkillDisplayName(skill)}`,
    getSkillDisplayName(skill) !== skill.name ? `Internal Name: ${skill.name}` : '',
    `Triggers: ${triggers.filter(Boolean).join(', ')}`,
    shortDescription ? `Description: ${shortDescription}` : '',
    skill.filePath ? `File Path: ${skill.filePath}` : '',
    skill.dirPath ? `Directory Path: ${skill.dirPath}` : '',
    `Mode: ${skill.mode || 'insert'}`,
    `Kind: ${skill.kind || 'prompt'}`,
    skill.tools && skill.tools.length > 0 ? `Declared Tools: ${skill.tools.join(', ')}` : '',
    '',
    '--- SKILL.md Prompt Instructions ---',
    skill.rawMarkdown || skill.prompt,
    '-------------------------------------',
    ...packageLines,
    ...(!includePackageContent && packageLines.length > 0
      ? [
          '',
          'Load auxiliary files only when needed with read_skill_resource using the listed Path.'
        ]
      : [])
  ]

  return lines.filter((line) => line !== '').join('\n')
}
