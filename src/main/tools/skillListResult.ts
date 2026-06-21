import { Skill } from '../../shared/types'
import { createSkillResult, pathToFileUrl } from './skillResult'
import { ToolExecutionResult } from './types'
import { getSkillDisplayName, getSkillShortDescription, getSkillTriggers } from './skillMetadata'

export function createSkillListResult(skills: Skill[]): ToolExecutionResult {
  if (skills.length === 0) {
    return createSkillResult({
      resultForModel: 'No custom skills installed.',
      title: 'List Skills',
      summary: '0 skills installed'
    })
  }

  const lines = ['Installed Skills:']
  const items = skills.map((skill) => {
    const triggersStr = getSkillTriggers(skill).join(', ')
    const displayName = getSkillDisplayName(skill)
    const shortDescription = getSkillShortDescription(skill)

    lines.push(`- ID: ${skill.id}`)
    lines.push(`  Name: ${displayName}`)
    if (displayName !== skill.name) lines.push(`  Internal Name: ${skill.name}`)
    lines.push(`  Triggers: ${triggersStr}`)
    if (shortDescription) lines.push(`  Description: ${shortDescription}`)
    if (skill.filePath) lines.push(`  File Path: ${skill.filePath}`)
    if (skill.dirPath) lines.push(`  Directory Path: ${skill.dirPath}`)
    lines.push(`  Mode: ${skill.mode || 'insert'}`)
    lines.push(`  Kind: ${skill.kind || 'prompt'}`)
    if (skill.tools && skill.tools.length > 0) {
      lines.push(`  Declared Tools: ${skill.tools.join(', ')}`)
    }
    lines.push('')

    return {
      title: displayName,
      url: skill.filePath ? pathToFileUrl(skill.filePath) : '',
      snippet: `Triggers: ${triggersStr} | Mode: ${skill.mode || 'insert'}${shortDescription ? ` | ${shortDescription}` : ''}`,
      source: skill.source || 'markdown'
    }
  })

  return createSkillResult({
    resultForModel: lines.join('\n'),
    title: 'List Skills',
    summary: `Found ${skills.length} skills`,
    items
  })
}
