import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { shell } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  CallToolResultSchema,
  LoggingMessageNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import { getQuickAiRoot } from './paths'
import { registerToolDefinition, unregisterToolDefinition } from './toolRegistry'
import { ToolDefinition } from './tools/types'
import { createMcpToolResult } from './tools/mcpResult'
import { logger } from './logger'
import { getMcpErrorMessage, listAllMcpTools, McpToolInfo, toMcpModelToolName } from './mcpCatalog'
import { safeJsonStringify } from './tools/jsonSafe'

export interface McpServerTimeouts {
  connect_timeout?: number
  execute_timeout?: number
  read_timeout?: number
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  enabled?: boolean // support both for flexibility
  /** Per-server override of the global `timeouts` block. */
  timeouts?: McpServerTimeouts
}

export interface McpConfig {
  timeouts?: McpServerTimeouts
  servers?: Record<string, McpServerConfig>
  mcpServers?: Record<string, McpServerConfig>
}

/** Merge the global timeouts block with a server's own overrides (server wins). */
const resolveServerTimeouts = (
  globalTimeouts: McpConfig['timeouts'],
  srvConfig: McpServerConfig
): NonNullable<McpConfig['timeouts']> => ({
  ...(globalTimeouts || {}),
  ...(srvConfig.timeouts || {})
})

import { McpServerStatus } from '../shared/types'

const defaultMcpParameters = (): ToolDefinition['parameters'] => ({
  type: 'object',
  properties: {}
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isMcpServerConfig = (value: unknown): value is McpServerConfig =>
  isRecord(value) && typeof value.command === 'string'

const toToolParameterProperties = (value: unknown): ToolDefinition['parameters']['properties'] => {
  if (!isRecord(value)) return {}

  const properties: ToolDefinition['parameters']['properties'] = {}
  for (const [key, property] of Object.entries(value)) {
    if (!isRecord(property) || typeof property.type !== 'string') continue
    properties[key] = {
      type: property.type,
      description: typeof property.description === 'string' ? property.description : undefined,
      enum: Array.isArray(property.enum)
        ? property.enum.filter((item): item is string => typeof item === 'string')
        : undefined,
      items: isRecord(property.items) ? property.items : undefined
    }
  }
  return properties
}

const toToolParameters = (value: unknown): ToolDefinition['parameters'] => {
  if (!isRecord(value) || value.type !== 'object') return defaultMcpParameters()
  return {
    type: 'object',
    properties: toToolParameterProperties(value.properties),
    required: Array.isArray(value.required)
      ? value.required.filter((item): item is string => typeof item === 'string')
      : undefined
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMsg))
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer)
  })
}

/**
 * Kill a stdio server's process tree so no orphaned children survive a reload/shutdown.
 * Windows: `taskkill /T /F` kills the whole tree in one call.
 * POSIX: recursively collect descendants via `pgrep -P`, then SIGTERM them (same strategy as opencode).
 */
function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
      return
    }

    const collectDescendants = (rootPid: number): Promise<number[]> =>
      new Promise((collectResolve) => {
        execFile('pgrep', ['-P', String(rootPid)], { windowsHide: true }, (err, stdout) => {
          if (err) return collectResolve([])
          const children = stdout
            .split('\n')
            .map((line) => parseInt(line.trim(), 10))
            .filter((value) => Number.isFinite(value))
          Promise.all(children.map(collectDescendants)).then((nested) =>
            collectResolve([...children, ...nested.flat()])
          )
        })
      })

    collectDescendants(pid).then((descendants) => {
      for (const descendant of descendants) {
        try {
          process.kill(descendant, 'SIGTERM')
        } catch {
          // Already dead — ignore.
        }
      }
      resolve()
    })
  })
}

const getTransportPid = (client: Client): number | undefined => {
  if (!(client.transport instanceof StdioClientTransport)) return undefined
  const pid = client.transport.pid
  return pid === null || pid === undefined ? undefined : pid
}

class McpManagerImpl {
  private configPath: string = ''
  private clients = new Map<string, Client>()
  private transports = new Map<string, StdioClientTransport>()
  private statuses = new Map<string, McpServerStatus>()
  private registeredToolNames = new Set<string>()
  private registeredToolNamesByServer = new Map<string, Set<string>>()
  private toolRefreshes = new Map<string, Promise<void>>()
  private instructionsByServer = new Map<string, string>()

