import { BrowserWindow } from 'electron'
import { AgentSkillRunOptions, ChatRunOptions } from '../../shared/types'
import { runAgentLoop } from './agentLoop'
import { globalPermissionManager } from './permissionManager'
import { abortRun, getRun } from './AgentRunContext'

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

export const resolveToolPermission = (
  reqId: string,
  callId: string,
  approved:
    | boolean
    | {
        approved: boolean
        scope?: 'prefix' | 'tool'
        prefix?: string
        prefixes?: string[]
        tool?: string
      }
): void => {
  let isApproved = false
  if (typeof approved === 'boolean') {
    isApproved = approved
  } else if (approved && typeof approved === 'object') {
    isApproved = approved.approved
    if (approved.approved) {
      const run = getRun(reqId)
      if (run) {
        if (approved.scope === 'prefix') {
          // A chained command sends every segment prefix at once (prefixes); a single command
          // sends one (prefix). Approve whichever is present so the combined option grants all.
          if (approved.prefixes && approved.prefixes.length > 0) {
            for (const prefix of approved.prefixes) {
              run.approveCommandPrefix(prefix)
            }
          } else if (approved.prefix) {
            run.approveCommandPrefix(approved.prefix)
          }
        } else if (approved.scope === 'tool' && approved.tool) {
          run.approveTool(approved.tool)
        }
      }
    }
  }
  globalPermissionManager.resolve(reqId, callId, isApproved)
}

export const abortAgentSkill = (reqId: string): void => {
  abortRun(reqId)
}
