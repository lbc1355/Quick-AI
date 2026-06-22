import { ToolDefinition } from './types'
import { askUserChoiceTool } from './userChoice'
import { reminderTools } from './reminderTools'
import { resourceTools } from './resourceTools'
import { taskTool } from './taskTool'
import { skillTools } from './skillTools'
import { inspectEnvironmentTool } from './inspectEnvironmentTool'
import { notifyTool } from './notifyTool'

export const systemTools: Record<string, ToolDefinition> = {
  ...resourceTools,
  task: taskTool,
  inspect_environment: inspectEnvironmentTool,
  ask_user_choice: askUserChoiceTool,
  ...reminderTools,
  notify: notifyTool,
  ...skillTools
}