  private async cleanupServer(name: string): Promise<void> {
    const serverTools = this.registeredToolNamesByServer.get(name)
    if (serverTools) {
      for (const toolName of serverTools) {
        unregisterToolDefinition(toolName)
        this.registeredToolNames.delete(toolName)
      }
      this.registeredToolNamesByServer.delete(name)
    }

    const client = this.clients.get(name)
    const transport = this.transports.get(name)
    this.clients.delete(name)
    this.transports.delete(name)
    this.toolRefreshes.delete(name)
    this.instructionsByServer.delete(name)

    if (client) {
      const pid = getTransportPid(client)
      if (pid !== undefined) {
        // Kill the server's whole process tree first so no orphaned children linger.
        await killProcessTree(pid)
      }
      try {
        await client.close()
      } catch (err) {
        logger.warn('MCP', `Error closing client for "${name}": ${(err as Error).message}`)
      }
    }

    if (transport) {
      try {
        await transport.close()
      } catch (err) {
        logger.warn('MCP', `Error closing transport for "${name}": ${(err as Error).message}`)
      }
    }
  }

  init(): void {
    this.configPath = join(getQuickAiRoot(), 'mcp.json')
    logger.info('MCP', `Initializing MCP Manager with config: ${this.configPath}`)

    // Create a starter mcp.json if it doesn't exist
    if (!existsSync(this.configPath)) {
      try {
        const starterConfig: McpConfig = {
          servers: {}
        }
        writeFileSync(this.configPath, JSON.stringify(starterConfig, null, 2), 'utf-8')
      } catch (err) {
        logger.error('MCP', `Failed to create starter mcp.json: ${(err as Error).message}`)
      }
    }

    // Load and connect to servers
    this.reload().catch((err) => {
      logger.error('MCP', `Error during initial load: ${(err as Error).message}`)
    })
  }

  getConfigPath(): string {
    return this.configPath
  }

  readConfigRaw(): string {
    try {
      if (existsSync(this.configPath)) {
        return readFileSync(this.configPath, 'utf-8')
      }
    } catch (err) {
      logger.error('MCP', `Failed to read mcp.json: ${(err as Error).message}`)
    }
    return JSON.stringify({ servers: {} }, null, 2)
  }

  writeConfigRaw(content: string): string {
    try {
      const input = JSON.parse(content)
      if (typeof input !== 'object' || input === null) {
        throw new Error('Config must be a valid JSON object')
      }

      // Load existing config
      let existingConfig: McpConfig = { servers: {} }
      if (existsSync(this.configPath)) {
        try {
          existingConfig = JSON.parse(readFileSync(this.configPath, 'utf-8'))
        } catch (err) {
          logger.warn('MCP', `Existing mcp.json is invalid, overwriting: ${(err as Error).message}`)
        }
      }

      // Ensure servers key exists in existing config
      if (!existingConfig.servers && !existingConfig.mcpServers) {
        existingConfig.servers = {}
      }
      const targetKey = existingConfig.servers ? 'servers' : 'mcpServers'
      if (!existingConfig[targetKey]) {
        existingConfig[targetKey] = {}
      }

      // Determine the input shape
      let inputServers: Record<string, McpServerConfig> = {}

      if (input.servers || input.mcpServers) {
        // Form 1: Root contains "servers" or "mcpServers" key
        inputServers = {
          ...(input.mcpServers || {}),
          ...(input.servers || {})
        }
      } else {
        // Form 2: Direct map of server-name to server config, e.g. { "arxiv-agent": { "command": "..." } }
        // Filter to make sure each value is an object that contains a "command" property
        for (const [key, val] of Object.entries(input)) {
          if (isMcpServerConfig(val)) {
            inputServers[key] = val
          }
        }
      }

      // If we found servers, merge them.
      if (Object.keys(inputServers).length > 0) {
        existingConfig[targetKey] = {
          ...existingConfig[targetKey],
          ...inputServers
        }
      } else {
        // If they pasted a complete new empty config or something else, let's treat it as the new config
        if (input.servers !== undefined || input.mcpServers !== undefined) {
          existingConfig = input
        } else if (Object.keys(input).length === 0) {
          existingConfig[targetKey] = {}
        }
      }

      const mergedContent = JSON.stringify(existingConfig, null, 2)
      writeFileSync(this.configPath, mergedContent, 'utf-8')
      return mergedContent
    } catch (err) {
      logger.error('MCP', `Failed to write mcp.json: ${(err as Error).message}`)
      throw err
    }
  }

