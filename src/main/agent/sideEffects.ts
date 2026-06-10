import { ToolArgs } from '../../shared/types'
import { ActionRecord } from './actionLog'
import { analyzeCommand } from './commandSafety'
import { SideEffectEntry, SideEffectKind, SideEffectReversibility } from './runManifest'

export const SIDE_EFFECTING_TOOLS = new Set(['shell', 'file_write', 'write_memory'])

const IRREVERSIBLE_SHELL_PATTERNS = [
  /\b(npm|pnpm|yarn)\s+(install|add|remove|uninstall)\b/i,
  /\bgit\s+(commit|push|merge|rebase|reset|checkout|clean)\b/i,
  /\b(prisma|typeorm|sequelize|knex)\s+.*\bmigrate\b/i,
  /\bmigrate\b/i,
  /\bRemove-Item\b/i,
  /\b(del|erase|rmdir|move|mv|rm)\b/i
]

export const extractResourceIds = (resultContent: string): string[] => {
  const ids = new Set<string>()
  for (const match of resultContent.matchAll(
    /\bResource ID:\s*([a-fA-F0-9]{16,}|[A-Za-z0-9_-]{12,})/g
  )) {
    ids.add(match[1])
  }
  return Array.from(ids)
}

const getShellReversibility = (
  command: string,
  status: ActionRecord['resultStatus']
): SideEffectReversibility => {
  if (status === 'ambiguous') return 'ambiguous'
  if (IRREVERSIBLE_SHELL_PATTERNS.some((pattern) => pattern.test(command))) return 'irreversible'
  const verdict = analyzeCommand(command)
  if (verdict.level === 'safe') return 'metadata_only'
  if (status === 'success') return 'ambiguous'
  return 'metadata_only'
}

export const buildSideEffectEntry = (
  runId: string,
  callId: string,
  toolName: string,
  args: ToolArgs,
  status: ActionRecord['resultStatus'],
  resultContent: string
): SideEffectEntry => {
  let kind: SideEffectKind = 'system'
  let reversibility: SideEffectReversibility = 'metadata_only'
  const filesTouched: string[] = []
  const command = typeof args.command === 'string' ? args.command : undefined

  if (toolName === 'shell') {
    kind = 'shell'
    reversibility = getShellReversibility(command || '', status)
  } else if (toolName === 'file_write') {
    kind = 'file_write'
    reversibility = status === 'success' ? 'ambiguous' : 'metadata_only'
    if (typeof args.path === 'string') filesTouched.push(args.path)
  } else if (toolName === 'write_memory') {
    kind = 'memory'
    // Memory writes are git-committed, so they are recoverable.
    reversibility = status === 'success' ? 'reversible' : 'metadata_only'
  } else if (toolName === 'fetch_url' || toolName === 'click_link') {
    kind = 'cache'
    reversibility = 'metadata_only'
  } else if (toolName === 'web_search') {
    kind = 'external'
    reversibility = 'metadata_only'
  } else if (
    toolName.includes('read') ||
    toolName.includes('search') ||
    toolName.includes('list')
  ) {
    kind = 'read'
    reversibility = 'metadata_only'
  }

  if (status === 'denied' || status === 'blocked' || status === 'error') {
    reversibility = reversibility === 'irreversible' ? 'irreversible' : 'metadata_only'
  }

  return {
    actionId: callId,
    runId,
    toolName,
    kind,
    reversibility,
    status: status === 'timeout' ? 'error' : status,
    summary: resultContent.slice(0, 300),
    args,
    command,
    filesTouched,
    createdAt: Date.now()
  }
}
