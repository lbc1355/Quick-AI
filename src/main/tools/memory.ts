import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import { getCurrentMemoryDoc, replaceMemoryDoc, listMemories, listMemoryDocs, archiveMemoryDoc } from '../database'
import {
  DEFAULT_MEMORY_DOC_TITLE,
  getMemoryDocIdentity,
  formatMemoryDocHeader,
  appendMemoryDocContent
} from './shared'

export const memoryTools: Record<string, ToolDefinition> = {
  list_past_actions: {
    name: 'list_past_actions',
    title: 'List Past Tool Actions',
    description:
      'Browse your own tool call history for this conversation. Returns a list of recent actions (tool name, turn index, status, result summary). Use this to recall what you have already tried before repeating work or asking the user. Optionally filter by tool name, turn range, or limit.',
    tags: ['memory', 'history', 'actions', 'audit', 'log', '历史', '记录', '操作'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description:
            'Optional filter: only return actions for this tool (e.g. "fetch_url", "web_search").'
        },
        fromTurn: {
          type: 'number',
          description: 'Optional filter: only return actions from this turn index onward.'
        },
        toTurn: {
          type: 'number',
          description: 'Optional filter: only return actions up to this turn index.'
        },
        limit: {
          type: 'number',
          description: 'Maximum actions to return (1-50, default 20).'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const run = getRun(ctx.reqId)
      if (!run) {
        throw new Error(
          'No active agent run found — action log is only available during an agent session.'
        )
      }
      const list = run.actionLog.list({
        toolName: typeof args.toolName === 'string' ? args.toolName : undefined,
        fromTurn: typeof args.fromTurn === 'number' ? args.fromTurn : undefined,
        toTurn: typeof args.toTurn === 'number' ? args.toTurn : undefined,
        limit: typeof args.limit === 'number' ? Math.min(50, Math.max(1, args.limit)) : 20
      })

      if (list.length === 0) {
        return {
          resultForModel: 'No past actions found in this conversation yet.',
          resultForUi: {
            title: 'Past Actions',
            summary: 'No actions recorded yet'
          }
        }
      }

      const lines = [`Past tool actions (${list.length} shown, newest first):`, '']
      list.forEach((a, i) => {
        lines.push(
          `${i + 1}. [Turn ${a.turnIndex}] ${a.toolName} — ${a.resultStatus} (${a.durationMs}ms, ${a.resultSize} chars)`
        )
        lines.push(`   callId: ${a.callId}`)
        if (a.resultInOutputStore) {
          lines.push(
            `   Full output preserved — use get_past_action("${a.callId}") or read_tool_output for full text.`
          )
        }
        lines.push(`   Summary: ${a.resultSummary.slice(0, 200)}`)
        lines.push('')
      })
      lines.push('To inspect a specific action in full, call get_past_action with its callId.')

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'Past Actions',
          summary: `Listed ${list.length} past tool actions`
        }
      }
    }
  },
  get_past_action: {
    name: 'get_past_action',
    title: 'Get Past Action Detail',
    description:
      'Retrieve the full record of a specific past tool call, including its arguments and complete result summary. Use this after list_past_actions to inspect a particular action in detail.',
    tags: ['memory', 'history', 'detail', 'audit', 'log', '历史', '详情', '操作'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        callId: {
          type: 'string',
          description: 'The callId of the past action to retrieve (from list_past_actions).'
        }
      },
      required: ['callId']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const callId = typeof args.callId === 'string' ? args.callId : ''
      if (!callId) {
        throw new Error('Missing or invalid callId parameter')
      }
      const run = getRun(ctx.reqId)
      if (!run) {
        throw new Error('No active agent run found.')
      }
      const record = run.actionLog.get(callId)
      if (!record) {
        return {
          resultForModel: `No action found with callId "${callId}". It may be from a different conversation or have been evicted from the log.`,
          resultForUi: {
            title: `Past Action: ${callId}`,
            summary: 'Not found'
          }
        }
      }

      const argsStr = JSON.stringify(record.args, null, 2)
      const retrievalHint = record.resultInOutputStore
        ? `\nFull result is preserved in the output store. Call read_tool_output(output_id="${record.callId}") to read it.`
        : ''

      return {
        resultForModel: [
          `Action Detail for callId: ${record.callId}`,
          `Tool: ${record.toolName}`,
          `Turn: ${record.turnIndex}`,
          `Status: ${record.resultStatus}`,
          `Permission: ${record.permission}`,
          `Duration: ${record.durationMs}ms`,
          `Result size: ${record.resultSize} chars`,
          `Arguments:`,
          argsStr,
          `Result summary (first 500 chars):`,
          record.resultSummary,
          retrievalHint
        ].join('\n'),
        resultForUi: {
          title: `Past Action: ${record.toolName}`,
          summary: `Turn ${record.turnIndex} — ${record.resultStatus} (${record.durationMs}ms)`
        }
      }
    }
  },
  remember: {
    name: 'remember',
    title: 'Remember',
    description:
      'Append a concise fact, preference, or piece of context to the current versioned memory document. This creates a new current document version and archives the previous one, so existing memory content is preserved. Before writing to a target document that may already exist, read it with read_memory_doc so you know the full current content. For corrections, conflicts, or rewrites, use replace_memory_doc with the complete merged document, never only the new fact.',
    tags: ['memory', 'remember', 'save', 'persist', 'preference', 'fact', '记忆', '记住', '偏好'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory text to store. Be concise and self-contained.'
        },
        scope: {
          type: 'string',
          description:
            'global = remember across all conversations; session = only this conversation. Default: session.',
          enum: ['global', 'session']
        },
        kind: {
          type: 'string',
          description:
            'constant = permanent identity, coding rules, tone; ondemand = facts, directories, experience. Default: ondemand.',
          enum: ['constant', 'ondemand', 'memory', 'soul']
        },
        key: {
          type: 'string',
          description:
            'Document key to append to. Default: "default". Use a stable key for related facts.'
        },
        category: {
          type: 'string',
          description:
            'A short tag to organize the memory, e.g. "preference", "fact", "project", "task". Default: general.'
        }
      },
      required: ['content']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!content) {
        throw new Error('Missing or invalid content parameter')
      }
      const MAX_MEMORY_CHARS = 4000
      if (content.length > MAX_MEMORY_CHARS) {
        throw new Error(
          `Memory content is too long (${content.length} chars). Keep a single memory under ${MAX_MEMORY_CHARS} characters; store concise facts, not whole documents.`
        )
      }
      const category =
        typeof args.category === 'string' && args.category.trim()
          ? args.category.trim().slice(0, 60)
          : 'general'
      const run = getRun(ctx.reqId)
      const sessionId = run?.sessionId
      const identity = getMemoryDocIdentity(args, sessionId)
      let note = ''
      if (args.scope === 'session' && identity.scope === 'global') {
        note = ' (no active conversation id, stored as global)'
      }

      const current = getCurrentMemoryDoc(identity)
      const line = `[${category}] ${content}`
      const nextContent = appendMemoryDocContent(current, line)
      const next = replaceMemoryDoc({
        ...identity,
        title: current?.title || DEFAULT_MEMORY_DOC_TITLE,
        content: nextContent,
        baseVersionId: current?.id,
        reason: `remember:${category}`
      })

      return {
        resultForModel: `Stored ${identity.kind} ${identity.scope} memory document${note}: ${formatMemoryDocHeader(next)}\nNew version id: ${next.id}\nThe previous version was archived automatically.\nAdded: "${content.slice(0, 120)}${
          content.length > 120 ? '…' : ''
        }"`,
        resultForUi: {
          title: 'Remember',
          summary: `Saved ${identity.kind}/${identity.scope} memory v${next.version}`
        }
      }
    }
  },
  read_memory_doc: {
    name: 'read_memory_doc',
    title: 'Read Memory Document',
    description:
      'Read the complete current memory or soul document before modifying or writing related memory. The returned version id must be passed as baseVersionId to replace_memory_doc. Use this first so old memory lines are preserved when adding or changing facts. Use kind="soul" for assistant profile/persona and kind="memory" for facts/preferences.',
    tags: ['memory', 'soul', 'read', 'profile', 'persona', '璁板繂', '鐏甸瓊'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['constant', 'ondemand', 'memory', 'soul'],
          description: 'Document kind. Default: ondemand.'
        },
        scope: {
          type: 'string',
          enum: ['global', 'session'],
          description: 'Document scope. Default: session.'
        },
        key: {
          type: 'string',
          description: 'Document key. Default: "default".'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const run = getRun(ctx.reqId)
      const identity = getMemoryDocIdentity(args, run?.sessionId)
      const doc = getCurrentMemoryDoc(identity)

      if (!doc) {
        return {
          resultForModel: `No current ${identity.kind} document found for ${identity.scope}/${identity.key}. You may create the first version with replace_memory_doc without baseVersionId.`,
          resultForUi: {
            title: 'Read Memory Document',
            summary: 'No current document'
          }
        }
      }

      return {
        resultForModel: [
          formatMemoryDocHeader(doc),
          `Version id: ${doc.id}`,
          `Status: ${doc.status}`,
          `Reason: ${doc.reason || 'none'}`,
          '',
          doc.content
        ].join('\n'),
        resultForUi: {
          title: 'Read Memory Document',
          summary: `${doc.kind}/${doc.scope}/${doc.key} v${doc.version}`
        }
      }
    }
  },
  replace_memory_doc: {
    name: 'replace_memory_doc',
    title: 'Replace Memory Document',
    description:
      'Replace a memory or soul document by writing the complete new document content. If a current version exists, baseVersionId is required and must match the id returned by read_memory_doc. This archives the old version and creates a new current version. Always include all existing memory that should remain plus the new/changed facts; never send only the new lines unless you are intentionally deleting the old content.',
    tags: ['memory', 'soul', 'replace', 'update', 'profile', 'persona', '璁板繂', '鐏甸瓊'],
    category: 'memory',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['constant', 'ondemand', 'memory', 'soul'],
          description: 'Document kind. Default: ondemand.'
        },
        scope: {
          type: 'string',
          enum: ['global', 'session'],
          description: 'Document scope. Default: session.'
        },
        key: {
          type: 'string',
          description: 'Document key. Default: "default".'
        },
        title: {
          type: 'string',
          description: 'Short document title.'
        },
        content: {
          type: 'string',
          description:
            'The complete updated document content. Do not pass only a patch or a single changed line.'
        },
        baseVersionId: {
          type: 'string',
          description:
            'The current version id returned by read_memory_doc. Required when replacing an existing document.'
        },
        reason: {
          type: 'string',
          description: 'Short reason for the change.'
        }
      },
      required: ['content']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!content) {
        throw new Error('Missing or invalid content parameter')
      }
      const MAX_DOC_CHARS = 30000
      if (content.length > MAX_DOC_CHARS) {
        throw new Error(
          `Memory document is too long (${content.length} chars). Keep it under ${MAX_DOC_CHARS} characters.`
        )
      }

      const run = getRun(ctx.reqId)
      const identity = getMemoryDocIdentity(args, run?.sessionId)
      const doc = replaceMemoryDoc({
        ...identity,
        title: typeof args.title === 'string' ? args.title : undefined,
        content,
        baseVersionId: typeof args.baseVersionId === 'string' ? args.baseVersionId : undefined,
        reason: typeof args.reason === 'string' ? args.reason : undefined
      })

      return {
        resultForModel: `Replaced ${identity.kind} ${identity.scope} document: ${formatMemoryDocHeader(doc)}\nNew version id: ${doc.id}\nPrevious version: ${doc.parentId || 'none'}.`,
        resultForUi: {
          title: 'Replace Memory Document',
          summary: `${doc.kind}/${doc.scope}/${doc.key} v${doc.version}`
        }
      }
    }
  },
  archive_memory_doc: {
    name: 'archive_memory_doc',
    title: 'Archive Memory Document',
    description:
      'Archive (delete) an active memory document so that it is no longer current and will not be loaded or retrieved. Use this when a custom memory category/key, environment configuration, or lesson learned is no longer relevant or has been fully obsoleted.',
    tags: ['memory', 'archive', 'delete', 'remove', '记忆', '删除', '归档'],
    category: 'memory',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['constant', 'ondemand', 'memory', 'soul'],
          description: 'Document kind. Default: ondemand.'
        },
        scope: {
          type: 'string',
          enum: ['global', 'session'],
          description: 'Document scope. Default: session.'
        },
        key: {
          type: 'string',
          description: 'Document key. Default: "default".'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const run = getRun(ctx.reqId)
      const identity = getMemoryDocIdentity(args, run?.sessionId)
      const success = archiveMemoryDoc(identity)
      if (!success) {
        return {
          resultForModel: `No active ${identity.kind} document found for ${identity.scope}/${identity.key} to archive.`,
          resultForUi: {
            title: 'Archive Memory Document',
            summary: 'No active document found'
          }
        }
      }
      return {
        resultForModel: `Successfully archived the current ${identity.kind} document for ${identity.scope}/${identity.key}. It will no longer be retrieved by default.`,
        resultForUi: {
          title: 'Archive Memory Document',
          summary: `Archived ${identity.kind}/${identity.scope}/${identity.key}`
        }
      }
    }
  },
  recall: {
    name: 'recall',
    title: 'Recall Memories',
    description:
      "Retrieve current durable memory/soul documents. By default returns global documents plus this conversation's session documents. Archived versions are not returned; use read_memory_doc for the complete current document before modifying it.",
    tags: [
      'memory',
      'recall',
      'retrieve',
      'remember',
      'preference',
      'fact',
      '记忆',
      '回忆',
      '偏好'
    ],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional text filter (substring match on memory content). Omit to list all.'
        },
        scope: {
          type: 'string',
          description:
            'Restrict to a layer: global or session. Omit to search both global and this conversation.',
          enum: ['global', 'session']
        },
        kind: {
          type: 'string',
          enum: ['constant', 'ondemand', 'memory', 'soul'],
          description: 'Restrict to constant, ondemand, memory or soul documents.'
        },
        key: {
          type: 'string',
          description: 'Restrict to a document key.'
        },
        category: {
          type: 'string',
          description: 'Legacy option kept for compatibility; current document recall ignores it.'
        },
        limit: {
          type: 'number',
          description: 'Maximum memories to return (1-30, default 10).'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const run = getRun(ctx.reqId)
      const sessionId = run?.sessionId

      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.min(30, Math.max(1, Math.floor(args.limit)))
          : 10
      const docs = listMemoryDocs({
        kind: (args.kind === 'constant' || args.kind === 'ondemand' || args.kind === 'memory' || args.kind === 'soul')
          ? args.kind
          : undefined,
        scope: args.scope === 'global' || args.scope === 'session' ? args.scope : undefined,
        sessionId,
        key: typeof args.key === 'string' ? args.key : undefined,
        includeSession: true,
        limit
      })
      const queryText = typeof args.query === 'string' ? args.query.trim() : ''
      const loweredQuery = queryText.toLowerCase()
      const results = loweredQuery
        ? docs.filter(
            (doc) =>
              doc.content.toLowerCase().includes(loweredQuery) ||
              doc.title.toLowerCase().includes(loweredQuery) ||
              doc.key.toLowerCase().includes(loweredQuery)
          )
        : docs

      if (results.length === 0) {
        const legacy = queryText
          ? listMemories({ sessionId, limit }).filter((memory) =>
              memory.content.toLowerCase().includes(loweredQuery)
            )
          : listMemories({ sessionId, limit })
        if (legacy.length > 0) {
          const legacyLines = [
            `No current memory documents found. Found ${legacy.length} legacy memory item(s):`,
            ''
          ]
          legacy.forEach((m, i) => {
            const date = new Date(m.createdAt).toLocaleDateString('en-CA')
            legacyLines.push(`${i + 1}. [legacy/${m.scope}/${m.category}/${date}] ${m.content}`)
          })
          return {
            resultForModel: legacyLines.join('\n'),
            resultForUi: {
              title: 'Recall',
              summary: `Recalled ${legacy.length} legacy memory item(s)`
            }
          }
        }
        return {
          resultForModel: queryText
            ? `No memories found matching "${queryText}".`
            : 'No memories stored yet.',
          resultForUi: {
            title: 'Recall',
            summary: 'No memories found'
          }
        }
      }

      const lines = [`Found ${results.length} current memory document(s):`, '']
      results.forEach((doc, i) => {
        const m = {
          scope: doc.scope,
          category: `${doc.kind}/${doc.key}/v${doc.version}`,
          content: `${formatMemoryDocHeader(doc)}\n${doc.content}`
        }
        const date = ''
        lines.push(`${i + 1}. [${m.scope} · ${m.category} · ${date}] ${m.content}`)
      })

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'Recall',
          summary: `Recalled ${results.length} memory document(s)`
        }
      }
    }
  }
}