  deleteServer(name: string): { deleted: boolean; config: string } {
    if (!name.trim()) {
      throw new Error('MCP server name cannot be empty')
    }

    try {
      let config: McpConfig = { servers: {} }
      if (existsSync(this.configPath)) {
        config = JSON.parse(readFileSync(this.configPath, 'utf-8')) as McpConfig
      }

      let deleted = false
      if (config.servers && Object.prototype.hasOwnProperty.call(config.servers, name)) {
        delete config.servers[name]
        deleted = true
      }
      if (config.mcpServers && Object.prototype.hasOwnProperty.call(config.mcpServers, name)) {
        delete config.mcpServers[name]
        deleted = true
      }

      if (!config.servers && !config.mcpServers) {
        config.servers = {}
      }

      const content = JSON.stringify(config, null, 2)
      writeFileSync(this.configPath, content, 'utf-8')
      return { deleted, config: content }
    } catch (err) {
      logger.error('MCP', `Failed to delete MCP server "${name}": ${(err as Error).message}`)
      throw err
    }
  }

  async reload(): Promise<void> {
    logger.info('MCP', 'Reloading MCP servers...')
    await this.shutdown()

    let config: McpConfig
    try {
      const content = this.readConfigRaw()
      config = JSON.parse(content)
    } catch (err) {
      logger.error('MCP', `Failed to parse config for reload: ${(err as Error).message}`)
      return
    }

    const serversMap: Record<string, McpServerConfig> = {
      ...(config.mcpServers || {}),
      ...(config.servers || {})
    }

    const startPromises = Object.entries(serversMap).map(async ([name, srvConfig]) => {
      const isDisabled = srvConfig.disabled === true || srvConfig.enabled === false

      if (isDisabled) {
        this.statuses.set(name, {
          name,
          status: 'disabled',
          tools: []
        })
        logger.info('MCP', `Server "${name}" is disabled, skipping.`)
        return
      }

      this.statuses.set(name, {
        name,
        status: 'connecting',
        tools: []
      })

      try {
        await this.connectServer(name, srvConfig, resolveServerTimeouts(config.timeouts, srvConfig))
      } catch (err) {
        const errorMsg = (err as Error).message || String(err)
        this.statuses.set(name, {
          name,
          status: 'failed',
          error: errorMsg,
          tools: []
        })
        logger.error('MCP', `Failed to start server "${name}": ${errorMsg}`)
      }
    })

    await Promise.all(startPromises)
    logger.info('MCP', 'MCP servers reload completed.')
  }

  async reloadServer(name: string): Promise<McpServerStatus> {
    if (!name.trim()) {
      throw new Error('MCP server name cannot be empty')
    }

    logger.info('MCP', `Reloading MCP server "${name}"...`)

    let config: McpConfig
    try {
      const content = this.readConfigRaw()
      config = JSON.parse(content)
    } catch (err) {
      throw new Error(`Failed to parse mcp.json: ${(err as Error).message}`)
    }

    const serversMap: Record<string, McpServerConfig> = {
      ...(config.mcpServers || {}),
      ...(config.servers || {})
    }
    const srvConfig = serversMap[name]
    if (!srvConfig) {
      throw new Error(`MCP server "${name}" was not found in mcp.json`)
    }

    await this.cleanupServer(name)

    const isDisabled = srvConfig.disabled === true || srvConfig.enabled === false
    if (isDisabled) {
      const status: McpServerStatus = {
        name,
        status: 'disabled',
        tools: []
      }
      this.statuses.set(name, status)
      logger.info('MCP', `Server "${name}" is disabled, skipping reconnect.`)
      return status
    }

    this.statuses.set(name, {
      name,
      status: 'connecting',
      tools: []
    })

    try {
      await this.connectServer(name, srvConfig, resolveServerTimeouts(config.timeouts, srvConfig))
    } catch (err) {
      const errorMsg = (err as Error).message || String(err)
      const status: McpServerStatus = {
        name,
        status: 'failed',
        error: errorMsg,
        tools: []
      }
      this.statuses.set(name, status)
      logger.error('MCP', `Failed to reload server "${name}": ${errorMsg}`)
      return status
    }

    const status = this.statuses.get(name)
    if (!status) {
      throw new Error(`MCP server "${name}" status missing after reload`)
    }
    return status
  }

