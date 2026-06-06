import { BrowserWindow } from 'electron'
import { AgentSkillRunOptions, ChatRunOptions } from '../../shared/types'
import { runAgentLoop } from './agentLoop'
import { globalPermissionManager } from './permissionManager'
import { abortRun } from './AgentRunContext'

export const runAgentSkill = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: AgentSkillRunOptions,
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  return runAgentLoop(mainWindow, reqId, options, permissions)
}

export const runGeneralAgent = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: ChatRunOptions,
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  return runAgentLoop(mainWindow, reqId, options, permissions)
}

export const resolveToolPermission = (reqId: string, callId: string, approved: boolean): void => {
  globalPermissionManager.resolve(reqId, callId, approved)
}

export const abortAgentSkill = (reqId: string): void => {
  abortRun(reqId)
}
