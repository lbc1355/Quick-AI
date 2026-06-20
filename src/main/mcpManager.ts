import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { shell } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getQuickAiRoot } from './paths'
import { registerTool, unregisterTool } from './toolRegistry'
import { ToolDefinition } from './tools/types'
import { createRawToolResult, createToolResult } from './tools/result'
import { logger } from './logger'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  enabled?: boolean // support both for flexibility
}

export interface McpConfig {
  timeouts?: {
    connect_timeout?: number
    execute_timeout?: number
    read_timeout?: number
  }
  servers?: Record<string, McpServerConfig>
  mcpServers?: Record<string, McpServerConfig>
}

import { McpServerStatus } from '../shared/types'

class McpManagerImpl {
  private configPath: string = ''
  private clients = new Map<string, Client>()
  private transports = new Map<string, StdioClientTransport>()
  private statuses = new Map<string, McpServerStatus>()
  private registeredToolNames = new Set<string>()

  init() {
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
          if (val && typeof val === 'object' && ('command' in (val as any))) {
            inputServers[key] = val as McpServerConfig
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

    // Merge both "servers" and "mcpServers"
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
        await this.connectServer(name, srvConfig)
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

  private async connectServer(name: string, srvConfig: McpServerConfig): Promise<void> {
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

    await client.connect(transport)

    // Discover tools
    const response = await client.listTools()
    const tools = response.tools || []

    const serverStatus: McpServerStatus = {
      name,
      status: 'connected',
      tools: tools.map((t) => ({ name: t.name, description: t.description }))
    }
    this.statuses.set(name, serverStatus)

    // Register each tool in our local registry
    for (const tool of tools) {
      const modelName = `mcp_${name}_${tool.name}`

      // Create a ToolDefinition compatible with QuickAI registry
      const toolDef: ToolDefinition = {
        name: modelName,
        title: tool.name,
        description: tool.description || `MCP tool "${tool.name}" from server "${name}"`,
        tags: ['mcp', name],
        category: 'system',
        risk: 'medium', // Default to medium risk so it goes through standard approval prompts
        source: 'mcp',
        implemented: true,
        discoverable: true,
        parameters: (tool.inputSchema as any) || {
          type: 'object',
          properties: {}
        },
        execute: async (args, _ctx) => {
          logger.info('MCP', `Executing tool "${tool.name}" on server "${name}"`)
          try {
            const result = (await client.callTool({
              name: tool.name,
              arguments: args
            })) as any

            return createRawToolResult({
              rawOutput: result.content ?? result,
              title: `MCP Tool Call: ${name} / ${tool.name}`,
              summary: `Successfully executed tool "${tool.name}" on server "${name}"`
            })
          } catch (err) {
            const errorMsg = (err as Error).message || String(err)
            logger.error('MCP', `Error executing tool "${tool.name}" on server "${name}": ${errorMsg}`)
            return createToolResult({
              resultForModel: `Error executing MCP tool: ${errorMsg}`,
              title: `MCP Tool Call Failed: ${name} / ${tool.name}`,
              summary: `Failed to execute: ${errorMsg}`
            })
          }
        }
      }

      registerTool(toolDef)
      this.registeredToolNames.add(modelName)
    }

    logger.info('MCP', `Connected to server "${name}" successfully. Registered ${tools.length} tools.`)
  }

  async shutdown(): Promise<void> {
    logger.info('MCP', 'Shutting down all MCP server connections...')

    // 1. Unregister all registered tool names from the global registry
    for (const toolName of this.registeredToolNames) {
      unregisterTool(toolName)
    }
    this.registeredToolNames.clear()

    // 2. Disconnect clients and close transports
    for (const [name, client] of this.clients.entries()) {
      try {
        await client.close()
      } catch (err) {
        logger.warn('MCP', `Error closing client for "${name}": ${(err as Error).message}`)
      }
    }
    this.clients.clear()
    this.transports.clear()
    this.statuses.clear()
  }

  getStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values())
  }

  openConfigFolder() {
    try {
      shell.showItemInFolder(this.configPath)
    } catch (err) {
      logger.error('MCP', `Failed to open config folder: ${(err as Error).message}`)
    }
  }
}

export const McpManager = new McpManagerImpl()