  private createToolDefinition(
    serverName: string,
    tool: McpToolInfo,
    client: Client,
    timeouts: NonNullable<McpConfig['timeouts']>
  ): ToolDefinition {
    const modelName = toMcpModelToolName(serverName, tool.name)
    return {
      name: modelName,
      title: tool.name,
      description: tool.description || 'MCP tool ' + tool.name + ' from server ' + serverName,
      tags: ['mcp', serverName],
      category: 'system',
      risk: 'medium',
      source: 'mcp',
      implemented: true,
      discoverable: true,
      parameters: toToolParameters(tool.inputSchema),
      execute: async (args, ctx) => {
        if (this.clients.get(serverName) !== client) {
          throw new Error('Stale MCP client for server ' + serverName)
        }

        logger.info('MCP', 'Executing tool ' + tool.name + ' on server ' + serverName)
        const executeTimeout = timeouts.execute_timeout || timeouts.read_timeout || 30000
        try {
          const result = await client.callTool(
            {
              name: tool.name,
              arguments: args
            },
            CallToolResultSchema,
            {
              signal: ctx.signal,
              timeout: executeTimeout,
              resetTimeoutOnProgress: true,
              onprogress: () => undefined
            }
          )
          const mcpError = getMcpErrorMessage(result)
          if (mcpError) throw new Error(mcpError)
          return createMcpToolResult({
            serverName,
            toolName: tool.name,
            result
          })
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (ctx.signal.aborted || error.name === 'AbortError') throw error
          logger.error(
            'MCP',
            'Error executing tool ' + tool.name + ' on server ' + serverName + ': ' + error.message
          )
          // A tool timeout is a single failed call, not evidence the whole server is dead.
          // Tearing the connection down here would kill every other tool on the server and
          // churn the tool registry (breaking the prompt-cache prefix) for one slow call.
          // A genuinely wedged server can be reloaded manually; give slow-but-alive servers
          // a longer per-server execute_timeout instead.
          throw error
        }
      }
    }
  }

