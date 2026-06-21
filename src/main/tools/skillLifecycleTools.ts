import { ToolDefinition } from './types'
import { createCreateSkillTool } from './skillCreateTool'
import { createInstallSkillTool } from './skillInstallTool'
import { createRemoveSkillTool } from './skillRemoveTool'
import { CreateSkillLifecycleToolsOptions } from './skillLifecycleShared'

export function createSkillLifecycleTools(
  options: CreateSkillLifecycleToolsOptions
): Record<'create_skill' | 'install_skill' | 'remove_skill', ToolDefinition> {
  return {
    create_skill: createCreateSkillTool(options),
    install_skill: createInstallSkillTool(options),
    remove_skill: createRemoveSkillTool(options)
  }
}
