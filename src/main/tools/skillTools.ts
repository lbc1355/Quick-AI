import { loadSkillsFromFolders } from '../skillManager'
import { ToolDefinition } from './types'
import { createListSkillsTool } from './skillListTool'
import { createSkillLifecycleTools } from './skillLifecycleTools'
import { createSkillReadTools } from './skillReadTools'
import { createValidateSkillTool } from './skillValidationTool'

export const skillTools: Record<string, ToolDefinition> = {
  ...createSkillLifecycleTools({ loadSkills: loadSkillsFromFolders }),
  validate_skill: createValidateSkillTool({ loadSkills: loadSkillsFromFolders }),
  ...createSkillReadTools({ loadSkills: loadSkillsFromFolders }),
  list_skills: createListSkillsTool({ loadSkills: loadSkillsFromFolders })
}