  private replaceServerTools(
    serverName: string,
    client: Client,
    tools: McpToolInfo[],
    timeouts: NonNullable<McpConfig['timeouts']>
  ): void {
    // Sort by tool name so an identical tool set always produces the same registry order and
    // therefore the same system-prompt bytes (stable prompt-cache prefix across refreshes).
    const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name))
    const definitions = sortedTools.map((tool) =>
      this.createToolDefinition(serverName, tool, client, timeouts)
    )
    const nextNames = new Set<string>()
    for (const definition of definitions) {
      if (nextNames.has(definition.name)) {
        throw new Error('MCP tool name collision after sanitization: ' + definition.name)
      }
      nextNames.add(definition.name)
    }

    const previousNames = this.registeredToolNamesByServer.get(serverName) || new Set<string>()
    for (const definition of definitions) {
      registerToolDefinition(definition)
      this.registeredToolNames.add(definition.name)
    }
    for (const previousName of previousNames) {
      if (nextNames.has(previousName)) continue
      unregisterToolDefinition(previousName)
      this.registeredToolNames.delete(previousName)
    }

    this.registeredToolNamesByServer.set(serverName, nextNames)
    this.statuses.set(serverName, {
      name: serverName,
      status: 'connected',
      tools: sortedTools.map((tool) => ({ name: tool.name, description: tool.description }))
    })
  }

  private queueServerToolRefresh(
    serverName: string,
    client: Client,
    timeouts: NonNullable<McpConfig['timeouts']>
  ): Promise<void> {
    const previous = this.toolRefreshes.get(serverName) || Promise.resolve()
    const refresh = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.clients.get(serverName) !== client) return
        const timeout = timeouts.connect_timeout || timeouts.read_timeout || 10000
        const tools = await listAllMcpTools(client, timeout)
        if (this.clients.get(serverName) !== client) return
        this.replaceServerTools(serverName, client, tools, timeouts)
        logger.info('MCP', 'Refreshed ' + tools.length + ' tools from server ' + serverName)
      })
    this.toolRefreshes.set(serverName, refresh)
    return refresh.finally(() => {
      if (this.toolRefreshes.get(serverName) === refresh) {
        this.toolRefreshes.delete(serverName)
      }
    })
  }

  private async connectServer(
    name: string,
    srvConfig: McpServerConfig,
    timeouts: NonNullable<McpConfig['timeouts']>
  ): Promise<void> {
    logger.info('MCP', `Connecting to server "${name}" via stdio...`)

    const transportEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        transportEnv[key] = value
      }
    }
    if (srvConfig.env) {
      for (const [key, value] of Object.entries(srvConfig.env)) {
        if (value !== undefined) {
          transportEnv[key] = value
        }
      }
    }

    const transport = new StdioClientTransport({
      command: srvConfig.command,
      args: srvConfig.args || [],
      env: transportEnv
    })

    const client = new Client(
      {
        name: 'quickai-client',
        version: '1.0.0'
      },
      {
        capabilities: {}
      }
    )

    this.transports.set(name, transport)
    this.clients.set(name, client)

    const connectTimeout = timeouts.connect_timeout || 10000
    let tools: McpToolInfo[] = []

    try {
      tools = await withTimeout(
        (async () => {
          await client.connect(transport)
          return await listAllMcpTools(client, connectTimeout)
        })(),
        connectTimeout,
        `Connection to server "${name}" timed out after ${connectTimeout}ms`
      )
    } catch (err) {
      await this.cleanupServer(name)
      throw err
    }

    try {
      this.replaceServerTools(name, client, tools, timeouts)

      // Capture the server's usage instructions (2025-06-18 MCP spec) for system-prompt injection.
      const getInstructions = (
        client as unknown as { getInstructions?: () => string | undefined }
      ).getInstructions
      const instructions =
        typeof getInstructions === 'function' ? getInstructions.call(client) : undefined
      if (instructions && instructions.trim()) {
        this.instructionsByServer.set(name, instructions.trim())
      } else {
        this.instructionsByServer.delete(name)
      }

      // Detect an unexpected connection loss (server crash, killed process, EOF) instead of
      // silently keeping a stale "connected" status. The renderer picks the new state up via
      // its status poll; a manual reload can then restart the server.
      client.onclose = () => {
        if (this.clients.get(name) !== client) return
        logger.warn('MCP', `Connection to server "${name}" closed unexpectedly`)
        this.instructionsByServer.delete(name)
        this.statuses.set(name, {
          name,
          status: 'failed',
          error: 'Connection closed unexpectedly',
          tools: []
        })
        this.cleanupServer(name).catch((err) => {
          logger.warn(
            'MCP',
            `Error cleaning up server "${name}" after close: ${(err as Error).message}`
          )
        })
      }

      // Surface MCP server logs (LoggingMessageNotification) through the app logger.
      client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
        const params = notification.params as { level: string; logger?: string; data: unknown }
        const data = typeof params.data === 'string' ? params.data : safeJsonStringify(params.data)
        const message = `[${params.logger || name}] ${data}`
        switch (params.level) {
          case 'debug':
            logger.debug('MCP', message)
            break
          case 'info':
          case 'notice':
            logger.info('MCP', message)
            break
          case 'warning':
            logger.warn('MCP', message)
            break
          case 'error':
          case 'critical':
          case 'alert':
          case 'emergency':
            logger.error('MCP', message)
            break
          default:
            logger.info('MCP', message)
        }
      })

      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        try {
          await this.queueServerToolRefresh(name, client, timeouts)
        } catch (err) {
          logger.error(
            'MCP',
            'Failed to refresh tools for server ' + name + ': ' + (err as Error).message
          )
        }
      })
    } catch (err) {
      await this.cleanupServer(name)
      throw err
    }

    logger.info(
      'MCP',
      `Connected to server "${name}" successfully. Registered ${tools.length} tools.`
    )
  }

  async shutdown(): Promise<void> {
    logger.info('MCP', 'Shutting down all MCP server connections...')

    // 1. Unregister all registered tool names from the global registry
    for (const toolName of this.registeredToolNames) {
      unregisterToolDefinition(toolName)
    }
    this.registeredToolNames.clear()
    this.registeredToolNamesByServer.clear()

    // 2. Invalidate refreshes before closing clients so no late refresh can re-register tools.
    const clients = Array.from(this.clients.entries())
    this.clients.clear()
    this.transports.clear()
    this.toolRefreshes.clear()
    for (const [name, client] of clients) {
      const pid = getTransportPid(client)
      if (pid !== undefined) {
        // Kill the server's whole process tree first so no orphaned children linger.
        await killProcessTree(pid)
      }
      try {
        await client.close()
      } catch (err) {
        logger.warn('MCP', `Error closing client for "${name}": ${(err as Error).message}`)
      }
    }
    this.statuses.clear()
    this.instructionsByServer.clear()
  }

  getStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values())
  }

  /**
   * Usage instructions published by connected MCP servers (2025-06-18 MCP spec).
   * Consumed by the system-prompt builder so the model knows how to use each server's tools.
   */
  getServerInstructions(): { name: string; instructions: string }[] {
    const result: { name: string; instructions: string }[] = []
    for (const [name, instructions] of this.instructionsByServer) {
      if (this.statuses.get(name)?.status !== 'connected') continue
      result.push({ name, instructions })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  openConfigFolder(): void {
    try {
      shell.showItemInFolder(this.configPath)
    } catch (err) {
      logger.error('MCP', `Failed to open config folder: ${(err as Error).message}`)
    }
  }
}

export const McpManager = new McpManagerImpl()
