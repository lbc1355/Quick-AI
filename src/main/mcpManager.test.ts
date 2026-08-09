/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { McpManager } from './mcpManager'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { getQuickAiRoot } from './paths'
import { getToolRegistry } from './toolRegistry'
import { toMcpModelToolName } from './mcpCatalog'

const pathMock = vi.hoisted(() => ({
  root: `${process.cwd()}/.test-quickai`
}))

const mcpMockState = vi.hoisted(
  (): {
    callToolResult: Record<string, unknown>
    listToolsResults: Array<Record<string, unknown>>
    toolListChangedHandler?: () => Promise<void> | void
    lastCallToolOptions?: Record<string, unknown>
    instructions?: string
  } => ({
    callToolResult: {
      content: [{ type: 'text', text: 'mocked tool response' }]
    },
    listToolsResults: [],
    instructions: undefined
  })
)

vi.mock('./paths', () => ({
  getQuickAiRoot: () => pathMock.root,
  getLogsRoot: () => `${pathMock.root}/logs`,
  getMemoriesRoot: () => `${pathMock.root}/memories`,
  getWorkspaceRoot: () => `${pathMock.root}/workspace`,
  getSkillRoot: () => `${pathMock.root}/skill`
}))

// Mock MCP SDK classes
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class {
      async connect(): Promise<void> {
        return Promise.resolve(undefined)
      }
      async listTools(): Promise<any> {
        const nextResult = mcpMockState.listToolsResults.shift()
        if (nextResult) return Promise.resolve(nextResult)
        return Promise.resolve({
          tools: [
            {
              name: 'test_tool',
              description: 'A mock test tool',
              inputSchema: {
                type: 'object',
                properties: {
                  inputVal: { type: 'string' }
                }
              }
            }
          ]
        })
      }
      setNotificationHandler(_schema: unknown, handler: () => Promise<void> | void): void {
        mcpMockState.toolListChangedHandler = handler
      }
      getInstructions(): any {
        return mcpMockState.instructions
      }
      async callTool(
        _params?: unknown,
        _schema?: unknown,
        options?: Record<string, unknown>
      ): Promise<any> {
        mcpMockState.lastCallToolOptions = options
        return Promise.resolve(mcpMockState.callToolResult)
      }
      async close(): Promise<void> {
        return Promise.resolve(undefined)
      }
    }
  }
})

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: class {}
  }
})

