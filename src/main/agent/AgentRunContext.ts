import { PermissionManager, globalPermissionManager } from './permissionManager'

export class AgentRunContext {
  readonly reqId: string
  readonly controller: AbortController
  readonly activeTools: Set<string>
  readonly executedCalls: Set<string>
  readonly toolScope: Set<string> | 'all'
  readonly permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
  private readonly permissions: PermissionManager

  constructor(
    reqId: string,
    initialTools: string[],
    toolScope: Set<string> | 'all',
    permissionManager: PermissionManager,
    permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
  ) {
    this.reqId = reqId
    this.controller = new AbortController()
    this.activeTools = new Set(initialTools)
    this.executedCalls = new Set()
    this.toolScope = toolScope
    this.permissionPolicy = permissionPolicy
    this.permissions = permissionManager
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  abort(): void {
    this.controller.abort()
    this.permissions.cleanupForRun(this.reqId)
  }

  isToolActive(toolName: string): boolean {
    return this.activeTools.has(toolName)
  }

  activateTool(toolName: string): void {
    this.activeTools.add(toolName)
  }

  hasExecuted(callKey: string): boolean {
    return this.executedCalls.has(callKey)
  }

  markExecuted(callKey: string): void {
    this.executedCalls.add(callKey)
  }
}

const activeRuns = new Map<string, AgentRunContext>()

export function createRun(
  reqId: string,
  initialTools: string[],
  toolScope: Set<string> | 'all',
  permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): AgentRunContext {
  const ctx = new AgentRunContext(reqId, initialTools, toolScope, globalPermissionManager, permissionPolicy)
  activeRuns.set(reqId, ctx)
  return ctx
}

export function getRun(reqId: string): AgentRunContext | undefined {
  return activeRuns.get(reqId)
}

export function destroyRun(reqId: string): void {
  const ctx = activeRuns.get(reqId)
  if (ctx) {
    ctx.abort()
    activeRuns.delete(reqId)
  }
}