describe('McpManager', () => {
  const configPath = join(getQuickAiRoot(), 'mcp.json')

  beforeEach(() => {
    mcpMockState.callToolResult = {
      content: [{ type: 'text', text: 'mocked tool response' }]
    }
    mcpMockState.listToolsResults = []
    mcpMockState.toolListChangedHandler = undefined
    mcpMockState.lastCallToolOptions = undefined
    mcpMockState.instructions = undefined
    mkdirSync(getQuickAiRoot(), { recursive: true })
    // Delete config file if it exists to ensure a clean state
    if (existsSync(configPath)) {
      unlinkSync(configPath)
    }
  })

  afterEach(async () => {
    await McpManager.shutdown()
    if (existsSync(configPath)) {
      unlinkSync(configPath)
    }
  })

  afterAll(() => {
    rmSync(getQuickAiRoot(), { recursive: true, force: true })
  })

  it('initializes and creates a default config file if missing', () => {
    expect(existsSync(configPath)).toBe(false)
    McpManager.init()
    expect(existsSync(configPath)).toBe(true)

    const content = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(content).toHaveProperty('servers')
    expect(content.servers).toEqual({})
  })

  it('loads config, connects to enabled servers and registers tools', async () => {
    // Write mock config
    const mockConfig = {
      servers: {
        git: {
          command: 'node',
          args: ['git-server.js'],
          env: { TEST_VAR: 'hello' }
        },
        disabledSrv: {
          command: 'node',
          args: ['disabled.js'],
          disabled: true
        }
      }
    }

    writeFileSync(configPath, JSON.stringify(mockConfig, null, 2), 'utf-8')

    McpManager.init()
    // Wait for connects to finish
    await new Promise((resolve) => setTimeout(resolve, 100))

    const statuses = McpManager.getStatuses()
    expect(statuses).toHaveLength(2)

    const gitStatus = statuses.find((s) => s.name === 'git')
    expect(gitStatus).toBeDefined()
    expect(gitStatus?.status).toBe('connected')
    expect(gitStatus?.tools).toHaveLength(1)
    expect(gitStatus?.tools[0].name).toBe('test_tool')

    const disabledStatus = statuses.find((s) => s.name === 'disabledSrv')
    expect(disabledStatus).toBeDefined()
    expect(disabledStatus?.status).toBe('disabled')

    // Verify tool was registered in global registry
    const registry = getToolRegistry()
    expect(registry.has('mcp_git_test_tool')).toBe(true)

    const toolDef = registry.get('mcp_git_test_tool')
    expect(toolDef?.title).toBe('test_tool')
    expect(toolDef?.risk).toBe('medium')

    // Test execution mapping
    const executionResult = await toolDef?.execute(
      { inputVal: 'test' },
      { reqId: 'test-req', signal: new AbortController().signal }
    )
    expect(executionResult?.resultForModel).toBe('mocked tool response')
    expect(executionResult?.resultForUi.title).toBe('MCP Tool Call: git / test_tool')
    expect(mcpMockState.lastCallToolOptions).toMatchObject({
      timeout: 30000,
      resetTimeoutOnProgress: true,
      signal: expect.any(AbortSignal),
      onprogress: expect.any(Function)
    })
  })

  it('refreshes a server tool set when tools/list_changed is received', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ servers: { git: { command: 'node' } } }, null, 2),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const registry = getToolRegistry()
    expect(registry.has('mcp_git_test_tool')).toBe(true)
    mcpMockState.listToolsResults = [
      {
        tools: [
          {
            name: 'fresh.tool',
            description: 'Refreshed tool',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      }
    ]

    await mcpMockState.toolListChangedHandler?.()

    const refreshedName = toMcpModelToolName('git', 'fresh.tool')
    expect(registry.has('mcp_git_test_tool')).toBe(false)
    expect(registry.has(refreshedName)).toBe(true)
    expect(McpManager.getStatuses()[0].tools).toEqual([
      { name: 'fresh.tool', description: 'Refreshed tool' }
    ])
  })

  it('registers tools in stable sorted order so prompt bytes do not change across refreshes', async () => {
    mcpMockState.listToolsResults = [
      {
        tools: [
          {
            name: 'zeta_tool',
            description: 'z tool',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'alpha_tool',
            description: 'a tool',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'mid_tool',
            description: 'm tool',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      }
    ]
    writeFileSync(
      configPath,
      JSON.stringify({ servers: { git: { command: 'node' } } }, null, 2),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Statuses expose tools sorted by name.
    const status = McpManager.getStatuses().find((s) => s.name === 'git')
    expect(status?.tools.map((t) => t.name)).toEqual(['alpha_tool', 'mid_tool', 'zeta_tool'])

    // Registry insertion order follows the same sort.
    const registry = getToolRegistry()
    expect(registry.toolNames().filter((n) => n.startsWith('mcp_git_'))).toEqual([
      'mcp_git_alpha_tool',
      'mcp_git_mid_tool',
      'mcp_git_zeta_tool'
    ])
  })

  it('keeps structured MCP tool content visible in UI details', async () => {
    mcpMockState.callToolResult = {
      content: [
        { type: 'text', text: 'text part' },
        {
          type: 'resource',
          resource: {
            uri: 'file:///paper.md',
            text: 'resource part'
          }
        }
      ]
    }

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          servers: {
            arxiv: {
              command: 'node',
              args: ['arxiv-server.js']
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const toolDef = getToolRegistry().get('mcp_arxiv_test_tool')
    const executionResult = await toolDef?.execute(
      { inputVal: 'test' },
      { reqId: 'test-req', signal: new AbortController().signal }
    )

    expect(executionResult?.resultForModel).toContain('text part')
    expect(executionResult?.resultForModel).toContain('"uri": "file:///paper.md"')
    expect(executionResult?.resultForUi.details).toContain('resource part')
  })

  it('rejects protocol-level MCP tool errors without disconnecting the server', async () => {
    mcpMockState.callToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'remote tool failed' }]
    }
    writeFileSync(
      configPath,
      JSON.stringify({ servers: { git: { command: 'node' } } }, null, 2),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const registry = getToolRegistry()
    const toolDef = registry.get('mcp_git_test_tool')
    await expect(
      toolDef?.execute(
        { inputVal: 'test' },
        { reqId: 'test-req', signal: new AbortController().signal }
      )
    ).rejects.toThrow('remote tool failed')
    expect(McpManager.getStatuses()[0].status).toBe('connected')
    expect(registry.has('mcp_git_test_tool')).toBe(true)
  })

  it('forwards cancellation without marking the MCP server as failed', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ servers: { git: { command: 'node' } } }, null, 2),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const callToolSpy = vi.spyOn(Client.prototype, 'callTool').mockImplementation((async (
      _params: unknown,
      _schema: unknown,
      options: { signal: AbortSignal }
    ) => {
      return await new Promise((_, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true }
        )
      })
    }) as any)
    const registry = getToolRegistry()
    const controller = new AbortController()
    const execution = registry
      .get('mcp_git_test_tool')
      ?.execute({ inputVal: 'test' }, { reqId: 'test-req', signal: controller.signal })

    controller.abort()

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    expect(McpManager.getStatuses()[0].status).toBe('connected')
    expect(registry.has('mcp_git_test_tool')).toBe(true)
    callToolSpy.mockRestore()
  })

  it('supports mcpServers compatibility key', async () => {
    const mockConfig = {
      mcpServers: {
        nodeSrv: {
          command: 'node',
          args: ['node-server.js']
        }
      }
    }

    writeFileSync(configPath, JSON.stringify(mockConfig, null, 2), 'utf-8')
    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const statuses = McpManager.getStatuses()
    const srv = statuses.find((s) => s.name === 'nodeSrv')
    expect(srv).toBeDefined()
    expect(srv?.status).toBe('connected')

    const registry = getToolRegistry()
    expect(registry.has('mcp_nodeSrv_test_tool')).toBe(true)
  })

  it('handles write config raw and triggers hot-reloads', async () => {
    McpManager.init()
    expect(McpManager.getStatuses()).toHaveLength(0)

    const newConfig = JSON.stringify({
      servers: {
        hotReloaded: {
          command: 'node',
          args: ['test.js']
        }
      }
    })

    const result = McpManager.writeConfigRaw(newConfig)
    await McpManager.reload()

    const statuses = McpManager.getStatuses()
    expect(statuses).toHaveLength(1)
    expect(statuses[0].name).toBe('hotReloaded')
    expect(statuses[0].status).toBe('connected')
    expect(JSON.parse(result).servers).toHaveProperty('hotReloaded')
  })

  it('performs smart merge of pasted server config snippets', () => {
    // Write initial config
    const initialConfig = {
      servers: {
        git: {
          command: 'git',
          args: ['status']
        }
      }
    }
    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8')

    // Paste only a snippet containing arxiv-agent directly at root
    const pasted = JSON.stringify({
      'arxiv-agent': {
        command: 'python',
        args: ['-m', 'arxiv']
      }
    })

    const merged = McpManager.writeConfigRaw(pasted)
    const parsed = JSON.parse(merged)

    expect(parsed.servers).toHaveProperty('git')
    expect(parsed.servers).toHaveProperty('arxiv-agent')
    expect(parsed.servers.git.command).toBe('git')
    expect(parsed.servers['arxiv-agent'].command).toBe('python')
  })

  it('deletes one MCP server without removing other configured servers', () => {
    const initialConfig = {
      servers: {
        git: {
          command: 'git',
          args: ['status']
        },
        'arxiv-agent': {
          command: 'python',
          args: ['-m', 'arxiv_agent.mcp.server']
        }
      }
    }
    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8')

    const result = McpManager.deleteServer('arxiv-agent')
    const parsed = JSON.parse(result.config)

    expect(result.deleted).toBe(true)
    expect(parsed.servers).toHaveProperty('git')
    expect(parsed.servers).not.toHaveProperty('arxiv-agent')
  })

  it('handles connect timeout and cleans up resources', async () => {
    const mockConfig = {
      timeouts: {
        connect_timeout: 50
      },
      servers: {
        git: {
          command: 'node',
          args: ['git-server.js']
        }
      }
    }
    writeFileSync(configPath, JSON.stringify(mockConfig, null, 2), 'utf-8')

    const connectSpy = vi.spyOn(Client.prototype, 'connect').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    const closeSpy = vi.spyOn(Client.prototype, 'close')

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 150))

    const statuses = McpManager.getStatuses()
    const gitStatus = statuses.find((s) => s.name === 'git')

    expect(gitStatus).toBeDefined()
    expect(gitStatus?.status).toBe('failed')
    expect(gitStatus?.error).toContain('timed out')
    expect(closeSpy).toHaveBeenCalled()

    const registry = getToolRegistry()
    expect(registry.has('mcp_git_test_tool')).toBe(false)

    connectSpy.mockRestore()
    closeSpy.mockRestore()
  })

  it('reports a tool timeout as a failed call without tearing down the server', async () => {
    const mockConfig = {
      timeouts: {
        execute_timeout: 50
      },
      servers: {
        git: {
          command: 'node',
          args: ['git-server.js']
        }
      }
    }
    writeFileSync(configPath, JSON.stringify(mockConfig, null, 2), 'utf-8')

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    let statuses = McpManager.getStatuses()
    let gitStatus = statuses.find((s) => s.name === 'git')
    expect(gitStatus?.status).toBe('connected')
    const registry = getToolRegistry()
    expect(registry.has('mcp_git_test_tool')).toBe(true)

    const callToolSpy = vi
      .spyOn(Client.prototype, 'callTool')
      .mockRejectedValue(new Error('Request timed out after 50ms'))
    const closeSpy = vi.spyOn(Client.prototype, 'close')

    const toolDef = registry.get('mcp_git_test_tool')
    await expect(
      toolDef?.execute(
        { inputVal: 'test' },
        { reqId: 'test-req', signal: new AbortController().signal }
      )
    ).rejects.toThrow('timed out')

    // A single slow call must not kill the connection, its tools, or the cache prefix.
    expect(closeSpy).not.toHaveBeenCalled()
    statuses = McpManager.getStatuses()
    gitStatus = statuses.find((s) => s.name === 'git')
    expect(gitStatus?.status).toBe('connected')
    expect(registry.has('mcp_git_test_tool')).toBe(true)

    callToolSpy.mockRestore()
    closeSpy.mockRestore()
  })

  it('lets a server override the global execute timeout', async () => {
    const mockConfig = {
      timeouts: {
        execute_timeout: 50
      },
      servers: {
        git: {
          command: 'node',
          args: ['git-server.js'],
          timeouts: {
            execute_timeout: 100
          }
        }
      }
    }
    writeFileSync(configPath, JSON.stringify(mockConfig, null, 2), 'utf-8')

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const registry = getToolRegistry()
    const toolDef = registry.get('mcp_git_test_tool')
    await toolDef?.execute(
      { inputVal: 'test' },
      { reqId: 'test-req', signal: new AbortController().signal }
    )

    // Server-level timeout wins over the global 50ms.
    expect(mcpMockState.lastCallToolOptions?.timeout).toBe(100)
  })

  it('precisely cleans up only the tools belonging to the target server to avoid prefix collision (e.g. git vs git_extra)', async () => {
    const mockConfig = {
      servers: {
        git: {
          command: 'node',
          args: ['git-server.js']
        },
        git_extra: {
          command: 'node',
          args: ['git-extra-server.js']
        }
      }
    }
    writeFileSync(configPath, JSON.stringify(mockConfig, null, 2), 'utf-8')

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const registry = getToolRegistry()
    expect(registry.has('mcp_git_test_tool')).toBe(true)
    expect(registry.has('mcp_git_extra_test_tool')).toBe(true)

    // Directly trigger cleanupServer('git')
    await (McpManager as any).cleanupServer('git')

    // Assert "git" tools are unregistered, but "git_extra" tools are still registered
    expect(registry.has('mcp_git_test_tool')).toBe(false)
    expect(registry.has('mcp_git_extra_test_tool')).toBe(true)
  })

  it('captures server instructions for system-prompt injection', async () => {
    mcpMockState.instructions =
      'This server exposes git helpers. Call mcp_git_* tools for git operations.'
    writeFileSync(
      configPath,
      JSON.stringify({ servers: { git: { command: 'node' } } }, null, 2),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(McpManager.getServerInstructions()).toEqual([
      {
        name: 'git',
        instructions: 'This server exposes git helpers. Call mcp_git_* tools for git operations.'
      }
    ])
  })

  it('marks a server failed and unregisters its tools when the connection closes unexpectedly', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ servers: { git: { command: 'node' } } }, null, 2),
      'utf-8'
    )

    McpManager.init()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const registry = getToolRegistry()
    expect(registry.has('mcp_git_test_tool')).toBe(true)

    const client = (McpManager as any).clients.get('git')
    expect(client).toBeDefined()
    expect(typeof client.onclose).toBe('function')

    client.onclose()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const status = McpManager.getStatuses().find((s) => s.name === 'git')
    expect(status?.status).toBe('failed')
    expect(status?.error).toContain('closed')
    expect(registry.has('mcp_git_test_tool')).toBe(false)
    expect(McpManager.getServerInstructions()).toEqual([])
  })
})
